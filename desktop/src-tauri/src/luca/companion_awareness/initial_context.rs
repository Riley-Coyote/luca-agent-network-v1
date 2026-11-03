//! A one-use host-reviewed recent-work sample, independent of Brain and Follow.
//! No serde/Clone approval token and no persisted source bodies. The host must
//! issue this only after the distinct initial-context scope was owner-approved.

use super::{
    native_profile::{
        self, NativeProfileKindV1, NativeProfileObservationClassV1, NativeProfileSelectionV1,
    },
    selected_files::{
        encode_bounded, selected_snapshot, ChangedStateSamplerV1, SamplingOutcomeV1,
        REFERENCE_NOTICE,
    },
    source_runtime::initial_context_exclusions,
    AwarenessProfileChildV1, AwarenessStoreError, LiveAwarenessOwner,
};
use crate::{
    app_state::AppState,
    luca::{connected_brain, managed_cognition},
};
use luca_protocol::{canonical_sha256, ConnectedBrainSourceKindV1, Hex64, Sha256Ref};
use serde_json::{json, Value};
use std::time::{Duration, Instant};

const MAX_SESSIONS: usize = 3;
const MAX_SAMPLE_SECONDS: u64 = 3;
const MAX_EXCERPT_CHARS: usize = 1200;

struct ApprovedSource {
    selection: NativeProfileSelectionV1,
    authority_fingerprint: String,
}

/// Exact, process-local one-use consent. Existing Follow/history settings alone
/// cannot construct this: the host calls this only after initial-context review.
pub(crate) struct InitialSampleApprovalV1 {
    owner: Hex64,
    resident: Hex64,
    binding: Sha256Ref,
    sources: Vec<ApprovedSource>,
    deadline: Instant,
}

/// Pending excerpts are private until the final current-authority serialization.
/// Never log or persist this value. It deliberately does not implement Debug.
pub(crate) struct InitialSampleResultV1 {
    approval: InitialSampleApprovalV1,
    sessions: Vec<SampledSession>,
    receipts: Vec<Value>,
}

struct SampledSession {
    source_index: usize,
    exclusion_token: Sha256Ref,
    source_ref: luca_protocol::OpaqueId,
    session_ref: luca_protocol::OpaqueId,
    provider: &'static str,
    updated_at: String,
    excerpts: Vec<String>,
}

impl InitialSampleApprovalV1 {
    /// Capture current scopes AFTER explicit initial-sample approval and setup.
    /// This method is host-only, not an agent/renderer permission endpoint.
    pub(crate) fn after_owner_review(
        state: &AppState,
        owner: &Hex64,
        resident: &Hex64,
        binding: &Sha256Ref,
        selections: Vec<NativeProfileSelectionV1>,
    ) -> Result<Self, AwarenessStoreError> {
        if selections.is_empty() || selections.len() > 2 || owner == resident {
            return Err(AwarenessStoreError::Invalid);
        }
        require_binding(resident, binding)?;
        let live = LiveAwarenessOwner::authenticate(state)?;
        if live.owner() != owner {
            return Err(AwarenessStoreError::Invalid);
        }
        let sources = live.with_current(|| {
            state
                .companion_awareness
                .with_controller(owner, |controller| {
                    let mut sources = Vec::new();
                    for selection in selections {
                        let key = selection.grant_key();
                        if key.source.owner_pubkey != *owner
                            || key.resident_pubkey != *resident
                            || key.source.device_id != controller.scope.device
                            || selection.class() != NativeProfileObservationClassV1::VisibleExcerpts
                            || sources
                                .iter()
                                .any(|source: &ApprovedSource| source.selection.grant_key() == key)
                        {
                            return Err(AwarenessStoreError::Invalid);
                        }
                        sources.push(ApprovedSource {
                            authority_fingerprint: fingerprint(controller, &selection, binding)?,
                            selection,
                        });
                    }
                    Ok(sources)
                })
        })?;
        Ok(Self {
            owner: owner.clone(),
            resident: resident.clone(),
            binding: binding.clone(),
            sources,
            deadline: Instant::now() + Duration::from_secs(MAX_SAMPLE_SECONDS),
        })
    }

    /// Consume once. Candidate metadata is ranked across profiles; at most three
    /// 64-KiB tails are parsed. Cancellation never returns already-read bodies.
    pub(crate) fn sample(
        self,
        state: &AppState,
        cancelled: &mut impl FnMut() -> bool,
    ) -> Result<InitialSampleResultV1, AwarenessStoreError> {
        let mut candidates = Vec::new();
        let mut receipts = Vec::new();
        for (index, source) in self.sources.iter().enumerate() {
            self.check_cancelled(cancelled)?;
            let selection = &source.selection;
            let (kind, provider) = family(selection.kind());
            let excluded = initial_context_exclusions(state, provider, self.deadline)?;
            let found = self.with_source(state, index, |_| {
                self.check_cancelled(cancelled)?;
                connected_brain::initial_session_locators(
                    selection.transcript_root(),
                    kind,
                    &selection.grant_key().source.source_id,
                    &excluded,
                    self.deadline,
                )
                .map_err(|_| AwarenessStoreError::Unavailable)
            });
            match found {
                Ok(locators) => {
                    receipts.push(json!({"sourceRef": selection.grant_key().source.source_id,
                        "provider": provider, "status": "available", "candidateCount": locators.len()}));
                    candidates.extend(locators.into_iter().map(|locator| (index, locator)));
                }
                Err(AwarenessStoreError::Unavailable) => receipts.push(json!({
                    "sourceRef":selection.grant_key().source.source_id,"provider":provider,"status":"unavailable"})),
                Err(error) => return Err(error),
            }
        }
        candidates.sort_by(|left, right| {
            right
                .1
                .updated_at
                .cmp(&left.1.updated_at)
                .then_with(|| left.1.session_ref.cmp(&right.1.session_ref))
        });
        let mut sessions = Vec::new();
        // Cap attempted tails, not only successful reads: failures cannot cause
        // an unbounded search through the remaining source history.
        for (index, locator) in candidates.into_iter().take(MAX_SESSIONS) {
            self.check_cancelled(cancelled)?;
            let selection = &self.sources[index].selection;
            let (kind, provider) = family(selection.kind());
            let excluded = initial_context_exclusions(state, provider, self.deadline)?;
            let result = self.with_source(state, index, |_| {
                self.check_cancelled(cancelled)?;
                let root = selection.transcript_root();
                selection.changed_child_ref(&locator.locator)?;
                let before = selected_snapshot(root, &locator.locator, 256 * 1024 * 1024)?;
                let native_id = std::path::Path::new(&locator.locator)
                    .file_stem()
                    .and_then(|value| value.to_str())
                    .and_then(|stem| stem.get(stem.len().saturating_sub(36)..))
                    .ok_or(AwarenessStoreError::Invalid)?;
                self.check_cancelled(cancelled)?;
                let excerpts = with_eligible_header(
                    &root.join(&locator.locator),
                    selection.kind(),
                    native_id,
                    || {
                        self.check_cancelled(cancelled)?;
                        connected_brain::initial_session_excerpts(
                            root,
                            kind,
                            &selection.grant_key().source.source_id,
                            &locator,
                            &excluded,
                        )
                        .map_err(|_| AwarenessStoreError::Unavailable)
                    },
                )?;
                if selected_snapshot(root, &locator.locator, 256 * 1024 * 1024)? != before {
                    return Err(AwarenessStoreError::Unavailable);
                }
                Ok((
                    excerpts
                        .into_iter()
                        .map(|excerpt| bound_excerpt(&excerpt))
                        .collect::<Vec<_>>(),
                    selection.exclusion_token(native_id)?,
                ))
            });
            match result {
                Ok((excerpts, exclusion_token)) if !excerpts.is_empty() => {
                    sessions.push(SampledSession {
                        source_index: index,
                        exclusion_token,
                        source_ref: selection.grant_key().source.source_id.clone(),
                        session_ref: locator.session_ref,
                        provider,
                        updated_at: locator.updated_at,
                        excerpts,
                    })
                }
                Ok(_) | Err(AwarenessStoreError::Unavailable) => {}
                Err(error) => return Err(error),
            }
        }
        self.check_cancelled(cancelled)?;
        Ok(InitialSampleResultV1 {
            approval: self,
            sessions,
            receipts,
        })
    }

    fn check_cancelled(
        &self,
        cancelled: &mut impl FnMut() -> bool,
    ) -> Result<(), AwarenessStoreError> {
        if cancelled() || Instant::now() >= self.deadline {
            return Err(AwarenessStoreError::Unavailable);
        }
        Ok(())
    }

    fn with_source<T>(
        &self,
        state: &AppState,
        index: usize,
        effect: impl FnOnce(&super::AwarenessStoredAuthorityV1) -> Result<T, AwarenessStoreError>,
    ) -> Result<T, AwarenessStoreError> {
        require_binding(&self.resident, &self.binding)?;
        let source = self
            .sources
            .get(index)
            .ok_or(AwarenessStoreError::Invalid)?;
        let live = LiveAwarenessOwner::authenticate(state)?;
        if live.owner() != &self.owner {
            return Err(AwarenessStoreError::Invalid);
        }
        live.with_current(|| {
            state
                .companion_awareness
                .with_controller(&self.owner, |controller| {
                    if fingerprint(controller, &source.selection, &self.binding)?
                        != source.authority_fingerprint
                    {
                        return Err(AwarenessStoreError::Conflict);
                    }
                    let authority = controller.store.snapshot(source.selection.grant_key())?;
                    effect(&authority)
                })
        })
    }
}

impl InitialSampleResultV1 {
    /// Admit approved samples as ordinary ephemeral observations. The tool
    /// result is BODY-FREE: the next real owner turn consumes the buffered
    /// material through normal awareness framing, dependency and lease checks.
    /// This avoids introducing untracked source text halfway through a turn.
    pub(crate) fn queue_current(self, state: &AppState) -> Result<Value, AwarenessStoreError> {
        if Instant::now() >= self.approval.deadline {
            return Err(AwarenessStoreError::Unavailable);
        }
        let mut queued = 0;
        for session in self.sessions {
            if Instant::now() >= self.approval.deadline {
                break;
            }
            let authority =
                self.approval
                    .with_source(state, session.source_index, |authority| {
                        Ok(authority.clone())
                    })?;
            let selection = &self.approval.sources[session.source_index].selection;
            let key = selection.grant_key();
            let runtime = &state.companion_awareness;
            let live = LiveAwarenessOwner::authenticate(state)?;
            if live.owner() != &self.approval.owner {
                return Err(AwarenessStoreError::Invalid);
            }
            let now = crate::luca::continuity_jobs::current_canonical_timestamp()
                .map_err(|_| AwarenessStoreError::Unavailable)?;
            let payload = encode_bounded(&json!({
                "protocol":"polyphonic.awareness.native-profile.v1",
                "profile_ref": session.source_ref, "provider":session.provider,
                "observation_class":"visible_excerpts", "session_ref":session.session_ref,
                "availability":"approved_initial_sample", "work_status":"unknown",
                "source_updated_at":session.updated_at, "reference_notice":REFERENCE_NOTICE,
                "excerpts":session.excerpts, "excerpt_truncated":true
            }))?;
            let child = AwarenessProfileChildV1 {
                child_ref: session.session_ref,
                exclusion_token: session.exclusion_token,
            };
            let reference =
                admit_initial_payload(runtime, &live, key, &child, authority, payload, &now)?;
            state
                .companion_sources
                .remember_initial_sample(reference, child.child_ref)?;
            queued += 1;
        }
        Ok(
            json!({"status":if queued == 0 {"no_recent_context"} else {"queued"},
            "sampledSessionCount":queued,"sources":self.receipts,"tailByteLimit":65536,
            "delivery":"next_ordinary_turn",
            "notice":"Approved recent context is buffered briefly for the next ordinary conversation turn, subject to current permission. No excerpts are in this tool response. This is not proof Luca has read it, a note was saved, or a Brain source was imported."}),
        )
    }
}

fn admit_initial_payload(
    runtime: &super::CompanionAwarenessRuntime,
    live: &LiveAwarenessOwner<'_>,
    key: &super::AwarenessGrantKeyV1,
    child: &AwarenessProfileChildV1,
    authority: super::AwarenessStoredAuthorityV1,
    payload: Vec<u8>,
    now: &luca_protocol::CanonicalTimestamp,
) -> Result<luca_protocol::AwarenessObservationRefV1, AwarenessStoreError> {
    let sequence = runtime.next_sequence(live, key)?;
    let mut sampler = ChangedStateSamplerV1::default();
    sampler.set_enabled(true);
    match sampler.finish_with_admission(
        runtime,
        live,
        key,
        (authority, payload),
        now,
        sequence,
        |facts, reference, bytes| runtime.admit_profile(live, facts, reference, bytes, child),
    )? {
        SamplingOutcomeV1::Admitted(reference) => Ok(reference),
        _ => Err(AwarenessStoreError::Unavailable),
    }
}

fn fingerprint(
    controller: &super::Controller,
    selection: &NativeProfileSelectionV1,
    binding: &Sha256Ref,
) -> Result<String, AwarenessStoreError> {
    let key = selection.grant_key();
    let resident = controller
        .store
        .resident_state(&key.source.owner_pubkey, &key.resident_pubkey)?;
    if resident.paused {
        return Err(AwarenessStoreError::Paused);
    }
    controller
        .store
        .recheck_native_history_choice(key, binding)?;
    let authority = controller.store.snapshot(key)?;
    let history = controller
        .store
        .native_history_choice(key)?
        .ok_or(AwarenessStoreError::Invalid)?;
    canonical_sha256(&json!([
        authority.grant,
        authority.source.deny_epoch,
        history.revision,
        resident.revision
    ]))
    .map_err(|_| AwarenessStoreError::Invalid)
}

fn require_binding(resident: &Hex64, binding: &Sha256Ref) -> Result<(), AwarenessStoreError> {
    if managed_cognition::active_binding_ref(resident)
        .as_ref()
        .ok()
        != Some(binding)
    {
        return Err(AwarenessStoreError::Invalid);
    }
    Ok(())
}

fn family(kind: NativeProfileKindV1) -> (ConnectedBrainSourceKindV1, &'static str) {
    match kind {
        NativeProfileKindV1::ClaudeProjects => {
            (ConnectedBrainSourceKindV1::ClaudeHistory, "claude_code")
        }
        NativeProfileKindV1::CodexSessions => (ConnectedBrainSourceKindV1::CodexHistory, "codex"),
    }
}

fn bound_excerpt(value: &str) -> String {
    value.chars().take(MAX_EXCERPT_CHARS).collect()
}

/// Only this local eligibility check maps malformed/unsupported/hidden headers
/// to unavailable. Authority, revision and path failures still propagate.
fn with_eligible_header<T>(
    path: &std::path::Path,
    kind: NativeProfileKindV1,
    native_id: &str,
    read: impl FnOnce() -> Result<T, AwarenessStoreError>,
) -> Result<T, AwarenessStoreError> {
    native_profile::validate_native_header(path, kind, native_id).map_err(|error| match error {
        AwarenessStoreError::Invalid => AwarenessStoreError::Unavailable,
        other => other,
    })?;
    read()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queued_initial_sample_is_ephemeral_unpromoted_and_revoke_blocks_next_frame() {
        use super::super::selected_files::tests::{id, now, number, Fixture};
        use super::super::{AwarenessHostFactsV1, AwarenessMaterialFactsV1, AwarenessWithdrawalV1};
        use luca_protocol::{AwarenessMaterialStateV1, AwarenessUseV1};
        let fixture = Fixture::new();
        let live = LiveAwarenessOwner::authenticate(&fixture.state).unwrap();
        let key = fixture.grant(id("initial-source"), true);
        let binding = Sha256Ref::parse(format!("sha256:{}", "c".repeat(64))).unwrap();
        let mut grant = fixture.runtime.snapshot(live.owner(), &key).unwrap().grant;
        grant.grant_revision = number(2);
        grant.choices.provider_egress_binding = Some(binding.clone());
        assert!(!grant.choices.promote);
        assert!(!grant.choices.retain);
        fixture
            .runtime
            .put_grant(&live, &grant, Some(number(1)), &id("share-initial"))
            .unwrap();
        fixture
            .runtime
            .set_native_history_choice(
                live.owner(),
                &key,
                Some(&live),
                number(0),
                true,
                Some(&binding),
                &now(),
                &id("history-initial"),
            )
            .unwrap();
        let child = AwarenessProfileChildV1 {
            child_ref: id("initial-child"),
            exclusion_token: Sha256Ref::parse(format!("sha256:{}", "d".repeat(64))).unwrap(),
        };
        let payload = encode_bounded(&json!({
            "protocol":"polyphonic.awareness.native-profile.v1",
            "session_ref":child.child_ref,"provider":"codex","work_status":"unknown",
            "excerpts":["INITIAL_CONTEXT_UNPROMOTED_SENTINEL"]
        }))
        .unwrap();
        let reference = admit_initial_payload(
            &fixture.runtime,
            &live,
            &key,
            &child,
            fixture.runtime.snapshot(live.owner(), &key).unwrap(),
            payload,
            &now(),
        )
        .unwrap();
        assert_eq!(
            fixture
                .runtime
                .profile_child_bindings(live.owner(), &fixture.resident)
                .unwrap()[0]
                .reference,
            reference
        );
        let at = now();
        let facts = AwarenessHostFactsV1 {
            owner_pubkey: live.owner(),
            resident_pubkey: &fixture.resident,
            now: &at,
            source_fresh: true,
            material_state: AwarenessMaterialStateV1::Available,
        };
        // Queuing ephemeral source context does not grant memory promotion.
        assert!(fixture
            .runtime
            .with_payload(
                &live,
                &facts,
                &reference,
                AwarenessUseV1 {
                    promote: true,
                    ..Default::default()
                },
                |_| ()
            )
            .is_err());
        let resolve =
            |_: &luca_protocol::AwarenessObservationRefV1, _: bool| AwarenessMaterialFactsV1 {
                source_fresh: true,
                material_state: AwarenessMaterialStateV1::Available,
            };
        {
            let lease = live.lease().unwrap();
            let mut framed = false;
            fixture
                .runtime
                .with_native_history_payloads_lease(
                    &lease,
                    &facts,
                    std::slice::from_ref(&reference),
                    &binding,
                    resolve,
                    &id("initial-frame"),
                    |_| {
                        framed = true;
                    },
                )
                .unwrap();
            assert!(framed);
        }
        let old_authority = fixture.runtime.snapshot(live.owner(), &key).unwrap();
        fixture
            .runtime
            .withdraw_grant(
                live.owner(),
                &key,
                number(2),
                AwarenessWithdrawalV1::Withdraw,
                &id("withdraw-before-followup"),
            )
            .unwrap();
        assert!(admit_initial_payload(
            &fixture.runtime,
            &live,
            &key,
            &child,
            old_authority,
            encode_bounded(&json!({"excerpts":["OLD_CAPTURE_AFTER_WITHDRAWAL"]})).unwrap(),
            &at
        )
        .is_err());
        let lease = live.lease().unwrap();
        let mut framed = false;
        assert!(fixture
            .runtime
            .with_native_history_payloads_lease(
                &lease,
                &facts,
                std::slice::from_ref(&reference),
                &binding,
                resolve,
                &id("initial-frame-after-revoke"),
                |_| {
                    framed = true;
                }
            )
            .is_err());
        assert!(!framed);
    }

    #[test]
    fn initial_context_bounds_are_fixed_not_caller_selected() {
        assert_eq!(MAX_SESSIONS, 3);
        assert_eq!(MAX_SAMPLE_SECONDS, 3);
        assert_eq!(bound_excerpt(&"é".repeat(2000)).chars().count(), 1200);
        assert_eq!(
            bound_excerpt("ordinary visible words"),
            "ordinary visible words"
        );
    }

    #[test]
    fn unsupported_and_partial_headers_skip_only_their_candidate_without_tail_reads() {
        let temporary = tempfile::tempdir().expect("fixture");
        let root = temporary.path().canonicalize().expect("root");
        let id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        let unsupported = root.join("unsupported.jsonl");
        let partial = root.join("partial.jsonl");
        let valid = root.join("valid.jsonl");
        std::fs::write(&unsupported, r#"{"type":"session_meta","payload":{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","source":"unknown","originator":"unknown"}}"#).expect("unsupported header");
        std::fs::write(&partial, r#"{"type":"session_meta","payload":"#).expect("partial header");
        std::fs::write(&valid, r#"{"type":"session_meta","payload":{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","source":"cli","originator":"codex_cli_rs"}}"#).expect("valid header");
        let mut tail_reads = 0;
        let mut context = Vec::new();
        for path in [&unsupported, &partial, &valid]
            .into_iter()
            .take(MAX_SESSIONS)
        {
            let result = with_eligible_header(path, NativeProfileKindV1::CodexSessions, id, || {
                tail_reads += 1;
                Ok("Useful context from the valid candidate")
            });
            match result {
                Ok(value) => context.push(value),
                Err(AwarenessStoreError::Unavailable) => {}
                Err(error) => panic!("candidate must not fail the sample: {error}"),
            }
        }
        assert_eq!(tail_reads, 1);
        assert_eq!(context, vec!["Useful context from the valid candidate"]);
    }

    #[test]
    fn metadata_discovery_does_not_parse_conversations_and_excludes_subagents() {
        let temporary = tempfile::tempdir().expect("fixture");
        let root = temporary.path().canonicalize().expect("root");
        std::fs::create_dir_all(root.join("-project/subagents")).expect("directories");
        std::fs::write(
            root.join("-project/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jsonl"),
            b"not a parseable conversation or eligibility header",
        )
        .expect("fixture");
        std::fs::write(
            root.join("-project/subagents/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jsonl"),
            b"private subagent history",
        )
        .expect("fixture");
        let source = luca_protocol::OpaqueId::parse("source-fixture").expect("source");
        let candidates = connected_brain::initial_session_locators(
            &root,
            ConnectedBrainSourceKindV1::ClaudeHistory,
            &source,
            &Default::default(),
            Instant::now() + Duration::from_secs(3),
        )
        .expect("metadata");
        assert_eq!(candidates.len(), 1);
        assert!(candidates[0].locator.starts_with("-project/aaaaaaaa"));
        assert!(connected_brain::initial_session_locators(
            &root,
            ConnectedBrainSourceKindV1::ClaudeHistory,
            &source,
            &Default::default(),
            Instant::now() - Duration::from_secs(1)
        )
        .is_err());
    }

    #[test]
    fn initial_tail_cannot_reach_an_old_message_outside_64_kib() {
        let temporary = tempfile::tempdir().expect("fixture");
        let root = temporary.path().canonicalize().expect("root");
        std::fs::create_dir(root.join("-project")).expect("directory");
        let path = root.join("-project/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jsonl");
        let mut body = String::from("{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"OLD OUTSIDE THE BOUND\"}}\n");
        body.push_str(&format!(
            "{{\"type\":\"system\",\"padding\":\"{}\"}}\n",
            "x".repeat(70_000)
        ));
        body.push_str("{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"Recent visible work\"}}\n");
        body.push_str("{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"thinking\",\"thinking\":\"HIDDEN REASONING\"}]}}\n");
        std::fs::write(path, body).expect("fixture");
        let source = luca_protocol::OpaqueId::parse("source-fixture").expect("source");
        let candidates = connected_brain::initial_session_locators(
            &root,
            ConnectedBrainSourceKindV1::ClaudeHistory,
            &source,
            &Default::default(),
            Instant::now() + Duration::from_secs(3),
        )
        .expect("metadata");
        let excerpts = connected_brain::initial_session_excerpts(
            &root,
            ConnectedBrainSourceKindV1::ClaudeHistory,
            &source,
            &candidates[0],
            &Default::default(),
        )
        .expect("tail");
        assert_eq!(excerpts, vec!["Recent visible work"]);
        assert!(!format!("{excerpts:?}").contains("HIDDEN REASONING"));
    }
}
