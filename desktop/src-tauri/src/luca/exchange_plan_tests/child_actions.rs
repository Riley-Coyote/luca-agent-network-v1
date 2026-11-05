use super::*;
use crate::luca::agent_inbox_binding::{InboxChildActionBinding, InboxChildActionPhase};

#[test]
fn agent_inbox_tool_task_gets_the_managed_work_window() {
    let f = fixture();
    let child = Hex64::parse("9".repeat(64)).unwrap();
    {
        let mut dispatch = f.dispatch.lock().unwrap();
        dispatch
            .bind_communication_turn_start(&f.trigger_id, f.luca.as_str(), CHANNEL, 7, NOW)
            .unwrap();
        dispatch
            .stage_inbox_child_action(
                &f.trigger_id,
                &child,
                f.luca.as_str(),
                CHANNEL,
                7,
                InboxChildActionBinding {
                    scope: crate::luca::agent_inbox::InboxScope {
                        community_id: "22222222-2222-4222-8222-222222222222".into(),
                        owner_pubkey: f.owner.clone(),
                    },
                    parent_dispatch_id: Hex64::parse(&f.trigger_id).unwrap(),
                    action_key: child.clone(),
                    input_fingerprint: child.clone(),
                    recipient_pubkey: f.vektor.clone(),
                    phase: InboxChildActionPhase::Request,
                    anchor_event_id: Some(Hex64::parse("c".repeat(64)).unwrap()),
                    exchange_id: None,
                    root_event_id: None,
                    reply_event_id: None,
                    response_surface: None,
                },
                vec![f.owner.as_str().to_owned()],
                NOW,
            )
            .unwrap();
    }
    let mut request = f.request("Inspect, implement, test and report the result.");
    request.dispatch_receipt_id = OpaqueId::parse(child.as_str()).unwrap();
    let plan = f.resolver().resolve(&request, NOW).unwrap();
    let record = f
        .relay
        .fetch_head(&plan.exchange.unwrap().exchange_id, &f.owner)
        .unwrap()
        .unwrap()
        .record;
    assert_eq!(record.deadline.get(), NOW + 2 * 60 * 60 + 5 * 60);
    assert!(record.admits_turn(2, NOW + 45 * 60));
    assert_eq!(record.bucket, luca_protocol::EXCHANGE_DEFAULT_BUCKET);
}

#[test]
fn agent_inbox_long_work_return_still_honors_stop_and_deadline() {
    for case in ["open", "stop", "expired"] {
        let (f, request, mut record) = owner_return_fixture(true);
        crate::luca::agent_inbox_binding::prepare_new_task_window(&mut record, NOW).unwrap();
        let late = if case == "expired" {
            record.deadline.get() + 1
        } else {
            NOW + 45 * 60
        };
        if case == "stop" {
            record = record.stopped();
        }
        f.relay.seed_head(&record, NOW + 1);
        let result = f.resolver().resolve(&request, late);
        match case {
            "stop" => assert_eq!(result, Err(ExchangeDenial::Closed)),
            "expired" => assert_eq!(result, Err(ExchangeDenial::Expired)),
            _ => assert_eq!(
                result.unwrap().apply(&request).unwrap().resolved_p_tags,
                vec![f.owner.clone()]
            ),
        }
    }
}

#[test]
fn agent_inbox_two_child_tasks_keep_exact_parent_awareness_audience() {
    let f = fixture();
    f.dispatch
        .lock()
        .unwrap()
        .bind_communication_turn_start(&f.trigger_id, f.luca.as_str(), CHANNEL, 7, NOW)
        .unwrap();
    let parent_final = f.request("Both requests were delivered; answers are not yet complete.");
    let mut tasks = Vec::new();
    for (slot, root) in [('8', 'c'), ('9', 'd')] {
        let anchor = Hex64::parse(root.to_string().repeat(64)).unwrap();
        let record = ExchangeRecordV1::open(
            f.owner.clone(),
            vec![f.luca.clone(), f.vektor.clone()],
            OpaqueId::parse(CHANNEL).unwrap(),
            anchor.clone(),
            f.luca.clone(),
            None,
            NOW,
        )
        .unwrap();
        f.relay.seed_head(&record, NOW);
        let child = Hex64::parse(slot.to_string().repeat(64)).unwrap();
        let proof = InboxChildActionBinding {
            scope: crate::luca::agent_inbox::InboxScope {
                community_id: "22222222-2222-4222-8222-222222222222".into(),
                owner_pubkey: f.owner.clone(),
            },
            parent_dispatch_id: Hex64::parse(&f.trigger_id).unwrap(),
            action_key: child.clone(),
            input_fingerprint: child.clone(),
            recipient_pubkey: f.vektor.clone(),
            phase: InboxChildActionPhase::Request,
            anchor_event_id: Some(anchor),
            exchange_id: Some(record.exchange_id.clone()),
            root_event_id: None,
            reply_event_id: None,
            response_surface: None,
        };
        {
            let mut dispatch = f.dispatch.lock().unwrap();
            dispatch
                .stage_inbox_child_action(
                    &f.trigger_id,
                    &child,
                    f.luca.as_str(),
                    CHANNEL,
                    7,
                    proof,
                    vec![f.owner.as_str().to_owned()],
                    NOW,
                )
                .unwrap();
            // B's owner-only anchor and task request must retain only A's
            // accepted audience, regardless of whether B has its own tag.
            if !tasks.is_empty() {
                let mut b = parent_final.clone();
                b.dispatch_receipt_id = OpaqueId::parse(child.as_str()).unwrap();
                drop(dispatch);
                assert_eq!(
                    f.resolver().inbox_awareness_guests(&b, NOW).unwrap(),
                    BTreeSet::from([f.vektor.clone()])
                );
                b.exchange = Some(ExchangeTurnTag::new(record.exchange_id.clone(), 1).unwrap());
                assert_eq!(
                    f.resolver().inbox_awareness_guests(&b, NOW).unwrap(),
                    BTreeSet::from([f.vektor.clone()])
                );
                dispatch = f.dispatch.lock().unwrap();
            }
            let accepted = root.to_string().repeat(64);
            dispatch
                .begin_submission(child.as_str(), f.luca.as_str(), 7, &accepted)
                .unwrap();
            dispatch
                .mark_published(child.as_str(), f.luca.as_str(), &accepted)
                .unwrap();
        }
        tasks.push(record);
    }
    assert_ne!(
        tasks[0].exchange_id, tasks[1].exchange_id,
        "distinct actions retain distinct task roots"
    );
    assert_eq!(
        f.resolver()
            .inbox_awareness_guests(&parent_final, NOW)
            .unwrap(),
        BTreeSet::from([f.vektor.clone()])
    );
    assert!(
        f.dispatch
            .lock()
            .unwrap()
            .authorize_continuity_turn(&f.trigger_id, f.luca.as_str(), CHANNEL, 7, NOW)
            .is_ok(),
        "child acceptance does not consume the ordinary final"
    );
    let mut later_session = parent_final.clone();
    later_session.cancellation_epoch = SafeU53::new(8).unwrap();
    assert!(f
        .resolver()
        .inbox_awareness_guests(&later_session, NOW)
        .unwrap()
        .is_empty());
    let mut later_parent = parent_final.clone();
    later_parent.dispatch_receipt_id = OpaqueId::parse("f".repeat(64)).unwrap();
    assert!(f
        .resolver()
        .inbox_awareness_guests(&later_parent, NOW)
        .unwrap()
        .is_empty());
    f.relay.room.lock().unwrap().remove(&f.vektor);
    assert_eq!(
        f.resolver().inbox_awareness_guests(&parent_final, NOW),
        Err(ExchangeDenial::NotMember)
    );
    f.relay.room.lock().unwrap().insert(f.vektor.clone());
    for mut record in tasks {
        record.state = luca_protocol::ExchangeStateV1::Closed;
        f.relay.seed_head(&record, NOW + 1);
    }
    assert!(
        f.resolver()
            .inbox_awareness_guests(&parent_final, NOW + 1)
            .unwrap()
            .is_empty(),
        "Stop withdraws guest proof even if fade has not removed membership yet"
    );
}

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
