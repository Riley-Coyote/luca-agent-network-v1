//! Concrete resident-authorized publication and restart reconciliation.
//!
//! The final kind-9 event is already signed and frozen by the desktop broker.
//! This module submits the retained canonical JSON bytes directly; only the
//! per-request NIP-98 authorization event is freshly signed.

use std::{
    io::Read,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

use luca_protocol::{
    ArtifactReceiptStateV1, ExchangeTurnTag, Hex64, ManagedMessagePublishRequestV1, OpaqueId,
    Sha256Ref,
};
use nostr::{Event, JsonUtil, Keys, Kind};
use reqwest::Method;
use tauri::{AppHandle, Emitter, Manager};

use super::{
    exchange::{classify_exchange_refusal, ExchangeDenial, ExchangeNote, ExchangeRefusal},
    exchange_plan::{ExchangePlan, ExchangeResolver},
    exchange_relay::{AppExchangeRelay, ExchangeRelay},
    exchange_store::{global_exchange_store, ExchangeStore},
    managed_dispatch_store::{
        DispatchAuthorizationError, ManagedDispatchReconciliation, ManagedDispatchStore,
    },
    managed_message_outbox::{
        ManagedMessageOutbox, ManagedMessagePublicationAuthority, ManagedOutboxReconcileEntry,
        ManagedOutboxState, ManagedPublicationAuthorityError,
    },
};

const RELAY_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const RECONCILE_REQUEST_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_RELAY_RESPONSE_BYTES: u64 = 64 * 1024;

#[derive(Debug)]
enum ManagedRelaySubmitOutcome {
    Response(crate::relay::SubmitEventResponse),
    TerminalRejected {
        /// The relay's own words, when it gave any. The exchange gates answer
        /// with `restricted: exchange …`, and that sentence is the difference
        /// between "re-sign on the next turn" and "this reply is held".
        reason: Option<String>,
    },
    Retryable,
}
/// The owner-key authority this publisher uses to mint, count, and explain.
struct ExchangeAuthority {
    relay: Box<dyn ExchangeRelay>,
    store: Arc<Mutex<ExchangeStore>>,
}

#[derive(Debug)]
enum ManagedRelayProbeOutcome {
    Present(crate::relay::SubmitEventResponse),
    Absent,
    TerminalRejected,
    Retryable,
}

enum SerializedSubmission {
    Accepted,
    Published,
    Cancelled,
    Rejected,
    Retryable,
    Invalid,
    /// The turn collided. The dispatch keeps its authority so the same draft can
    /// be re-signed on a free turn.
    ExchangeTurnTaken,
    /// The exchange refused the reply outright. Terminal, and explained — the
    /// denial travels so the room's sentence matches the resident's code.
    ExchangeHeld(ExchangeDenial),
}

trait ManagedRelayTransport: Send {
    fn submit_exact(
        &mut self,
        signed_event_json: &str,
        timeout: Duration,
    ) -> ManagedRelaySubmitOutcome;

    fn probe_exact(
        &mut self,
        signed_event_json: &str,
        expected_event_id: &str,
        timeout: Duration,
    ) -> ManagedRelayProbeOutcome;
}

struct HttpManagedRelayTransport {
    client: reqwest::blocking::Client,
    resident_keys: Keys,
    relay_http_base: String,
    auth_tag: Option<String>,
}

impl HttpManagedRelayTransport {
    fn new(resident_keys: Keys, relay_url: &str, auth_tag: Option<String>) -> Result<Self, String> {
        let client = reqwest::blocking::Client::builder()
            .build()
            .map_err(|error| format!("build managed publication client: {error}"))?;
        Ok(Self {
            client,
            resident_keys,
            relay_http_base: crate::relay::relay_http_base_url(relay_url)
                .trim_end_matches('/')
                .to_owned(),
            auth_tag,
        })
    }

    fn post_exact(
        &self,
        path: &str,
        body: Vec<u8>,
        timeout: Duration,
    ) -> Result<reqwest::blocking::Response, String> {
        let url = format!("{}{path}", self.relay_http_base);
        let auth = crate::relay::build_nip98_auth_header_for_keys(
            &self.resident_keys,
            &Method::POST,
            &url,
            &body,
        )?;
        let mut request = self
            .client
            .post(url)
            .timeout(timeout)
            .header("Authorization", auth)
            .header("Content-Type", "application/json");
        if let Some(auth_tag) = &self.auth_tag {
            request = request.header("x-auth-tag", auth_tag);
        }
        request
            .body(body)
            .send()
            .map_err(|error| format!("managed relay request failed: {error}"))
    }

    fn parse_bounded_json<T: serde::de::DeserializeOwned>(
        mut response: reqwest::blocking::Response,
    ) -> Result<T, String> {
        let mut bytes = Vec::new();
        response
            .by_ref()
            .take(MAX_RELAY_RESPONSE_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "managed relay response could not be read".to_owned())?;
        if bytes.len() as u64 > MAX_RELAY_RESPONSE_BYTES {
            return Err("managed relay response exceeded the size limit".to_owned());
        }
        serde_json::from_slice(&bytes)
            .map_err(|_| "managed relay response was invalid JSON".to_owned())
    }

    /// The relay's structured refusal string, when it gave one.
    ///
    /// Only the `error`/`message` field of a well-formed JSON body is read; a
    /// non-JSON body is discarded rather than logged, so a refusal can never
    /// carry event-controlled content into the desktop's own reasoning.
    fn read_refusal_reason(response: reqwest::blocking::Response) -> Option<String> {
        let body: serde_json::Value = Self::parse_bounded_json(response).ok()?;
        body.get("error")
            .or_else(|| body.get("message"))
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned)
    }
}

impl ManagedRelayTransport for HttpManagedRelayTransport {
    fn submit_exact(
        &mut self,
        signed_event_json: &str,
        timeout: Duration,
    ) -> ManagedRelaySubmitOutcome {
        let response =
            match self.post_exact("/events", signed_event_json.as_bytes().to_vec(), timeout) {
                Ok(response) => response,
                Err(_) => return ManagedRelaySubmitOutcome::Retryable,
            };
        if !response.status().is_success() {
            // Only an invalid-event 400 is terminal. Authentication, routing,
            // conflict, throttling, timeout and server failures can recover or
            // may conceal prior acceptance, so they retain Submitted.
            return if response.status() == reqwest::StatusCode::BAD_REQUEST {
                ManagedRelaySubmitOutcome::TerminalRejected {
                    reason: Self::read_refusal_reason(response),
                }
            } else {
                ManagedRelaySubmitOutcome::Retryable
            };
        }
        match Self::parse_bounded_json(response) {
            Ok(response) => ManagedRelaySubmitOutcome::Response(response),
            Err(_) => ManagedRelaySubmitOutcome::Retryable,
        }
    }

    fn probe_exact(
        &mut self,
        signed_event_json: &str,
        expected_event_id: &str,
        timeout: Duration,
    ) -> ManagedRelayProbeOutcome {
        let response = match self.post_exact(
            "/events?mode=probe",
            signed_event_json.as_bytes().to_vec(),
            timeout,
        ) {
            Ok(response) => response,
            Err(_) => return ManagedRelayProbeOutcome::Retryable,
        };
        if !response.status().is_success() {
            return if response.status() == reqwest::StatusCode::BAD_REQUEST {
                ManagedRelayProbeOutcome::TerminalRejected
            } else {
                ManagedRelayProbeOutcome::Retryable
            };
        }
        let response: crate::relay::SubmitEventResponse = match Self::parse_bounded_json(response) {
            Ok(response) => response,
            Err(_) => return ManagedRelayProbeOutcome::Retryable,
        };
        if response.event_id != expected_event_id {
            return ManagedRelayProbeOutcome::Retryable;
        }
        if response.accepted && response.message == "duplicate:" {
            ManagedRelayProbeOutcome::Present(response)
        } else if !response.accepted && response.message == "absent:" {
            ManagedRelayProbeOutcome::Absent
        } else {
            ManagedRelayProbeOutcome::Retryable
        }
    }
}

/// Desktop publication authority for one resident identity and relay.
pub(crate) struct ManagedMessagePublisher {
    resident_pubkey: String,
    dispatch_store: Arc<Mutex<ManagedDispatchStore>>,
    transport: Box<dyn ManagedRelayTransport>,
    handoff_scheduler: Option<HandoffScheduler>,
    artifact_app_data_dir: Option<PathBuf>,
    exchange: Option<ExchangeAuthority>,
}

#[derive(Clone)]
struct HandoffScheduler {
    app: AppHandle,
    binding_ref: Sha256Ref,
}

impl ManagedMessagePublisher {
    /// Stage a dispatch row for a turn this desktop never staged itself,
    /// deriving it from the turn's own signed trigger event on the relay.
    fn ensure_wake_dispatch(
        &self,
        exchange: &ExchangeAuthority,
        request: &ManagedMessagePublishRequestV1,
        now_unix_secs: u64,
    ) {
        let Ok(mut store) = self.dispatch_store.lock() else {
            return;
        };
        let key = (
            request.dispatch_receipt_id.as_str().to_owned(),
            request.resident_pubkey.as_str().to_owned(),
        );
        if store.has_dispatch(&key) {
            return;
        }
        let Ok(trigger_id) =
            luca_protocol::Hex64::parse(request.dispatch_receipt_id.as_str().to_owned())
        else {
            return; // not an event-shaped receipt — nothing to derive from
        };
        let trigger = match exchange.relay.fetch_trigger(&trigger_id) {
            Ok(Some(event)) => event,
            Ok(None) => {
                eprintln!(
                    "luca-exchange: wake trigger {} is not on the relay — leaving the turn unstaged",
                    trigger_id.as_str()
                );
                return;
            }
            Err(error) => {
                eprintln!("luca-exchange: wake trigger fetch failed — {error}");
                return;
            }
        };
        let owner = match exchange.relay.owner() {
            Ok(owner) => owner,
            Err(error) => {
                eprintln!("luca-exchange: owner lookup failed — {error}");
                return;
            }
        };
        if let Err(error) = store.stage_wake_from_trigger(
            &trigger,
            request.resident_pubkey.as_str(),
            owner.as_str(),
            now_unix_secs,
        ) {
            eprintln!(
                "luca-exchange: could not stage a wake dispatch for {} — {error}",
                request.resident_pubkey.as_str()
            );
        }
    }

    /// Build the production exact-byte publisher.
    pub(crate) fn new(
        resident_keys: Keys,
        relay_url: &str,
        auth_tag: Option<String>,
        dispatch_store: Arc<Mutex<ManagedDispatchStore>>,
        app: AppHandle,
        binding_ref: Sha256Ref,
    ) -> Result<Self, String> {
        let resident_pubkey = resident_keys.public_key().to_hex();
        let transport = HttpManagedRelayTransport::new(resident_keys, relay_url, auth_tag)?;
        let exchange = ExchangeAuthority {
            relay: Box::new(AppExchangeRelay::new(app.clone())),
            store: global_exchange_store(&app)?,
        };
        let artifact_app_data_dir = app.path().app_data_dir().ok();
        Ok(Self {
            resident_pubkey,
            dispatch_store,
            transport: Box::new(transport),
            handoff_scheduler: Some(HandoffScheduler { app, binding_ref }),
            artifact_app_data_dir,
            exchange: Some(exchange),
        })
    }

    #[cfg(test)]
    fn with_transport(
        resident_pubkey: String,
        dispatch_store: Arc<Mutex<ManagedDispatchStore>>,
        transport: Box<dyn ManagedRelayTransport>,
    ) -> Self {
        Self {
            resident_pubkey,
            dispatch_store,
            transport,
            handoff_scheduler: None,
            artifact_app_data_dir: None,
            exchange: None,
        }
    }

    #[cfg(test)]
    fn with_artifact_app_data_dir(mut self, app_data_dir: PathBuf) -> Self {
        self.artifact_app_data_dir = Some(app_data_dir);
        self
    }

    /// Bind an offline exchange authority so the mint/continue/refuse paths can
    /// be exercised without a relay.
    #[cfg(test)]
    fn with_exchange(
        mut self,
        relay: Box<dyn ExchangeRelay>,
        store: Arc<Mutex<ExchangeStore>>,
    ) -> Self {
        self.exchange = Some(ExchangeAuthority { relay, store });
        self
    }

    fn map_dispatch_error(error: DispatchAuthorizationError) -> ManagedPublicationAuthorityError {
        match error {
            DispatchAuthorizationError::Cancelled => ManagedPublicationAuthorityError::Cancelled,
            DispatchAuthorizationError::Persistence => {
                ManagedPublicationAuthorityError::Unavailable
            }
            DispatchAuthorizationError::Unknown
            | DispatchAuthorizationError::Ambiguous
            | DispatchAuthorizationError::Expired
            | DispatchAuthorizationError::Terminal
            | DispatchAuthorizationError::WrongOwner
            | DispatchAuthorizationError::WrongResident
            | DispatchAuthorizationError::WrongConversation
            | DispatchAuthorizationError::WrongThread
            | DispatchAuthorizationError::WrongRecipients
            | DispatchAuthorizationError::WrongSurface
            | DispatchAuthorizationError::WrongSession => ManagedPublicationAuthorityError::Denied,
        }
    }

    fn parse_exact_event(
        request: &ManagedMessagePublishRequestV1,
        signed_event_json: &str,
    ) -> Result<Event, ManagedPublicationAuthorityError> {
        let event = Event::from_json(signed_event_json)
            .map_err(|_| ManagedPublicationAuthorityError::Invalid)?;
        if event.pubkey.to_hex() != request.resident_pubkey.as_str()
            || event.kind != Kind::Custom(9)
            || !event.verify_id()
            || !event.verify_signature()
        {
            return Err(ManagedPublicationAuthorityError::Invalid);
        }
        Ok(event)
    }

    fn mark_accepted(
        &mut self,
        entry: &ManagedOutboxReconcileEntry,
        outbox: &mut ManagedMessageOutbox,
    ) -> Result<(), ManagedPublicationAuthorityError> {
        {
            let mut store = self
                .dispatch_store
                .lock()
                .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
            store
                .mark_published(
                    entry.request.dispatch_receipt_id.as_str(),
                    entry.request.resident_pubkey.as_str(),
                    entry.event_id.as_str(),
                )
                .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
        }
        outbox
            .mark_accepted(
                &entry.idempotency_key,
                OpaqueId::parse(entry.event_id.as_str().to_owned())
                    .map_err(|_| ManagedPublicationAuthorityError::Invalid)?,
            )
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
        if self.artifact_app_data_dir.is_some() {
            outbox
                .mark_artifact_receipts_pending(&entry.idempotency_key)
                .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
        }
        {
            let mut store = self
                .dispatch_store
                .lock()
                .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
            store
                .finalize_published_outbox(
                    entry.request.dispatch_receipt_id.as_str(),
                    entry.request.resident_pubkey.as_str(),
                    entry.event_id.as_str(),
                )
                .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
        }
        outbox
            .mark_authority_finalized(&entry.idempotency_key)
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
        // Continuity begins only after every publication authority has reached
        // its durable terminal state. Scheduling must never change the
        // already-accepted chat result, but an unsuccessful handoff transfer
        // leaves this encrypted outbox row recoverable until a later broker
        // slice records the idempotent job.
        if let Err(error) = self.record_handoff_job(entry, outbox) {
            eprintln!("luca-continuity: handoff job scheduling unavailable: {error:?}");
        }
        if self
            .settle_artifact_receipts(
                &entry.request,
                Some(entry.event_id.as_str()),
                ArtifactReceiptStateV1::Linked,
            )
            .is_ok()
        {
            // Publication remains successful when the owner-local artifact
            // store is transiently unavailable. The false durable bit keeps
            // this encrypted row eligible for a later startup retry.
            let _ = outbox.mark_artifact_receipts_settled(&entry.idempotency_key);
        }
        Ok(())
    }

    /// Artifact bookkeeping is deliberately downstream of publication. A
    /// missing or damaged Library must never turn an accepted resident final
    /// into a failed conversation turn.
    fn settle_artifact_receipts(
        &self,
        request: &ManagedMessagePublishRequestV1,
        final_message_id: Option<&str>,
        state: ArtifactReceiptStateV1,
    ) -> Result<(), ()> {
        let Some(app_data_dir) = &self.artifact_app_data_dir else {
            return Ok(());
        };
        let result = (|| {
            let mut store = super::artifacts::ArtifactStore::open(app_data_dir).map_err(|_| ())?;
            match state {
                ArtifactReceiptStateV1::Linked => {
                    let message_id =
                        Hex64::parse(final_message_id.ok_or(())?.to_owned()).map_err(|_| ())?;
                    store
                        .link_turn_receipts(
                            &request.owner_pubkey,
                            &request.conversation_id,
                            &request.turn_id,
                            &message_id,
                        )
                        .map_err(|_| ())
                }
                ArtifactReceiptStateV1::Interrupted | ArtifactReceiptStateV1::Orphaned => store
                    .mark_turn_receipts(
                        &request.owner_pubkey,
                        &request.conversation_id,
                        &request.turn_id,
                        state,
                    )
                    .map_err(|_| ()),
                ArtifactReceiptStateV1::Provisional => Err(()),
            }
        })();
        match result {
            Ok(changed) if changed > 0 => {
                if let Some(scheduler) = &self.handoff_scheduler {
                    let _ = scheduler.app.emit(
                        "luca://artifacts-changed",
                        serde_json::json!({ "reason": "receipt-settled" }),
                    );
                }
                Ok(())
            }
            Ok(_) => Ok(()),
            Err(()) => {
                eprintln!("luca-artifacts: receipt settlement unavailable");
                Err(())
            }
        }
    }

    fn record_handoff_job(
        &self,
        entry: &ManagedOutboxReconcileEntry,
        outbox: &mut ManagedMessageOutbox,
    ) -> Result<(), ManagedPublicationAuthorityError> {
        if let Some(scheduler) = &self.handoff_scheduler {
            super::continuity_jobs::enqueue_finalized(
                &scheduler.app,
                &entry.request,
                &entry.event_id,
                &scheduler.binding_ref,
            )
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
        }
        // Tests and legacy publishers have no continuity scheduler. Marking the
        // transfer complete preserves their pre-V1B terminal semantics.
        outbox
            .mark_handoff_recorded(&entry.idempotency_key)
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)
    }

    fn reject(
        &mut self,
        entry: &ManagedOutboxReconcileEntry,
        outbox: &mut ManagedMessageOutbox,
    ) -> Result<(), ManagedPublicationAuthorityError> {
        {
            let mut store = self
                .dispatch_store
                .lock()
                .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
            store
                .mark_rejected(&[(
                    entry.request.dispatch_receipt_id.as_str().to_owned(),
                    entry.request.resident_pubkey.as_str().to_owned(),
                )])
                .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
        }
        outbox
            .reject_during_reconciliation(&entry.idempotency_key)
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
        self.finalize_terminal(
            entry,
            outbox,
            super::managed_dispatch_store::ManagedDispatchState::Rejected,
        )?;
        Ok(())
    }

    fn cancel(
        &mut self,
        entry: &ManagedOutboxReconcileEntry,
        outbox: &mut ManagedMessageOutbox,
    ) -> Result<(), ManagedPublicationAuthorityError> {
        outbox
            .cancel_during_reconciliation(&entry.idempotency_key)
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
        self.finalize_terminal(
            entry,
            outbox,
            super::managed_dispatch_store::ManagedDispatchState::Cancelled,
        )
    }

    fn finalize_terminal(
        &mut self,
        entry: &ManagedOutboxReconcileEntry,
        outbox: &mut ManagedMessageOutbox,
        state: super::managed_dispatch_store::ManagedDispatchState,
    ) -> Result<(), ManagedPublicationAuthorityError> {
        {
            let mut store = self
                .dispatch_store
                .lock()
                .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
            store
                .recover_terminal_outbox_finalization(
                    entry.request.dispatch_receipt_id.as_str(),
                    entry.request.resident_pubkey.as_str(),
                    entry.event_id.as_str(),
                    state,
                )
                .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
        }
        outbox
            .mark_authority_finalized(&entry.idempotency_key)
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
        let receipt_state =
            if state == super::managed_dispatch_store::ManagedDispatchState::Cancelled {
                ArtifactReceiptStateV1::Interrupted
            } else {
                ArtifactReceiptStateV1::Orphaned
            };
        let _ = self.settle_artifact_receipts(&entry.request, None, receipt_state);
        Ok(())
    }

    fn submit_entry_serialized(
        &mut self,
        entry: &ManagedOutboxReconcileEntry,
        outbox: &mut ManagedMessageOutbox,
        installation_session_id: &OpaqueId,
        now_unix_secs: u64,
        timeout: Duration,
    ) -> Result<(), ManagedPublicationAuthorityError> {
        if entry.state == ManagedOutboxState::Prepared {
            outbox
                .mark_submitted(&entry.idempotency_key, installation_session_id, false)
                .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
        }
        let submission = {
            // This lock is deliberately held across the ordinary ingesting
            // request. A cancellation either persists before this recheck and
            // suppresses the request, or waits until relay acceptance/rejection
            // has been durably recorded in dispatch authority.
            let mut store = self
                .dispatch_store
                .lock()
                .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
            match store
                .authorize_reconciliation(&entry.request, entry.event_id.as_str(), now_unix_secs)
                .map_err(Self::map_dispatch_error)?
            {
                ManagedDispatchReconciliation::Published => SerializedSubmission::Published,
                ManagedDispatchReconciliation::Cancelled => SerializedSubmission::Cancelled,
                ManagedDispatchReconciliation::Rejected => SerializedSubmission::Rejected,
                ManagedDispatchReconciliation::Ready => {
                    match self
                        .transport
                        .submit_exact(&entry.signed_event_json, timeout)
                    {
                        ManagedRelaySubmitOutcome::Response(response) => {
                            if response.event_id != entry.event_id.as_str() {
                                SerializedSubmission::Invalid
                            } else if response.accepted {
                                store
                                    .mark_published(
                                        entry.request.dispatch_receipt_id.as_str(),
                                        entry.request.resident_pubkey.as_str(),
                                        entry.event_id.as_str(),
                                    )
                                    .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
                                SerializedSubmission::Accepted
                            } else {
                                Self::settle_relay_refusal(&mut store, entry, &response.message)?
                            }
                        }
                        ManagedRelaySubmitOutcome::TerminalRejected { reason } => {
                            Self::settle_relay_refusal(
                                &mut store,
                                entry,
                                reason.as_deref().unwrap_or_default(),
                            )?
                        }
                        ManagedRelaySubmitOutcome::Retryable => SerializedSubmission::Retryable,
                    }
                }
            }
        };
        match submission {
            SerializedSubmission::Accepted | SerializedSubmission::Published => {
                self.mark_accepted(entry, outbox)
            }
            SerializedSubmission::Cancelled => {
                self.cancel(entry, outbox)?;
                Err(ManagedPublicationAuthorityError::Cancelled)
            }
            SerializedSubmission::Rejected => {
                self.reject(entry, outbox)?;
                Err(ManagedPublicationAuthorityError::Denied)
            }
            SerializedSubmission::ExchangeHeld(denial) => {
                self.reject(entry, outbox)?;
                self.tell_the_room_the_reply_was_held(&entry.request, denial);
                Err(ManagedPublicationAuthorityError::ExchangeDenied(
                    denial.code(),
                ))
            }
            // Deliberately not terminal, and deliberately not marked rejected:
            // the dispatch keeps its authority so the broker can re-sign the
            // identical draft on the next free turn.
            SerializedSubmission::ExchangeTurnTaken => {
                Err(ManagedPublicationAuthorityError::ExchangeTurnTaken)
            }
            SerializedSubmission::Retryable => Err(ManagedPublicationAuthorityError::Unavailable),
            SerializedSubmission::Invalid => Err(ManagedPublicationAuthorityError::Invalid),
        }
    }

    fn settle_probe_terminal_rejection_with<F>(
        &mut self,
        entry: &ManagedOutboxReconcileEntry,
        outbox: &mut ManagedMessageOutbox,
        now_unix_secs: u64,
        after_dispatch_decision: F,
    ) -> Result<ManagedDispatchReconciliation, ManagedPublicationAuthorityError>
    where
        F: FnOnce(),
    {
        let mut store = self
            .dispatch_store
            .lock()
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
        let decision = store
            .resolve_reconciled_rejection(&entry.request, entry.event_id.as_str(), now_unix_secs)
            .map_err(Self::map_dispatch_error)?;
        after_dispatch_decision();
        let terminal_state = match decision {
            ManagedDispatchReconciliation::Cancelled => {
                outbox
                    .cancel_during_reconciliation(&entry.idempotency_key)
                    .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
                super::managed_dispatch_store::ManagedDispatchState::Cancelled
            }
            ManagedDispatchReconciliation::Rejected => {
                outbox
                    .reject_during_reconciliation(&entry.idempotency_key)
                    .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
                super::managed_dispatch_store::ManagedDispatchState::Rejected
            }
            ManagedDispatchReconciliation::Published => return Ok(decision),
            ManagedDispatchReconciliation::Ready => {
                return Err(ManagedPublicationAuthorityError::Unavailable)
            }
        };
        store
            .recover_terminal_outbox_finalization(
                entry.request.dispatch_receipt_id.as_str(),
                entry.request.resident_pubkey.as_str(),
                entry.event_id.as_str(),
                terminal_state,
            )
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
        outbox
            .mark_authority_finalized(&entry.idempotency_key)
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
        let receipt_state =
            if terminal_state == super::managed_dispatch_store::ManagedDispatchState::Cancelled {
                ArtifactReceiptStateV1::Interrupted
            } else {
                ArtifactReceiptStateV1::Orphaned
            };
        drop(store);
        let _ = self.settle_artifact_receipts(&entry.request, None, receipt_state);
        Ok(decision)
    }

    fn settle_probe_terminal_rejection(
        &mut self,
        entry: &ManagedOutboxReconcileEntry,
        outbox: &mut ManagedMessageOutbox,
        now_unix_secs: u64,
    ) -> Result<ManagedDispatchReconciliation, ManagedPublicationAuthorityError> {
        self.settle_probe_terminal_rejection_with(entry, outbox, now_unix_secs, || {})
    }

    fn reconcile_entry(
        &mut self,
        entry: ManagedOutboxReconcileEntry,
        outbox: &mut ManagedMessageOutbox,
        installation_session_id: &OpaqueId,
        now_unix_secs: u64,
    ) -> Result<(), ManagedPublicationAuthorityError> {
        if entry.state == ManagedOutboxState::Accepted {
            if self.artifact_app_data_dir.is_some() {
                outbox
                    .mark_artifact_receipts_pending(&entry.idempotency_key)
                    .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
            }
            {
                let mut store = self
                    .dispatch_store
                    .lock()
                    .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
                store
                    .recover_published_outbox_finalization(
                        entry.request.dispatch_receipt_id.as_str(),
                        entry.request.resident_pubkey.as_str(),
                        entry.event_id.as_str(),
                    )
                    .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
            }
            outbox
                .mark_authority_finalized(&entry.idempotency_key)
                .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
            // The relay acceptance may have become durable immediately before
            // a crash. Receipt settlement is idempotent and remains fail-soft,
            // so recovery links the artifact to the already-accepted final
            // without changing conversation publication truth.
            self.settle_artifact_receipts(
                &entry.request,
                Some(entry.event_id.as_str()),
                ArtifactReceiptStateV1::Linked,
            )
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
            outbox
                .mark_artifact_receipts_settled(&entry.idempotency_key)
                .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
            self.record_handoff_job(&entry, outbox)?;
            return Ok(());
        }
        if matches!(
            entry.state,
            ManagedOutboxState::Cancelled | ManagedOutboxState::Rejected
        ) {
            let state = if entry.state == ManagedOutboxState::Cancelled {
                super::managed_dispatch_store::ManagedDispatchState::Cancelled
            } else {
                super::managed_dispatch_store::ManagedDispatchState::Rejected
            };
            return self.finalize_terminal(&entry, outbox, state);
        }
        let decision = {
            let mut store = self
                .dispatch_store
                .lock()
                .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
            store
                .bind_reconciled_submission(
                    &entry.request,
                    entry.event_id.as_str(),
                    now_unix_secs,
                    entry.state == ManagedOutboxState::Submitted,
                )
                .map_err(Self::map_dispatch_error)?
        };
        match decision {
            ManagedDispatchReconciliation::Published => {
                if entry.state == ManagedOutboxState::Prepared {
                    outbox
                        .mark_submitted(&entry.idempotency_key, installation_session_id, false)
                        .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
                }
                return self.mark_accepted(&entry, outbox);
            }
            ManagedDispatchReconciliation::Rejected => {
                outbox
                    .reject_during_reconciliation(&entry.idempotency_key)
                    .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
                return self.finalize_terminal(
                    &entry,
                    outbox,
                    super::managed_dispatch_store::ManagedDispatchState::Rejected,
                );
            }
            ManagedDispatchReconciliation::Ready | ManagedDispatchReconciliation::Cancelled => {}
        }

        if entry.state == ManagedOutboxState::Prepared {
            if decision == ManagedDispatchReconciliation::Cancelled {
                return self.cancel(&entry, outbox);
            }
            outbox
                .mark_submitted(&entry.idempotency_key, installation_session_id, false)
                .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
        }

        match self.transport.probe_exact(
            &entry.signed_event_json,
            entry.event_id.as_str(),
            RECONCILE_REQUEST_TIMEOUT,
        ) {
            ManagedRelayProbeOutcome::Present(response) => {
                debug_assert_eq!(response.event_id, entry.event_id.as_str());
                self.mark_accepted(&entry, outbox)
            }
            ManagedRelayProbeOutcome::Absent => {
                if decision == ManagedDispatchReconciliation::Cancelled {
                    return self.cancel(&entry, outbox);
                }
                self.submit_entry_serialized(
                    &entry,
                    outbox,
                    installation_session_id,
                    now_unix_secs,
                    RECONCILE_REQUEST_TIMEOUT,
                )
            }
            ManagedRelayProbeOutcome::TerminalRejected => {
                match self.settle_probe_terminal_rejection(&entry, outbox, now_unix_secs)? {
                    ManagedDispatchReconciliation::Cancelled => Ok(()),
                    ManagedDispatchReconciliation::Rejected => {
                        Err(ManagedPublicationAuthorityError::Denied)
                    }
                    ManagedDispatchReconciliation::Published => self.mark_accepted(&entry, outbox),
                    ManagedDispatchReconciliation::Ready => {
                        Err(ManagedPublicationAuthorityError::Unavailable)
                    }
                }
            }
            ManagedRelayProbeOutcome::Retryable => {
                Err(ManagedPublicationAuthorityError::Unavailable)
            }
        }
    }
}

impl ManagedMessagePublicationAuthority for ManagedMessagePublisher {
    fn resolve_exchange(
        &mut self,
        request: &ManagedMessagePublishRequestV1,
        now_unix_secs: u64,
    ) -> Result<ExchangePlan, ManagedPublicationAuthorityError> {
        if request.resident_pubkey.as_str() != self.resident_pubkey {
            return Err(ManagedPublicationAuthorityError::Denied);
        }
        let Some(exchange) = &self.exchange else {
            return self.resolve_without_exchange_authority(request);
        };
        // A turn woken by another resident's message (or by an owner message
        // published from another device) reaches this desktop with no staged
        // dispatch. Stage it from the trigger event itself — the signed event
        // is the authority, the row is bookkeeping. Failure here is not a
        // refusal: the resolver below still decides, visibly.
        // TODO(ship): permissive-staging default chosen for build velocity
        // (2026-08); review the security posture before shipping and confirm
        // we are happy with how turns acquire dispatch rows.
        self.ensure_wake_dispatch(exchange, request, now_unix_secs);
        let decided = ExchangeResolver::new(
            exchange.relay.as_ref(),
            &exchange.store,
            &self.dispatch_store,
        )
        .resolve(request, now_unix_secs);
        match decided {
            Ok(plan) => Ok(plan),
            Err(denial) => {
                eprintln!(
                    "luca-exchange: {} — {denial}",
                    request.resident_pubkey.as_str()
                );
                // The common held path is this one, not the relay's. A reply
                // this desktop refuses before it is ever signed still owes the
                // room the same sentence a relay-refused reply gets.
                self.tell_the_room_the_reply_was_held(request, denial);
                Err(ManagedPublicationAuthorityError::ExchangeDenied(
                    denial.code(),
                ))
            }
        }
    }

    fn retune_exchange_turn(
        &mut self,
        request: &ManagedMessagePublishRequestV1,
        refused_event_id: &str,
        outbox: &mut ManagedMessageOutbox,
        now_unix_secs: u64,
    ) -> Result<ExchangeTurnTag, ManagedPublicationAuthorityError> {
        let Some(exchange) = &self.exchange else {
            return Err(ManagedPublicationAuthorityError::ExchangeDenied(
                ExchangeDenial::Unavailable.code(),
            ));
        };
        let retuned = ExchangeResolver::new(
            exchange.relay.as_ref(),
            &exchange.store,
            &self.dispatch_store,
        )
        .retune_turn(request, now_unix_secs);
        let tag = match retuned {
            // A turn that cannot move is a bucket with nothing left in it, and
            // resubmitting the same bytes would only lose the same race again.
            Ok(tag) if request.exchange.as_ref() == Some(&tag) => {
                return Err(self.hold_after_failed_retune(
                    request,
                    refused_event_id,
                    outbox,
                    ExchangeDenial::Exhausted,
                ))
            }
            Ok(tag) => tag,
            Err(denial) => {
                eprintln!(
                    "luca-exchange: {} — {denial}",
                    request.resident_pubkey.as_str()
                );
                return Err(self.hold_after_failed_retune(
                    request,
                    refused_event_id,
                    outbox,
                    denial,
                ));
            }
        };
        self.dispatch_store
            .lock()
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?
            .release_exchange_submission(
                request.dispatch_receipt_id.as_str(),
                request.resident_pubkey.as_str(),
                request.cancellation_epoch.get(),
                refused_event_id,
            )
            .map_err(Self::map_dispatch_error)?;
        Ok(tag)
    }

    fn authorize_request(
        &mut self,
        request: &ManagedMessagePublishRequestV1,
        now_unix_secs: u64,
    ) -> Result<(), ManagedPublicationAuthorityError> {
        if request.resident_pubkey.as_str() != self.resident_pubkey {
            return Err(ManagedPublicationAuthorityError::Denied);
        }
        self.dispatch_store
            .lock()
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?
            .authorize_publication(request, now_unix_secs)
            .map(|_| ())
            .map_err(Self::map_dispatch_error)
    }

    fn publish_prepared(
        &mut self,
        request: &ManagedMessagePublishRequestV1,
        outbox: &mut ManagedMessageOutbox,
        installation_session_id: &OpaqueId,
    ) -> Result<(), ManagedPublicationAuthorityError> {
        let signed_event_json = outbox
            .event_for_submission(&request.idempotency_key)
            .map_err(|_| ManagedPublicationAuthorityError::Invalid)?
            .to_owned();
        let event = Self::parse_exact_event(request, &signed_event_json)?;
        let entry = ManagedOutboxReconcileEntry {
            idempotency_key: request.idempotency_key.clone(),
            event_id: luca_protocol::Hex64::parse(event.id.to_hex())
                .map_err(|_| ManagedPublicationAuthorityError::Invalid)?,
            signed_event_json,
            state: ManagedOutboxState::Prepared,
            request: request.clone(),
            created_order: 0,
        };
        {
            let mut store = self
                .dispatch_store
                .lock()
                .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
            store
                .recheck_before_submit(
                    request.dispatch_receipt_id.as_str(),
                    request.resident_pubkey.as_str(),
                    request.cancellation_epoch.get(),
                )
                .map_err(Self::map_dispatch_error)?;
            store
                .begin_submission(
                    request.dispatch_receipt_id.as_str(),
                    request.resident_pubkey.as_str(),
                    request.cancellation_epoch.get(),
                    entry.event_id.as_str(),
                )
                .map_err(Self::map_dispatch_error)?;
        }
        let now_unix_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?
            .as_secs();
        self.submit_entry_serialized(
            &entry,
            outbox,
            installation_session_id,
            now_unix_secs,
            RELAY_REQUEST_TIMEOUT,
        )
    }

    fn reconcile_on_start(
        &mut self,
        outbox: &mut ManagedMessageOutbox,
        installation_session_id: &OpaqueId,
    ) -> Result<(), ManagedPublicationAuthorityError> {
        let now_unix_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?
            .as_secs();
        let mut deferred = None;
        // One row per invocation hard-bounds each idle reconciliation slice.
        // With the two-second relay timeout this cannot begin a second row
        // just before a soft wall-clock budget expires.
        for entry in outbox.reconciliation_entries().into_iter().take(1) {
            let created_order = entry.created_order;
            if let Err(error) =
                self.reconcile_entry(entry, outbox, installation_session_id, now_unix_secs)
            {
                deferred = Some(error);
            }
            if outbox.advance_reconcile_cursor(created_order).is_err() {
                deferred = Some(ManagedPublicationAuthorityError::Unavailable);
            }
        }
        if let Some(error) = deferred {
            return Err(error);
        }
        Ok(())
    }
}

#[path = "managed_message_publisher_exchange.rs"]
mod managed_message_publisher_exchange;

#[cfg(test)]
#[path = "managed_message_publisher_tests.rs"]
mod managed_message_publisher_tests;
