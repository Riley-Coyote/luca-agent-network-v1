use super::*;

const OWNER: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const RESIDENT: &str = "2222222222222222222222222222222222222222222222222222222222222222";
const STRANGER: &str = "3333333333333333333333333333333333333333333333333333333333333333";
const CONVERSATION: &str = "conversation-one";
const NOW: i64 = 1_800_000_000;

fn message(id: &str, author: &str, created_at: i64) -> ConversationMessage {
    ConversationMessage {
        id: id.to_owned(),
        author: author.to_owned(),
        conversation: CONVERSATION.to_owned(),
        created_at,
        signature_valid: true,
    }
}

/// Luca proposes, the owner answers: the ordinary shape of consent.
fn exchange() -> Vec<ConversationMessage> {
    vec![
        message("proposal", RESIDENT, NOW - 60),
        message("agreement", OWNER, NOW - 30),
    ]
}

#[test]
fn an_owner_answer_after_lucas_proposal_is_consent() {
    let messages = exchange();
    let consent =
        verified_consent(&messages, "agreement", OWNER, RESIDENT, CONVERSATION, NOW).expect("consent");
    assert_eq!(consent.id, "agreement");
}

#[test]
fn only_this_owners_own_recent_answer_in_this_conversation_counts() {
    let cases: Vec<(&str, Vec<ConversationMessage>, &str)> = vec![
        ("unknown message", exchange(), "missing"),
        (
            "the resident agreeing with itself",
            vec![
                message("proposal", RESIDENT, NOW - 60),
                message("agreement", RESIDENT, NOW - 30),
            ],
            "agreement",
        ),
        (
            "someone else in the room",
            vec![
                message("proposal", RESIDENT, NOW - 60),
                message("agreement", STRANGER, NOW - 30),
            ],
            "agreement",
        ),
        (
            "an answer from another conversation",
            vec![
                message("proposal", RESIDENT, NOW - 60),
                ConversationMessage {
                    conversation: "conversation-two".to_owned(),
                    ..message("agreement", OWNER, NOW - 30)
                },
            ],
            "agreement",
        ),
        (
            "an unverifiable message",
            vec![
                message("proposal", RESIDENT, NOW - 60),
                ConversationMessage {
                    signature_valid: false,
                    ..message("agreement", OWNER, NOW - 30)
                },
            ],
            "agreement",
        ),
        (
            "an agreement older than the review's own lifetime",
            vec![
                message("proposal", RESIDENT, NOW - 16 * 60 - 30),
                message("agreement", OWNER, NOW - 16 * 60),
            ],
            "agreement",
        ),
        (
            "an agreement stamped in the future",
            vec![
                message("proposal", RESIDENT, NOW - 60),
                message("agreement", OWNER, NOW + 5 * 60),
            ],
            "agreement",
        ),
        (
            "an answer that came before anything was proposed",
            vec![
                message("agreement", OWNER, NOW - 60),
                message("proposal", RESIDENT, NOW - 30),
            ],
            "agreement",
        ),
        (
            "a conversation Luca has not spoken in",
            vec![message("agreement", OWNER, NOW - 30)],
            "agreement",
        ),
        (
            "a proposal that cannot be verified either",
            vec![
                ConversationMessage {
                    signature_valid: false,
                    ..message("proposal", RESIDENT, NOW - 60)
                },
                message("agreement", OWNER, NOW - 30),
            ],
            "agreement",
        ),
    ];
    for (case, messages, consent_event_id) in cases {
        assert!(
            verified_consent(
                &messages,
                consent_event_id,
                OWNER,
                RESIDENT,
                CONVERSATION,
                NOW
            )
            .is_err(),
            "{case}"
        );
    }
}

#[test]
fn an_agreement_at_the_edge_of_the_window_still_counts() {
    let messages = vec![
        message("proposal", RESIDENT, NOW - CONSENT_LIFETIME_SECONDS - 5),
        message("agreement", OWNER, NOW - CONSENT_LIFETIME_SECONDS),
    ];
    assert!(
        verified_consent(&messages, "agreement", OWNER, RESIDENT, CONVERSATION, NOW).is_ok(),
        "the boundary belongs to the owner, not to the clock"
    );
}

#[test]
fn only_startable_runtime_families_map_to_a_runtime() {
    assert_eq!(managed_runtime_id("codex"), Some("codex"));
    assert_eq!(managed_runtime_id("claude_code"), Some("claude"));
    assert_eq!(managed_runtime_id("hermes"), None);
    assert_eq!(managed_runtime_id("openclaw"), None);
    assert_eq!(managed_runtime_id("shell"), None);
}

#[test]
fn import_and_native_provisioning_keep_the_owner_review() {
    let arguments = |value: serde_json::Value| -> ProposalArguments {
        serde_json::from_value(value).expect("arguments")
    };
    assert!(takes_direct_path(&arguments(json!({
        "display_name": "Vektor", "system_prompt": "Research the project.",
        "runtime_family": "codex", "model": "gpt-5.6-sol",
        "consent_event_id": "a".repeat(64)
    }))));
    assert!(!takes_direct_path(&arguments(json!({
        "display_name": "Vektor", "system_prompt": "Research the project.",
        "runtime_family": "codex", "model": "gpt-5.6-sol"
    }))));
    assert!(!takes_direct_path(&arguments(json!({
        "runtime_family": "hermes", "provisioning_intent": "import",
        "native_profile_name": "research", "consent_event_id": "a".repeat(64)
    }))));
}

#[test]
fn one_agreement_creates_one_resident_however_often_the_tool_retries() {
    let consent_event_id = format!("receipt-test-{}", "d".repeat(16));
    assert!(existing_receipt(&consent_event_id).is_none());
    let result = json!({"status": "created_waking", "residentPubkey": RESIDENT});
    remember_receipt(&consent_event_id, &result);
    assert_eq!(existing_receipt(&consent_event_id), Some(result));
}

#[test]
fn a_bring_up_failure_is_reported_in_one_bounded_line() {
    assert_eq!(bounded_error("   "), "Starting this resident did not finish.");
    assert_eq!(bounded_error("codex is not signed in"), "codex is not signed in");
    assert_eq!(bounded_error("two\nlines"), "twolines");
    assert_eq!(bounded_error(&"x".repeat(400)).chars().count(), 240);
}
