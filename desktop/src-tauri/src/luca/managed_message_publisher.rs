//! Concrete resident-authorized publication and restart reconciliation.
//!
//! The final kind-9 event is already signed and frozen by the desktop broker.
//! This module submits the retained canonical JSON bytes directly; only the
//! per-request NIP-98 authorization event is freshly signed.

use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use luca_protocol::{ManagedMessagePublishRequestV1, OpaqueId};
use nostr::{Event, EventId, JsonUtil, Keys, Kind};
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
const RECONCILE_STARTUP_BUDGET: Duration = Duration::from_secs(5);

trait ManagedRelayTransport: Send {
    fn submit_exact(
        &mut self,
        signed_event_json: &str,
        timeout: Duration,
    ) -> Result<crate::relay::SubmitEventResponse, String>;

    fn query_exact_event(
        &mut self,
        event_id: &str,
        expected_signed_event_json: &str,
        timeout: Duration,
    ) -> Result<bool, String>;
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
}

impl ManagedRelayTransport for HttpManagedRelayTransport {
    fn submit_exact(
        &mut self,
        signed_event_json: &str,
        timeout: Duration,
    ) -> Result<crate::relay::SubmitEventResponse, String> {
        let response =
            self.post_exact("/events", signed_event_json.as_bytes().to_vec(), timeout)?;
        if !response.status().is_success() {
            return Err(format!(
                "managed relay submission returned HTTP {}",
                response.status()
            ));
        }
        response
            .json()
            .map_err(|error| format!("parse managed relay submission: {error}"))
    }

    fn query_exact_event(
        &mut self,
        event_id: &str,
        expected_signed_event_json: &str,
        timeout: Duration,
    ) -> Result<bool, String> {
        EventId::from_hex(event_id).map_err(|_| "managed event ID is invalid".to_owned())?;
        let body = serde_json::to_vec(&[serde_json::json!({
            "ids": [event_id],
            "kinds": [9],
            "limit": 1
        })])
        .map_err(|error| format!("serialize managed relay query: {error}"))?;
        let response = self.post_exact("/query", body, timeout)?;
        if !response.status().is_success() {
            return Err(format!(
                "managed relay query returned HTTP {}",
                response.status()
            ));
        }
        let events: Vec<Event> = response
            .json()
            .map_err(|error| format!("parse managed relay query: {error}"))?;
        for event in events {
            if event.id.to_hex() == event_id {
                if event.kind != Kind::Custom(9)
                    || !event.verify_id()
                    || !event.verify_signature()
                    || luca_protocol::canonicalize(&event)
                        .map(|bytes| bytes.as_slice() != expected_signed_event_json.as_bytes())
                        .unwrap_or(true)
                {
                    return Err("managed relay returned an invalid exact event".into());
                }
                return Ok(true);
            }
        }
        Ok(false)
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
        Ok(())
    }

    fn submit_entry(
        &mut self,
        entry: &ManagedOutboxReconcileEntry,
        outbox: &mut ManagedMessageOutbox,
        installation_session_id: &OpaqueId,
        timeout: Duration,
    ) -> Result<(), ManagedPublicationAuthorityError> {
        if entry.state == ManagedOutboxState::Prepared {
            outbox
                .mark_submitted(&entry.idempotency_key, installation_session_id, false)
                .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
        }
        let response = self
            .transport
            .submit_exact(&entry.signed_event_json, timeout)
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
        if response.event_id != entry.event_id.as_str() {
            return Err(ManagedPublicationAuthorityError::Invalid);
        }
        if !response.accepted {
            self.reject(entry, outbox)?;
            return Err(ManagedPublicationAuthorityError::Denied);
        }
        self.mark_accepted(entry, outbox)
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
        let decision = {
            let mut store = self
                .dispatch_store
                .lock()
                .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
            store
                .bind_reconciled_submission(&entry.request, entry.event_id.as_str(), now_unix_secs)
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
                return Ok(());
            }
            ManagedDispatchReconciliation::Ready | ManagedDispatchReconciliation::Cancelled => {}
        }

        if entry.state == ManagedOutboxState::Prepared {
            if decision == ManagedDispatchReconciliation::Cancelled {
                outbox
                    .cancel_during_reconciliation(&entry.idempotency_key)
                    .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
                return Ok(());
            }
            outbox
                .mark_submitted(&entry.idempotency_key, installation_session_id, false)
                .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
        }

        let exists = self
            .transport
            .query_exact_event(
                entry.event_id.as_str(),
                &entry.signed_event_json,
                RECONCILE_REQUEST_TIMEOUT,
            )
            .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
        if exists {
            return self.mark_accepted(&entry, outbox);
        }
        if decision == ManagedDispatchReconciliation::Cancelled {
            outbox
                .cancel_during_reconciliation(&entry.idempotency_key)
                .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
            return Ok(());
        }
        self.submit_entry(
            &entry,
            outbox,
            installation_session_id,
            RECONCILE_REQUEST_TIMEOUT,
        )
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
        self.submit_entry(
            &entry,
            outbox,
            installation_session_id,
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
        let started = std::time::Instant::now();
        let mut deferred = None;
        for entry in outbox.reconciliation_entries() {
            if started.elapsed() >= RECONCILE_STARTUP_BUDGET {
                break;
            }
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
        sync::{Arc, Mutex},
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
        queries: Vec<(String, String, Duration)>,
        submit_results: VecDeque<Result<crate::relay::SubmitEventResponse, String>>,
        query_results: VecDeque<Result<bool, String>>,
    }

    struct FakeRelayTransport {
        state: Arc<Mutex<FakeRelayState>>,
    }

    impl ManagedRelayTransport for FakeRelayTransport {
        fn submit_exact(
            &mut self,
            signed_event_json: &str,
            _timeout: Duration,
        ) -> Result<crate::relay::SubmitEventResponse, String> {
            let mut state = self.state.lock().expect("state");
            state.submissions.push(signed_event_json.to_owned());
            state
                .submit_results
                .pop_front()
                .unwrap_or_else(|| Err("no submit fixture".into()))
        }

        fn query_exact_event(
            &mut self,
            event_id: &str,
            expected_signed_event_json: &str,
            timeout: Duration,
        ) -> Result<bool, String> {
            let mut state = self.state.lock().expect("state");
            state.queries.push((
                event_id.to_owned(),
                expected_signed_event_json.to_owned(),
                timeout,
            ));
            state
                .query_results
                .pop_front()
                .unwrap_or_else(|| Err("no query fixture".into()))
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
        let path = temp.keep().join("dispatches.json");
        let mut store = ManagedDispatchStore::load(path).expect("store");
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
        }
    }

    fn publisher(fixture: &Fixture, state: Arc<Mutex<FakeRelayState>>) -> ManagedMessagePublisher {
        ManagedMessagePublisher::with_transport(
            fixture.resident.public_key().to_hex(),
            Arc::clone(&fixture.store),
            Box::new(FakeRelayTransport { state }),
        )
    }

    #[test]
    fn managed_publisher_submits_retained_exact_bytes_and_finalizes_both_stores() {
        let mut fixture = fixture();
        let state = Arc::new(Mutex::new(FakeRelayState {
            submit_results: VecDeque::from([Ok(crate::relay::SubmitEventResponse {
                event_id: fixture.event_id.clone(),
                accepted: true,
                message: "accepted".into(),
            })]),
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
            submit_results: VecDeque::from([Err("response lost".into())]),
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
            query_results: VecDeque::from([Ok(false)]),
            submit_results: VecDeque::from([Ok(crate::relay::SubmitEventResponse {
                event_id: fixture.event_id.clone(),
                accepted: true,
                message: "accepted".into(),
            })]),
            ..Default::default()
        }));
        let mut restarted = publisher(&fixture, Arc::clone(&restart_state));
        restarted
            .reconcile_on_start(&mut fixture.outbox, &fixture.session)
            .expect("reconcile");
        let state = restart_state.lock().expect("state");
        assert_eq!(state.queries.len(), 1);
        assert_eq!(state.queries[0].0, fixture.event_id);
        assert_eq!(state.queries[0].1, fixture.exact_event_json);
        assert_eq!(state.queries[0].2, RECONCILE_REQUEST_TIMEOUT);
        assert_eq!(state.submissions, vec![fixture.exact_event_json]);
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
}
