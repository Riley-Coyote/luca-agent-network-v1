//! The runner leaves when the app that started it is gone.
//!
//! The desktop app stamps every runner it starts with its own process id. A
//! runner the app started directly watches that app: once its parent is no
//! longer the stamped process (the app crashed or was force-quit, and the
//! runner was handed to launchd/init), it sends the same shutdown signal that
//! SIGTERM, Ctrl+C and the owner's command send, so its agent goes with it.
//!
//! A runner started any other way (by hand, in a test, under another harness,
//! or further down the app's tree, where the inherited stamp names an app that
//! is not its parent) never looks.
//!
//! Unix only: elsewhere the watch is never armed and nothing changes.
#![cfg_attr(not(unix), allow(dead_code))]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::watch;

/// The variable the desktop app stamps on every runner it starts, naming the
/// app's own process id.
///
/// This is the same string as `DESKTOP_OWNER_PID_ENV` in the desktop crate
/// (`desktop/src-tauri/src/managed_agents/runtime.rs`). This crate cannot
/// import that constant, so a test on the desktop side pins the name: a
/// silent rename there would turn this watch off.
const DESKTOP_OWNER_PID_ENV: &str = "BUZZ_MANAGED_DESKTOP_PID";

/// How often an armed watch looks at the runner's parent.
const WATCH_INTERVAL: Duration = Duration::from_secs(1);

/// What the stamp says, read once at start.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Stamp {
    /// Not set, or set to nothing: the runner was not started by the app.
    Absent,
    /// Set, but not a positive process id.
    Malformed,
    /// The app's process id.
    App(u32),
}

/// Read the stamp's raw value. Never fails: a bad value only turns the watch off.
fn parse_stamp(raw: Option<&str>) -> Stamp {
    let Some(raw) = raw.map(str::trim).filter(|value| !value.is_empty()) else {
        return Stamp::Absent;
    };
    match raw.parse::<u32>() {
        Ok(pid) if pid > 0 => Stamp::App(pid),
        _ => Stamp::Malformed,
    }
}

/// The app to watch, if any: only when the runner's parent at start IS the
/// stamped app. The stamp is inherited by everything below the runner, so a
/// process further down the tree carries it too and must never look.
fn armed_app(stamp: Stamp, parent_at_start: u32) -> Option<u32> {
    match stamp {
        Stamp::App(app) if app == parent_at_start => Some(app),
        _ => None,
    }
}

/// Resolve once `current_parent` stops reporting `app`, looking every
/// `interval`, starting at once.
async fn app_departed(app: u32, interval: Duration, current_parent: impl Fn() -> u32) {
    loop {
        if current_parent() != app {
            return;
        }
        tokio::time::sleep(interval).await;
    }
}

/// Watch `app` until it is gone, then say so once and mark `gone`.
async fn watch_app(
    app: u32,
    interval: Duration,
    current_parent: impl Fn() -> u32,
    gone: watch::Sender<bool>,
) {
    app_departed(app, interval, current_parent).await;
    tracing::warn!("the app that started this runner is gone; stopping");
    let _ = gone.send(true);
}

/// Resolve once `gone` turns true; never, when nothing can set it (unarmed).
async fn until_gone(mut gone: watch::Receiver<bool>) {
    if gone.wait_for(|gone| *gone).await.is_err() {
        std::future::pending::<()>().await;
    }
}

/// When `gone` turns true, stop the runner by sending on `shutdown`, and
/// mark `stopped_runner` unless another reason already asked first.
async fn stop_when_gone(
    gone: watch::Receiver<bool>,
    shutdown: watch::Sender<()>,
    stopped_runner: Arc<AtomicBool>,
) {
    // Subscribed before waiting, so it can tell whether SIGTERM, Ctrl+C,
    // the owner or the signing channel asked first.
    let earlier = shutdown.subscribe();
    until_gone(gone).await;
    if matches!(earlier.has_changed(), Ok(false)) {
        stopped_runner.store(true, Ordering::SeqCst);
    }
    let _ = shutdown.send(());
}

/// Which app (if any) this runner watches, decided once at start, and what
/// the watch has seen since.
#[derive(Debug)]
pub(crate) struct AppWatch {
    app: Option<u32>,
    /// True once the app is seen gone. Its only sender lives in the watch
    /// task, so an unarmed watch has none.
    gone: watch::Receiver<bool>,
    /// True when the app leaving is what stopped the runner.
    stopped_runner: Arc<AtomicBool>,
}

impl AppWatch {
    /// Read the stamp and the runner's parent once, as early as possible,
    /// and start watching when armed.
    ///
    /// A runner whose app died in the instant before this check already has
    /// another parent, so its watch stays off; that one case is left to the
    /// app's start-up sweep on its next launch.
    pub(crate) fn at_start() -> Self {
        #[cfg(unix)]
        {
            let raw = std::env::var(DESKTOP_OWNER_PID_ENV).ok();
            let app = Self::decide(raw.as_deref(), std::os::unix::process::parent_id());
            Self::start(app, WATCH_INTERVAL, std::os::unix::process::parent_id)
        }
        #[cfg(not(unix))]
        {
            Self::start(None, WATCH_INTERVAL, || 0)
        }
    }

    /// Decide from the stamp's raw value and the parent at start, saying why
    /// once when the watch stays off for a reason worth knowing.
    fn decide(raw: Option<&str>, parent_at_start: u32) -> Option<u32> {
        let stamp = parse_stamp(raw);
        let app = armed_app(stamp, parent_at_start);
        match stamp {
            Stamp::Absent => {}
            Stamp::Malformed => tracing::warn!(
                "{DESKTOP_OWNER_PID_ENV} is not a positive process id; the app watch stays off"
            ),
            Stamp::App(_) if app.is_none() => tracing::debug!(
                "this runner's parent is not the app named by {DESKTOP_OWNER_PID_ENV}; the app watch stays off"
            ),
            Stamp::App(_) => {}
        }
        app
    }

    /// Start the one watch task for `app`, reading the parent through
    /// `current_parent`; with no `app`, start nothing.
    fn start(
        app: Option<u32>,
        interval: Duration,
        current_parent: impl Fn() -> u32 + Send + 'static,
    ) -> Self {
        let (gone_tx, gone) = watch::channel(false);
        match app {
            Some(app) => {
                tokio::spawn(watch_app(app, interval, current_parent, gone_tx));
            }
            None => drop(gone_tx),
        }
        Self {
            app,
            gone,
            stopped_runner: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Resolve once the app is gone (at once if it already is); never, when
    /// unarmed. The start-up and the setup listener race this.
    pub(crate) async fn gone(&self) {
        until_gone(self.gone.clone()).await;
    }

    /// From now on, the app leaving sends on `shutdown`, the signal every
    /// other reason to stop already uses. Nothing, when unarmed.
    pub(crate) fn stop_runner_when_gone(&self, shutdown: watch::Sender<()>) {
        if self.app.is_some() {
            tokio::spawn(stop_when_gone(
                self.gone.clone(),
                shutdown,
                Arc::clone(&self.stopped_runner),
            ));
        }
    }

    /// How long the shutdown waits for turns in flight: `usual`, or no time
    /// at all when the app leaving is what stopped the runner.
    ///
    /// Nobody is left to read a reply once the app is gone, and a turn can
    /// hold that wait for its full length. With no wait, the turns are
    /// aborted at once and each agent's process group is killed by the
    /// crate's own `AcpClient` cleanup, so the runner and its agents end
    /// within seconds. Every other reason to stop keeps `usual`.
    pub(crate) fn shutdown_grace(&self, usual: Duration) -> Duration {
        if self.stopped_runner.load(Ordering::SeqCst) {
            Duration::ZERO
        } else {
            usual
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, AtomicUsize};

    const USUAL_GRACE: Duration = Duration::from_secs(30);

    /// A watch on app 4242 whose parent a test can change.
    fn watch_with_parent() -> (AppWatch, Arc<AtomicU32>) {
        let parent = Arc::new(AtomicU32::new(4242));
        let reader = Arc::clone(&parent);
        let watcher = AppWatch::start(Some(4242), WATCH_INTERVAL, move || {
            reader.load(Ordering::SeqCst)
        });
        (watcher, parent)
    }

    #[test]
    fn the_stamp_is_a_positive_pid_or_nothing() {
        assert_eq!(parse_stamp(None), Stamp::Absent);
        assert_eq!(parse_stamp(Some("")), Stamp::Absent);
        assert_eq!(parse_stamp(Some("  \n")), Stamp::Absent);
        assert_eq!(parse_stamp(Some("0")), Stamp::Malformed);
        assert_eq!(parse_stamp(Some("-1")), Stamp::Malformed);
        assert_eq!(parse_stamp(Some("app")), Stamp::Malformed);
        assert_eq!(parse_stamp(Some("12x")), Stamp::Malformed);
        assert_eq!(parse_stamp(Some("99999999999")), Stamp::Malformed);
        assert_eq!(parse_stamp(Some("4242")), Stamp::App(4242));
        assert_eq!(parse_stamp(Some(" 4242\n")), Stamp::App(4242));
    }

    #[test]
    fn only_the_apps_own_child_arms() {
        assert_eq!(armed_app(Stamp::App(4242), 4242), Some(4242));
        // Started further down the tree, or through a wrapper.
        assert_eq!(armed_app(Stamp::App(4242), 777), None);
        // The app already gone at start: the parent is launchd/init.
        assert_eq!(armed_app(Stamp::App(4242), 1), None);
        assert_eq!(armed_app(Stamp::Absent, 4242), None);
        assert_eq!(armed_app(Stamp::Malformed, 4242), None);
    }

    #[test]
    fn the_decision_never_refuses_and_arms_only_on_a_match() {
        for (raw, parent) in [
            (None, 4242),
            (Some(""), 4242),
            (Some("0"), 4242),
            (Some("nope"), 4242),
            (Some("4242"), 777),
        ] {
            assert_eq!(
                AppWatch::decide(raw, parent),
                None,
                "{raw:?} with parent {parent}"
            );
        }
        assert_eq!(AppWatch::decide(Some("4242"), 4242), Some(4242));
    }

    #[tokio::test(start_paused = true)]
    async fn the_watch_resolves_when_the_parent_changes_and_not_before() {
        let parent = Arc::new(AtomicU32::new(4242));
        let looks = Arc::new(AtomicUsize::new(0));
        let (reader_parent, reader_looks) = (Arc::clone(&parent), Arc::clone(&looks));
        let watch = tokio::spawn(app_departed(4242, WATCH_INTERVAL, move || {
            reader_looks.fetch_add(1, Ordering::SeqCst);
            reader_parent.load(Ordering::SeqCst)
        }));

        // An hour with the app still its parent: it keeps looking, once a
        // second, and never resolves.
        tokio::time::sleep(Duration::from_secs(3600)).await;
        assert!(
            !watch.is_finished(),
            "resolved while the app was its parent"
        );
        let looked = looks.load(Ordering::SeqCst);
        assert!(
            (3600..=3602).contains(&looked),
            "looked {looked} times in an hour"
        );

        // The app is gone and the runner was handed to launchd.
        parent.store(1, Ordering::SeqCst);
        tokio::time::sleep(WATCH_INTERVAL).await;
        tokio::task::yield_now().await;
        assert!(watch.is_finished(), "did not resolve within one look");
        watch.await.expect("watch task");
    }

    #[tokio::test(start_paused = true)]
    async fn an_app_already_gone_resolves_on_the_first_look() {
        let watched = app_departed(4242, WATCH_INTERVAL, || 1);
        tokio::time::timeout(Duration::from_millis(1), watched)
            .await
            .expect("the first look must resolve without waiting");
    }

    #[tokio::test(start_paused = true)]
    async fn the_app_leaving_stops_the_runner_without_the_usual_wait() {
        let (watcher, parent) = watch_with_parent();
        let (tx, mut rx) = watch::channel(());
        watcher.stop_runner_when_gone(tx);

        tokio::time::sleep(Duration::from_secs(600)).await;
        assert!(!rx.has_changed().expect("sender alive"), "sent too early");
        assert_eq!(watcher.shutdown_grace(USUAL_GRACE), USUAL_GRACE);

        parent.store(1, Ordering::SeqCst);
        tokio::time::timeout(WATCH_INTERVAL * 2, rx.changed())
            .await
            .expect("must send within one look")
            .expect("sender alive until it sends");
        assert_eq!(watcher.shutdown_grace(USUAL_GRACE), Duration::ZERO);
    }

    #[tokio::test(start_paused = true)]
    async fn another_reason_first_keeps_the_usual_wait() {
        let (watcher, parent) = watch_with_parent();
        let (tx, mut rx) = watch::channel(());
        let sigterm = tx.clone();
        watcher.stop_runner_when_gone(tx);
        tokio::time::sleep(Duration::from_secs(5)).await;

        // SIGTERM (or the owner, Ctrl+C, the signing channel) asks first;
        // the app leaving afterwards does not shorten that shutdown.
        sigterm.send(()).expect("receiver alive");
        rx.borrow_and_update();
        parent.store(1, Ordering::SeqCst);
        tokio::time::timeout(WATCH_INTERVAL * 2, rx.changed())
            .await
            .expect("the watch still sends")
            .expect("sender alive");
        assert_eq!(watcher.shutdown_grace(USUAL_GRACE), USUAL_GRACE);
    }

    #[tokio::test(start_paused = true)]
    async fn the_start_up_and_setup_wait_ends_only_once_the_app_is_gone() {
        let (watcher, parent) = watch_with_parent();
        assert!(
            tokio::time::timeout(Duration::from_secs(3600), watcher.gone())
                .await
                .is_err(),
            "ended while the app was its parent"
        );
        parent.store(1, Ordering::SeqCst);
        tokio::time::timeout(WATCH_INTERVAL * 2, watcher.gone())
            .await
            .expect("must end within one look");
        // Already gone: a later wait ends at once, and nothing stopped the
        // runner through the shutdown channel.
        tokio::time::timeout(Duration::from_millis(1), watcher.gone())
            .await
            .expect("must end at once once gone");
        assert_eq!(watcher.shutdown_grace(USUAL_GRACE), USUAL_GRACE);
    }

    #[tokio::test(start_paused = true)]
    async fn an_unarmed_watch_never_ends_anything() {
        let looks = Arc::new(AtomicUsize::new(0));
        let reader_looks = Arc::clone(&looks);
        // The reader reports a different parent on every look, so any look
        // at all would end the watch.
        let watcher = AppWatch::start(None, WATCH_INTERVAL, move || {
            reader_looks.fetch_add(1, Ordering::SeqCst);
            1
        });
        let (tx, mut rx) = watch::channel(());
        watcher.stop_runner_when_gone(tx.clone());
        assert!(
            tokio::time::timeout(Duration::from_secs(3600), watcher.gone())
                .await
                .is_err(),
            "an unarmed watch must never end the start-up or setup listener"
        );
        assert!(!rx.has_changed().expect("sender alive"));
        drop(tx);
        // Every sender is gone: nothing was ever sent and nothing holds one.
        assert!(rx.changed().await.is_err());
        assert_eq!(looks.load(Ordering::SeqCst), 0, "it must never look");
        assert_eq!(watcher.shutdown_grace(USUAL_GRACE), USUAL_GRACE);
    }

    #[cfg(unix)]
    #[tokio::test(start_paused = true)]
    async fn an_armed_watch_reads_the_real_parent() {
        // Armed on this test's OWN process id, which is never its parent,
        // so "its app" is gone on the first look wherever the test runs.
        let watcher = AppWatch::start(
            Some(std::process::id()),
            WATCH_INTERVAL,
            std::os::unix::process::parent_id,
        );
        let (tx, mut rx) = watch::channel(());
        watcher.stop_runner_when_gone(tx);
        tokio::time::timeout(Duration::from_secs(5), rx.changed())
            .await
            .expect("the watch must send")
            .expect("sender alive until it sends");
        assert_eq!(watcher.shutdown_grace(USUAL_GRACE), Duration::ZERO);
    }
}
