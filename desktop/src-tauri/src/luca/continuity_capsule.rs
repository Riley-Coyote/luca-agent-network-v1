//! Trusted desktop boundary for the one managed portable continuity Capsule.
//!
//! This module is deliberately I/O-free. It validates owner-readable relay
//! candidates and gives the already-running resident signing broker one exact,
//! fixed Capsule operation. It exposes no Tauri command, generic signer,
//! generic decryptor, key loader, or child-process surface.

use std::{
    sync::mpsc::{self, Receiver, SyncSender, TryRecvError, TrySendError},
    time::Duration,
};

use buzz_core_pkg::{
    engram::{build_event, conversation_key, d_tag, select_head, validate_and_decrypt, Body},
    kind::KIND_AGENT_ENGRAM,
};
use luca_continuity::{
    classify_capsule_successor, parse_portable_capsule_envelope, CapsuleSuccessorDisposition,
    ContinuityLayerMaterial, ContinuityReferenceItem, PortableCapsuleEnvelopeV1,
    PORTABLE_CAPSULE_NIP_AE_SLUG,
};
use luca_protocol::{ContinuityLayerStatusV1, Hex64, Sha256Ref};
use luca_protocol::{ContinuityWakeItemV1, OpaqueId};
use nostr::{Event, JsonUtil, Keys, PublicKey};
use reqwest::Method;
use zeroize::Zeroize;

use crate::{
    luca::local_broker_session::LocalBrokerSessionBinding,
    relay::{build_nip98_auth_header_for_keys, relay_http_base_url},
};

pub(crate) const CAPSULE_FETCH_LIMIT: u32 = 8;
const CAPSULE_BROKER_QUEUE_DEPTH: usize = 4;
const CAPSULE_BROKER_DRAIN_LIMIT: usize = 4;

/// Body-free failure states for trusted Capsule operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ContinuityCapsuleDesktopError {
    InvalidProjection,
    InvalidCurrentHead,
    WrongOwner,
    ResidentKeyMismatch,
    StaleBinding,
    RevisionConflict,
    RelayProtocol,
    TimestampOverflow,
    BrokerBusy,
    BrokerUnavailable,
    OwnerLocked,
    RelayUnavailable,
    Timeout,
}

impl std::fmt::Display for ContinuityCapsuleDesktopError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::InvalidProjection => "portable continuity Capsule is invalid",
            Self::InvalidCurrentHead => "current portable continuity Capsule is invalid",
            Self::WrongOwner => "portable continuity Capsule owner is not active",
            Self::ResidentKeyMismatch => "resident Capsule key does not match identity",
            Self::StaleBinding => "portable continuity Capsule binding is stale",
            Self::RevisionConflict => "portable continuity Capsule revision conflicts",
            Self::RelayProtocol => "portable continuity Capsule relay response is invalid",
            Self::TimestampOverflow => "portable continuity Capsule timestamp overflow",
            Self::BrokerBusy => "resident Capsule broker is busy",
            Self::BrokerUnavailable => "resident Capsule broker is unavailable",
            Self::OwnerLocked => "owner identity is unavailable for portable continuity",
            Self::RelayUnavailable => "portable continuity relay is unavailable",
            Self::Timeout => "resident Capsule broker timed out",
        })
    }
}

impl std::error::Error for ContinuityCapsuleDesktopError {}

/// The one exact relay coordinate derived with the active owner's custody.
#[derive(Clone)]
pub(crate) struct ContinuityCapsuleQuery {
    owner_pubkey: Hex64,
    resident_pubkey: Hex64,
    resident: PublicKey,
    d_tag: String,
}

impl ContinuityCapsuleQuery {
    pub(crate) fn derive(
        owner_keys: &Keys,
        expected_owner: &Hex64,
        resident_pubkey: &Hex64,
    ) -> Result<Self, ContinuityCapsuleDesktopError> {
        if owner_keys.public_key().to_hex() != expected_owner.as_str()
            || expected_owner == resident_pubkey
        {
            return Err(ContinuityCapsuleDesktopError::WrongOwner);
        }
        let resident = PublicKey::from_hex(resident_pubkey.as_str())
            .map_err(|_| ContinuityCapsuleDesktopError::InvalidProjection)?;
        let d_tag = d_tag(
            &conversation_key(owner_keys.secret_key(), &resident),
            PORTABLE_CAPSULE_NIP_AE_SLUG,
        );
        Ok(Self {
            owner_pubkey: expected_owner.clone(),
            resident_pubkey: resident_pubkey.clone(),
            resident,
            d_tag,
        })
    }

    /// Exact relay filter. The caller chooses no kind, author, owner, slug, or
    /// pagination coordinate.
    pub(crate) fn filter(&self) -> serde_json::Value {
        serde_json::json!({
            "kinds": [KIND_AGENT_ENGRAM],
            "authors": [self.resident_pubkey.as_str()],
            "#p": [self.owner_pubkey.as_str()],
            "#d": [self.d_tag.as_str()],
            "limit": CAPSULE_FETCH_LIMIT,
        })
    }
}

/// One verified current relay projection. Its Debug implementation remains
/// body-free even if a future pure envelope Debug implementation changes.
pub(crate) struct LoadedContinuityCapsule {
    envelope: PortableCapsuleEnvelopeV1,
    event_id: Hex64,
    event_created_at: u64,
}

impl LoadedContinuityCapsule {
    pub(crate) fn envelope(&self) -> &PortableCapsuleEnvelopeV1 {
        &self.envelope
    }

    pub(crate) fn event_id(&self) -> &Hex64 {
        &self.event_id
    }

    pub(crate) fn event_created_at(&self) -> u64 {
        self.event_created_at
    }
}

impl std::fmt::Debug for LoadedContinuityCapsule {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("LoadedContinuityCapsule")
            .field("event_id", &self.event_id)
            .field("event_created_at", &self.event_created_at)
            .field("revision", &self.envelope.capsule().revision)
            .field("binding_ref", &self.envelope.capsule().binding_ref)
            .finish()
    }
}

/// Absence, stale state, and corruption remain distinguishable. Stale retains
/// its validated envelope only so the broker can authorize revision N+1 when a
/// runtime binding changes; callers must never inject its body into context.
#[derive(Debug)]
pub(crate) enum ContinuityCapsuleLoadState {
    Empty,
    Ready(LoadedContinuityCapsule),
    Stale(LoadedContinuityCapsule),
    Invalid,
}

/// Convert a verified load outcome into the fixed context layer. Only a Ready
/// head carries body material; stale and failed states remain body-free.
pub(crate) fn capsule_context_layer(
    state: ContinuityCapsuleLoadState,
) -> Result<ContinuityLayerMaterial, luca_continuity::ContinuityError> {
    match state {
        ContinuityCapsuleLoadState::Empty => {
            ContinuityLayerMaterial::status(ContinuityLayerStatusV1::Empty, None)
        }
        ContinuityCapsuleLoadState::Stale(_) => {
            ContinuityLayerMaterial::status(ContinuityLayerStatusV1::Stale, None)
        }
        ContinuityCapsuleLoadState::Invalid => {
            ContinuityLayerMaterial::status(ContinuityLayerStatusV1::Invalid, None)
        }
        ContinuityCapsuleLoadState::Ready(loaded) => {
            let value = loaded.envelope.to_body_value()?;
            let provenance = Sha256Ref::parse(format!("sha256:{}", loaded.event_id.as_str()))
                .map_err(|_| luca_continuity::ContinuityError::InvalidCapsule)?;
            let item = ContinuityReferenceItem::new(
                loaded.envelope.capsule().capsule_id.clone(),
                value.as_str().to_owned(),
                vec![provenance],
            )?;
            ContinuityLayerMaterial::ready(vec![item])
        }
    }
}

/// Map only the Capsule's exact identity and owner-relationship segments into
/// Wake fallback items. No prose or category is inferred from other segments.
pub(crate) fn capsule_wake_orientation(
    loaded: &LoadedContinuityCapsule,
) -> Result<(Vec<ContinuityWakeItemV1>, Vec<ContinuityWakeItemV1>), luca_continuity::ContinuityError>
{
    let state = loaded.envelope.current_state();
    let segments = state.segments_in_order();
    let identity = segments
        .iter()
        .find_map(|(name, body)| matches!(*name, "core" | "self_model").then_some(*body).flatten());
    let relationship = segments
        .iter()
        .find_map(|(name, body)| (*name == "owner_relationship").then_some(*body).flatten());
    let event_ref = Sha256Ref::parse(format!("sha256:{}", loaded.event_id.as_str()))
        .map_err(|_| luca_continuity::ContinuityError::InvalidCapsule)?;
    let mut provenance_refs = state.source_refs().to_vec();
    provenance_refs.push(event_ref);
    provenance_refs.sort();
    provenance_refs.dedup();
    let author_kind = OpaqueId::parse("resident")
        .map_err(|_| luca_continuity::ContinuityError::InvalidCapsule)?;
    let source_event_ids = vec![loaded.event_id.clone()];
    let make_item = |suffix: &str, record_kind: &str, body: &str| {
        let item = ContinuityWakeItemV1 {
            item_id: OpaqueId::parse(format!(
                "{}-{suffix}",
                loaded.envelope.capsule().capsule_id.as_str()
            ))
            .map_err(|_| luca_continuity::ContinuityError::InvalidCapsule)?,
            record_kind: OpaqueId::parse(record_kind)
                .map_err(|_| luca_continuity::ContinuityError::InvalidCapsule)?,
            author_kind: author_kind.clone(),
            body: body.to_owned(),
            source_event_ids: source_event_ids.clone(),
            provenance_refs: provenance_refs.clone(),
        };
        item.validate()
            .map_err(|_| luca_continuity::ContinuityError::InvalidCapsule)?;
        Ok(item)
    };
    Ok((
        identity
            .map(|body| make_item("identity", "identity", body))
            .transpose()?
            .into_iter()
            .collect(),
        relationship
            .map(|body| make_item("relationship", "relationship", body))
            .transpose()?
            .into_iter()
            .collect(),
    ))
}

/// Verify signatures before decrypting, select the public coordinate head,
/// then validate the fixed Capsule envelope and exact identities.
pub(crate) fn open_capsule_candidates(
    events: Vec<Event>,
    owner_keys: &Keys,
    query: &ContinuityCapsuleQuery,
    expected_binding: &Sha256Ref,
) -> ContinuityCapsuleLoadState {
    if owner_keys.public_key().to_hex() != query.owner_pubkey.as_str() {
        return ContinuityCapsuleLoadState::Invalid;
    }
    if events.is_empty() {
        return ContinuityCapsuleLoadState::Empty;
    }

    let mut addressed = Vec::new();
    let mut opened = Vec::new();
    for event in events {
        if event.verify().is_err() || !has_exact_coordinate(&event, query) {
            continue;
        }
        addressed.push(event.clone());
        let body = match validate_and_decrypt(
            &event,
            &query.resident,
            &owner_keys.public_key(),
            owner_keys.secret_key(),
            &query.resident,
        ) {
            Ok(body) => body,
            Err(_) => continue,
        };
        match body {
            Body::Memory { slug, value } if slug == PORTABLE_CAPSULE_NIP_AE_SLUG => {
                opened.push((event, value));
            }
            _ => {}
        }
    }

    let Some(head) = select_head(addressed) else {
        return ContinuityCapsuleLoadState::Invalid;
    };
    let Some((event, value)) = opened.into_iter().find(|(event, _)| event.id == head.id) else {
        return ContinuityCapsuleLoadState::Invalid;
    };
    let Some(mut value) = value else {
        return ContinuityCapsuleLoadState::Empty;
    };
    let parsed = parse_portable_capsule_envelope(&value);
    value.zeroize();
    let Ok(envelope) = parsed else {
        return ContinuityCapsuleLoadState::Invalid;
    };
    if envelope.capsule().owner_pubkey != query.owner_pubkey
        || envelope.capsule().resident_pubkey != query.resident_pubkey
    {
        return ContinuityCapsuleLoadState::Invalid;
    }
    let Ok(event_id) = Hex64::parse(event.id.to_hex()) else {
        return ContinuityCapsuleLoadState::Invalid;
    };
    let loaded = LoadedContinuityCapsule {
        envelope,
        event_id,
        event_created_at: event.created_at.as_secs(),
    };
    if &loaded.envelope.capsule().binding_ref == expected_binding {
        ContinuityCapsuleLoadState::Ready(loaded)
    } else {
        ContinuityCapsuleLoadState::Stale(loaded)
    }
}

fn has_exact_coordinate(event: &Event, query: &ContinuityCapsuleQuery) -> bool {
    if event.kind.as_u16() as u32 != KIND_AGENT_ENGRAM
        || event.pubkey.to_hex() != query.resident_pubkey.as_str()
    {
        return false;
    }
    let d_tags = event
        .tags
        .iter()
        .filter(|tag| tag.kind().to_string() == "d")
        .filter_map(|tag| tag.content())
        .collect::<Vec<_>>();
    let p_tags = event
        .tags
        .iter()
        .filter(|tag| tag.kind().to_string() == "p")
        .filter_map(|tag| tag.content())
        .collect::<Vec<_>>();
    d_tags.as_slice() == [query.d_tag.as_str()]
        && p_tags.as_slice() == [query.owner_pubkey.as_str()]
}

/// Body-free proof of either a safe retry or an accepted relay publication.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ContinuityCapsuleStoreReceipt {
    pub(crate) event_id: Hex64,
    pub(crate) revision: u64,
    pub(crate) idempotent: bool,
}

/// Public encrypted HTTP material prepared synchronously while resident keys
/// remain inside the broker. No secret key or plaintext Capsule is retained.
pub(crate) struct PreparedCapsulePublication {
    pub(crate) event_id: Hex64,
    pub(crate) revision: u64,
    pub(crate) url: String,
    pub(crate) body: Vec<u8>,
    pub(crate) authorization: String,
    pub(crate) owner_auth_tag: Option<String>,
}

impl std::fmt::Debug for PreparedCapsulePublication {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PreparedCapsulePublication")
            .field("event_id", &self.event_id)
            .field("revision", &self.revision)
            .field("body_bytes", &self.body.len())
            .field("authorization", &"[PUBLIC-SIGNED-AUTH]")
            .field("owner_auth_tag", &self.owner_auth_tag.is_some())
            .finish()
    }
}

pub(crate) enum CapsulePublicationPreparation {
    Idempotent(ContinuityCapsuleStoreReceipt),
    Publish(PreparedCapsulePublication),
}

impl std::fmt::Debug for CapsulePublicationPreparation {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Idempotent(receipt) => {
                formatter.debug_tuple("Idempotent").field(receipt).finish()
            }
            Self::Publish(prepared) => formatter.debug_tuple("Publish").field(prepared).finish(),
        }
    }
}

pub(crate) struct CapsulePrepareRequest {
    pub(crate) candidate: PortableCapsuleEnvelopeV1,
    pub(crate) current: ContinuityCapsuleLoadState,
    pub(crate) now_unix_seconds: u64,
}

struct CapsuleBrokerRequest {
    request: CapsulePrepareRequest,
    response: SyncSender<Result<CapsulePublicationPreparation, ContinuityCapsuleDesktopError>>,
}

/// Cloneable, bounded, non-signing handle to the resident-owned broker thread.
#[derive(Clone)]
pub(crate) struct CapsuleBrokerHandle {
    sender: SyncSender<CapsuleBrokerRequest>,
    owner_pubkey: Hex64,
    resident_pubkey: Hex64,
    binding_ref: Sha256Ref,
    relay_url: String,
    relay_query_url: String,
}

impl std::fmt::Debug for CapsuleBrokerHandle {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("CapsuleBrokerHandle(<bounded trusted channel>)")
    }
}

impl CapsuleBrokerHandle {
    pub(crate) fn owner_pubkey(&self) -> &Hex64 {
        &self.owner_pubkey
    }

    pub(crate) fn resident_pubkey(&self) -> &Hex64 {
        &self.resident_pubkey
    }

    pub(crate) fn binding_ref(&self) -> &Sha256Ref {
        &self.binding_ref
    }

    pub(crate) fn relay_url(&self) -> &str {
        &self.relay_url
    }

    pub(crate) fn relay_query_url(&self) -> &str {
        &self.relay_query_url
    }

    pub(crate) fn prepare(
        &self,
        request: CapsulePrepareRequest,
        timeout: Duration,
    ) -> Result<CapsulePublicationPreparation, ContinuityCapsuleDesktopError> {
        let (sender, receiver) = mpsc::sync_channel(1);
        match self.sender.try_send(CapsuleBrokerRequest {
            request,
            response: sender,
        }) {
            Ok(()) => {}
            Err(TrySendError::Full(_)) => return Err(ContinuityCapsuleDesktopError::BrokerBusy),
            Err(TrySendError::Disconnected(_)) => {
                return Err(ContinuityCapsuleDesktopError::BrokerUnavailable)
            }
        }
        receiver
            .recv_timeout(timeout)
            .map_err(|error| match error {
                mpsc::RecvTimeoutError::Timeout => ContinuityCapsuleDesktopError::Timeout,
                mpsc::RecvTimeoutError::Disconnected => {
                    ContinuityCapsuleDesktopError::BrokerUnavailable
                }
            })?
    }
}

pub(crate) fn capsule_broker_channel(
    binding: &LocalBrokerSessionBinding,
) -> Result<(CapsuleBrokerHandle, CapsuleBrokerReceiver), ContinuityCapsuleDesktopError> {
    let (sender, receiver) = mpsc::sync_channel(CAPSULE_BROKER_QUEUE_DEPTH);
    let binding_ref = Sha256Ref::parse(format!(
        "sha256:{}",
        binding.runtime_configuration_sha256.as_str()
    ))
    .map_err(|_| ContinuityCapsuleDesktopError::InvalidProjection)?;
    Ok((
        CapsuleBrokerHandle {
            sender,
            owner_pubkey: binding.owner_pubkey.clone(),
            resident_pubkey: binding.resident_pubkey.clone(),
            binding_ref,
            relay_url: binding.relay_url.clone(),
            relay_query_url: binding.relay_query_url.clone(),
        },
        CapsuleBrokerReceiver { receiver },
    ))
}

pub(crate) struct CapsuleBrokerReceiver {
    receiver: Receiver<CapsuleBrokerRequest>,
}

impl std::fmt::Debug for CapsuleBrokerReceiver {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("CapsuleBrokerReceiver(<resident authority queue>)")
    }
}

/// Service at most one fixed bounded queue slice on the resident authority
/// thread. It never performs network I/O and never returns resident keys.
pub(crate) fn service_capsule_broker_slice(
    receiver: &CapsuleBrokerReceiver,
    resident_keys: &Keys,
    binding: &LocalBrokerSessionBinding,
) {
    for _ in 0..CAPSULE_BROKER_DRAIN_LIMIT {
        let request = match receiver.receiver.try_recv() {
            Ok(request) => request,
            Err(TryRecvError::Empty | TryRecvError::Disconnected) => return,
        };
        let result = prepare_publication(request.request, resident_keys, binding);
        let _ = request.response.try_send(result);
    }
}

fn prepare_publication(
    request: CapsulePrepareRequest,
    resident_keys: &Keys,
    binding: &LocalBrokerSessionBinding,
) -> Result<CapsulePublicationPreparation, ContinuityCapsuleDesktopError> {
    let expected_binding = Sha256Ref::parse(format!(
        "sha256:{}",
        binding.runtime_configuration_sha256.as_str()
    ))
    .map_err(|_| ContinuityCapsuleDesktopError::InvalidProjection)?;
    let candidate = request.candidate;
    candidate
        .to_body_value()
        .map_err(|_| ContinuityCapsuleDesktopError::InvalidProjection)?;
    if candidate.capsule().owner_pubkey != binding.owner_pubkey
        || candidate.capsule().resident_pubkey != binding.resident_pubkey
        || candidate.capsule().binding_ref != expected_binding
        || resident_keys.public_key().to_hex() != binding.resident_pubkey.as_str()
    {
        return Err(ContinuityCapsuleDesktopError::StaleBinding);
    }

    let prior = match request.current {
        ContinuityCapsuleLoadState::Empty => {
            if candidate.capsule().revision.get() != 1 {
                return Err(ContinuityCapsuleDesktopError::RevisionConflict);
            }
            None
        }
        ContinuityCapsuleLoadState::Invalid => {
            return Err(ContinuityCapsuleDesktopError::InvalidCurrentHead)
        }
        ContinuityCapsuleLoadState::Ready(current) | ContinuityCapsuleLoadState::Stale(current) => {
            match classify_capsule_successor(&current.envelope, &candidate, &expected_binding) {
                CapsuleSuccessorDisposition::Idempotent => {
                    return Ok(CapsulePublicationPreparation::Idempotent(
                        ContinuityCapsuleStoreReceipt {
                            event_id: current.event_id,
                            revision: candidate.capsule().revision.get(),
                            idempotent: true,
                        },
                    ));
                }
                CapsuleSuccessorDisposition::Successor => Some(current.event_created_at),
                CapsuleSuccessorDisposition::Stale => {
                    return Err(ContinuityCapsuleDesktopError::StaleBinding)
                }
                CapsuleSuccessorDisposition::Invalid => {
                    return Err(ContinuityCapsuleDesktopError::RevisionConflict)
                }
            }
        }
    };
    let created_at = match prior {
        Some(prior) => request.now_unix_seconds.max(
            prior
                .checked_add(1)
                .ok_or(ContinuityCapsuleDesktopError::TimestampOverflow)?,
        ),
        None => request.now_unix_seconds,
    };
    let owner = PublicKey::from_hex(binding.owner_pubkey.as_str())
        .map_err(|_| ContinuityCapsuleDesktopError::InvalidProjection)?;
    let value = candidate
        .to_body_value()
        .map_err(|_| ContinuityCapsuleDesktopError::InvalidProjection)?;
    let mut body = Body::Memory {
        slug: PORTABLE_CAPSULE_NIP_AE_SLUG.to_owned(),
        value: Some(value.as_str().to_owned()),
    };
    let event = build_event(resident_keys, &owner, &body, created_at)
        .map_err(|_| ContinuityCapsuleDesktopError::InvalidProjection);
    zeroize_body(&mut body);
    let event = event?;
    let event_id = Hex64::parse(event.id.to_hex())
        .map_err(|_| ContinuityCapsuleDesktopError::RelayProtocol)?;
    let url = format!(
        "{}/events",
        relay_http_base_url(&binding.relay_url).trim_end_matches('/')
    );
    let body = event.as_json().into_bytes();
    let authorization = build_nip98_auth_header_for_keys(resident_keys, &Method::POST, &url, &body)
        .map_err(|_| ContinuityCapsuleDesktopError::RelayProtocol)?;
    let owner_auth_tag = binding
        .owner_attestation
        .as_ref()
        .map(|attestation| serde_json::to_string(&attestation.tag_value()))
        .transpose()
        .map_err(|_| ContinuityCapsuleDesktopError::RelayProtocol)?;
    Ok(CapsulePublicationPreparation::Publish(
        PreparedCapsulePublication {
            event_id,
            revision: candidate.capsule().revision.get(),
            url,
            body,
            authorization,
            owner_auth_tag,
        },
    ))
}

fn zeroize_body(body: &mut Body) {
    if let Body::Memory { slug, value } = body {
        slug.zeroize();
        if let Some(value) = value {
            value.zeroize();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use luca_continuity::{project_portable_capsule, PortableCapsuleCurrentStateV1};
    use luca_protocol::{CanonicalTimestamp, OpaqueId, SafeU53};

    fn keys(byte: &str) -> Keys {
        Keys::parse(&byte.repeat(64 / byte.len())).expect("fixture key")
    }

    fn hex_key(keys: &Keys) -> Hex64 {
        Hex64::parse(keys.public_key().to_hex()).expect("hex key")
    }

    fn sha(byte: char) -> Sha256Ref {
        Sha256Ref::parse(format!("sha256:{}", byte.to_string().repeat(64))).expect("sha")
    }

    fn capsule(
        owner: &Keys,
        resident: &Keys,
        binding: Sha256Ref,
        revision: u64,
        body: &str,
    ) -> PortableCapsuleEnvelopeV1 {
        project_portable_capsule(
            hex_key(owner),
            hex_key(resident),
            binding,
            SafeU53::new(revision).expect("revision"),
            CanonicalTimestamp::parse(format!("2026-08-05T00:00:{revision:02}Z"))
                .expect("timestamp"),
            PortableCapsuleCurrentStateV1::new(
                Some(body.to_owned()),
                None,
                None,
                None,
                Some("digest".to_owned()),
                None,
                vec![],
            )
            .expect("state"),
        )
        .expect("capsule")
    }

    fn binding(owner: &Keys, resident: &Keys, runtime: char) -> LocalBrokerSessionBinding {
        LocalBrokerSessionBinding {
            owner_pubkey: hex_key(owner),
            resident_pubkey: hex_key(resident),
            acp_pid: 42,
            session_epoch: SafeU53::new(1).unwrap(),
            runtime_configuration_sha256: Hex64::parse(runtime.to_string().repeat(64)).unwrap(),
            installation_session_id: OpaqueId::parse("installation-1").unwrap(),
            relay_url: "ws://127.0.0.1:3000".into(),
            relay_query_url: "http://127.0.0.1:3000/query".into(),
            owner_attestation: None,
        }
    }

    fn event(
        capsule: &PortableCapsuleEnvelopeV1,
        owner: &Keys,
        resident: &Keys,
        created_at: u64,
    ) -> Event {
        let value = capsule.to_body_value().unwrap();
        build_event(
            resident,
            &owner.public_key(),
            &Body::Memory {
                slug: PORTABLE_CAPSULE_NIP_AE_SLUG.into(),
                value: Some(value.as_str().to_owned()),
            },
            created_at,
        )
        .unwrap()
    }

    #[test]
    fn fixed_query_and_round_trip_are_exact() {
        let owner = keys("11");
        let resident = keys("22");
        let runtime = sha('a');
        let capsule = capsule(&owner, &resident, runtime.clone(), 1, "private continuity");
        let query = ContinuityCapsuleQuery::derive(&owner, &hex_key(&owner), &hex_key(&resident))
            .expect("query");
        let filter = query.filter();
        assert_eq!(filter["kinds"], serde_json::json!([KIND_AGENT_ENGRAM]));
        assert_eq!(filter["limit"], CAPSULE_FETCH_LIMIT);
        let opened = open_capsule_candidates(
            vec![event(&capsule, &owner, &resident, 100)],
            &owner,
            &query,
            &runtime,
        );
        let ContinuityCapsuleLoadState::Ready(opened) = opened else {
            panic!("expected ready")
        };
        assert_eq!(opened.envelope(), &capsule);
    }

    #[test]
    fn malformed_newer_head_does_not_fall_back() {
        let owner = keys("31");
        let resident = keys("32");
        let runtime = sha('a');
        let valid = event(
            &capsule(&owner, &resident, runtime.clone(), 1, "valid"),
            &owner,
            &resident,
            100,
        );
        let malformed = build_event(
            &resident,
            &owner.public_key(),
            &Body::Memory {
                slug: PORTABLE_CAPSULE_NIP_AE_SLUG.into(),
                value: Some("not-a-capsule".into()),
            },
            101,
        )
        .unwrap();
        let query =
            ContinuityCapsuleQuery::derive(&owner, &hex_key(&owner), &hex_key(&resident)).unwrap();
        assert!(matches!(
            open_capsule_candidates(vec![valid, malformed], &owner, &query, &runtime),
            ContinuityCapsuleLoadState::Invalid
        ));
    }

    #[test]
    fn stale_binding_is_visible_and_can_advance_under_current_broker_binding() {
        let owner = keys("41");
        let resident = keys("42");
        let old = sha('b');
        let current = sha('c');
        let prior_capsule = capsule(&owner, &resident, old, 1, "prior");
        let next = capsule(&owner, &resident, current.clone(), 2, "next");
        let query =
            ContinuityCapsuleQuery::derive(&owner, &hex_key(&owner), &hex_key(&resident)).unwrap();
        let stale = open_capsule_candidates(
            vec![event(&prior_capsule, &owner, &resident, 100)],
            &owner,
            &query,
            &current,
        );
        assert!(matches!(stale, ContinuityCapsuleLoadState::Stale(_)));
        let prepared = prepare_publication(
            CapsulePrepareRequest {
                candidate: next,
                current: stale,
                now_unix_seconds: 101,
            },
            &resident,
            &binding(&owner, &resident, 'c'),
        )
        .unwrap();
        assert!(matches!(
            prepared,
            CapsulePublicationPreparation::Publish(_)
        ));
    }

    #[test]
    fn broker_rejects_wrong_identity_and_allows_exact_idempotent_retry() {
        let owner = keys("51");
        let resident = keys("52");
        let other = keys("53");
        let runtime = sha('d');
        let current_capsule = capsule(&owner, &resident, runtime.clone(), 1, "current");
        let current_event = event(&current_capsule, &owner, &resident, 100);
        let loaded = LoadedContinuityCapsule {
            envelope: current_capsule.clone(),
            event_id: Hex64::parse(current_event.id.to_hex()).unwrap(),
            event_created_at: 100,
        };
        let exact = prepare_publication(
            CapsulePrepareRequest {
                candidate: current_capsule,
                current: ContinuityCapsuleLoadState::Ready(loaded),
                now_unix_seconds: 101,
            },
            &resident,
            &binding(&owner, &resident, 'd'),
        )
        .unwrap();
        assert!(matches!(
            exact,
            CapsulePublicationPreparation::Idempotent(_)
        ));

        let wrong = prepare_publication(
            CapsulePrepareRequest {
                candidate: capsule(&owner, &resident, runtime, 1, "wrong"),
                current: ContinuityCapsuleLoadState::Empty,
                now_unix_seconds: 101,
            },
            &other,
            &binding(&owner, &resident, 'd'),
        );
        assert!(matches!(
            wrong,
            Err(ContinuityCapsuleDesktopError::StaleBinding)
        ));
    }

    #[test]
    fn surface_contains_no_io_command_storage_or_generic_signer() {
        let source = include_str!("continuity_capsule.rs");
        let production = source.split("#[cfg(test)]").next().unwrap();
        for forbidden in [
            "tauri::command",
            "load_managed_agents",
            "query_relay",
            "submit_signed_event_with_keys",
            "std::process::Command",
            "BUZZ_PRIVATE_KEY",
            "NOSTR_PRIVATE_KEY",
        ] {
            assert!(
                !production.contains(forbidden),
                "forbidden surface: {forbidden}"
            );
        }
    }

    #[test]
    fn debug_and_errors_are_body_free() {
        let owner = keys("61");
        let resident = keys("62");
        let capsule = capsule(&owner, &resident, sha('e'), 1, "sentinel-private-body");
        let event = event(&capsule, &owner, &resident, 100);
        assert!(!format!("{event:?}").contains("sentinel-private-body"));
        for error in [
            ContinuityCapsuleDesktopError::InvalidProjection,
            ContinuityCapsuleDesktopError::InvalidCurrentHead,
            ContinuityCapsuleDesktopError::WrongOwner,
            ContinuityCapsuleDesktopError::ResidentKeyMismatch,
            ContinuityCapsuleDesktopError::StaleBinding,
            ContinuityCapsuleDesktopError::RevisionConflict,
            ContinuityCapsuleDesktopError::RelayProtocol,
            ContinuityCapsuleDesktopError::TimestampOverflow,
            ContinuityCapsuleDesktopError::BrokerBusy,
            ContinuityCapsuleDesktopError::BrokerUnavailable,
            ContinuityCapsuleDesktopError::OwnerLocked,
            ContinuityCapsuleDesktopError::RelayUnavailable,
            ContinuityCapsuleDesktopError::Timeout,
        ] {
            assert!(!error.to_string().contains("sentinel-private-body"));
        }
    }
}
