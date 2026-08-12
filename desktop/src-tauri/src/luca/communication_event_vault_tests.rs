use std::fs;

use age::secrecy::SecretString;
use luca_protocol::{
    CanonicalTimestamp, CommunicationActionRequestV1, CommunicationDestinationV1,
    CommunicationOperationV1, Hex64, OpaqueArtifactHandleV1, OpaqueId, SafeU53, Sha256Ref,
    COMMUNICATION_ACTION_PROTOCOL,
};
use nostr::{Event, EventBuilder, JsonUtil, Keys, Kind, Tag, Timestamp};

use super::{
    CommunicationEventVault, CommunicationEventVaultError, CommunicationEventVaultTerminal,
};

const CONVERSATION: &str = "destination-conversation";

fn opaque(value: &str) -> OpaqueId {
    OpaqueId::parse(value).expect("opaque id")
}

fn hex(value: char) -> Hex64 {
    Hex64::parse(value.to_string().repeat(64)).expect("hex")
}

fn sha(value: char) -> Sha256Ref {
    Sha256Ref::parse(format!("sha256:{}", value.to_string().repeat(64))).expect("sha")
}

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("safe integer")
}

fn time(value: &str) -> CanonicalTimestamp {
    CanonicalTimestamp::parse(value).expect("timestamp")
}

fn request(resident: Hex64, body: &str) -> CommunicationActionRequestV1 {
    finalize_request(CommunicationActionRequestV1 {
        protocol: COMMUNICATION_ACTION_PROTOCOL.to_owned(),
        action_id: opaque("action-1"),
        idempotency_key: hex('0'),
        action_fingerprint: sha('0'),
        actor_pubkey: resident.clone(),
        owner_pubkey: hex('1'),
        resident_pubkey: resident,
        session_epoch: safe(4),
        runtime_binding_ref: sha('3'),
        source_conversation_id: opaque("source-conversation"),
        destination: CommunicationDestinationV1::ExistingConversation {
            conversation_id: opaque(CONVERSATION),
            participant_set_version: safe(7),
            participant_set_ref: sha('4'),
        },
        turn_id: opaque("turn-1"),
        dispatch_receipt_id: opaque("dispatch-1"),
        causal_root_id: opaque("causal-root-1"),
        causal_parent_action_id: None,
        causal_depth: safe(0),
        cancellation_epoch: safe(2),
        expires_at: time("2026-08-11T13:00:00Z"),
        approval_id: None,
        operation: CommunicationOperationV1::SendMessage {
            body: body.to_owned(),
            reply_to_event_id: None,
            mention_pubkeys: Vec::new(),
            activation_pubkeys: Vec::new(),
            artifact_handles: Vec::new(),
        },
    })
}

fn finalize_request(mut request: CommunicationActionRequestV1) -> CommunicationActionRequestV1 {
    request.action_fingerprint = request
        .derive_action_fingerprint()
        .expect("fixture fingerprint");
    request.idempotency_key = request.derive_idempotency_key().expect("fixture key");
    request
}

fn signed(keys: &Keys, kind: Kind, body: &str, tags: Vec<Tag>) -> String {
    signed_at(keys, kind, body, tags, 1_723_000_000)
}

fn signed_at(keys: &Keys, kind: Kind, body: &str, tags: Vec<Tag>, created_at: u64) -> String {
    EventBuilder::new(kind, body)
        .tags(tags)
        .custom_created_at(Timestamp::from(created_at))
        .sign_with_keys(keys)
        .expect("sign")
        .as_json()
}

fn channel_tag(value: &str) -> Tag {
    Tag::parse(["h", value]).expect("channel tag")
}

fn vault(directory: &std::path::Path, secret: &str, resident: Hex64) -> CommunicationEventVault {
    CommunicationEventVault::open(
        directory.to_path_buf(),
        SecretString::from(secret.to_owned()),
        resident,
    )
    .expect("vault")
}

#[test]
fn seals_round_trips_and_never_persists_plaintext() {
    let dir = tempfile::tempdir().expect("tempdir");
    let keys = Keys::generate();
    let resident = Hex64::parse(keys.public_key().to_hex()).expect("resident");
    let vault = vault(&dir.path().join("events"), "vault-secret", resident.clone());
    let request = request(resident, "private message canary");
    let event = signed(
        &keys,
        Kind::Custom(9),
        "private message canary",
        vec![channel_tag(CONVERSATION)],
    );
    let sealed = vault.seal(&request, &event).expect("seal");
    let loaded = vault
        .load_exact(
            &sealed.handle,
            &request,
            &sealed.event_id,
            &sealed.event_sha256,
        )
        .expect("load");
    assert!(loaded.contains("private message canary"));

    let ciphertext_path = fs::read_dir(dir.path().join("events"))
        .expect("entries")
        .next()
        .expect("entry")
        .expect("entry")
        .path();
    let bytes = fs::read(&ciphertext_path).expect("ciphertext");
    assert!(!String::from_utf8_lossy(&bytes).contains("private message canary"));
    assert!(!format!("{sealed:?}").contains(sealed.handle.as_str()));

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(dir.path().join("events"))
                .expect("directory metadata")
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(ciphertext_path)
                .expect("file metadata")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
}

#[test]
fn exact_repeat_is_idempotent_and_binding_drift_is_rejected() {
    let dir = tempfile::tempdir().expect("tempdir");
    let keys = Keys::generate();
    let resident = Hex64::parse(keys.public_key().to_hex()).expect("resident");
    let vault = vault(&dir.path().join("events"), "vault-secret", resident.clone());
    let request = request(resident, "same bytes");
    let event = signed(
        &keys,
        Kind::Custom(9),
        "same bytes",
        vec![channel_tag(CONVERSATION)],
    );
    let first = vault.seal(&request, &event).expect("first");
    let second = vault.seal(&request, &event).expect("second");
    assert_eq!(first, second);

    let differently_signed = signed_at(
        &keys,
        Kind::Custom(9),
        "same bytes",
        vec![channel_tag(CONVERSATION)],
        1_723_000_001,
    );
    assert_eq!(
        vault.seal(&request, &differently_signed),
        Err(CommunicationEventVaultError::Collision),
        "one semantic action must never freeze two signed events"
    );

    let mut drifted = request.clone();
    drifted.action_id = opaque("action-2");
    let drifted = finalize_request(drifted);
    assert_eq!(
        vault.load_exact(
            &first.handle,
            &drifted,
            &first.event_id,
            &first.event_sha256,
        ),
        Err(CommunicationEventVaultError::Collision)
    );
}

#[test]
fn seal_or_recover_reuses_the_frozen_event_without_a_replacement_signature() {
    let dir = tempfile::tempdir().expect("tempdir");
    let keys = Keys::generate();
    let resident = Hex64::parse(keys.public_key().to_hex()).expect("resident");
    let vault = vault(&dir.path().join("events"), "vault-secret", resident.clone());
    let request = request(resident, "recover frozen event");
    let original = signed(
        &keys,
        Kind::Custom(9),
        "recover frozen event",
        vec![channel_tag(CONVERSATION)],
    );
    let sealed = vault.seal(&request, &original).expect("seal original");
    let recovered = vault
        .seal_or_recover(&request, None)
        .expect("recover committed slot");
    assert_eq!(recovered, sealed);
    assert_eq!(
        vault
            .load_exact(
                &recovered.handle,
                &request,
                &recovered.event_id,
                &recovered.event_sha256,
            )
            .expect("load recovered bytes")
            .as_str(),
        Event::from_json(&original).expect("parse original").as_json(),
        "recovery must retain nostr's stable signed-event bytes"
    );

    let replacement = signed_at(
        &keys,
        Kind::Custom(9),
        "recover frozen event",
        vec![channel_tag(CONVERSATION)],
        1_723_000_001,
    );
    assert_eq!(
        vault.seal_or_recover(&request, Some(&replacement)).expect("still recover"),
        sealed,
        "an already-sealed semantic action never consumes a replacement signature"
    );
}

#[test]
fn wrong_key_tamper_and_terminal_deletion_fail_closed() {
    let dir = tempfile::tempdir().expect("tempdir");
    let keys = Keys::generate();
    let resident = Hex64::parse(keys.public_key().to_hex()).expect("resident");
    let event_dir = dir.path().join("events");
    let event_vault = vault(&event_dir, "vault-secret", resident.clone());
    let request = request(resident.clone(), "delete me");
    let event = signed(
        &keys,
        Kind::Custom(9),
        "delete me",
        vec![channel_tag(CONVERSATION)],
    );
    let sealed = event_vault.seal(&request, &event).expect("seal");

    let wrong = vault(&event_dir, "wrong-secret", resident);
    assert_eq!(
        wrong.load_exact(
            &sealed.handle,
            &request,
            &sealed.event_id,
            &sealed.event_sha256,
        ),
        Err(CommunicationEventVaultError::Persistence)
    );

    let mut wrong_request = request.clone();
    wrong_request.action_id = opaque("wrong-action");
    let wrong_request = finalize_request(wrong_request);
    assert_eq!(
        event_vault.delete_after_terminal(
            &sealed.handle,
            &wrong_request,
            &sealed.event_id,
            &sealed.event_sha256,
            CommunicationEventVaultTerminal::NeverSubmitted,
        ),
        Err(CommunicationEventVaultError::Collision)
    );

    event_vault
        .delete_after_terminal(
            &sealed.handle,
            &request,
            &sealed.event_id,
            &sealed.event_sha256,
            CommunicationEventVaultTerminal::AcceptedAndFinalized,
        )
        .expect("delete");
    event_vault
        .delete_after_terminal(
            &sealed.handle,
            &request,
            &sealed.event_id,
            &sealed.event_sha256,
            CommunicationEventVaultTerminal::ExplicitlyRejected,
        )
        .expect("idempotent delete");
    assert_eq!(
        event_vault.load_exact(
            &sealed.handle,
            &request,
            &sealed.event_id,
            &sealed.event_sha256,
        ),
        Err(CommunicationEventVaultError::NotFound)
    );
}

#[test]
fn ciphertext_tampering_is_detected() {
    let dir = tempfile::tempdir().expect("tempdir");
    let keys = Keys::generate();
    let resident = Hex64::parse(keys.public_key().to_hex()).expect("resident");
    let event_dir = dir.path().join("events");
    let vault = vault(&event_dir, "vault-secret", resident.clone());
    let request = request(resident, "tamper sentinel");
    let event = signed(
        &keys,
        Kind::Custom(9),
        "tamper sentinel",
        vec![channel_tag(CONVERSATION)],
    );
    let sealed = vault.seal(&request, &event).expect("seal");
    let path = fs::read_dir(event_dir)
        .expect("entries")
        .next()
        .expect("entry")
        .expect("entry")
        .path();
    let mut bytes = fs::read(&path).expect("read ciphertext");
    let middle = bytes.len() / 2;
    bytes[middle] ^= 0x01;
    fs::write(path, bytes).expect("tamper ciphertext");
    assert_eq!(
        vault.load_exact(
            &sealed.handle,
            &request,
            &sealed.event_id,
            &sealed.event_sha256,
        ),
        Err(CommunicationEventVaultError::Persistence)
    );
}

#[test]
fn signing_identity_kind_destination_body_mentions_and_reply_are_exact() {
    let dir = tempfile::tempdir().expect("tempdir");
    let keys = Keys::generate();
    let other_keys = Keys::generate();
    let resident = Hex64::parse(keys.public_key().to_hex()).expect("resident");
    let mention = hex('a');
    let reply = hex('b');
    let mut request = request(resident.clone(), "semantic message");
    request.operation = CommunicationOperationV1::SendMessage {
        body: "semantic message".to_owned(),
        reply_to_event_id: Some(reply.clone()),
        mention_pubkeys: vec![mention.clone()],
        activation_pubkeys: Vec::new(),
        artifact_handles: Vec::new(),
    };
    let request = finalize_request(request);

    let valid = signed(
        &keys,
        Kind::Custom(9),
        "semantic message",
        vec![
            channel_tag(CONVERSATION),
            Tag::parse(["e", reply.as_str(), "", "reply"]).expect("reply tag"),
            Tag::parse(["p", mention.as_str()]).expect("mention tag"),
        ],
    );
    vault(&dir.path().join("valid"), "vault-secret", resident.clone())
        .seal(&request, &valid)
        .expect("valid exact event");

    let cases = [
        signed(
            &other_keys,
            Kind::Custom(9),
            "semantic message",
            vec![channel_tag(CONVERSATION)],
        ),
        signed(
            &keys,
            Kind::Custom(7),
            "semantic message",
            vec![channel_tag(CONVERSATION)],
        ),
        signed(
            &keys,
            Kind::Custom(9),
            "different body",
            vec![channel_tag(CONVERSATION)],
        ),
        signed(
            &keys,
            Kind::Custom(9),
            "semantic message",
            vec![channel_tag("wrong-conversation")],
        ),
        signed(
            &keys,
            Kind::Custom(9),
            "semantic message",
            vec![
                channel_tag(CONVERSATION),
                Tag::parse(["e", reply.as_str()]).expect("unmarked event tag"),
                Tag::parse(["p", mention.as_str()]).expect("mention tag"),
            ],
        ),
        signed(
            &keys,
            Kind::Custom(9),
            "semantic message",
            vec![
                channel_tag(CONVERSATION),
                Tag::parse(["e", reply.as_str(), "", "reply"]).expect("reply tag"),
                Tag::parse(["p", mention.as_str()]).expect("mention tag"),
                Tag::parse(["p", hex('c').as_str()]).expect("extra mention tag"),
            ],
        ),
    ];
    for (index, event) in cases.into_iter().enumerate() {
        assert_eq!(
            vault(
                &dir.path().join(format!("invalid-{index}")),
                "vault-secret",
                resident.clone(),
            )
            .seal(&request, &event),
            Err(CommunicationEventVaultError::Invalid),
            "case {index} must fail closed"
        );
    }
}

#[test]
fn artifact_metadata_is_bound_to_the_exact_semantic_handles() {
    let dir = tempfile::tempdir().expect("tempdir");
    let keys = Keys::generate();
    let resident = Hex64::parse(keys.public_key().to_hex()).expect("resident");
    let artifact = OpaqueArtifactHandleV1 {
        handle_id: opaque("artifact-1"),
        content_sha256: hex('a'),
        byte_length: safe(42),
        media_type: "text/plain".to_owned(),
        display_name: Some("notes.txt".to_owned()),
    };
    let mut request = request(resident.clone(), "attached");
    request.operation = CommunicationOperationV1::SendMessage {
        body: "attached".to_owned(),
        reply_to_event_id: None,
        mention_pubkeys: Vec::new(),
        activation_pubkeys: Vec::new(),
        artifact_handles: vec![artifact],
    };
    let request = finalize_request(request);
    let valid_imeta = Tag::parse([
        "imeta",
        "url https://relay.invalid/blob",
        "m text/plain",
        &format!("x {}", hex('a').as_str()),
        "size 42",
        "filename notes.txt",
    ])
    .expect("imeta");
    let valid = signed(
        &keys,
        Kind::Custom(9),
        "attached",
        vec![channel_tag(CONVERSATION), valid_imeta],
    );
    vault(&dir.path().join("valid"), "vault-secret", resident.clone())
        .seal(&request, &valid)
        .expect("exact artifact");

    let wrong_imeta = Tag::parse([
        "imeta",
        "url https://relay.invalid/blob",
        "m text/plain",
        &format!("x {}", hex('b').as_str()),
        "size 42",
        "filename notes.txt",
    ])
    .expect("wrong imeta");
    let wrong = signed(
        &keys,
        Kind::Custom(9),
        "attached",
        vec![channel_tag(CONVERSATION), wrong_imeta],
    );
    assert_eq!(
        vault(&dir.path().join("wrong"), "vault-secret", resident,).seal(&request, &wrong),
        Err(CommunicationEventVaultError::Invalid)
    );
}
