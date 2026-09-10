/// Service name for the desktop OS keyring. Debug builds default to a distinct
/// service, while standalone worktree launches may request a scoped dev service.
fn dev_keyring_service(configured: Option<String>) -> String {
    configured
        .filter(|service| service.starts_with("buzz-desktop-dev."))
        .unwrap_or_else(|| "buzz-desktop-dev".to_string())
}

/// Env var honoured by *release* builds to move the keyring off the real service.
///
/// Release builds normally store the identity under the hardcoded service
/// `buzz-desktop`. A signed candidate that is only being smoke-tested must not
/// touch that item, so this override exists — but it is deliberately crippled:
/// only values starting with `buzz-desktop-test.` are accepted, so a stray or
/// hostile env var can never point a release binary at the real keyring (or at
/// the dev one).
pub(crate) const RELEASE_KEYRING_SERVICE_ENV: &str = "BUZZ_DESKTOP_KEYRING_SERVICE";

const RELEASE_KEYRING_SERVICE: &str = "buzz-desktop";
const RELEASE_TEST_PREFIX: &str = "buzz-desktop-test.";

fn release_keyring_service(configured: Option<String>) -> String {
    configured
        .filter(|service| service.starts_with(RELEASE_TEST_PREFIX))
        .unwrap_or_else(|| RELEASE_KEYRING_SERVICE.to_string())
}

pub(crate) fn keyring_service() -> &'static str {
    if cfg!(debug_assertions) {
        static DEV_SERVICE: std::sync::OnceLock<String> = std::sync::OnceLock::new();
        DEV_SERVICE
            .get_or_init(|| dev_keyring_service(std::env::var("BUZZ_DEV_KEYRING_SERVICE").ok()))
            .as_str()
    } else {
        static RELEASE_SERVICE: std::sync::OnceLock<String> = std::sync::OnceLock::new();
        RELEASE_SERVICE
            .get_or_init(|| {
                release_keyring_service(std::env::var(RELEASE_KEYRING_SERVICE_ENV).ok())
            })
            .as_str()
    }
}

pub(super) fn migration_marker_name(service: &str, default_name: &str) -> String {
    if service == "buzz-desktop" || service == "buzz-desktop-dev" {
        default_name.to_string()
    } else {
        format!("identity.{service}.migrated")
    }
}

#[cfg(test)]
mod tests {
    use super::{dev_keyring_service, migration_marker_name, release_keyring_service};

    #[test]
    fn standalone_scope_must_remain_under_dev_service() {
        assert_eq!(
            dev_keyring_service(Some("buzz-desktop-dev.example".to_string())),
            "buzz-desktop-dev.example"
        );
        assert_eq!(
            dev_keyring_service(Some("buzz-desktop".to_string())),
            "buzz-desktop-dev"
        );
    }

    #[test]
    fn standalone_scope_uses_its_own_migration_marker() {
        assert_eq!(
            migration_marker_name("buzz-desktop", "identity.migrated"),
            "identity.migrated"
        );
        assert_eq!(
            migration_marker_name("buzz-desktop-dev", "identity.migrated"),
            "identity.migrated"
        );
        assert_eq!(
            migration_marker_name("buzz-desktop-dev.example", "identity.migrated"),
            "identity.buzz-desktop-dev.example.migrated"
        );
    }

    #[test]
    fn release_defaults_to_the_real_service() {
        assert_eq!(release_keyring_service(None), "buzz-desktop");
    }

    #[test]
    fn release_accepts_only_test_scoped_services() {
        assert_eq!(
            release_keyring_service(Some("buzz-desktop-test.rel2".to_string())),
            "buzz-desktop-test.rel2"
        );
        assert_eq!(
            release_keyring_service(Some("buzz-desktop-test.".to_string())),
            "buzz-desktop-test."
        );
    }

    #[test]
    fn release_refuses_to_be_pointed_at_the_real_or_dev_keyring() {
        for hostile in [
            "buzz-desktop",
            "buzz-desktop-dev",
            "buzz-desktop-dev.example",
            "buzz-desktop-testing",
            "",
            "Buzz-Desktop-Test.rel2",
            "../buzz-desktop",
        ] {
            assert_eq!(
                release_keyring_service(Some(hostile.to_string())),
                "buzz-desktop",
                "release build must ignore BUZZ_DESKTOP_KEYRING_SERVICE={hostile:?}"
            );
        }
    }

    #[test]
    fn a_test_scoped_release_service_gets_its_own_migration_marker() {
        assert_eq!(
            migration_marker_name("buzz-desktop-test.rel2", "identity.migrated"),
            "identity.buzz-desktop-test.rel2.migrated"
        );
    }
}
