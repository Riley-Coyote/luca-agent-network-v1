use super::*;

#[test]
fn current_builtin_agents_intentionally_have_no_seeded_avatars() {
    for legacy in LEGACY_BUILTIN_AVATARS {
        assert_eq!(
            crate::managed_agents::built_in_persona_avatar_url(legacy.persona_id),
            None
        );
    }
}

#[test]
fn legacy_avatar_refresh_is_a_safe_noop_without_replacement_avatars() {
    use sha2::{Digest as _, Sha256};

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("managed-agents.json");
    let old_fizz = "data:image/png;base64,old-fizz";
    let fizz_hash = hex::encode(Sha256::digest(old_fizz.as_bytes()));
    let legacy_avatars = [LegacyBuiltInAvatar {
        persona_id: "builtin:fizz",
        data_url_sha256: fizz_hash.as_str(),
        sanitized_media_sha256: "",
        persona_content_hash: "legacy-version",
    }];
    let records = serde_json::json!([
        {
            "name": "Fizz",
            "pubkey": "",
            "slug": "builtin:fizz",
            "persona_id": "builtin:fizz",
            "avatar_url": old_fizz,
            "updated_at": "before"
        },
        {
            "name": "fizz-instance",
            "pubkey": "fizz-instance",
            "persona_id": "builtin:fizz",
            "avatar_url": old_fizz,
            "persona_source_version": "legacy-version",
            "updated_at": "before"
        }
    ]);
    std::fs::write(&path, serde_json::to_vec_pretty(&records).unwrap()).unwrap();
    let before = std::fs::read(&path).unwrap();

    refresh_builtin_agent_avatars_in_file(&path, &legacy_avatars, "after");

    assert_eq!(std::fs::read(&path).unwrap(), before);
}
