//! Explicit-relay transport for the trusted portable Capsule boundary.
//!
//! Owner and resident keys are used only in synchronous preparation blocks.
//! Network futures retain public signed material, never a secret key, and the
//! resident operation remains the fixed allowlist owned by the signing broker.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};

use nostr::Keys;
use reqwest::Method;

use crate::{
    app_state::AppState,
    managed_agents::managed_capsule_broker_handle,
    relay::{
        build_nip98_auth_header_for_keys, classify_request_error, relay_http_base_url,
        SubmitEventResponse,
    },
};

use super::continuity_capsule::{
    open_capsule_candidates, CapsuleBrokerHandle, CapsulePrepareRequest,
    CapsulePublicationPreparation, ContinuityCapsuleDesktopError, ContinuityCapsuleLoadState,
    ContinuityCapsuleQuery, ContinuityCapsuleStoreReceipt, PreparedCapsulePublication,
};

const CAPSULE_BROKER_TIMEOUT: Duration = Duration::from_secs(2);
const CAPSULE_LOAD_TIMEOUT: Duration = Duration::from_secs(3);
const CAPSULE_STORE_TIMEOUT: Duration = Duration::from_secs(8);
const MAX_CAPSULE_QUERY_RESPONSE_BYTES: usize = 256 * 1024;
const MAX_CAPSULE_SUBMIT_RESPONSE_BYTES: usize = 64 * 1024;

fn capsule_store_locks() -> &'static Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>> {
    static LOCKS: OnceLock<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>> = OnceLock::new();
    LOCKS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn capsule_store_lock(
    resident_pubkey: &luca_protocol::Hex64,
) -> Result<Arc<tokio::sync::Mutex<()>>, ContinuityCapsuleDesktopError> {
    let mut locks = capsule_store_locks()
        .lock()
        .map_err(|_| ContinuityCapsuleDesktopError::BrokerUnavailable)?;
    Ok(Arc::clone(
        locks
            .entry(resident_pubkey.as_str().to_owned())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(()))),
    ))
}

/// Query and decrypt the one fixed Capsule coordinate with the active owner.
pub(crate) async fn load_current_capsule(
    state: &AppState,
    handle: &CapsuleBrokerHandle,
) -> Result<ContinuityCapsuleLoadState, ContinuityCapsuleDesktopError> {
    tokio::time::timeout(
        CAPSULE_LOAD_TIMEOUT,
        load_current_capsule_inner(state, handle),
    )
    .await
    .map_err(|_| ContinuityCapsuleDesktopError::Timeout)?
}

async fn load_current_capsule_inner(
    state: &AppState,
    handle: &CapsuleBrokerHandle,
) -> Result<ContinuityCapsuleLoadState, ContinuityCapsuleDesktopError> {
    let expected_query_url = format!(
        "{}/query",
        relay_http_base_url(handle.relay_url()).trim_end_matches('/')
    );
    if handle.relay_query_url() != expected_query_url {
        return Err(ContinuityCapsuleDesktopError::RelayProtocol);
    }

    crate::relay_admission::wait_for_rate_limit().await;
    let (body, authorization) = {
        let owner_keys = exact_owner_keys(state, handle)?;
        let query = ContinuityCapsuleQuery::derive(
            &owner_keys,
            handle.owner_pubkey(),
            handle.resident_pubkey(),
        )?;
        let body = serde_json::to_vec(&[query.filter()])
            .map_err(|_| ContinuityCapsuleDesktopError::RelayProtocol)?;
        let authorization = build_nip98_auth_header_for_keys(
            &owner_keys,
            &Method::POST,
            handle.relay_query_url(),
            &body,
        )
        .map_err(|_| ContinuityCapsuleDesktopError::RelayProtocol)?;
        (body, authorization)
    };

    let response = state
        .http_client
        .post(handle.relay_query_url())
        .header("Authorization", authorization)
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|error| {
            let _ = classify_request_error(&error);
            ContinuityCapsuleDesktopError::RelayUnavailable
        })?;
    if !response.status().is_success() {
        return Err(ContinuityCapsuleDesktopError::RelayUnavailable);
    }
    let bytes = read_bounded_response(response, MAX_CAPSULE_QUERY_RESPONSE_BYTES).await?;
    let events = decode_capsule_candidates(&bytes)?;
    let owner_keys = exact_owner_keys(state, handle)?;
    let query = ContinuityCapsuleQuery::derive(
        &owner_keys,
        handle.owner_pubkey(),
        handle.resident_pubkey(),
    )?;
    Ok(open_capsule_candidates(
        events,
        &owner_keys,
        &query,
        handle.binding_ref(),
    ))
}

/// Prepare with the resident broker, publish public encrypted bytes, and
/// require the exact event to become the verified current head.
pub(crate) async fn store_current_capsule(
    state: &AppState,
    resident_pubkey: &luca_protocol::Hex64,
    candidate: luca_continuity::PortableCapsuleEnvelopeV1,
    now_unix_seconds: u64,
) -> Result<ContinuityCapsuleStoreReceipt, ContinuityCapsuleDesktopError> {
    let deadline = tokio::time::Instant::now() + CAPSULE_STORE_TIMEOUT;
    tokio::time::timeout_at(deadline, async {
        let lock = capsule_store_lock(resident_pubkey)?;
        let _transaction = lock.lock().await;
        store_current_capsule_inner(state, resident_pubkey, candidate, now_unix_seconds).await
    })
    .await
    .map_err(|_| ContinuityCapsuleDesktopError::Timeout)?
}

async fn store_current_capsule_inner(
    state: &AppState,
    resident_pubkey: &luca_protocol::Hex64,
    candidate: luca_continuity::PortableCapsuleEnvelopeV1,
    now_unix_seconds: u64,
) -> Result<ContinuityCapsuleStoreReceipt, ContinuityCapsuleDesktopError> {
    let handle = managed_capsule_broker_handle(resident_pubkey.as_str())
        .map_err(|_| ContinuityCapsuleDesktopError::BrokerUnavailable)?;
    if candidate.capsule().owner_pubkey != *handle.owner_pubkey()
        || candidate.capsule().resident_pubkey != *handle.resident_pubkey()
        || candidate.capsule().binding_ref != *handle.binding_ref()
    {
        return Err(ContinuityCapsuleDesktopError::StaleBinding);
    }
    let current = load_current_capsule_inner(state, &handle).await?;
    let prepare_handle = handle.clone();
    let prepared = tauri::async_runtime::spawn_blocking(move || {
        prepare_handle.prepare(
            CapsulePrepareRequest {
                candidate,
                current,
                now_unix_seconds,
            },
            CAPSULE_BROKER_TIMEOUT,
        )
    })
    .await
    .map_err(|_| ContinuityCapsuleDesktopError::BrokerUnavailable)??;

    match prepared {
        CapsulePublicationPreparation::Idempotent(receipt) => Ok(receipt),
        CapsulePublicationPreparation::Publish(prepared) => {
            publish_prepared(state, &prepared).await?;
            let verified = load_current_capsule_inner(state, &handle).await?;
            let ContinuityCapsuleLoadState::Ready(current) = verified else {
                return Err(ContinuityCapsuleDesktopError::RelayProtocol);
            };
            if current.event_id() != &prepared.event_id
                || current.envelope().capsule().revision.get() != prepared.revision
            {
                return Err(ContinuityCapsuleDesktopError::RelayProtocol);
            }
            Ok(ContinuityCapsuleStoreReceipt {
                event_id: prepared.event_id,
                revision: prepared.revision,
                idempotent: false,
            })
        }
    }
}

async fn publish_prepared(
    state: &AppState,
    prepared: &PreparedCapsulePublication,
) -> Result<(), ContinuityCapsuleDesktopError> {
    crate::relay_admission::wait_for_rate_limit().await;
    let mut request = state
        .http_client
        .post(&prepared.url)
        .header("Authorization", &prepared.authorization)
        .header("Content-Type", "application/json");
    if let Some(auth_tag) = prepared.owner_auth_tag.as_deref() {
        request = request.header("x-auth-tag", auth_tag);
    }
    let response = request
        .body(prepared.body.clone())
        .send()
        .await
        .map_err(|error| {
            let _ = classify_request_error(&error);
            ContinuityCapsuleDesktopError::RelayUnavailable
        })?;
    if !response.status().is_success() {
        return Err(ContinuityCapsuleDesktopError::RelayUnavailable);
    }
    let bytes = read_bounded_response(response, MAX_CAPSULE_SUBMIT_RESPONSE_BYTES).await?;
    let result: SubmitEventResponse =
        serde_json::from_slice(&bytes).map_err(|_| ContinuityCapsuleDesktopError::RelayProtocol)?;
    if !result.accepted || result.event_id != prepared.event_id.as_str() {
        return Err(ContinuityCapsuleDesktopError::RelayProtocol);
    }
    Ok(())
}

async fn read_bounded_response(
    mut response: reqwest::Response,
    max_bytes: usize,
) -> Result<Vec<u8>, ContinuityCapsuleDesktopError> {
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes as u64)
    {
        return Err(ContinuityCapsuleDesktopError::RelayProtocol);
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| ContinuityCapsuleDesktopError::RelayUnavailable)?
    {
        let next = bytes
            .len()
            .checked_add(chunk.len())
            .ok_or(ContinuityCapsuleDesktopError::RelayProtocol)?;
        if next > max_bytes {
            return Err(ContinuityCapsuleDesktopError::RelayProtocol);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn decode_capsule_candidates(
    bytes: &[u8],
) -> Result<Vec<nostr::Event>, ContinuityCapsuleDesktopError> {
    let events: Vec<nostr::Event> =
        serde_json::from_slice(bytes).map_err(|_| ContinuityCapsuleDesktopError::RelayProtocol)?;
    if events.len() > super::continuity_capsule::CAPSULE_FETCH_LIMIT as usize {
        return Err(ContinuityCapsuleDesktopError::RelayProtocol);
    }
    Ok(events)
}

fn exact_owner_keys(
    state: &AppState,
    handle: &CapsuleBrokerHandle,
) -> Result<Keys, ContinuityCapsuleDesktopError> {
    let keys = state
        .signing_keys()
        .map_err(|_| ContinuityCapsuleDesktopError::OwnerLocked)?;
    if keys.public_key().to_hex() != handle.owner_pubkey().as_str() {
        return Err(ContinuityCapsuleDesktopError::WrongOwner);
    }
    Ok(keys)
}

#[cfg(test)]
mod tests {
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        },
    };

    use luca_protocol::Hex64;
    use nostr::{EventBuilder, JsonUtil, Keys, Kind};

    use super::*;
    use crate::luca::continuity_capsule::CAPSULE_FETCH_LIMIT;

    fn local_response(raw: Vec<u8>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 1024];
            let _ = stream.read(&mut request);
            stream.write_all(&raw).unwrap();
            stream.flush().unwrap();
        });
        format!("http://{address}")
    }

    #[test]
    fn transport_source_never_loads_or_exports_resident_keys() {
        let source = include_str!("continuity_capsule_relay.rs");
        let production = source.split("#[cfg(test)]").next().unwrap();
        for forbidden in [
            "load_managed_agents",
            "private_key_nsec",
            "submit_signed_event_with_keys",
            "parse_json_response",
            "relay_error_message",
            "BUZZ_PRIVATE_KEY",
            "NOSTR_PRIVATE_KEY",
            "tauri::command",
        ] {
            assert!(
                !production.contains(forbidden),
                "forbidden transport surface: {forbidden}"
            );
        }
    }

    #[test]
    fn ignored_query_limit_is_rejected_after_decode() {
        let keys = Keys::parse(&"71".repeat(32)).unwrap();
        let event = EventBuilder::new(Kind::Custom(9), "public fixture")
            .sign_with_keys(&keys)
            .unwrap();
        let json = format!(
            "[{}]",
            std::iter::repeat_n(event.as_json(), CAPSULE_FETCH_LIMIT as usize + 1)
                .collect::<Vec<_>>()
                .join(",")
        );
        assert!(matches!(
            decode_capsule_candidates(json.as_bytes()),
            Err(ContinuityCapsuleDesktopError::RelayProtocol)
        ));
    }

    #[tokio::test]
    async fn content_length_chunk_growth_and_stalls_are_bounded() {
        let url = local_response(
            b"HTTP/1.1 200 OK\r\nContent-Length: 9\r\nConnection: close\r\n\r\n123456789".to_vec(),
        );
        let response = reqwest::get(url).await.unwrap();
        assert!(matches!(
            read_bounded_response(response, 8).await,
            Err(ContinuityCapsuleDesktopError::RelayProtocol)
        ));

        let url = local_response(
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n5\r\n12345\r\n4\r\n6789\r\n0\r\n\r\n"
                .to_vec(),
        );
        let response = reqwest::get(url).await.unwrap();
        assert!(matches!(
            read_bounded_response(response, 8).await,
            Err(ContinuityCapsuleDesktopError::RelayProtocol)
        ));

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 1024];
            let _ = stream.read(&mut request);
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 1\r\n\r\n")
                .unwrap();
            stream.flush().unwrap();
            std::thread::sleep(Duration::from_millis(100));
            let _ = stream.write_all(b"x");
        });
        let response = reqwest::get(format!("http://{address}")).await.unwrap();
        assert!(tokio::time::timeout(
            Duration::from_millis(10),
            read_bounded_response(response, 8)
        )
        .await
        .is_err());
    }

    #[tokio::test]
    async fn per_resident_transaction_lock_serializes_without_cross_resident_blocking() {
        let resident = Hex64::parse("8".repeat(64)).unwrap();
        let other = Hex64::parse("9".repeat(64)).unwrap();
        let first_lock = capsule_store_lock(&resident).unwrap();
        let first_guard = first_lock.lock().await;
        let second_lock = capsule_store_lock(&resident).unwrap();
        let acquired = Arc::new(AtomicBool::new(false));
        let acquired_by_second = Arc::clone(&acquired);
        let waiter = tokio::spawn(async move {
            let _guard = second_lock.lock().await;
            acquired_by_second.store(true, Ordering::SeqCst);
        });
        tokio::task::yield_now().await;
        assert!(!acquired.load(Ordering::SeqCst));

        let other_lock = capsule_store_lock(&other).unwrap();
        assert!(other_lock.try_lock().is_ok());
        drop(first_guard);
        tokio::time::timeout(Duration::from_secs(1), waiter)
            .await
            .unwrap()
            .unwrap();
        assert!(acquired.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn concurrent_different_successors_have_one_terminal_winner() {
        use std::sync::atomic::AtomicUsize;

        let resident = Hex64::parse("a".repeat(64)).unwrap();
        let head = Arc::new(AtomicUsize::new(0));
        let start = Arc::new(tokio::sync::Barrier::new(3));
        let mut writers = Vec::new();
        for candidate in [1_usize, 2_usize] {
            let lock = capsule_store_lock(&resident).unwrap();
            let head = Arc::clone(&head);
            let start = Arc::clone(&start);
            writers.push(tokio::spawn(async move {
                start.wait().await;
                let _transaction = lock.lock().await;
                head.compare_exchange(0, candidate, Ordering::SeqCst, Ordering::SeqCst)
                    .map(|_| candidate)
            }));
        }
        start.wait().await;
        let left = writers.remove(0).await.unwrap();
        let right = writers.remove(0).await.unwrap();
        assert_ne!(left.is_ok(), right.is_ok());
        assert!(matches!(head.load(Ordering::SeqCst), 1 | 2));
    }
}
