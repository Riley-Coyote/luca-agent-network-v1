//! Drop resident-only bootstrap authority before invoking a user's native CLI.

use tokio::process::Command;

use super::codex_events::NativeFailure;

const DESCRIPTORS: &[(&str, i32)] = &[
    ("LUCA_MANAGED_PERMISSION_FD", 3),
    ("LUCA_MANAGED_CONTINUITY_FD", 4),
    ("LUCA_MANAGED_COGNITION_FD", 5),
    ("LUCA_MANAGED_MCP_FD", 6),
    ("LUCA_MANAGED_PRESENTATION_FD", 7),
];

pub(super) fn resident_environment_key(key: &str) -> bool {
    let key = key.to_ascii_uppercase();
    key.starts_with("LUCA_")
        || key.starts_with("BUZZ_")
        || matches!(
            key.as_str(),
            "NOSTR_PRIVATE_KEY" | "CODEX_CONFIG" | "INITIAL_AGENT_MODE"
        )
}

pub(super) fn scrub_environment(command: &mut Command) {
    crate::acp::scrub_luca_descendant_environment(command, true);
    let explicit_keys: Vec<_> = command
        .as_std()
        .get_envs()
        .filter(|(key, _)| key.to_str().is_some_and(resident_environment_key))
        .map(|(key, _)| key.to_os_string())
        .collect();
    for key in explicit_keys {
        command.env_remove(key);
    }
    for (key, _) in std::env::vars_os() {
        if key.to_str().is_some_and(resident_environment_key) {
            command.env_remove(key);
        }
    }
    // These adapter-only overlays must stay absent even in tests/hosts where
    // they are not currently set. Native home, auth, PATH and user config stay
    // untouched; no shadow profile or configuration overlay is installed.
    command.env_remove("CODEX_CONFIG");
    command.env_remove("INITIAL_AGENT_MODE");
}

fn descriptor(key: &str, value: &str) -> Result<i32, NativeFailure> {
    let expected = DESCRIPTORS
        .iter()
        .find(|(name, _)| *name == key)
        .map(|(_, fd)| *fd)
        .ok_or(NativeFailure::Isolation)?;
    if value != expected.to_string() {
        return Err(NativeFailure::Isolation);
    }
    Ok(expected)
}

pub(super) fn discard_inherited_descriptors() -> Result<(), NativeFailure> {
    // Collect and validate all coordinates before closing anything. This
    // standalone continuation lane never adopts a resident permission/MCP/
    // continuity channel and does not read any of their protected bodies.
    let mut descriptors = Vec::new();
    for (key, value) in std::env::vars_os() {
        let Some(name) = key.to_str() else { continue };
        if name.starts_with("LUCA_MANAGED_") && name.ends_with("_FD") {
            let value = value.to_str().ok_or(NativeFailure::Isolation)?;
            descriptors.push(descriptor(name, value)?);
        }
    }
    #[cfg(unix)]
    for raw in descriptors {
        nix::unistd::close(raw).map_err(|_| NativeFailure::Isolation)?;
    }
    #[cfg(not(unix))]
    if !descriptors.is_empty() {
        return Err(NativeFailure::Isolation);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resident_identity_authority_and_policy_are_scrubbed_not_native_profile() {
        for key in [
            "LUCA_MANAGED_RESIDENT_PUBKEY",
            "LUCA_MANAGED_PERMISSION_FD",
            "LUCA_COMMUNICATIONS_CAPABILITY",
            "LUCA_RUNTIME_SESSION_PURPOSE_STORE",
            "BUZZ_PRIVATE_KEY",
            "BUZZ_ACP_SYSTEM_PROMPT",
            "BUZZ_ACP_MODEL",
            "BUZZ_ACP_CODEX_POLICY",
            "CODEX_CONFIG",
            "INITIAL_AGENT_MODE",
            "NOSTR_PRIVATE_KEY",
            "luca_managed_new_authority",
        ] {
            assert!(resident_environment_key(key), "{key}");
        }
        for key in [
            "HOME",
            "PATH",
            "CODEX_HOME",
            "CODEX_API_KEY",
            "OPENAI_API_KEY",
        ] {
            assert!(!resident_environment_key(key), "{key}");
        }
    }

    #[test]
    fn inherited_coordinates_cannot_close_arbitrary_descriptors() {
        for (key, expected) in DESCRIPTORS {
            assert_eq!(descriptor(key, &expected.to_string()), Ok(*expected));
            for invalid in ["0", "1", "2", "100", "-3", "03", "PRIVATE_BODY"] {
                assert_eq!(descriptor(key, invalid), Err(NativeFailure::Isolation));
            }
        }
        assert_eq!(
            descriptor("LUCA_MANAGED_UNKNOWN_FD", "3"),
            Err(NativeFailure::Isolation)
        );
    }

    #[cfg(unix)]
    #[test]
    fn actual_bootstrap_descriptors_do_not_reach_native_or_nested_children() {
        const CHILD_MARKER: &str = "POLYPHONIC_FD_ISOLATION_FIXTURE_CHILD";
        if std::env::var_os(CHILD_MARKER).is_some() {
            // The outer shell installed /dev/null at only these two reserved
            // coordinates. Close production bootstraps before starting the
            // async runtime, just as the native runner does before spawn.
            discard_inherited_descriptors().expect("discard synthetic bootstraps");
            let mut command = Command::new("/bin/sh");
            command
                .args([
                    "-c",
                    "test ! -e /dev/fd/3 && test ! -e /dev/fd/6 && \
                     test -z \"${LUCA_MANAGED_PERMISSION_FD+x}\" && \
                     test -z \"${LUCA_MANAGED_MCP_FD+x}\" && \
                     /bin/sh -c 'test ! -e /dev/fd/3 && test ! -e /dev/fd/6 && \
                     test -z \"${LUCA_MANAGED_RESIDENT_PUBKEY+x}\"'",
                ])
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null());
            scrub_environment(&mut command);
            let runtime = tokio::runtime::Runtime::new().expect("isolated fixture runtime");
            let status = runtime
                .block_on(async { command.status().await })
                .expect("synthetic descendants");
            assert!(status.success());
            return;
        }
        let mut driver = std::process::Command::new("/bin/sh");
        for (key, _) in DESCRIPTORS {
            driver.env_remove(key);
        }
        let output = driver
            .args([
                "-c",
                "exec 3</dev/null; exec 6</dev/null; \
                 exec \"$1\" --exact \
                 runtime_task_runner::native_isolation::tests::actual_bootstrap_descriptors_do_not_reach_native_or_nested_children",
                "polyphonic-owned-fd-fixture",
            ])
            .arg(std::env::current_exe().expect("focused test binary"))
            .env(CHILD_MARKER, "1")
            .env("LUCA_MANAGED_PERMISSION_FD", "3")
            .env("LUCA_MANAGED_MCP_FD", "6")
            .env("LUCA_MANAGED_RESIDENT_PUBKEY", "SYNTHETIC_RESIDENT_ONLY")
            .stdin(std::process::Stdio::null())
            .output()
            .expect("owned descriptor fixture process");
        assert!(
            output.status.success(),
            "descriptor fixture failed: {}",
            String::from_utf8_lossy(&output.stdout)
        );
    }
}
