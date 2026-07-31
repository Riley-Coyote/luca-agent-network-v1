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

use luca_protocol::{ManagedMessagePublishRequestV1, OpaqueId};
use nostr::{Event, JsonUtil, Keys, Kind};
use reqwest::Method;

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
}

impl ManagedMessagePublisher {
    /// Build the production exact-byte publisher.
    pub(crate) fn new(
        resident_keys: Keys,
        relay_url: &str,
        auth_tag: Option<String>,
        dispatch_store: Arc<Mutex<ManagedDispatchStore>>,
    ) -> Result<Self, String> {
        let resident_pubkey = resident_keys.public_key().to_hex();
        let transport = HttpManagedRelayTransport::new(resident_keys, relay_url, auth_tag)?;
        Ok(Self {
            resident_pubkey,
            dispatch_store,
            transport: Box::new(transport),
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
        }
    }

    fn map_dispatch_error(error: DispatchAuthorizationError) -> ManagedPublicationAuthorityError {
        match error {
            DispatchAuthorizationError::Cancelled => ManagedPublicationAuthorityError::Cancelled,
            DispatchAuthorizationError::Persistence => {
                ManagedPublicationAuthorityError::Unavailable
            }
            DispatchAuthorizationError::Unknown
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
        Ok(())
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
                let current = self
                    .dispatch_store
                    .lock()
                    .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?
                    .authorize_reconciliation(
                        &entry.request,
                        entry.event_id.as_str(),
                        now_unix_secs,
                    )
                    .map_err(Self::map_dispatch_error)?;
                if current == ManagedDispatchReconciliation::Cancelled {
                    self.cancel(&entry, outbox)
                } else {
                    self.reject(&entry, outbox)?;
                    Err(ManagedPublicationAuthorityError::Denied)
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
mod tests {
    use super::*;
    use std::{
        collections::VecDeque,
        io::{Read, Write},
        net::TcpListener,
        path::PathBuf,
        sync::{Arc, Mutex},
        thread::JoinHandle,
    };

    use luca_protocol::{
        canonicalize, derive_message_publish_idempotency_key, Hex64, SafeU53,
        MESSAGE_PUBLISH_PROTOCOL,
    };
    use nostr::{EventBuilder, Tag, Timestamp};

    const CHANNEL: &str = "11111111-1111-4111-8111-111111111111";

    #[derive(Default)]
    struct FakeRelayState {
        submissions: Vec<String>,
        probes: Vec<String>,
        submit_results: VecDeque<ManagedRelaySubmitOutcome>,
        probe_results: VecDeque<ManagedRelayProbeOutcome>,
    }

    struct FakeRelayTransport {
        state: Arc<Mutex<FakeRelayState>>,
    }

    impl ManagedRelayTransport for FakeRelayTransport {
        fn submit_exact(
            &mut self,
            signed_event_json: &str,
            _timeout: Duration,
        ) -> ManagedRelaySubmitOutcome {
            let mut state = self.state.lock().expect("state");
            state.submissions.push(signed_event_json.to_owned());
            state
                .submit_results
                .pop_front()
                .unwrap_or(ManagedRelaySubmitOutcome::Retryable)
        }

        fn probe_exact(
            &mut self,
            signed_event_json: &str,
            _expected_event_id: &str,
            _timeout: Duration,
        ) -> ManagedRelayProbeOutcome {
            let mut state = self.state.lock().expect("state");
            state.probes.push(signed_event_json.to_owned());
            state
                .probe_results
                .pop_front()
                .unwrap_or(ManagedRelayProbeOutcome::Retryable)
        }
    }

    struct Fixture {
        resident: Keys,
        request: ManagedMessagePublishRequestV1,
        store: Arc<Mutex<ManagedDispatchStore>>,
        outbox: ManagedMessageOutbox,
        session: OpaqueId,
        exact_event_json: String,
        event_id: String,
        dispatch_path: PathBuf,
    }

    fn fixture() -> Fixture {
        let owner = Keys::parse(&"91".repeat(32)).expect("owner");
        let resident = Keys::parse(&"92".repeat(32)).expect("resident");
        let trigger = EventBuilder::new(Kind::Custom(9), "owner trigger")
            .tags([
                Tag::parse(["h", CHANNEL]).expect("h"),
                Tag::public_key(owner.public_key()),
                Tag::public_key(resident.public_key()),
            ])
            .custom_created_at(Timestamp::from(100))
            .sign_with_keys(&owner)
            .expect("trigger");
        let resident_pubkey = Hex64::parse(resident.public_key().to_hex()).expect("resident");
        let receipt = OpaqueId::parse(trigger.id.to_hex()).expect("receipt");
        let request = ManagedMessagePublishRequestV1 {
            protocol: MESSAGE_PUBLISH_PROTOCOL.to_owned(),
            turn_id: OpaqueId::parse(trigger.id.to_hex()).expect("turn"),
            idempotency_key: derive_message_publish_idempotency_key(&receipt, &resident_pubkey)
                .expect("idempotency"),
            owner_pubkey: Hex64::parse(owner.public_key().to_hex()).expect("owner"),
            resident_pubkey,
            conversation_id: OpaqueId::parse(CHANNEL).expect("channel"),
            thread_id: Some(
                OpaqueId::parse(format!("thread:{}", trigger.id.to_hex())).expect("thread"),
            ),
            root_event_id: Some(Hex64::parse(trigger.id.to_hex()).expect("root")),
            reply_event_id: Some(Hex64::parse(trigger.id.to_hex()).expect("reply")),
            resolved_p_tags: vec![Hex64::parse(owner.public_key().to_hex()).expect("owner")],
            final_draft: "exact resident final".to_owned(),
            dispatch_receipt_id: receipt,
            cancellation_epoch: SafeU53::new(7).expect("epoch"),
        };
        let final_event = EventBuilder::new(Kind::Custom(9), request.final_draft.clone())
            .tags([
                Tag::parse(["h", CHANNEL]).expect("h"),
                Tag::parse(["e", trigger.id.to_hex().as_str(), "", "reply"]).expect("reply"),
                Tag::public_key(owner.public_key()),
            ])
            .custom_created_at(Timestamp::from(101))
            .sign_with_keys(&resident)
            .expect("final");
        let exact_event_json =
            String::from_utf8(canonicalize(&final_event).expect("canonical")).expect("UTF-8");
        let event_id = final_event.id.to_hex();
        let frozen = super::super::managed_message_outbox::FrozenManagedMessageEvent::parse(
            exact_event_json.clone(),
            &request,
        )
        .expect("frozen");
        let temp = tempfile::tempdir().expect("temp");
        let dispatch_path = temp.keep().join("dispatches.json");
        let mut store = ManagedDispatchStore::load(dispatch_path.clone()).expect("store");
        store
            .stage_owner_event(&trigger, &[resident.public_key().to_hex()], 100)
            .expect("stage");
        store
            .activate_session(&resident.public_key().to_hex(), 7)
            .expect("session");
        let store = Arc::new(Mutex::new(store));
        let session = OpaqueId::parse("installation-publisher").expect("installation");
        let mut outbox = ManagedMessageOutbox::new(session.clone());
        outbox
            .prepare(&request, frozen, &session, 7, false)
            .expect("prepare");
        Fixture {
            resident,
            request,
            store,
            outbox,
            session,
            exact_event_json,
            event_id,
            dispatch_path,
        }
    }

    fn publisher(fixture: &Fixture, state: Arc<Mutex<FakeRelayState>>) -> ManagedMessagePublisher {
        ManagedMessagePublisher::with_transport(
            fixture.resident.public_key().to_hex(),
            Arc::clone(&fixture.store),
            Box::new(FakeRelayTransport { state }),
        )
    }

    fn one_shot_http_response(
        status: u16,
        body: Vec<u8>,
        expected_path: Option<&'static str>,
    ) -> (String, JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test relay");
        let address = listener.local_addr().expect("test relay address");
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept request");
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .expect("read timeout");
            let mut request = Vec::new();
            let mut chunk = [0_u8; 1024];
            let (header_end, content_length) = loop {
                let read = stream.read(&mut chunk).expect("read request");
                assert_ne!(read, 0, "request closed before headers");
                request.extend_from_slice(&chunk[..read]);
                if let Some(index) = request.windows(4).position(|window| window == b"\r\n\r\n") {
                    let header_end = index + 4;
                    let headers = String::from_utf8_lossy(&request[..header_end]);
                    if let Some(expected_path) = expected_path {
                        assert_eq!(
                            headers
                                .lines()
                                .next()
                                .and_then(|line| line.split_whitespace().nth(1)),
                            Some(expected_path)
                        );
                    }
                    let content_length = headers
                        .lines()
                        .find_map(|line| {
                            let (name, value) = line.split_once(':')?;
                            name.eq_ignore_ascii_case("content-length")
                                .then(|| value.trim().parse::<usize>().expect("content length"))
                        })
                        .unwrap_or(0);
                    break (header_end, content_length);
                }
            };
            while request.len() < header_end + content_length {
                let read = stream.read(&mut chunk).expect("read request body");
                assert_ne!(read, 0, "request closed before body");
                request.extend_from_slice(&chunk[..read]);
            }
            let reason = if status == 200 { "OK" } else { "Test" };
            let response = format!(
                "HTTP/1.1 {status} {reason}\r\nContent-Length: {}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n",
                body.len()
            );
            stream
                .write_all(response.as_bytes())
                .expect("write headers");
            stream.write_all(&body).expect("write body");
            stream.flush().expect("flush response");
        });
        (format!("http://{address}"), handle)
    }

    #[test]
    fn managed_publisher_submits_retained_exact_bytes_and_finalizes_both_stores() {
        let mut fixture = fixture();
        let state = Arc::new(Mutex::new(FakeRelayState {
            submit_results: VecDeque::from([ManagedRelaySubmitOutcome::Response(
                crate::relay::SubmitEventResponse {
                    event_id: fixture.event_id.clone(),
                    accepted: true,
                    message: "accepted".into(),
                },
            )]),
            ..Default::default()
        }));
        let mut publisher = publisher(&fixture, Arc::clone(&state));
        publisher
            .authorize_request(&fixture.request, 101)
            .expect("authorize");
        publisher
            .publish_prepared(&fixture.request, &mut fixture.outbox, &fixture.session)
            .expect("publish");
        assert_eq!(
            state.lock().expect("state").submissions,
            vec![fixture.exact_event_json.clone()]
        );
        assert!(matches!(
            fixture
                .outbox
                .accepted_result(&fixture.request.idempotency_key)
                .expect("result"),
            luca_protocol::ManagedMessagePublishResultV1::Published { .. }
        ));
        assert!(fixture.outbox.reconciliation_entries().is_empty());
    }

    #[test]
    fn managed_publisher_response_loss_reconciles_by_exact_id_and_bytes() {
        let mut fixture = fixture();
        let first_state = Arc::new(Mutex::new(FakeRelayState {
            submit_results: VecDeque::from([ManagedRelaySubmitOutcome::Retryable]),
            ..Default::default()
        }));
        let mut first = publisher(&fixture, Arc::clone(&first_state));
        first
            .authorize_request(&fixture.request, 101)
            .expect("authorize");
        assert_eq!(
            first.publish_prepared(&fixture.request, &mut fixture.outbox, &fixture.session),
            Err(ManagedPublicationAuthorityError::Unavailable)
        );

        let restart_state = Arc::new(Mutex::new(FakeRelayState {
            probe_results: VecDeque::from([ManagedRelayProbeOutcome::Absent]),
            submit_results: VecDeque::from([ManagedRelaySubmitOutcome::Response(
                crate::relay::SubmitEventResponse {
                    event_id: fixture.event_id.clone(),
                    accepted: true,
                    message: "accepted".into(),
                },
            )]),
            ..Default::default()
        }));
        let mut restarted = publisher(&fixture, Arc::clone(&restart_state));
        restarted
            .reconcile_on_start(&mut fixture.outbox, &fixture.session)
            .expect("reconcile");
        let state = restart_state.lock().expect("state");
        assert_eq!(state.probes, vec![fixture.exact_event_json.clone()]);
        assert_eq!(state.submissions, vec![fixture.exact_event_json]);
    }

    #[test]
    fn managed_http_submit_classifies_only_bad_request_as_terminal() {
        for status in [401, 403, 404, 408, 409, 413, 422, 429, 500, 503] {
            let (relay_url, server) =
                one_shot_http_response(status, b"SECRET-SERVER-BODY".to_vec(), Some("/events"));
            let resident = Keys::parse(&"93".repeat(32)).expect("resident");
            let mut transport =
                HttpManagedRelayTransport::new(resident, &relay_url, None).expect("transport");
            assert!(matches!(
                transport.submit_exact("{}", Duration::from_secs(2)),
                ManagedRelaySubmitOutcome::Retryable
            ));
            server.join().expect("server");
        }

        let (relay_url, server) =
            one_shot_http_response(400, b"SECRET-INVALID-EVENT-BODY".to_vec(), Some("/events"));
        let resident = Keys::parse(&"94".repeat(32)).expect("resident");
        let mut transport =
            HttpManagedRelayTransport::new(resident, &relay_url, None).expect("transport");
        assert!(matches!(
            transport.submit_exact("{}", Duration::from_secs(2)),
            ManagedRelaySubmitOutcome::TerminalRejected
        ));
        server.join().expect("server");
    }

    #[test]
    fn managed_http_submit_bounds_success_response_before_json_parse() {
        let (relay_url, server) = one_shot_http_response(
            200,
            vec![b'x'; usize::try_from(MAX_RELAY_RESPONSE_BYTES + 1).expect("size")],
            Some("/events"),
        );
        let resident = Keys::parse(&"95".repeat(32)).expect("resident");
        let mut transport =
            HttpManagedRelayTransport::new(resident, &relay_url, None).expect("transport");
        assert!(matches!(
            transport.submit_exact("{}", Duration::from_secs(2)),
            ManagedRelaySubmitOutcome::Retryable
        ));
        server.join().expect("server");
    }

    #[test]
    fn managed_http_probe_uses_payload_bound_mode_and_typed_absence() {
        let event_id = "ab".repeat(32);
        let response = serde_json::to_vec(&crate::relay::SubmitEventResponse {
            event_id: event_id.clone(),
            accepted: false,
            message: "absent:".into(),
        })
        .expect("response");
        let (relay_url, server) = one_shot_http_response(200, response, Some("/events?mode=probe"));
        let resident = Keys::parse(&"96".repeat(32)).expect("resident");
        let mut transport =
            HttpManagedRelayTransport::new(resident, &relay_url, None).expect("transport");
        assert!(matches!(
            transport.probe_exact("{}", &event_id, Duration::from_secs(2)),
            ManagedRelayProbeOutcome::Absent
        ));
        server.join().expect("server");
    }

    #[test]
    fn terminal_bad_request_rejects_and_finalizes_both_stores() {
        let mut fixture = fixture();
        let state = Arc::new(Mutex::new(FakeRelayState {
            submit_results: VecDeque::from([ManagedRelaySubmitOutcome::TerminalRejected]),
            ..Default::default()
        }));
        let mut publisher = publisher(&fixture, state);
        publisher
            .authorize_request(&fixture.request, 101)
            .expect("authorize");
        assert_eq!(
            publisher.publish_prepared(&fixture.request, &mut fixture.outbox, &fixture.session),
            Err(ManagedPublicationAuthorityError::Denied)
        );
        assert!(fixture.outbox.reconciliation_entries().is_empty());
        assert_eq!(
            fixture
                .store
                .lock()
                .expect("store")
                .authorize_reconciliation(&fixture.request, &fixture.event_id, 101)
                .expect("terminal state"),
            ManagedDispatchReconciliation::Rejected
        );
    }

    #[test]
    fn prepared_cancelled_restart_never_queries_or_submits() {
        let mut fixture = fixture();
        assert_eq!(
            fixture
                .store
                .lock()
                .expect("store")
                .cancel_matching(
                    fixture.request.owner_pubkey.as_str(),
                    fixture.request.conversation_id.as_str(),
                    fixture.request.thread_id.as_ref().map(OpaqueId::as_str),
                    &[fixture.request.resident_pubkey.as_str().to_owned()],
                )
                .expect("cancel"),
            1
        );
        let state = Arc::new(Mutex::new(FakeRelayState::default()));
        let mut restarted = publisher(&fixture, Arc::clone(&state));
        restarted
            .reconcile_on_start(&mut fixture.outbox, &fixture.session)
            .expect("reconcile cancellation");
        let state = state.lock().expect("state");
        assert!(state.probes.is_empty());
        assert!(state.submissions.is_empty());
        assert!(fixture.outbox.reconciliation_entries().is_empty());
    }

    #[test]
    fn cancelled_ambiguous_submission_probes_presence_and_records_publication() {
        let mut fixture = fixture();
        let first_state = Arc::new(Mutex::new(FakeRelayState {
            submit_results: VecDeque::from([ManagedRelaySubmitOutcome::Retryable]),
            ..Default::default()
        }));
        let mut first = publisher(&fixture, first_state);
        first
            .authorize_request(&fixture.request, 101)
            .expect("authorize");
        assert_eq!(
            first.publish_prepared(&fixture.request, &mut fixture.outbox, &fixture.session),
            Err(ManagedPublicationAuthorityError::Unavailable)
        );
        assert_eq!(
            fixture
                .store
                .lock()
                .expect("store")
                .cancel_matching(
                    fixture.request.owner_pubkey.as_str(),
                    fixture.request.conversation_id.as_str(),
                    fixture.request.thread_id.as_ref().map(OpaqueId::as_str),
                    &[fixture.request.resident_pubkey.as_str().to_owned()],
                )
                .expect("cancel after submit"),
            1
        );

        let restart_state = Arc::new(Mutex::new(FakeRelayState {
            probe_results: VecDeque::from([ManagedRelayProbeOutcome::Present(
                crate::relay::SubmitEventResponse {
                    event_id: fixture.event_id.clone(),
                    accepted: true,
                    message: "duplicate:".into(),
                },
            )]),
            ..Default::default()
        }));
        let mut restarted = publisher(&fixture, Arc::clone(&restart_state));
        restarted
            .reconcile_on_start(&mut fixture.outbox, &fixture.session)
            .expect("reconcile exact submission");
        let state = restart_state.lock().expect("state");
        assert_eq!(state.probes, vec![fixture.exact_event_json.clone()]);
        assert!(state.submissions.is_empty());
    }

    #[test]
    fn cancelled_ambiguous_submission_probes_absence_and_never_resubmits() {
        let mut fixture = fixture();
        let first_state = Arc::new(Mutex::new(FakeRelayState {
            submit_results: VecDeque::from([ManagedRelaySubmitOutcome::Retryable]),
            ..Default::default()
        }));
        let mut first = publisher(&fixture, first_state);
        first
            .authorize_request(&fixture.request, 101)
            .expect("authorize");
        assert_eq!(
            first.publish_prepared(&fixture.request, &mut fixture.outbox, &fixture.session),
            Err(ManagedPublicationAuthorityError::Unavailable)
        );

        let mut persisted: serde_json::Value = serde_json::from_slice(
            &std::fs::read(&fixture.dispatch_path).expect("read dispatch store"),
        )
        .expect("dispatch JSON");
        persisted["dispatches"][0]["state"] = serde_json::json!("cancelled");
        persisted["dispatches"][0]["outbox_finalized"] = serde_json::json!(false);
        std::fs::write(
            &fixture.dispatch_path,
            serde_json::to_vec(&persisted).expect("serialize"),
        )
        .expect("write legacy race state");
        fixture.store = Arc::new(Mutex::new(
            ManagedDispatchStore::load(fixture.dispatch_path.clone()).expect("reload"),
        ));

        let restart_state = Arc::new(Mutex::new(FakeRelayState {
            probe_results: VecDeque::from([ManagedRelayProbeOutcome::Absent]),
            ..Default::default()
        }));
        let mut restarted = publisher(&fixture, Arc::clone(&restart_state));
        restarted
            .reconcile_on_start(&mut fixture.outbox, &fixture.session)
            .expect("reconcile cancelled absence");
        let state = restart_state.lock().expect("state");
        assert_eq!(state.probes, vec![fixture.exact_event_json.clone()]);
        assert!(state.submissions.is_empty());
        assert!(fixture.outbox.reconciliation_entries().is_empty());
        assert_eq!(
            fixture
                .store
                .lock()
                .expect("store")
                .authorize_reconciliation(&fixture.request, &fixture.event_id, 101)
                .expect("terminal state"),
            ManagedDispatchReconciliation::Cancelled
        );
    }

    #[test]
    fn accepted_outbox_can_finish_after_safely_compacted_dispatch() {
        let mut fixture = fixture();
        fixture
            .outbox
            .mark_submitted(&fixture.request.idempotency_key, &fixture.session, false)
            .expect("submitted");
        fixture
            .outbox
            .mark_accepted(
                &fixture.request.idempotency_key,
                OpaqueId::parse(fixture.event_id.clone()).expect("receipt"),
            )
            .expect("accepted");
        let empty_store = Arc::new(Mutex::new(
            ManagedDispatchStore::load(
                tempfile::tempdir()
                    .expect("temp")
                    .keep()
                    .join("dispatches.json"),
            )
            .expect("empty store"),
        ));
        let state = Arc::new(Mutex::new(FakeRelayState::default()));
        let mut publisher = ManagedMessagePublisher::with_transport(
            fixture.resident.public_key().to_hex(),
            empty_store,
            Box::new(FakeRelayTransport { state }),
        );
        publisher
            .reconcile_on_start(&mut fixture.outbox, &fixture.session)
            .expect("finish retained acceptance");
        assert!(fixture.outbox.reconciliation_entries().is_empty());
    }

    #[test]
    fn cancelled_outbox_can_finish_after_safely_compacted_dispatch() {
        let mut fixture = fixture();
        fixture
            .outbox
            .cancel_during_reconciliation(&fixture.request.idempotency_key)
            .expect("cancelled");
        let empty_store = Arc::new(Mutex::new(
            ManagedDispatchStore::load(
                tempfile::tempdir()
                    .expect("temp")
                    .keep()
                    .join("dispatches.json"),
            )
            .expect("empty store"),
        ));
        let state = Arc::new(Mutex::new(FakeRelayState::default()));
        let mut publisher = ManagedMessagePublisher::with_transport(
            fixture.resident.public_key().to_hex(),
            empty_store,
            Box::new(FakeRelayTransport { state }),
        );
        publisher
            .reconcile_on_start(&mut fixture.outbox, &fixture.session)
            .expect("finish retained cancellation");
        assert!(fixture.outbox.reconciliation_entries().is_empty());
    }
}
