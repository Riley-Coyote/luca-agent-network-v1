use super::{
    protocol::{self, Page, Scope, Section},
    Binding,
};
use serde_json::json;

fn scope() -> Scope {
    Scope {
        agent_id: "wren".into(),
        person_id: "pat-example".into(),
        project_scope: "lighthouse".into(),
    }
}
fn sample() -> serde_json::Value {
    json!({"protocol_version":1,"mnemos_version":"0.6.7","schema_version":19,
    "scope":scope(),"section":"notes","limit":50,"items":[{"id":"internal-id","text":"The first line","author":"resident","extra":"not for the view"}],
    "truncated":true,"next_cursor":"cGFnZQ"})
}
fn project(v: &serde_json::Value) -> Result<Page, String> {
    protocol::project(
        &serde_json::to_vec(v).unwrap(),
        &scope(),
        "first",
        Section::Notes,
    )
}
#[test]
fn exact_scope_and_bounded_projection() {
    let orig = sample();
    let v = serde_json::to_value(project(&orig).unwrap()).unwrap();
    assert_eq!(v["items"][0]["text"], "The first line");
    assert!(v["items"][0].get("author").is_none());
    let mut known = orig.clone();
    known["items"][0]["author"] = json!("person");
    assert_eq!(
        serde_json::to_value(project(&known).unwrap()).unwrap()["items"][0]["author"],
        "person"
    );
    assert!(!v.to_string().contains("internal-id") && !v.to_string().contains("not for the view"));
    for flag in [json!(false), json!(true), json!("false"), json!(null)] {
        let mut value = orig.clone();
        value["items"][0]["clipped"] = flag.clone();
        match flag.as_bool() {
            Some(mark) => assert_eq!(
                serde_json::to_value(project(&value).unwrap()).unwrap()["items"][0]["clipped"],
                mark
            ),
            None => assert!(project(&value).is_err()),
        }
    }
    let mut wire = serde_json::to_vec(&orig).unwrap();
    wire.resize(protocol::MAX_REPLY, b' ');
    let check = |wire: &[u8]| protocol::project(wire, &scope(), "first", Section::Notes);
    assert!(check(&wire).is_ok());
    wire.push(b'\n');
    assert!(check(&wire).is_ok());
    wire.pop();
    wire.push(b' ');
    assert!(check(&wire).is_err());
    wire.push(b'\n');
    assert!(check(&wire).is_err());
    for key in ["agent_id", "person_id", "project_scope"] {
        let mut other = orig.clone();
        other["scope"][key] = json!("elsewhere");
        assert!(project(&other).is_err());
    }
    for (key, value) in [
        ("protocol_version", json!(2)),
        ("schema_version", json!(null)),
        ("section", json!("journal")),
        ("limit", json!(200)),
        ("truncated", json!(false)),
    ] {
        let mut wrong = orig.clone();
        wrong[key] = value;
        assert!(project(&wrong).is_err());
    }
    let mut large = orig;
    large["items"][0]["text"] = json!("x".repeat(16385));
    assert!(project(&large).is_err());
    assert!(protocol::project(
        &vec![b'x'; protocol::MAX_REPLY + 2],
        &scope(),
        "first",
        Section::Notes
    )
    .is_err());
}
#[test]
fn cursor_does_not_cross_a_grant_or_section() {
    let Page::Items {
        next_cursor: Some(cursor),
        ..
    } = project(&sample()).unwrap()
    else {
        panic!("missing page")
    };
    assert_eq!(
        protocol::cursor_for("first", Section::Notes, &cursor).unwrap(),
        "cGFnZQ"
    );
    assert!(protocol::cursor_for("second", Section::Notes, &cursor).is_err());
    assert!(protocol::cursor_for("first", Section::Journal, &cursor).is_err());
    assert!(protocol::cursor_for("first", Section::Summary, "first:summary:x").is_err());
    for (length, allowed) in [(0, false), (1, true), (1024, true), (1025, false)] {
        let token = "a".repeat(length);
        let mut reply = sample();
        reply["next_cursor"] = json!(token);
        assert_eq!(project(&reply).is_ok(), allowed);
        assert_eq!(
            protocol::cursor_for("first", Section::Notes, &format!("first:notes:{token}")).is_ok(),
            allowed
        );
    }
}
#[test]
fn refuse_noncanonical_ids() {
    for id in ["", "Wren", " a", "a/other", "-other", "other-", "a b"] {
        let mut s = scope();
        s.agent_id = id.into();
        assert!(!s.valid());
    }
    assert!(scope().valid());
    for (value, valid) in [
        ("_".into(), true),
        ("a--b_2".into(), true),
        ("a".repeat(128), true),
        ("a".repeat(129), false),
        ("a\n".into(), false),
    ] {
        assert_eq!(
            Scope {
                person_id: value,
                ..scope()
            }
            .valid(),
            valid
        );
    }
}
#[test]
fn a_managed_provider_is_not_a_local_memory_resident() {
    use crate::managed_agents::BackendKind;
    assert!(super::require_local(&BackendKind::Local).is_ok());
    assert!(super::require_local(&BackendKind::Provider {
        id: "external".into(),
        config: json!({})
    })
    .is_err());
}
#[test]
fn stored_approval_is_not_a_different_owner_or_resident() {
    let tmp = tempfile::tempdir().unwrap();
    let file = tmp.path().join("store.db");
    std::fs::write(&file, b"synthetic").unwrap();
    let b = Binding::selected("owner".into(), "resident".into(), scope(), &file).unwrap();
    let config = tmp.path().join("binding.json");
    std::fs::write(&config, serde_json::to_vec(&b).unwrap()).unwrap();
    assert!(super::load(&config, &("other".into(), "resident".into())).is_err());
    assert!(super::load(&config, &("owner".into(), "other".into())).is_err());
    assert_eq!(
        super::load(&config, &("owner".into(), "resident".into()))
            .unwrap()
            .unwrap()
            .grant,
        b.grant
    );
}
#[cfg(unix)]
#[test]
fn replaced_or_redirected_store_needs_new_consent() {
    let tmp = tempfile::tempdir().unwrap();
    let file = tmp.path().join("store.db");
    std::fs::write(&file, b"a").unwrap();
    let b = Binding::selected("owner".into(), "resident".into(), scope(), &file).unwrap();
    assert!(b.same_file());
    let other = tmp.path().join("other");
    std::fs::write(&other, b"b").unwrap();
    std::fs::rename(&other, &file).unwrap();
    assert!(!b.same_file());
    std::fs::rename(&file, &other).unwrap();
    std::os::unix::fs::symlink(&other, &file).unwrap();
    assert!(!b.same_file());
}
#[test]
fn artifact_matches_the_compiled_pin() {
    use sha2::{Digest, Sha256};
    assert_eq!(
        hex::encode(Sha256::digest(include_bytes!(
            "../../../helpers/mnemos-read-view.pyz"
        ))),
        include_str!("reader.sha256").trim()
    );
}
#[cfg(unix)]
#[test]
fn oversized_or_symlinked_connection_is_unavailable() {
    let tmp = tempfile::tempdir().unwrap();
    let key = ("owner".into(), "resident".into());
    let cfg = tmp.path().join("binding.json");
    assert!(super::load(&cfg, &key).unwrap().is_none());
    std::fs::write(&cfg, vec![b' '; 8193]).unwrap();
    assert!(super::load(&cfg, &key).is_err());
    let link = tmp.path().join("link.json");
    std::os::unix::fs::symlink(&cfg, &link).unwrap();
    assert!(super::load(&link, &key).is_err());
}
