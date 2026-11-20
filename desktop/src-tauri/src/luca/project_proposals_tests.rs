use super::*;
use luca_protocol::{SafeU53, Sha256Ref};
use std::sync::{atomic::AtomicBool, Arc};

fn key(byte: char) -> Hex64 {
    Hex64::parse(byte.to_string().repeat(64)).expect("key")
}

fn scope_in(conversation: &str) -> ResidentProposalScope {
    ResidentProposalScope {
        owner: key('a'),
        resident: key('b'),
        session_epoch: SafeU53::new(1).expect("epoch"),
        binding: Sha256Ref::parse(format!("sha256:{}", "c".repeat(64))).expect("binding"),
        conversation: OpaqueId::parse(conversation).expect("conversation"),
        active: Arc::new(AtomicBool::new(true)),
    }
}

fn projection(request_id: &str, conversation: &str) -> ProjectProposalV1 {
    ProjectProposalV1 {
        request_id: request_id.into(),
        kind: ProjectRequestKindV1::NewProject,
        owner_pubkey: key('a').as_str().into(),
        resident_pubkey: key('b').as_str().into(),
        conversation_id: conversation.into(),
        project_name: "Ghost app".into(),
        purpose: "Build the Ghost app.".into(),
        chat_name: FIRST_CHAT_NAME.into(),
        resident_pubkeys: vec![key('b').as_str().into()],
        created_at: "2026-11-20T10:00:00Z".into(),
    }
}

fn pending_in(request_id: &str, conversation: &str) -> Pending {
    Pending {
        scope: scope_in(conversation),
        projection: projection(request_id, conversation),
        residents: vec![key('b')],
        deadline: Instant::now() + LIFETIME,
        result: None,
    }
}

#[test]
fn request_names_the_asker_first_and_accepts_nothing_else() {
    let parsed = parse_request(
        json!({"name":"  Ghost app ","purpose":"Build the Ghost app.","include_residents":[key('d').as_str(), key('b').as_str()]}),
        &key('b'),
    )
    .expect("valid request");
    assert_eq!(parsed.name, "Ghost app");
    assert_eq!(parsed.residents, vec![key('b'), key('d')]);

    for field in [
        "owner",
        "conversation_id",
        "chat_name",
        "project_id",
        "source_ids",
        "role",
    ] {
        let mut value = json!({"name":"Ghost app","purpose":"Build it."});
        value[field] = json!("injected");
        assert!(parse_request(value, &key('b')).is_err(), "{field}");
    }
    let nine = ('0'..='8')
        .map(|c| c.to_string().repeat(64))
        .collect::<Vec<_>>();
    for value in [
        json!({"name":"","purpose":"Build it."}),
        json!({"name":"x".repeat(121),"purpose":"Build it."}),
        json!({"name":"two\nlines","purpose":"Build it."}),
        json!({"name":"Ghost app","purpose":" "}),
        json!({"name":"Ghost app","purpose":"y".repeat(201)}),
        json!({"name":"Ghost app","purpose":"Build it.","include_residents":nine}),
        json!({"name":"Ghost app","purpose":"Build it.","include_residents":["D".repeat(64)]}),
        json!({"name":"Ghost app","purpose":"Build it.","include_residents":["Luca"]}),
        json!({"name":"Ghost app","purpose":"Build it.","include_residents":[key('d').as_str(), key('d').as_str()]}),
    ] {
        assert!(parse_request(value.clone(), &key('b')).is_err(), "{value}");
    }
    let eight = ('0'..='7')
        .map(|c| c.to_string().repeat(64))
        .collect::<Vec<_>>();
    assert_eq!(
        parse_request(
            json!({"name":"Ghost app","purpose":"Build it.","include_residents":eight}),
            &key('b')
        )
        .expect("eight is allowed")
        .residents
        .len(),
        9
    );
}

#[test]
fn residents_who_are_not_this_owners_are_refused() {
    let owned = BTreeSet::from([key('b'), key('d')]);
    assert!(require_owned(&[key('b'), key('d')], &owned).is_ok());
    let refusal = require_owned(&[key('b'), key('e')], &owned).expect_err("foreign resident");
    assert!(refusal.contains("owner's own residents"));
}

#[test]
fn a_turn_a_sibling_started_is_refused() {
    let owner = key('a');
    assert!(require_owner_turn(owner.as_str(), 0, &owner).is_ok());
    let sibling = require_owner_turn(owner.as_str(), 1, &owner).expect_err("sibling turn");
    assert!(sibling.contains("turn the owner started"));
    assert!(require_owner_turn(key('f').as_str(), 0, &owner).is_err());
}

#[test]
fn one_request_waits_per_conversation() {
    let mut state = Store::default();
    admit(&mut state, "one".into(), pending_in("one", "luca-chat")).expect("first");
    let second =
        admit(&mut state, "two".into(), pending_in("two", "luca-chat")).expect_err("second");
    assert!(second.contains("already waiting"));
    admit(
        &mut state,
        "three".into(),
        pending_in("three", "other-chat"),
    )
    .expect("another conversation");

    // Once the first has its answer, the conversation is free again.
    assert!(settle(&mut state, "one", &key('a'), declined()).expect("settle"));
    admit(&mut state, "four".into(), pending_in("four", "luca-chat")).expect("after the answer");

    // A request whose session ended does not hold the conversation.
    let ended_session = pending_in("five", "quiet-chat");
    ended_session.scope.active.store(false, Ordering::SeqCst);
    admit(&mut state, "five".into(), ended_session).expect("ended session");
    admit(&mut state, "six".into(), pending_in("six", "quiet-chat")).expect("free");
}

#[test]
fn an_answer_is_recorded_once_and_only_by_its_owner() {
    let mut state = Store::default();
    admit(&mut state, "one".into(), pending_in("one", "luca-chat")).expect("admit");
    assert!(settle(&mut state, "one", &key('f'), declined()).is_err());
    assert!(settle(&mut state, "one", &key('a'), declined()).expect("first answer"));
    assert!(!settle(
        &mut state,
        "one",
        &key('a'),
        json!({"status":"project_created"})
    )
    .expect("second"));
    assert_eq!(state.pending["one"].result, Some(declined()));
    assert!(settle(&mut state, "missing", &key('a'), declined()).is_err());

    let mut expired = pending_in("late", "late-chat");
    expired.deadline = Instant::now() - Duration::from_secs(1);
    state.pending.insert("late".into(), expired);
    assert!(!settle(&mut state, "late", &key('a'), declined()).expect("expired"));
}

#[test]
fn waiting_ends_with_the_answer_or_an_honest_reason() {
    // The owner answers while the resident waits.
    let store = Mutex::new(Store::default());
    admit(
        &mut lock(&store).expect("lock"),
        "one".into(),
        pending_in("one", "luca-chat"),
    )
    .expect("admit");
    thread::scope(|threads| {
        threads.spawn(|| {
            thread::sleep(Duration::from_millis(120));
            settle(
                &mut lock(&store).expect("lock"),
                "one",
                &key('a'),
                declined(),
            )
            .expect("answer");
        });
        assert_eq!(
            await_answer(&store, "one", || false).expect("answer"),
            declined()
        );
    });

    // No answer within the lifetime.
    let store = Mutex::new(Store::default());
    let mut late = pending_in("late", "luca-chat");
    late.deadline = Instant::now() + Duration::from_millis(80);
    admit(&mut lock(&store).expect("lock"), "late".into(), late).expect("admit");
    let result = await_answer(&store, "late", || false).expect("no answer");
    assert_eq!(result["status"], "no_answer");
    assert!(result["message"]
        .as_str()
        .expect("message")
        .contains("within 15 minutes"));

    // The resident's session ends.
    let store = Mutex::new(Store::default());
    let pending = pending_in("gone", "luca-chat");
    let active = Arc::clone(&pending.scope.active);
    admit(&mut lock(&store).expect("lock"), "gone".into(), pending).expect("admit");
    active.store(false, Ordering::SeqCst);
    assert_eq!(
        await_answer(&store, "gone", || false).expect("ended")["reason"],
        "resident_session_ended"
    );

    // The tool caller hangs up.
    let store = Mutex::new(Store::default());
    admit(
        &mut lock(&store).expect("lock"),
        "left".into(),
        pending_in("left", "luca-chat"),
    )
    .expect("admit");
    let result = await_answer(&store, "left", || true).expect("left");
    assert_eq!(result["status"], "incomplete");
    assert_eq!(result["reason"], "caller_disconnected");
}

fn facts(private_chat: bool, members: &[Hex64]) -> ChatFacts {
    ChatFacts {
        private_chat,
        members: members.iter().cloned().collect(),
    }
}

#[test]
fn the_chat_is_confirmed_after_its_late_membership_record_arrives() {
    let expected = [key('a'), key('b')];
    let mut reads = 0;
    let mut waits = 0;
    let check = confirm_chat(
        || {
            reads += 1;
            match reads {
                1 => None,
                2 => Some(facts(true, &[key('a')])),
                _ => Some(facts(true, &[key('a'), key('b'), key('d')])),
            }
        },
        &expected,
        MEMBERSHIP_ATTEMPTS,
        || waits += 1,
    );
    assert_eq!(check, ChatCheck::Confirmed);
    assert_eq!((reads, waits), (3, 2));

    let mut reads = 0;
    assert_eq!(
        confirm_chat(
            || {
                reads += 1;
                Some(facts(true, &[key('a')]))
            },
            &expected,
            4,
            || {}
        ),
        ChatCheck::MembersMissing(vec![key('b')])
    );
    assert_eq!(reads, 4, "it keeps retrying until the bound");
    assert_eq!(
        confirm_chat(|| None, &expected, 3, || {}),
        ChatCheck::NotFound
    );
    let mut reads = 0;
    assert_eq!(
        confirm_chat(
            || {
                reads += 1;
                Some(facts(false, &expected))
            },
            &expected,
            5,
            || {}
        ),
        ChatCheck::NotPrivate
    );
    assert_eq!(reads, 1, "a public chat is never retried into success");
}

#[test]
fn every_answer_tells_the_resident_what_happened_in_plain_words() {
    let projection = projection("one", "luca-chat");
    let created = created_result(&projection, &[key('b'), key('d')], "ghost-app", "chat-1");
    assert_eq!(created["status"], "project_created");
    assert_eq!(created["projectName"], "Ghost app");
    assert_eq!(created["projectId"], "ghost-app");
    assert_eq!(created["chatId"], "chat-1");
    assert_eq!(created["chatName"], "general");
    assert_eq!(
        created["residents"],
        json!([key('b').as_str(), key('d').as_str()])
    );
    assert_eq!(created["conversationId"], "luca-chat");
    assert!(created["message"]
        .as_str()
        .expect("message")
        .contains("stays in this conversation"));

    assert_eq!(
        declined()["message"],
        "The owner chose Not now. Nothing was created. Don't ask again unless they raise it."
    );

    let partial = partial_result(
        &projection,
        Some("ghost-app"),
        None,
        &[],
        "the chat could not be made",
    );
    assert_eq!(partial["status"], "partly_created");
    assert_eq!(partial["exists"], json!(["project"]));
    assert_eq!(partial["missing"], json!(["first chat"]));
    let missing = partial_result(
        &projection,
        Some("ghost-app"),
        Some("chat-1"),
        &[key('d')],
        "members",
    );
    assert_eq!(missing["missing"], json!(["some members"]));
    assert_eq!(missing["missingResidents"], json!([key('d').as_str()]));

    assert_eq!(ended("caller_disconnected")["status"], "incomplete");
}

#[test]
fn the_window_answers_in_a_closed_shape() {
    let created: ProjectProposalAnswerV1 = serde_json::from_value(
        json!({"outcome":"created","projectId":"ghost-app","chatId":"chat-1"}),
    )
    .expect("created");
    assert_eq!(
        created,
        ProjectProposalAnswerV1::Created {
            project_id: "ghost-app".into(),
            chat_id: "chat-1".into()
        }
    );
    assert_eq!(
        serde_json::from_value::<ProjectProposalAnswerV1>(json!({"outcome":"declined"}))
            .expect("declined"),
        ProjectProposalAnswerV1::Declined
    );
    for value in [
        json!({"outcome":"created","projectId":"ghost-app"}),
        json!({"outcome":"created","projectId":"ghost-app","chatId":"chat-1","members":["x"]}),
        json!({"outcome":"approved"}),
        json!({"outcome":"partial"}),
    ] {
        assert!(
            serde_json::from_value::<ProjectProposalAnswerV1>(value.clone()).is_err(),
            "{value}"
        );
    }
}

#[test]
fn the_card_is_drawn_from_host_facts_in_the_windows_shape() {
    let encoded = serde_json::to_value(projection("one", "luca-chat")).expect("encoding");
    assert_eq!(encoded["kind"], "new_project");
    assert_eq!(encoded["chatName"], "general");
    assert_eq!(encoded["projectName"], "Ghost app");
    assert_eq!(encoded["residentPubkeys"], json!([key('b').as_str()]));
    assert_eq!(encoded["conversationId"], "luca-chat");
}
