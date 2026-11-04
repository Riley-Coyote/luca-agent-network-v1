use super::*;
use crate::luca::agent_inbox_binding::{InboxChildActionBinding, InboxChildActionPhase};

#[test]
fn agent_inbox_accepted_reply_keeps_owner_final_without_extra_turn_and_stop_wins() {
    let (f, request, mut record) = owner_return_fixture(true);
    f.relay.room.lock().unwrap().insert(f.vektor.clone());
    f.dispatch
        .lock()
        .unwrap()
        .bind_communication_turn_start(
            request.dispatch_receipt_id.as_str(),
            f.luca.as_str(),
            CHANNEL,
            7,
            NOW,
        )
        .unwrap();
    let child = Hex64::parse("9".repeat(64)).unwrap();
    let binding = InboxChildActionBinding {
        scope: crate::luca::agent_inbox::InboxScope {
            community_id: "22222222-2222-4222-8222-222222222222".into(),
            owner_pubkey: f.owner.clone(),
        },
        parent_dispatch_id: Hex64::parse(request.dispatch_receipt_id.as_str()).unwrap(),
        action_key: Hex64::parse("a".repeat(64)).unwrap(),
        input_fingerprint: Hex64::parse("b".repeat(64)).unwrap(),
        recipient_pubkey: f.vektor.clone(),
        phase: InboxChildActionPhase::Request,
        anchor_event_id: None,
        exchange_id: Some(record.exchange_id.clone()),
        root_event_id: request.root_event_id.clone(),
        reply_event_id: Some(Hex64::parse(request.dispatch_receipt_id.as_str()).unwrap()),
        response_surface: request.response_surface,
    };
    {
        let mut dispatch = f.dispatch.lock().unwrap();
        dispatch
            .stage_inbox_child_action(
                request.dispatch_receipt_id.as_str(),
                &child,
                f.luca.as_str(),
                CHANNEL,
                7,
                binding,
                vec![f.vektor.as_str().to_owned()],
                NOW,
            )
            .unwrap();
        // Preparation alone is never accepted task provenance.
        assert!(dispatch
            .accepted_inbox_reply_status(request.dispatch_receipt_id.as_str(), f.luca.as_str())
            .is_none());
        let accepted = "7".repeat(64);
        dispatch
            .begin_submission(child.as_str(), f.luca.as_str(), 7, &accepted)
            .unwrap();
        dispatch
            .mark_published(child.as_str(), f.luca.as_str(), &accepted)
            .unwrap();
    }
    // The accepted explicit reply already used the final available turn.
    let spent: Vec<_> = (1..=record.bucket).collect();
    f.relay.seed_spent(&record, &spent);
    let before = f.relay.spent_turns(&record).unwrap();
    let plan = f.resolver().resolve(&request, NOW).unwrap();
    let effective = plan.apply(&request).unwrap();
    assert!(effective.exchange.is_none());
    assert_eq!(effective.resolved_p_tags, vec![f.owner.clone()]);
    assert_eq!(effective.final_draft, request.final_draft);
    assert_eq!(f.relay.spent_turns(&record).unwrap(), before);
    assert!(f.relay.published_records.lock().unwrap().is_empty());
    // Every retry re-reads canonical Stop, even after the owner-only plan was frozen.
    record.state = luca_protocol::ExchangeStateV1::Closed;
    f.relay.seed_head(&record, NOW + 1);
    assert_eq!(
        f.resolver().inbox_owner_status_plan(&effective, NOW + 1),
        Err(ExchangeDenial::Closed)
    );
    f.dispatch
        .lock()
        .unwrap()
        .cancel_inbox_exchange_actions(f.owner.as_str(), CHANNEL, &record.exchange_id)
        .unwrap();
    assert!(f
        .dispatch
        .lock()
        .unwrap()
        .authorize_publication(&effective, NOW + 1)
        .is_err());
}

#[test]
fn agent_inbox_tool_recipient_is_not_activated_again_by_normal_final_mentions() {
    let f = fixture();
    f.relay.seed_resident("Kai", &f.kai, true);
    f.dispatch
        .lock()
        .unwrap()
        .bind_communication_turn_start(&f.trigger_id, f.luca.as_str(), CHANNEL, 7, NOW)
        .unwrap();
    let child = Hex64::parse("9".repeat(64)).unwrap();
    let binding = InboxChildActionBinding {
        scope: crate::luca::agent_inbox::InboxScope {
            community_id: "22222222-2222-4222-8222-222222222222".into(),
            owner_pubkey: f.owner.clone(),
        },
        parent_dispatch_id: Hex64::parse(&f.trigger_id).unwrap(),
        action_key: Hex64::parse("a".repeat(64)).unwrap(),
        input_fingerprint: Hex64::parse("b".repeat(64)).unwrap(),
        recipient_pubkey: f.vektor.clone(),
        phase: InboxChildActionPhase::Request,
        anchor_event_id: Some(Hex64::parse("c".repeat(64)).unwrap()),
        exchange_id: None,
        root_event_id: None,
        reply_event_id: None,
        response_surface: None,
    };
    f.dispatch
        .lock()
        .unwrap()
        .stage_inbox_child_action(
            &f.trigger_id,
            &child,
            f.luca.as_str(),
            CHANNEL,
            7,
            binding,
            vec![f.owner.as_str().to_owned()],
            NOW,
        )
        .unwrap();
    let request = f.request("I asked @Vektor. @Kai is still a separate request.");
    let before = request.final_draft.clone();
    assert_eq!(
        f.resolver().resolve_mentions(&request).unwrap(),
        vec![("Kai".into(), f.kai.clone())]
    );
    assert_eq!(
        request.final_draft, before,
        "suppression never hides or changes body text"
    );
    let mut other_parent = request.clone();
    other_parent.dispatch_receipt_id = OpaqueId::parse("d".repeat(64)).unwrap();
    assert_eq!(
        f.resolver().resolve_mentions(&other_parent).unwrap().len(),
        2,
        "a different parent keeps its own exact activation authority"
    );
    let mut explicit_child = request;
    explicit_child.dispatch_receipt_id = OpaqueId::parse(child.as_str()).unwrap();
    assert_eq!(f.resolver().resolve_mentions(&explicit_child).unwrap(), vec![("Vektor".into(), f.vektor.clone())],
        "explicit distinct tool actions keep their exact recipient despite parent-final suppression");
}
