#[cfg(unix)]
const LUCA_ACP_ISOLATION_PROBE: &str = r#"
set -eu
{
  printf '[outer-argv]%s\n' "$0 $*"
  printf '[outer-env]\n'
  env
  printf '[outer-fds]\n'
  ls -l /dev/fd
  if [ -p /dev/fd/0 ] || [ "$(stat -f '%HT' /dev/fd/0 2>/dev/null || true)" = "Fifo" ]; then
    printf '[outer-stdin]pipe\n'
  else
    printf '[outer-stdin]not-pipe\n'
  fi
} > "$LUCA_OUTER_PROBE"

/bin/sh -c '
  set -eu
  {
    printf "[nested-argv]%s\n" "$0 $*"
    printf "[nested-env]\n"
    env
    printf "[nested-fds]\n"
    ls -l /dev/fd
    if [ -p /dev/fd/0 ] || [ "$(stat -f "%HT" /dev/fd/0 2>/dev/null || true)" = "Fifo" ]; then
      printf "[nested-stdin]pipe\n"
    else
      printf "[nested-stdin]not-pipe\n"
    fi
  } > "$LUCA_NESTED_PROBE"
' nested-shell harmless-nested

IFS= read -r initialize_request
case "$initialize_request" in
  *'"method":"initialize"'*) ;;
  *) exit 41 ;;
esac
printf '%s\n' '{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":2,"agentCapabilities":{}}}'
"#;

#[cfg(unix)]
fn luca_probe_path(label: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!(
        "luca-descendant-{label}-{}",
        uuid::Uuid::new_v4()
    ))
}

#[cfg(unix)]
fn luca_read_probe(path: &std::path::Path) -> String {
    let output = std::fs::read_to_string(path).expect("read descendant probe");
    let _ = std::fs::remove_file(path);
    output
}

#[cfg(unix)]
#[tokio::test]
async fn luca_descendant_isolation_managed_spawn_uses_pipe_and_scrubs_nested_shell() {
    let outer_path = luca_probe_path("managed-outer");
    let nested_path = luca_probe_path("managed-nested");
    let mut extra_env = vec![
        (
            "LUCA_OUTER_PROBE".to_owned(),
            outer_path.to_string_lossy().into_owned(),
        ),
        (
            "LUCA_NESTED_PROBE".to_owned(),
            nested_path.to_string_lossy().into_owned(),
        ),
        (
            "LUCA_DESCENDANT_SAFE_SENTINEL".to_owned(),
            "preserved".to_owned(),
        ),
        (
            "BUZZ_MANAGED_AGENT".to_owned(),
            "desktop-lifecycle-marker".to_owned(),
        ),
    ];
    for key in LUCA_DESCENDANT_FORBIDDEN_ENV {
        extra_env.push(((*key).to_owned(), format!("secret-for-{key}")));
        extra_env.push((key.to_ascii_lowercase(), format!("lower-secret-for-{key}")));
    }

    let args = vec![
        "-c".to_owned(),
        LUCA_ACP_ISOLATION_PROBE.to_owned(),
        "managed-outer".to_owned(),
        "harmless-outer".to_owned(),
    ];
    let mut client = AcpClient::spawn_managed("/bin/sh", &args, &extra_env, false)
        .await
        .expect("spawn through the production managed ACP path");
    let initialized = client
        .initialize()
        .await
        .expect("managed child must read initialize from replacement stdin");
    assert_eq!(initialized["protocolVersion"].as_u64(), Some(2));
    client.shutdown().await;

    let outer = luca_read_probe(&outer_path);
    let nested = luca_read_probe(&nested_path);
    assert!(outer.contains("[outer-argv]managed-outer harmless-outer"));
    assert!(nested.contains("[nested-argv]nested-shell harmless-nested"));
    assert!(outer.contains("LUCA_DESCENDANT_SAFE_SENTINEL=preserved"));
    assert!(nested.contains("LUCA_DESCENDANT_SAFE_SENTINEL=preserved"));
    assert!(outer.contains("BUZZ_MANAGED_AGENT=desktop-lifecycle-marker"));
    assert!(nested.contains("BUZZ_MANAGED_AGENT=desktop-lifecycle-marker"));
    assert!(
        outer.contains("[outer-stdin]pipe"),
        "managed model stdin was not the replacement ACP pipe:\n{outer}"
    );
    assert!(
        nested.contains("[nested-stdin]pipe"),
        "nested model descendant did not inherit the replacement ACP pipe:\n{nested}"
    );

    for (scope, probe) in [("managed model", &outer), ("nested descendant", &nested)] {
        for key in LUCA_DESCENDANT_FORBIDDEN_ENV {
            assert!(
                !probe
                    .lines()
                    .any(|line| line.to_ascii_uppercase().starts_with(&format!("{key}="))),
                "{key} crossed the {scope} environment boundary:\n{probe}"
            );
            assert!(
                !probe.contains(&format!("secret-for-{key}"))
                    && !probe.contains(&format!("lower-secret-for-{key}")),
                "{key} value crossed through {scope} argv, environment, or descriptors"
            );
        }
    }
}

#[test]
fn luca_descendant_isolation_rejects_case_insensitive_overrides() {
    for key in LUCA_DESCENDANT_FORBIDDEN_ENV {
        assert!(is_luca_descendant_forbidden_env(key));
        assert!(is_luca_descendant_forbidden_env(
            &key.to_ascii_lowercase()
        ));
    }
    assert!(!is_luca_descendant_forbidden_env(
        "LUCA_DESCENDANT_SAFE_SENTINEL"
    ));
    assert!(!is_luca_descendant_forbidden_env("BUZZ_MANAGED_AGENT"));
}

#[cfg(unix)]
#[tokio::test]
async fn luca_descendant_isolation_legacy_spawn_preserves_buzz_environment() {
    let outer_path = luca_probe_path("legacy-outer");
    let nested_path = luca_probe_path("legacy-nested");
    let extra_env = vec![
        (
            "LUCA_OUTER_PROBE".to_owned(),
            outer_path.to_string_lossy().into_owned(),
        ),
        (
            "LUCA_NESTED_PROBE".to_owned(),
            nested_path.to_string_lossy().into_owned(),
        ),
        (
            "BUZZ_PRIVATE_KEY".to_owned(),
            "synthetic-legacy-private-key".to_owned(),
        ),
        (
            "BUZZ_AUTH_TAG".to_owned(),
            "synthetic-legacy-auth-tag".to_owned(),
        ),
        (
            "BUZZ_MANAGED_AGENT".to_owned(),
            "synthetic-legacy-lifecycle-marker".to_owned(),
        ),
    ];
    let args = vec![
        "-c".to_owned(),
        LUCA_ACP_ISOLATION_PROBE.to_owned(),
        "legacy-outer".to_owned(),
        "harmless-outer".to_owned(),
    ];
    let mut client = AcpClient::spawn("/bin/sh", &args, &extra_env, false)
        .await
        .expect("spawn through the production legacy ACP path");
    client
        .initialize()
        .await
        .expect("legacy child must read initialize from replacement stdin");
    client.shutdown().await;

    let outer = luca_read_probe(&outer_path);
    let nested = luca_read_probe(&nested_path);
    for probe in [&outer, &nested] {
        assert!(probe.contains("BUZZ_PRIVATE_KEY=synthetic-legacy-private-key"));
        assert!(probe.contains("BUZZ_AUTH_TAG=synthetic-legacy-auth-tag"));
        assert!(probe.contains("BUZZ_MANAGED_AGENT=synthetic-legacy-lifecycle-marker"));
    }
}
