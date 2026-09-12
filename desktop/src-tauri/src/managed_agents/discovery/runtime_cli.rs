//! Where a runtime CLI actually lives, and whether it is new enough to use.
//!
//! Background (WP-SETUP1, 2026-09-12): on a clean Mac the app found
//! `/opt/homebrew/bin/codex` — a symlink to `@openai/codex` **0.1.2504161551**
//! installed 2025-04-16 — declared Codex "installed", and then asked the owner
//! to sign in to something they were already signed in to. The real Codex
//! (`/Applications/ChatGPT.app/Contents/Resources/codex`, `codex-cli
//! 0.154.0-alpha.6.2`, already `Logged in using ChatGPT`) was never looked at,
//! because it is not on any shell PATH.
//!
//! This module fixes both halves:
//!
//! * **Look where runtimes actually live.** A fixed, logged search order that
//!   starts with an explicit user override and known application-bundle
//!   locations, then the well-known bin directories, then the login-shell
//!   PATH, then the app's own managed tooling.
//! * **Refuse a fossil.** Every candidate is probed for `--version` and gated
//!   against a minimum sourced from the adapter's own dependency pin. A
//!   candidate below the minimum is *not a find*: it is recorded, with the
//!   reason, and skipped. When several candidates pass, the newest wins.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use super::KnownAcpRuntime;
use crate::managed_agents::{buzz_managed_node_bin_dir, buzz_managed_npm_bin_dir};

/// A place the search looks, in order, for a runtime CLI.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SearchLocation {
    /// `$<VAR>` — an explicit path set by the owner. Always wins.
    Override { env_var: String },
    /// A CLI that ships inside an application bundle (ChatGPT.app, …).
    Bundle { path: PathBuf },
    /// A well-known bin directory, searched whether or not it is on PATH.
    Directory { path: PathBuf },
    /// `zsh -l -c 'command -v <cli>'` — right for setups we cannot enumerate.
    LoginShell,
    /// The app's own managed node-tools prefix.
    Managed { path: PathBuf },
}

impl SearchLocation {
    pub(crate) fn describe(&self) -> String {
        match self {
            SearchLocation::Override { env_var } => format!("override ${env_var}"),
            SearchLocation::Bundle { path } => format!("bundle {}", path.display()),
            SearchLocation::Directory { path } => format!("dir {}", path.display()),
            SearchLocation::LoginShell => "login-shell PATH".to_string(),
            SearchLocation::Managed { path } => format!("managed {}", path.display()),
        }
    }
}

/// Why a candidate that exists on disk was not accepted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RejectedCandidate {
    pub path: PathBuf,
    pub version: Option<String>,
    pub reason: String,
}

/// The outcome of looking for one runtime's CLI.
#[derive(Debug, Clone, Default)]
pub(crate) struct RuntimeCliResolution {
    /// The newest candidate that met the minimum, if any.
    pub path: Option<PathBuf>,
    /// Its reported version string, verbatim.
    pub version: Option<String>,
    /// Candidates found but refused, each with the reason.
    pub rejected: Vec<RejectedCandidate>,
    /// Every location consulted, in order, as human-readable strings.
    pub searched: Vec<String>,
}

/// Expand a leading `~/` against the current home directory.
fn expand_home(raw: &str) -> Option<PathBuf> {
    if let Some(rest) = raw.strip_prefix("~/") {
        return dirs::home_dir().map(|home| home.join(rest));
    }
    Some(PathBuf::from(raw))
}

/// The well-known bin directories, in the order Decision 1 fixes them.
///
/// These are searched *whether or not* they are on any shell PATH — the whole
/// point of the clean-Mac failure is that the interesting directory was not.
fn well_known_dirs() -> Vec<PathBuf> {
    let mut dirs_out: Vec<PathBuf> = Vec::new();
    if let Some(home) = dirs::home_dir() {
        dirs_out.push(home.join(".local/bin"));
    }
    dirs_out.push(PathBuf::from("/opt/homebrew/bin"));
    dirs_out.push(PathBuf::from("/usr/local/bin"));
    if let Some(home) = dirs::home_dir() {
        dirs_out.push(home.join(".bun/bin"));
        dirs_out.push(home.join(".npm-global/bin"));
    }
    dirs_out.push(PathBuf::from("/usr/bin"));
    dirs_out.push(PathBuf::from("/home/linuxbrew/.linuxbrew/bin"));
    dirs_out
}

/// The full, ordered search plan for one runtime's CLI.
///
/// Pure — builds no processes and touches no disk beyond `dirs::home_dir()`.
/// Exposed so the startup log and the tests can both read the same list.
pub(crate) fn cli_search_order(runtime: &KnownAcpRuntime) -> Vec<SearchLocation> {
    let mut order = Vec::new();
    if let Some(env_var) = runtime.cli_override_env {
        order.push(SearchLocation::Override {
            env_var: env_var.to_string(),
        });
    }
    for raw in runtime.bundle_cli_paths {
        if let Some(path) = expand_home(raw) {
            order.push(SearchLocation::Bundle { path });
        }
    }
    for path in well_known_dirs() {
        order.push(SearchLocation::Directory { path });
    }
    order.push(SearchLocation::LoginShell);
    for managed in [buzz_managed_npm_bin_dir(), buzz_managed_node_bin_dir()]
        .into_iter()
        .flatten()
    {
        order.push(SearchLocation::Managed { path: managed });
    }
    order
}

/// Pull the first dotted numeric token out of a `--version` line.
///
/// Handles both shapes seen in the wild:
/// `codex-cli 0.154.0-alpha.6.2` → `(0, 154, 0)`, and the bare
/// `0.1.2504161551` the April-2025 relic prints → `(0, 1, 2504161551)`.
/// Pre-release and build suffixes are dropped before comparison, so an alpha
/// of a new-enough line still counts as new enough.
pub(crate) fn parse_cli_version(output: &str) -> Option<(u64, u64, u64)> {
    for token in output.split_whitespace() {
        let core = token
            .trim_start_matches('v')
            .split(['-', '+'])
            .next()
            .unwrap_or("");
        let mut parts = core.split('.');
        let (Some(major), Some(minor)) = (parts.next(), parts.next()) else {
            continue;
        };
        let patch = parts.next().unwrap_or("0");
        if let (Ok(major), Ok(minor), Ok(patch)) = (
            major.parse::<u64>(),
            minor.parse::<u64>(),
            patch.parse::<u64>(),
        ) {
            return Some((major, minor, patch));
        }
    }
    None
}

/// Run `<path> <args…>` with a hard deadline and return trimmed stdout+stderr.
///
/// Bounded at 5 seconds. A CLI that cannot start at all (the relic's
/// `#!/usr/bin/env node` shebang with no `node` on PATH) fails here, which is
/// exactly the right answer: a binary that cannot run is not a find.
fn run_version_probe(path: &Path, args: &[&str]) -> Option<String> {
    use std::io::{Read as _, Seek as _, SeekFrom};
    const TIMEOUT: Duration = Duration::from_secs(5);

    let mut tmp = tempfile::tempfile().ok()?;
    let mut command = Command::new(path);
    command.args(args);
    if let Some(augmented) = crate::managed_agents::readiness::cli_probe::augmented_path() {
        command.env("PATH", augmented);
    }
    let mut child = command
        .stdin(std::process::Stdio::null())
        .stdout(tmp.try_clone().ok()?)
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;

    let deadline = Instant::now() + TIMEOUT;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    };
    if !status.success() {
        return None;
    }
    tmp.seek(SeekFrom::Start(0)).ok()?;
    let mut buf = Vec::with_capacity(128);
    let _ = (&mut tmp as &mut dyn std::io::Read)
        .take(4096)
        .read_to_end(&mut buf);
    let text = String::from_utf8_lossy(&buf).trim().to_string();
    (!text.is_empty()).then_some(text)
}

fn is_executable_file(path: &Path) -> bool {
    super::is_executable_file(path)
}

fn format_version(v: (u64, u64, u64)) -> String {
    format!("{}.{}.{}", v.0, v.1, v.2)
}

/// Find the newest usable CLI for `runtime`, refusing anything below its
/// minimum and recording why.
///
/// Every candidate is probed, not just the first hit, so a fossil early on a
/// PATH cannot shadow a current binary found later.
pub(crate) fn resolve_runtime_cli(runtime: &KnownAcpRuntime) -> RuntimeCliResolution {
    let Some(cli) = runtime.underlying_cli else {
        return RuntimeCliResolution::default();
    };
    let mut result = RuntimeCliResolution::default();
    let mut best: Option<((u64, u64, u64), PathBuf, String)> = None;
    let mut unversioned: Option<PathBuf> = None;
    let mut seen: Vec<PathBuf> = Vec::new();

    let version_args: Vec<&str> = if runtime.cli_version_args.is_empty() {
        vec!["--version"]
    } else {
        runtime.cli_version_args.to_vec()
    };

    for location in cli_search_order(runtime) {
        result.searched.push(location.describe());
        let candidate = match &location {
            SearchLocation::Override { env_var } => std::env::var_os(env_var)
                .map(PathBuf::from)
                .filter(|p| is_executable_file(p)),
            SearchLocation::Bundle { path } => is_executable_file(path).then(|| path.clone()),
            SearchLocation::Directory { path } | SearchLocation::Managed { path } => {
                let joined = path.join(cli);
                is_executable_file(&joined).then_some(joined)
            }
            SearchLocation::LoginShell => super::find_via_login_shell(cli),
        };
        let Some(candidate) = candidate else { continue };
        let canonical = std::fs::canonicalize(&candidate).unwrap_or_else(|_| candidate.clone());
        if seen.contains(&canonical) {
            continue;
        }
        seen.push(canonical);

        // An override is the owner's explicit instruction. Honour it even when
        // it will not answer `--version`; refusing it would leave no way out.
        let is_override = matches!(location, SearchLocation::Override { .. });

        let raw = run_version_probe(&candidate, &version_args);
        let Some(raw) = raw else {
            if is_override {
                result.path = Some(candidate.clone());
                result.version = None;
                return result;
            }
            result.rejected.push(RejectedCandidate {
                path: candidate,
                version: None,
                reason: "does not answer --version (cannot start, or too old to have the flag)"
                    .to_string(),
            });
            continue;
        };
        let parsed = parse_cli_version(&raw);
        let Some(parsed) = parsed else {
            if unversioned.is_none() {
                unversioned = Some(candidate.clone());
            }
            result.rejected.push(RejectedCandidate {
                path: candidate,
                version: Some(raw),
                reason: "version output could not be parsed".to_string(),
            });
            continue;
        };
        if let Some(minimum) = runtime.min_cli_version {
            if parsed < minimum {
                result.rejected.push(RejectedCandidate {
                    path: candidate,
                    version: Some(raw),
                    reason: format!(
                        "below the minimum {} required by {}",
                        format_version(minimum),
                        runtime.min_cli_version_source.unwrap_or("the ACP adapter"),
                    ),
                });
                continue;
            }
        }
        if best.as_ref().is_none_or(|(seen, _, _)| parsed > *seen) {
            best = Some((parsed, candidate, raw));
        }
        if is_override {
            break;
        }
    }

    if let Some((_, path, raw)) = best {
        result.path = Some(path);
        result.version = Some(raw);
    } else if runtime.min_cli_version.is_none() {
        // No minimum to enforce and nothing answered a parseable version:
        // fall back to the first thing that at least exists and runs.
        result.path = unversioned;
    }
    result
}

/// The app-owned directory holding one symlink per chosen runtime CLI.
///
/// Prepended to every child process's PATH. Without it, a runtime that lives
/// inside an application bundle stays invisible to the ACP adapter we spawn,
/// and a fossil earlier on the shell PATH answers in its place — which is
/// exactly the clean-Mac failure, one layer down.
pub(crate) fn runtime_shim_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join("Buzz").join("runtime-bin"))
}

/// Point `<runtime-bin>/<cli>` at the CLI this app decided to use.
///
/// Idempotent: an existing link to the same target is left alone, and a link
/// to a stale target is replaced. Best-effort — a failure here degrades to the
/// previous behaviour rather than blocking discovery.
pub(crate) fn link_runtime_cli(cli: &str, target: &Path) {
    let Some(dir) = runtime_shim_dir() else {
        return;
    };
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let link = dir.join(cli);
    if let Ok(existing) = std::fs::read_link(&link) {
        if existing == target {
            return;
        }
    }
    let _ = std::fs::remove_file(&link);
    #[cfg(unix)]
    let outcome = std::os::unix::fs::symlink(target, &link);
    #[cfg(windows)]
    let outcome = std::fs::copy(target, &link).map(|_| ());
    if outcome.is_ok() {
        eprintln!(
            "[runtime-discovery] linked {} -> {}",
            link.display(),
            target.display()
        );
    }
}

/// How an already-signed-in runtime was recognised.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ExistingAuth {
    pub runtime_id: &'static str,
    /// e.g. `~/.codex/auth.json (auth_mode: chatgpt)`
    pub how: String,
    /// e.g. `ChatGPT`, when the auth file names the mode.
    pub mode: Option<String>,
}

/// Read a runtime's own auth file and say whether it shows a live session.
///
/// Cheap and offline — one small JSON read, no process spawn. Runs *before*
/// the CLI auth probe so a signed-in owner is never shown a sign-in step while
/// a subprocess is still starting up.
pub(crate) fn existing_auth_from_file(runtime: &KnownAcpRuntime) -> Option<ExistingAuth> {
    for raw in runtime.auth_files {
        let Some(path) = expand_home(raw) else {
            continue;
        };
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else {
            continue;
        };
        let mode = json
            .get("auth_mode")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let has_tokens = json.get("tokens").map(|v| !v.is_null()).unwrap_or(false)
            || json
                .get("OPENAI_API_KEY")
                .and_then(|v| v.as_str())
                .is_some_and(|k| !k.is_empty())
            || json
                .get("apiKey")
                .and_then(|v| v.as_str())
                .is_some_and(|k| !k.is_empty());
        if mode.is_some() || has_tokens {
            let how = match &mode {
                Some(mode) => format!("{raw} (auth_mode: {mode})"),
                None => format!("{raw} (credentials present)"),
            };
            return Some(ExistingAuth {
                runtime_id: runtime.id,
                how,
                mode: mode.map(|m| match m.as_str() {
                    "chatgpt" => "ChatGPT".to_string(),
                    other => other.to_string(),
                }),
            });
        }
    }
    None
}

/// Write the whole search plan to the app log once per process.
///
/// Decision 1 asks for every location searched to be reported "once, at
/// startup". This is that line: one block, first call wins, so a Doctor re-run
/// does not spam the log.
pub(crate) fn log_search_order_once(runtimes: &[KnownAcpRuntime]) {
    static LOGGED: OnceLock<()> = OnceLock::new();
    if LOGGED.set(()).is_err() {
        return;
    }
    for runtime in runtimes {
        let Some(cli) = runtime.underlying_cli else {
            continue;
        };
        let order: Vec<String> = cli_search_order(runtime)
            .iter()
            .map(SearchLocation::describe)
            .collect();
        eprintln!(
            "[runtime-discovery] {}: searching for `{}` (minimum {}, source: {}) in order: {}",
            runtime.id,
            cli,
            runtime
                .min_cli_version
                .map(format_version)
                .unwrap_or_else(|| "none".to_string()),
            runtime.min_cli_version_source.unwrap_or("n/a"),
            order.join(" -> "),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::managed_agents::discovery::known_acp_runtime_exact;

    fn codex() -> &'static KnownAcpRuntime {
        known_acp_runtime_exact("codex").expect("codex runtime is in the catalog")
    }

    #[test]
    fn parses_the_chatgpt_app_binary_version() {
        assert_eq!(
            parse_cli_version("codex-cli 0.154.0-alpha.6.2"),
            Some((0, 154, 0))
        );
    }

    #[test]
    fn parses_the_april_2025_relic_version() {
        assert_eq!(
            parse_cli_version("0.1.2504161551"),
            Some((0, 1, 2504161551))
        );
    }

    #[test]
    fn the_april_2025_relic_is_below_the_adapter_minimum() {
        let minimum = codex().min_cli_version.expect("codex has a minimum");
        let relic = parse_cli_version("0.1.2504161551").unwrap();
        let chatgpt_app = parse_cli_version("codex-cli 0.154.0-alpha.6.2").unwrap();
        assert!(relic < minimum, "the relic must be refused");
        assert!(chatgpt_app >= minimum, "the ChatGPT.app binary must pass");
    }

    #[test]
    fn the_search_order_puts_the_bundle_before_any_path_directory() {
        let order = cli_search_order(codex());
        let bundle = order
            .iter()
            .position(|l| matches!(l, SearchLocation::Bundle { .. }))
            .expect("codex declares a bundle location");
        let homebrew = order
            .iter()
            .position(|l| matches!(l, SearchLocation::Directory { path } if path.ends_with("homebrew/bin")))
            .expect("homebrew is searched");
        let login = order
            .iter()
            .position(|l| matches!(l, SearchLocation::LoginShell))
            .expect("the login shell is still searched");
        assert!(
            bundle < homebrew,
            "the app bundle outranks /opt/homebrew/bin"
        );
        assert!(
            homebrew < login,
            "known dirs are searched before the login shell"
        );
    }

    #[test]
    fn the_search_order_starts_with_the_owner_override() {
        let order = cli_search_order(codex());
        assert!(matches!(
            order.first(),
            Some(SearchLocation::Override { .. })
        ));
    }

    #[test]
    fn the_chatgpt_app_bundle_path_is_in_the_order() {
        let described: Vec<String> = cli_search_order(codex())
            .iter()
            .map(SearchLocation::describe)
            .collect();
        assert!(described
            .iter()
            .any(|d| d.contains("/Applications/ChatGPT.app/Contents/Resources/codex")));
    }

    /// Not a unit test — a diagnostic you run on a real machine to see what
    /// the search actually finds there. `cargo test -- --ignored --nocapture
    /// resolves_codex_on_this_machine`. Ignored by default because the answer
    /// depends on what is installed.
    #[test]
    #[ignore]
    fn resolves_codex_on_this_machine() {
        let resolution = resolve_runtime_cli(codex());
        println!("searched: {:#?}", resolution.searched);
        println!("rejected: {:#?}", resolution.rejected);
        println!(
            "chosen: {:?} version {:?}",
            resolution.path, resolution.version
        );
        println!("existing auth: {:?}", existing_auth_from_file(codex()));
    }

    #[test]
    fn auth_files_are_declared_for_the_runtimes_that_have_one() {
        assert!(
            codex()
                .auth_files
                .iter()
                .any(|f| f.contains(".codex/auth.json")),
            "codex sign-in is detectable without asking the user",
        );
    }
}
