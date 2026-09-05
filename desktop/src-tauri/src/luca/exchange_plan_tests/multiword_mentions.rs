use super::*;
use crate::{
    luca::resident_registry::{
        owned_resident_mention_aliases_from_records, resident_custody_pubkey,
        resolve_owned_resident_name_from_records, ResidentNameResolutionError,
    },
    managed_agents::ManagedAgentRecord,
};

fn owner_keys() -> Keys {
    Keys::parse(&"a1".repeat(32)).expect("synthetic fixture owner")
}

fn resident(owner: &Keys, name: &str) -> ManagedAgentRecord {
    let keys = Keys::generate();
    serde_json::from_value(serde_json::json!({
        "pubkey": keys.public_key().to_hex(), "name": name,
        "private_key_nsec": keys.secret_key().to_secret_hex(),
        "auth_tag": buzz_sdk_pkg::nip_oa::compute_auth_tag(owner, &keys.public_key(), "").expect("synthetic tag"),
        "relay_url": "", "acp_command": "", "agent_command": "", "agent_args": [],
        "mcp_command": "", "turn_timeout_seconds": 0, "system_prompt": null,
        "created_at": "2026-09-05T00:00:00Z", "updated_at": "2026-09-05T00:00:00Z",
        "last_started_at": null, "last_stopped_at": null, "last_exit_code": null,
        "last_error": null, "runtime": "codex"
    })).expect("synthetic resident")
}

fn install(fixture: &Fixture, records: Vec<ManagedAgentRecord>, in_room: bool) {
    for record in &records {
        if let Some(pubkey) = resident_custody_pubkey(record) {
            fixture.relay.seed_resident(&record.name, &pubkey, in_room);
        }
    }
    *fixture.relay.registry.lock().expect("registry") = Some(records);
}

#[test]
fn known_names_are_longest_first_case_aware_and_boundary_bounded() {
    let aliases = [
        "Research",
        "Research Helper",
        "Research Helper Plus",
        "Écho Bleu",
        "İ Research",
    ];
    for (draft, expected) in [
        (
            "Ask @Research Helper for one fact.",
            vec!["Research Helper"],
        ),
        (
            "(@rEsEaRcH hElPeR), @Research Helper Plus!",
            vec!["rEsEaRcH hElPeR", "Research Helper Plus"],
        ),
        (
            "@éCHO bLEU; @i\u{307} rESEARCH",
            vec!["éCHO bLEU", "i\u{307} rESEARCH"],
        ),
        (
            "email@Research Helper café@Écho Bleu _@Research Helper",
            vec![],
        ),
        ("@Research HelperX @Research Helper-Extra", vec![]),
        (
            "@Research Helper] @Research Helper}",
            vec!["Research Helper"],
        ),
        (
            "@Research Helper: @research helper?",
            vec!["Research Helper"],
        ),
    ] {
        assert_eq!(
            mentioned_names_with_aliases(draft, &aliases),
            expected,
            "draft: {draft}"
        );
    }
    assert_eq!(mentioned_names("@Research Helper"), ["Research"]);
    assert_eq!(
        mentioned_names_with_aliases("@Vektor.extra", &["Vektor"]),
        ["Vektor.extra"]
    );
    assert_eq!(
        mentioned_names_with_aliases("@Research\nHelper", &aliases),
        ["Research"]
    );
}

#[test]
fn malformed_names_and_recognition_limits_do_not_widen_generic_tokens() {
    let limit = format!("{} B", "a".repeat(254));
    let too_long = format!("{} B", "a".repeat(255));
    let aliases = [
        limit.as_str(),
        too_long.as_str(),
        "Bad\nName",
        "Bad\tName",
        " Leading Name",
        "Trailing Name ",
    ];
    assert_eq!(
        mentioned_names_with_aliases(&format!("@{limit}"), &aliases),
        [limit.as_str()]
    );
    assert!(mentioned_names_with_aliases(&format!("@{too_long}"), &aliases).is_empty());
    for malformed in &aliases[2..] {
        assert!(
            !mentioned_names_with_aliases(&format!("@{malformed}"), &aliases)
                .contains(&malformed.to_string())
        );
    }
    assert!(mentioned_names_with_aliases(&format!("@{}", "x".repeat(65)), &[]).is_empty());
    let names = (0..10)
        .map(|index| format!("Resident {index}"))
        .collect::<Vec<_>>();
    let aliases = names.iter().map(String::as_str).collect::<Vec<_>>();
    let draft = format!(
        "@resident 0, {}",
        names
            .iter()
            .map(|name| format!("@{name}"))
            .collect::<Vec<_>>()
            .join(" ")
    );
    let mentions = mentioned_names_with_aliases(&draft, &aliases);
    assert_eq!(mentions.len(), 8);
    assert_eq!(mentions[0], "resident 0");
    assert_eq!(mentions[7], "Resident 7");
}

#[test]
fn new_name_inventory_requires_signed_owner_and_matching_custody() {
    let owner = owner_keys();
    let foreign_owner = Keys::generate();
    let valid = resident(&owner, "Research Helper");
    assert!(
        valid.slug.is_none() && valid.display_name.is_none() && valid.backend_agent_id.is_none()
    );
    let foreign = resident(&foreign_owner, "Foreign Helper");
    let mut forged = resident(&owner, "Forged Helper");
    forged.auth_tag = foreign.auth_tag.clone();
    let mut missing = resident(&owner, "Missing Helper");
    missing.auth_tag = None;
    let mut wrong_key = resident(&owner, "Wrong Key Helper");
    wrong_key.private_key_nsec = Keys::generate().secret_key().to_secret_hex();
    let records = vec![valid, foreign, forged, missing, wrong_key];
    let custody = records.iter().filter_map(resident_custody_pubkey).collect();
    let owner = Hex64::parse(owner.public_key().to_hex()).expect("owner");
    let aliases =
        owned_resident_mention_aliases_from_records(&records, &custody, &owner).expect("aliases");
    assert_eq!(aliases, ["Research Helper"]);
    let mentions = mentioned_names_with_aliases("@research helper", &aliases);
    assert_eq!(
        resolve_owned_resident_name_from_records(&records, &custody, &mentions[0]),
        resident_custody_pubkey(&records[0]).ok_or(ResidentNameResolutionError::NotFound)
    );
    let empty_custody =
        owned_resident_mention_aliases_from_records(&records, &BTreeSet::new(), &owner)
            .expect("no custody");
    assert!(empty_custody.is_empty());
}

#[test]
fn current_dm_multiword_exchange_preserves_exact_final_bytes() {
    let fixture = fixture();
    let record = resident(&owner_keys(), "Research Helper");
    let target = resident_custody_pubkey(&record).expect("target");
    install(&fixture, vec![record], true);
    let draft = "I’ll ask @Research Helper for one checked fact.\nThen I’ll synthesize it.";
    let request = fixture.request(draft);
    let plan = fixture.resolver().resolve(&request, NOW).expect("exchange");
    assert_eq!(plan.granted_p_tags, [target]);
    assert_eq!(fixture.relay.records().len(), 1);
    assert!(fixture
        .relay
        .added_members
        .lock()
        .expect("members")
        .is_empty());
    let effective = plan.apply(&request).expect("effective");
    assert_eq!(effective.final_draft.as_bytes(), draft.as_bytes());
    assert_eq!(effective.conversation_id, request.conversation_id);
}

#[test]
fn multiword_visit_replays_frozen_decision_after_rename_without_duplicate_work() {
    let fixture = fixture();
    let record = resident(&owner_keys(), "Research Helper");
    let target = resident_custody_pubkey(&record).expect("target");
    install(&fixture, vec![record], false);
    let request = fixture.request("@Research Helper, please check one thing.");
    let first = fixture
        .resolver()
        .resolve(&request, NOW)
        .expect("visit exchange");
    {
        let mut registry = fixture.relay.registry.lock().expect("registry");
        registry.as_mut().expect("records")[0].name = "Renamed Helper".into();
    }
    *fixture.relay.registry_unavailable.lock().expect("flag") = true;
    let replay = fixture
        .resolver()
        .resolve(&request, NOW + 30)
        .expect("frozen replay");
    assert_eq!(first, replay);
    assert_eq!(
        first.apply(&request).expect("first request"),
        replay.apply(&request).expect("replayed request")
    );
    assert_eq!(
        replay.apply(&request).expect("effective").final_draft,
        request.final_draft
    );
    assert_eq!(
        replay.granted_p_tags.as_slice(),
        std::slice::from_ref(&target)
    );
    assert_eq!(
        fixture
            .relay
            .added_members
            .lock()
            .expect("visits")
            .as_slice(),
        &[target]
    );
    assert_eq!(fixture.relay.records().len(), 1);
    assert_eq!(fixture.relay.notes().len(), 1);
}

#[test]
fn ambiguous_long_name_never_routes_a_shorter_resident() {
    let fixture = fixture();
    let owner = owner_keys();
    let short = resident(&owner, "Research");
    let full = resident(&owner, "Research Helper");
    let mut hidden = resident(&Keys::generate(), "Hidden Foreign Resident");
    hidden.backend_agent_id = Some("Research Helper".into());
    install(&fixture, vec![short, full, hidden], false);
    let request = fixture.request("@Research Helper, check a fact.");
    let plan = fixture
        .resolver()
        .resolve(&request, NOW)
        .expect("no guessed exchange");
    assert_eq!(plan, ExchangePlan::unchanged());
    assert!(fixture.relay.records().is_empty());
    assert!(fixture
        .relay
        .added_members
        .lock()
        .expect("members")
        .is_empty());
}

#[test]
fn foreign_self_and_owner_names_cannot_add_exchange_authority() {
    let fixture = fixture();
    install(
        &fixture,
        vec![resident(&Keys::generate(), "Foreign Helper")],
        false,
    );
    let plan = fixture
        .resolver()
        .resolve(&fixture.request("@Foreign Helper, inspect this."), NOW)
        .expect("no foreign route");
    assert_eq!(plan, ExchangePlan::unchanged());
    assert!(fixture.relay.records().is_empty());
    for (name, is_owner) in [("Luca Resident", false), ("House Owner", true)] {
        let fixture = super::fixture();
        let target = if is_owner {
            &fixture.owner
        } else {
            &fixture.luca
        };
        fixture.relay.seed_resident(name, target, true);
        let plan = fixture
            .resolver()
            .resolve(&fixture.request(&format!("@{name}, check this.")), NOW)
            .expect("self/owner gate");
        assert_eq!(plan, ExchangePlan::unchanged());
        assert!(fixture.relay.records().is_empty());
    }
}

#[test]
fn unavailable_inventory_refuses_before_any_mint_or_visit() {
    let fixture = fixture();
    *fixture.relay.registry_unavailable.lock().expect("flag") = true;
    assert_eq!(
        fixture
            .resolver()
            .resolve(&fixture.request("@Research Helper, check this."), NOW),
        Err(ExchangeDenial::Unavailable)
    );
    assert!(fixture.relay.records().is_empty());
    assert!(fixture
        .relay
        .added_members
        .lock()
        .expect("members")
        .is_empty());
}
