//! Concrete resident-authorized publication and restart reconciliation.
//!
//! The final kind-9 event is already signed and frozen by the desktop broker.
//! This module submits the retained canonical JSON bytes directly; only the
//! per-request NIP-98 authorization event is freshly signed.

use std::{
    io::Read,
    sync::{Arc, Mutex},
    time::Duration,
};

use luca_protocol::{ManagedMessagePublishRequestV1, OpaqueId, Sha256Ref};
use nostr::{Event, JsonUtil, Keys, Kind};
use reqwest::Method;
use tauri::AppHandle;

use super::{
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
    TerminalRejected,
    Retryable,
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
                ManagedRelaySubmitOutcome::TerminalRejected
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
}

#[derive(Clone)]
struct HandoffScheduler {
    app: AppHandle,
    binding_ref: Sha256Ref,
}

impl ManagedMessagePublisher {
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
        Ok(Self {
            resident_pubkey,
            dispatch_store,
            transport: Box::new(transport),
            handoff_scheduler: Some(HandoffScheduler { app, binding_ref }),
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
        }
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
        Ok(())
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
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)
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
                                store
                                    .mark_rejected(&[(
                                        entry.request.dispatch_receipt_id.as_str().to_owned(),
                                        entry.request.resident_pubkey.as_str().to_owned(),
                                    )])
                                    .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
                                SerializedSubmission::Rejected
                            }
                        }
                        ManagedRelaySubmitOutcome::TerminalRejected => {
                            store
                                .mark_rejected(&[(
                                    entry.request.dispatch_receipt_id.as_str().to_owned(),
                                    entry.request.resident_pubkey.as_str().to_owned(),
                                )])
                                .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
                            SerializedSubmission::Rejected
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

#[cfg(test)]
#[path = "managed_message_publisher_tests.rs"]
mod managed_message_publisher_tests;
