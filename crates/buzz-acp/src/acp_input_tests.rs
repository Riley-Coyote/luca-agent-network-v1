//! Real private-socket/ACP fixtures; no inherited global state or provider calls.

use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
    time::Duration,
};

use tokio::io::{AsyncBufReadExt as _, AsyncWriteExt as _, BufReader};
use tokio::net::UnixStream;
use tracing::instrument::WithSubscriber as _;

use super::*;
use luca_protocol::{Hex64, ManagedInputValueV1, OpaqueId, SafeU53};

const SESSION: &str = "synthetic-session";
const TOOL: &str = "ask-1";
const QUESTION: &str = "PRIVATE_NATIVE_QUESTION_SENTINEL";
const INPUT: &str = "PRIVATE_NATIVE_TOOL_INPUT_SENTINEL";
const OUTPUT: &str = "PRIVATE_NATIVE_TOOL_OUTPUT_SENTINEL";
const ANSWER: &str = "PRIVATE_OWNER_ANSWER_SENTINEL";
const STALE: &str = "PRIVATE_STALE_ANSWER_SENTINEL";
const BOUND: Duration = Duration::from_secs(5);

fn pair() -> (Arc<ManagedPermissionClient>, UnixStream) {
    let (host, desktop) = UnixStream::pair().expect("synthetic private socket");
    (
        Arc::new(ManagedPermissionClient {
            stream: tokio::sync::Mutex::new(host),
            resident_pubkey: Hex64::parse("a".repeat(64)).unwrap(),
            session_epoch: SafeU53::new(7).unwrap(),
        }),
        desktop,
    )
}

fn tool_frame() -> serde_json::Value {
    serde_json::json!({"jsonrpc":"2.0","method":"session/update","params":{
        "sessionId":SESSION,"update":{"sessionUpdate":"tool_call","toolCallId":TOOL,
        "title":"AskUserQuestion","kind":"other","status":"pending",
        "_meta":{"claudeCode":{"toolName":"AskUserQuestion"}},
        "rawInput":{"questions":INPUT},"content":[{"type":"text","text":INPUT}]}}})
}

fn question_frame() -> serde_json::Value {
    serde_json::json!({"jsonrpc":"2.0","id":77,"method":"elicitation/create","params":{
        "sessionId":SESSION,"toolCallId":TOOL,"mode":"form","message":QUESTION,
        "requestedSchema":{"type":"object","required":["question_0"],"properties":{
            "question_0":{"type":"string","title":QUESTION,"description":QUESTION}}}}})
}

fn decision(
    request: &ManagedInputRequestV1,
    action: ManagedInputActionV1,
    text: &str,
) -> ManagedInputDecisionV1 {
    ManagedInputDecisionV1 {
        protocol: request.protocol.clone(),
        resident_pubkey: request.resident_pubkey.clone(),
        session_epoch: request.session_epoch,
        turn_id: request.turn_id.clone(),
        conversation_id: request.conversation_id.clone(),
        provider_session_id: request.provider_session_id.clone(),
        acp_request_id: request.acp_request_id.clone(),
        tool_call_id: request.tool_call_id.clone(),
        action,
        answers: if action == ManagedInputActionV1::Answered {
            BTreeMap::from([("question_0".into(), ManagedInputValueV1::Text(text.into()))])
        } else {
            BTreeMap::new()
        },
    }
}

fn expected_response(action: ManagedInputActionV1) -> serde_json::Value {
    let result = match action {
        ManagedInputActionV1::Answered => {
            serde_json::json!({"action":"accept","content":{"question_0":ANSWER}})
        }
        ManagedInputActionV1::Declined => serde_json::json!({"action":"decline"}),
        ManagedInputActionV1::Cancelled => serde_json::json!({"action":"cancel"}),
    };
    serde_json::json!({"jsonrpc":"2.0","id":77,"result":result})
}

fn private_request(private: &ManagedPermissionClient) -> ManagedInputRequestV1 {
    ManagedInputRequestV1 {
        protocol: MANAGED_INPUT_PROTOCOL.into(),
        resident_pubkey: private.resident_pubkey.clone(),
        session_epoch: private.session_epoch,
        turn_id: OpaqueId::parse("turn-1").unwrap(),
        conversation_id: OpaqueId::parse("conversation-1").unwrap(),
        provider_session_id: SESSION.into(),
        acp_request_id: "77".into(),
        tool_call_id: TOOL.into(),
        message: QUESTION.into(),
        fields: fields(&question_frame()["params"]).unwrap(),
    }
}

fn quoted(value: &serde_json::Value) -> String {
    format!(
        "'{}'",
        serde_json::to_string(value).unwrap().replace('\'', "'\\''")
    )
}

fn adapter_script(
    question: &serde_json::Value,
    expected: &serde_json::Value,
    restoring: bool,
    late: bool,
) -> String {
    let terminal = if restoring {
        serde_json::json!({"jsonrpc":"2.0","id":0,"result":{}})
    } else {
        serde_json::json!({"jsonrpc":"2.0","id":0,"result":{"stopReason":"end_turn"}})
    };
    let output = serde_json::json!({"jsonrpc":"2.0","method":"session/update","params":{
        "sessionId":SESSION,"update":{"sessionUpdate":"tool_call_update","toolCallId":TOOL,
        "status":"completed","rawOutput":{"answer":OUTPUT},"content":[{"type":"text","text":OUTPUT}]}}});
    format!("IFS= read -r REQUEST || exit 2\n{}printf '%s\\n' {}\nprintf '%s\\n' {}\nIFS= read -r RESPONSE || exit 3\nEXPECTED={}\nif [ \"$RESPONSE\" != \"$EXPECTED\" ]; then exit 4; fi\nprintf '%s\\n' \"$RESPONSE\"\nprintf '%s\\n' {}\n{}",
        if late { format!("printf '%s\\n' {}\n", quoted(&terminal)) } else { String::new() },
        quoted(&tool_frame()), quoted(question), quoted(expected), quoted(&output),
        if late { String::new() } else { format!("printf '%s\\n' {}\n", quoted(&terminal)) })
}

async fn adapter(script: &str, private: Arc<ManagedPermissionClient>) -> AcpClient {
    // Construct per-test private state explicitly, avoiding the process-global
    // inherited-FD OnceLock and environment mutation across parallel tests.
    let mut client = AcpClient::spawn("/bin/sh", &["-c".into(), script.into()], &[], false)
        .await
        .expect("synthetic ACP child");
    client.managed_identity = true;
    client.managed_permission = Some(private);
    client.set_managed_turn_context("turn-1", Some("conversation-1"), None);
    client
}

async fn read_request(peer: &mut BufReader<UnixStream>) -> ManagedInputRequestV1 {
    let mut line = String::new();
    let count = tokio::time::timeout(BOUND, peer.read_line(&mut line))
        .await
        .unwrap()
        .unwrap();
    assert!(count > 0 && line.len() <= MANAGED_PERMISSION_MAX_FRAME_BYTES);
    let request: ManagedInputRequestV1 = serde_json::from_str(&line).unwrap();
    request.validate().unwrap();
    assert_eq!(request.protocol, MANAGED_INPUT_PROTOCOL);
    assert_eq!(request.resident_pubkey.as_str(), "a".repeat(64));
    assert_eq!(request.session_epoch.get(), 7);
    assert_eq!(request.turn_id.as_str(), "turn-1");
    assert_eq!(request.conversation_id.as_str(), "conversation-1");
    assert_eq!(request.provider_session_id, SESSION);
    assert_eq!(request.message, QUESTION);
    request
}

async fn send_decision(peer: &mut BufReader<UnixStream>, answer: &ManagedInputDecisionV1) {
    let mut bytes = serde_json::to_vec(answer).unwrap();
    bytes.push(b'\n');
    peer.get_mut().write_all(&bytes).await.unwrap();
}

async fn complete_prompt(client: &mut AcpClient) {
    let outcome = tokio::time::timeout(
        BOUND,
        client.session_prompt_with_idle_timeout(SESSION, "SYNTHETIC_USER_PROMPT", BOUND, BOUND),
    )
    .await;
    let exited = tokio::time::timeout(BOUND, client.child.wait()).await;
    client.shutdown().await;
    assert_eq!(
        outcome
            .expect("bounded question lifecycle")
            .expect("wire-checked prompt"),
        StopReason::EndTurn
    );
    assert!(exited
        .expect("fake adapter exits after checking exact response")
        .unwrap()
        .success());
}

#[tokio::test]
async fn answered_declined_and_cancelled_reach_exact_native_wire_without_permission_grants() {
    for action in [
        ManagedInputActionV1::Answered,
        ManagedInputActionV1::Declined,
        ManagedInputActionV1::Cancelled,
    ] {
        let (private, peer) = pair();
        let server = tokio::spawn(async move {
            let mut peer = BufReader::new(peer);
            let request = read_request(&mut peer).await;
            assert_eq!(request.acp_request_id, "77");
            assert_eq!(request.tool_call_id, TOOL);
            assert!(request.fields[0].required);
            send_decision(&mut peer, &decision(&request, action, ANSWER)).await;
        });
        let script = adapter_script(&question_frame(), &expected_response(action), false, false);
        let mut client = adapter(&script, private).await;
        complete_prompt(&mut client).await;
        server.await.unwrap();
    }
}

#[tokio::test]
async fn stale_scope_and_malformed_socket_answers_are_ignored_until_exact_response() {
    let (private, peer) = pair();
    let server = tokio::spawn(async move {
        let mut peer = BufReader::new(peer);
        let request = read_request(&mut peer).await;
        peer.get_mut()
            .write_all(b"PRIVATE_MALFORMED_RESPONSE\n")
            .await
            .unwrap();
        for index in 0..8 {
            let mut stale = decision(&request, ManagedInputActionV1::Answered, STALE);
            match index {
                0 => stale.protocol = "luca.managed.permission.v1".into(),
                1 => stale.resident_pubkey = Hex64::parse("b".repeat(64)).unwrap(),
                2 => stale.session_epoch = SafeU53::new(8).unwrap(),
                3 => stale.turn_id = OpaqueId::parse("turn-2").unwrap(),
                4 => stale.conversation_id = OpaqueId::parse("conversation-2").unwrap(),
                5 => stale.provider_session_id = "sibling-session".into(),
                6 => stale.acp_request_id = "78".into(),
                _ => stale.tool_call_id = "ask-2".into(),
            }
            send_decision(&mut peer, &stale).await;
        }
        let mut unadvertised = decision(&request, ManagedInputActionV1::Answered, STALE);
        unadvertised.answers.insert(
            "unadvertised".into(),
            ManagedInputValueV1::Text(STALE.into()),
        );
        send_decision(&mut peer, &unadvertised).await;
        send_decision(
            &mut peer,
            &decision(&request, ManagedInputActionV1::Answered, ANSWER),
        )
        .await;
    });
    let mut client = adapter(
        &adapter_script(
            &question_frame(),
            &expected_response(ManagedInputActionV1::Answered),
            false,
            false,
        ),
        private,
    )
    .await;
    complete_prompt(&mut client).await;
    server.await.unwrap();
}

#[tokio::test]
async fn oversized_private_socket_frame_cancels_the_native_question() {
    let (private, peer) = pair();
    let server = tokio::spawn(async move {
        let mut peer = BufReader::new(peer);
        let _ = read_request(&mut peer).await;
        let mut oversized = vec![b'x'; MANAGED_PERMISSION_MAX_FRAME_BYTES + 1];
        oversized.push(b'\n');
        peer.get_mut().write_all(&oversized).await.unwrap();
    });
    let mut client = adapter(
        &adapter_script(
            &question_frame(),
            &expected_response(ManagedInputActionV1::Cancelled),
            false,
            false,
        ),
        private,
    )
    .await;
    complete_prompt(&mut client).await;
    server.await.unwrap();
}

#[tokio::test]
async fn private_socket_eof_or_closed_descriptor_cancels_without_answer() {
    for close_before_request in [true, false] {
        let (private, peer) = pair();
        let server = if close_before_request {
            // Exercise failure writing to a descriptor whose peer is gone.
            drop(peer);
            None
        } else {
            Some(tokio::spawn(async move {
                let mut peer = BufReader::new(peer);
                let _ = read_request(&mut peer).await;
            }))
        };
        let mut client = adapter(
            &adapter_script(
                &question_frame(),
                &expected_response(ManagedInputActionV1::Cancelled),
                false,
                false,
            ),
            private,
        )
        .await;
        complete_prompt(&mut client).await;
        if let Some(server) = server {
            server.await.unwrap();
        }
    }
}

#[tokio::test]
async fn wrong_session_sibling_tool_and_disabled_questions_decline_without_socket_forwarding() {
    for variant in 0..4 {
        let (private, peer) = pair();
        let mut question = question_frame();
        match variant {
            0 => question["params"]["sessionId"] = serde_json::json!("sibling-session"),
            1 => question["params"]["toolCallId"] = serde_json::json!("sibling-tool"),
            _ => {}
        }
        let mut client = adapter(
            &adapter_script(
                &question,
                &expected_response(ManagedInputActionV1::Declined),
                false,
                false,
            ),
            private,
        )
        .await;
        if variant == 2 {
            client.deny_unmanaged_permissions = true;
        }
        if variant == 3 {
            client.restoring_session = Some((SESSION.into(), 0));
        }
        complete_prompt(&mut client).await;
        let mut bytes = [0; 1];
        assert!(
            matches!(peer.try_read(&mut bytes), Err(error) if error.kind() == std::io::ErrorKind::WouldBlock)
        );
    }
}

#[tokio::test]
async fn native_restoration_questions_decline_before_and_after_load_response() {
    for late in [false, true] {
        let (private, peer) = pair();
        let mut client = adapter(
            &adapter_script(
                &question_frame(),
                &expected_response(ManagedInputActionV1::Declined),
                true,
                late,
            ),
            private,
        )
        .await;
        client.session_load_supported = true;
        let restored = tokio::time::timeout(
            BOUND,
            client.session_restore_full_with_context(
                SESSION,
                "/synthetic/workspace",
                &[],
                Vec::new(),
                None,
                None,
                true,
            ),
        )
        .await;
        let exited = tokio::time::timeout(Duration::from_secs(1), client.child.wait()).await;
        client.shutdown().await;
        assert_eq!(restored.unwrap().unwrap().0.session_id, SESSION);
        assert!(exited
            .expect("restoration decline reaches fake adapter")
            .unwrap()
            .success());
        let mut bytes = [0; 1];
        assert!(
            matches!(peer.try_read(&mut bytes), Err(error) if error.kind() == std::io::ErrorKind::WouldBlock)
        );
    }
}

#[derive(Clone)]
struct LogWriter(Arc<Mutex<Vec<u8>>>);

impl std::io::Write for LogWriter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0
            .lock()
            .map_err(|_| std::io::Error::other("fixture log lock"))?
            .extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for LogWriter {
    type Writer = Self;
    fn make_writer(&'a self) -> Self::Writer {
        self.clone()
    }
}

#[tokio::test]
async fn private_question_tool_input_output_and_owner_response_never_reach_observer_or_logs() {
    let (private, peer) = pair();
    let server = tokio::spawn(async move {
        let mut peer = BufReader::new(peer);
        let request = read_request(&mut peer).await;
        send_decision(
            &mut peer,
            &decision(&request, ManagedInputActionV1::Answered, ANSWER),
        )
        .await;
    });
    let mut client = adapter(
        &adapter_script(
            &question_frame(),
            &expected_response(ManagedInputActionV1::Answered),
            false,
            false,
        ),
        private,
    )
    .await;
    let observer = ObserverHandle::in_process();
    client.set_observer(Some(observer.clone()), 0);
    let logs = Arc::new(Mutex::new(Vec::new()));
    let subscriber = tracing_subscriber::fmt()
        .with_writer(LogWriter(Arc::clone(&logs)))
        .with_max_level(tracing::Level::TRACE)
        .with_ansi(false)
        .finish();
    complete_prompt(&mut client)
        .with_subscriber(subscriber)
        .await;
    server.await.unwrap();
    let snapshot = observer.snapshot();
    let encoded = serde_json::to_string(&snapshot).unwrap();
    let captured = String::from_utf8(logs.lock().unwrap().clone()).unwrap();
    for sentinel in [QUESTION, INPUT, OUTPUT, ANSWER] {
        assert!(!encoded.contains(sentinel), "observer leaked {sentinel}");
        assert!(!captured.contains(sentinel), "trace leaked {sentinel}");
    }
    assert!(snapshot.iter().any(|event| event.kind == "acp_read"
        && event.payload["method"] == "elicitation/create"
        && event.payload["params"]["redacted"] == true));
    assert!(snapshot.iter().any(|event| event.kind == "acp_write"
        && event.payload["id"] == 77
        && event.payload["bodyRedacted"] == true));
    for kind in ["tool_call", "tool_call_update"] {
        assert!(snapshot
            .iter()
            .any(
                |event| event.payload["params"]["update"]["sessionUpdate"] == kind
                    && event.payload["params"]["update"]["bodyRedacted"] == true
            ));
    }
}

#[tokio::test(start_paused = true)]
async fn unanswered_private_socket_expires_at_host_deadline() {
    let (private, peer) = pair();
    let request = private_request(&private);
    let waiter = tokio::spawn(async move { private.answer_input(request).await });
    let mut peer = BufReader::new(peer);
    let _ = read_request(&mut peer).await;
    tokio::time::advance(Duration::from_secs(
        MANAGED_PERMISSION_CLIENT_DEADLINE_SECS + 1,
    ))
    .await;
    let outcome = waiter.await.unwrap();
    assert!(
        matches!(outcome, Err(AcpError::Protocol(message)) if message == "native question expired")
    );
}

#[tokio::test]
async fn sibling_questions_share_one_serial_socket_and_ignore_prior_duplicate_answers() {
    let (private, peer) = pair();
    let first = private_request(&private);
    let mut second = first.clone();
    second.tool_call_id = "ask-2".into();
    second.acp_request_id = "78".into();
    let server = tokio::spawn(async move {
        let mut peer = BufReader::new(peer);
        let current = read_request(&mut peer).await;
        send_decision(
            &mut peer,
            &decision(&current, ManagedInputActionV1::Answered, ANSWER),
        )
        .await;
        let sibling = read_request(&mut peer).await;
        assert_ne!(current.tool_call_id, sibling.tool_call_id);
        assert_ne!(current.acp_request_id, sibling.acp_request_id);
        // A duplicate answer for the preceding question cannot resolve its sibling.
        send_decision(
            &mut peer,
            &decision(&current, ManagedInputActionV1::Answered, STALE),
        )
        .await;
        send_decision(
            &mut peer,
            &decision(&sibling, ManagedInputActionV1::Answered, ANSWER),
        )
        .await;
    });
    let (first_answer, second_answer) = tokio::time::timeout(BOUND, async {
        tokio::join!(
            private.answer_input(first.clone()),
            private.answer_input(second.clone())
        )
    })
    .await
    .expect("serialized bounded sibling questions");
    let first_answer = first_answer.unwrap();
    let second_answer = second_answer.unwrap();
    first_answer.validate_for(&first).unwrap();
    second_answer.validate_for(&second).unwrap();
    assert!(first_answer.validate_for(&second).is_err());
    assert!(second_answer.validate_for(&first).is_err());
    for answer in [first_answer, second_answer] {
        assert_eq!(
            answer.answers["question_0"],
            ManagedInputValueV1::Text(ANSWER.into())
        );
    }
    server.await.unwrap();
}

#[tokio::test]
async fn initialize_wire_advertises_object_form_only_with_enabled_private_channel() {
    let script = r#"IFS= read -r REQUEST || exit 2
printf '{"jsonrpc":"2.0","id":0,"result":{"wireInitialize":%s}}\n' "$REQUEST"
"#;
    // Enabled private host, legacy without FD, managed without FD, disabled host.
    for variant in 0..4 {
        let mut client = AcpClient::spawn("/bin/sh", &["-c".into(), script.into()], &[], false)
            .await
            .expect("synthetic initialization adapter");
        client.managed_identity = variant != 1;
        if matches!(variant, 0 | 3) {
            let (private, _peer) = pair();
            client.managed_permission = Some(private);
        }
        client.deny_unmanaged_permissions = variant == 3;
        let initialized = tokio::time::timeout(BOUND, client.initialize()).await;
        let exited = tokio::time::timeout(BOUND, client.child.wait()).await;
        client.shutdown().await;
        let initialized = initialized.unwrap().expect("initialize wire response");
        assert!(exited.unwrap().unwrap().success());
        let sent = &initialized["wireInitialize"];
        assert_eq!(sent["method"], "initialize");
        let elicitation = sent.pointer("/params/clientCapabilities/elicitation");
        if variant == 0 {
            assert_eq!(elicitation, Some(&serde_json::json!({"form": {}})));
            let form = elicitation.unwrap().get("form").unwrap();
            assert!(
                form.is_object(),
                "SDK form capability is an object, not true"
            );
            assert!(!form.is_boolean());
        } else {
            assert!(
                elicitation.is_none(),
                "unavailable private input must not be advertised"
            );
        }
    }
}
