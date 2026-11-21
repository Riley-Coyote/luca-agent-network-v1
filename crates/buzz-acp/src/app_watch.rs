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

/// Watch `app` until it is gone, then stop the runner: mark `gone` (unless
/// another reason already asked the runner to stop) and send on `shutdown`.
async fn watch_app(
    app: u32,
    interval: Duration,
    current_parent: impl Fn() -> u32,
    shutdown: watch::Sender<()>,
    gone: Arc<AtomicBool>,
) {
    // Subscribed before the first look, so it can tell whether SIGTERM,
    // Ctrl+C, the owner or the signing channel asked first.
    let earlier = shutdown.subscribe();
    app_departed(app, interval, current_parent).await;
    tracing::warn!("the app that started this runner is gone; stopping");
    if matches!(earlier.has_changed(), Ok(false)) {
        gone.store(true, Ordering::SeqCst);
    }
    let _ = shutdown.send(());
}

/// The decision taken at start, which app (if any) this runner watches, and
/// whether that app is now gone.
#[derive(Debug)]
pub(crate) struct AppWatch {
    app: Option<u32>,
    gone: Arc<AtomicBool>,
}

impl AppWatch {
    /// Read the stamp and the runner's parent once, as early as possible.
    ///
    /// A runner whose app died in the instant before this check already has
    /// another parent, so its watch stays off; that one case is left to the
    /// app's start-up sweep on its next launch.
    pub(crate) fn at_start() -> Self {
        #[cfg(unix)]
        {
            let raw = std::env::var(DESKTOP_OWNER_PID_ENV).ok();
            Self::decide(raw.as_deref(), std::os::unix::process::parent_id())
        }
        #[cfg(not(unix))]
        {
            Self::off()
        }
    }

    fn off() -> Self {
        Self {
            app: None,
            gone: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Decide from the stamp's raw value and the parent at start, saying why
    /// once when the watch stays off for a reason worth knowing.
    fn decide(raw: Option<&str>, parent_at_start: u32) -> Self {
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
        Self { app, ..Self::off() }
    }

    /// Start watching, if armed: when the app is gone, say so once and send
    /// on `shutdown`, the signal every other reason to stop already uses.
    pub(crate) fn spawn(&self, shutdown: watch::Sender<()>) {
        #[cfg(unix)]
        if let Some(app) = self.app {
            tokio::spawn(watch_app(
                app,
                WATCH_INTERVAL,
                std::os::unix::process::parent_id,
                shutdown,
                Arc::clone(&self.gone),
            ));
        }
        #[cfg(not(unix))]
        let _ = shutdown;
    }

    /// How long the shutdown waits for turns in flight: `usual`, or no time
    /// at all when this watch is what stopped the runner.
    ///
    /// Nobody is left to read a reply once the app is gone, and a turn can
    /// hold that wait for its full length. With no wait, the turns are
    /// aborted at once and each agent's process group is killed by the
    /// crate's own `AcpClient` cleanup, so the runner and its agents end
    /// within seconds. Every other reason to stop keeps `usual`.
    pub(crate) fn shutdown_grace(&self, usual: Duration) -> Duration {
        if self.gone.load(Ordering::SeqCst) {
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
            let decided = AppWatch::decide(raw, parent);
            assert_eq!(decided.app, None, "{raw:?} with parent {parent}");
            assert_eq!(decided.shutdown_grace(USUAL_GRACE), USUAL_GRACE);
        }
        assert_eq!(AppWatch::decide(Some("4242"), 4242).app, Some(4242));
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
        let parent = Arc::new(AtomicU32::new(4242));
        let reader = Arc::clone(&parent);
        let watcher = AppWatch::decide(Some("4242"), 4242);
        let (tx, mut rx) = watch::channel(());
        let task = tokio::spawn(watch_app(
            4242,
            WATCH_INTERVAL,
            move || reader.load(Ordering::SeqCst),
            tx,
            Arc::clone(&watcher.gone),
        ));

        tokio::time::sleep(Duration::from_secs(600)).await;
        assert!(!rx.has_changed().expect("sender alive"), "sent too early");
        assert_eq!(watcher.shutdown_grace(USUAL_GRACE), USUAL_GRACE);

        parent.store(1, Ordering::SeqCst);
        tokio::time::timeout(WATCH_INTERVAL * 2, rx.changed())
            .await
            .expect("must send within one look")
            .expect("sender alive until it sends");
        assert_eq!(watcher.shutdown_grace(USUAL_GRACE), Duration::ZERO);
        task.await.expect("watch task");
    }

    #[tokio::test(start_paused = true)]
    async fn another_reason_first_keeps_the_usual_wait() {
        let parent = Arc::new(AtomicU32::new(4242));
        let reader = Arc::clone(&parent);
        let watcher = AppWatch::decide(Some("4242"), 4242);
        let (tx, _rx) = watch::channel(());
        let sigterm = tx.clone();
        let task = tokio::spawn(watch_app(
            4242,
            WATCH_INTERVAL,
            move || reader.load(Ordering::SeqCst),
            tx,
            Arc::clone(&watcher.gone),
        ));
        tokio::time::sleep(Duration::from_secs(5)).await;

        // SIGTERM (or the owner, Ctrl+C, the signing channel) asks first;
        // the app leaving afterwards does not shorten that shutdown.
        sigterm.send(()).expect("receiver alive");
        parent.store(1, Ordering::SeqCst);
        tokio::time::timeout(WATCH_INTERVAL * 2, task)
            .await
            .expect("the watch still ends")
            .expect("watch task");
        assert_eq!(watcher.shutdown_grace(USUAL_GRACE), USUAL_GRACE);
    }

    #[cfg(unix)]
    #[tokio::test(start_paused = true)]
    async fn an_unarmed_watch_never_sends() {
        let (tx, mut rx) = watch::channel(());
        let watcher = AppWatch::off();
        watcher.spawn(tx.clone());
        tokio::time::sleep(Duration::from_secs(3600)).await;
        assert!(!rx.has_changed().expect("sender alive"));
        drop(tx);
        // Every sender is gone: nothing was ever sent and nothing holds one.
        assert!(rx.changed().await.is_err());
        assert_eq!(watcher.shutdown_grace(USUAL_GRACE), USUAL_GRACE);
    }

    #[cfg(unix)]
    #[tokio::test(start_paused = true)]
    async fn an_armed_watch_reads_the_real_parent() {
        // This test process's real parent is alive and is not pid 1, so a
        // watch armed on pid 1 sees "its app" gone on the first look.
        assert_ne!(std::os::unix::process::parent_id(), 1);
        let watcher = AppWatch {
            app: Some(1),
            ..AppWatch::off()
        };
        let (tx, mut rx) = watch::channel(());
        watcher.spawn(tx);
        tokio::time::timeout(Duration::from_secs(5), rx.changed())
            .await
            .expect("the watch must send")
            .expect("sender alive until it sends");
        assert_eq!(watcher.shutdown_grace(USUAL_GRACE), Duration::ZERO);
    }
}
