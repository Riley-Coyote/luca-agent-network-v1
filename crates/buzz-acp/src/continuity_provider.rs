//! Fail-soft, bounded continuity-provider seam for ACP pre-turn retrieval.
//!
//! This module deliberately has no publication, permission, cancellation, or
//! persistence authority. A provider failure is represented as typed context
//! data so ordinary conversation dispatch remains available.

use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures_util::future::BoxFuture;
use luca_protocol::{
    canonicalize, ContinuityContextRequestV1, ContinuityContextResultV1, ContinuityLayerResultV1,
    ContinuityLayerStatusV1, CONTINUITY_PROTOCOL, MAX_CONTINUITY_PACKET_BYTES,
};

/// Hard upper bound for one ACP continuity-provider resolution.
pub const CONTINUITY_RESOLUTION_TIMEOUT: Duration = Duration::from_secs(3);

/// A body-free failure returned by a continuity provider.
#[derive(Debug, Clone, Copy, thiserror::Error)]
#[error("continuity provider failed")]
pub struct ContinuityProviderError;

/// Read-only continuity provider used before a resident turn.
///
/// Implementations must not publish messages or mutate continuity state from
/// this call. The resolver below enforces its deadline and packet budget.
pub trait ContinuityProvider: Send + Sync {
    /// Resolve bounded continuity for one responding resident.
    fn resolve<'a>(
        &'a self,
        request: &'a ContinuityContextRequestV1,
    ) -> BoxFuture<'a, Result<ContinuityContextResultV1, ContinuityProviderError>>;
}

/// One deterministic outcome consumed by [`ScriptedContinuityProvider`].
#[derive(Debug, Clone)]
pub enum ScriptedContinuityResponse {
    /// Return a typed result immediately.
    Result(ContinuityContextResultV1),
    /// Return a provider failure, mapped fail-soft to `unavailable`.
    Error,
    /// Wait before returning a typed result; useful for deadline tests.
    Delayed {
        /// Delay before producing the outcome.
        delay: Duration,
        /// Result to return after the delay.
        result: ContinuityContextResultV1,
    },
}

/// Deterministic in-memory provider for ACP tests and local failure matrices.
#[derive(Debug, Default)]
pub struct ScriptedContinuityProvider {
    responses: Mutex<VecDeque<ScriptedContinuityResponse>>,
}

impl ScriptedContinuityProvider {
    /// Construct a provider that consumes outcomes in insertion order.
    pub fn new(responses: impl IntoIterator<Item = ScriptedContinuityResponse>) -> Self {
        Self {
            responses: Mutex::new(responses.into_iter().collect()),
        }
    }
}

impl ContinuityProvider for ScriptedContinuityProvider {
    fn resolve<'a>(
        &'a self,
        _request: &'a ContinuityContextRequestV1,
    ) -> BoxFuture<'a, Result<ContinuityContextResultV1, ContinuityProviderError>> {
        let response = self
            .responses
            .lock()
            .ok()
            .and_then(|mut responses| responses.pop_front());
        Box::pin(async move {
            match response {
                Some(ScriptedContinuityResponse::Result(result)) => Ok(result),
                Some(ScriptedContinuityResponse::Error) | None => Err(ContinuityProviderError),
                Some(ScriptedContinuityResponse::Delayed { delay, result }) => {
                    tokio::time::sleep(delay).await;
                    Ok(result)
                }
            }
        })
    }
}

/// Resolve continuity without allowing it to make a conversation unavailable.
///
/// Provider errors become `unavailable`; expired or elapsed deadlines become
/// `timeout`; invalid requests, results, identity echoes, or packet budgets
/// become `invalid`. Valid layer statuses are otherwise preserved exactly.
pub async fn resolve_continuity_fail_soft(
    provider: &dyn ContinuityProvider,
    request: &ContinuityContextRequestV1,
) -> ContinuityContextResultV1 {
    if request.validate().is_err() {
        return fallback_result(request, ContinuityLayerStatusV1::Invalid);
    }

    let now = unix_time_millis();
    let deadline = request.deadline_unix_ms.get();
    if deadline <= now {
        return fallback_result(request, ContinuityLayerStatusV1::Timeout);
    }

    let deadline_remaining = Duration::from_millis(deadline.saturating_sub(now));
    let timeout = deadline_remaining.min(CONTINUITY_RESOLUTION_TIMEOUT);
    let result = match tokio::time::timeout(timeout, provider.resolve(request)).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => return fallback_result(request, ContinuityLayerStatusV1::Unavailable),
        Err(_) => return fallback_result(request, ContinuityLayerStatusV1::Timeout),
    };

    if unix_time_millis() >= deadline {
        return fallback_result(request, ContinuityLayerStatusV1::Timeout);
    }
    if !result_matches_request(&result, request) || !result_is_bounded(&result, request) {
        return fallback_result(request, ContinuityLayerStatusV1::Invalid);
    }

    result
}

fn unix_time_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn result_matches_request(
    result: &ContinuityContextResultV1,
    request: &ContinuityContextRequestV1,
) -> bool {
    result.request_id == request.request_id && result.resident_pubkey == request.resident_pubkey
}

fn result_is_bounded(
    result: &ContinuityContextResultV1,
    request: &ContinuityContextRequestV1,
) -> bool {
    if result.validate().is_err() {
        return false;
    }
    let Some(packet) = &result.packet else {
        return true;
    };
    canonicalize(packet)
        .map(|packet| {
            packet.len() <= request.max_packet_bytes.get() as usize
                && packet.len() <= MAX_CONTINUITY_PACKET_BYTES
        })
        .unwrap_or(false)
}

fn fallback_result(
    request: &ContinuityContextRequestV1,
    status: ContinuityLayerStatusV1,
) -> ContinuityContextResultV1 {
    ContinuityContextResultV1 {
        protocol: CONTINUITY_PROTOCOL.to_owned(),
        request_id: request.request_id.clone(),
        resident_pubkey: request.resident_pubkey.clone(),
        layers: vec![ContinuityLayerResultV1 {
            layer: request.conversation_id.clone(),
            status,
            provenance_ref: None,
            diagnostic: None,
        }],
        packet: None,
        receipt_ref: request.binding_ref.clone(),
        diagnostics: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use luca_protocol::{ContinuityPacketV1, OpaqueId, SafeU53, Sha256Ref};
    use serde_json::json;
    use std::sync::Arc;

    fn request() -> ContinuityContextRequestV1 {
        serde_json::from_value(json!({
            "protocol": CONTINUITY_PROTOCOL,
            "request_id": "request-1",
            "owner_pubkey": "1111111111111111111111111111111111111111111111111111111111111111",
            "resident_pubkey": "3333333333333333333333333333333333333333333333333333333333333333",
            "conversation_id": "conversation-1",
            "binding_ref": "sha256:5555555555555555555555555555555555555555555555555555555555555555",
            "canonical_dispatch_ref": "sha256:6666666666666666666666666666666666666666666666666666666666666666",
            "provider_egress": "local",
            "deadline_unix_ms": unix_time_millis() + 60_000,
            "max_packet_bytes": MAX_CONTINUITY_PACKET_BYTES,
            "history_event_ids": []
        }))
        .expect("synthetic request is valid")
    }

    fn result_for(
        request: &ContinuityContextRequestV1,
        status: ContinuityLayerStatusV1,
    ) -> ContinuityContextResultV1 {
        let provenance =
            Sha256Ref::parse(format!("sha256:{}", "5".repeat(64))).expect("static ref");
        ContinuityContextResultV1 {
            protocol: CONTINUITY_PROTOCOL.to_owned(),
            request_id: request.request_id.clone(),
            resident_pubkey: request.resident_pubkey.clone(),
            layers: vec![ContinuityLayerResultV1 {
                layer: OpaqueId::parse("resident_private").expect("static layer"),
                status,
                provenance_ref: (status == ContinuityLayerStatusV1::Ready)
                    .then_some(provenance.clone()),
                diagnostic: None,
            }],
            packet: (status == ContinuityLayerStatusV1::Ready).then(|| ContinuityPacketV1 {
                protocol: CONTINUITY_PROTOCOL.to_owned(),
                packet_id: OpaqueId::parse("packet-1").expect("static packet"),
                content: "UNTRUSTED_REFERENCE\nsource=synthetic\n".to_owned(),
                provenance_refs: vec![provenance],
            }),
            receipt_ref: Sha256Ref::parse(format!("sha256:{}", "8".repeat(64)))
                .expect("static receipt"),
            diagnostics: Vec::new(),
        }
    }

    #[tokio::test]
    async fn preserves_every_valid_layer_status() {
        let statuses = [
            ContinuityLayerStatusV1::Ready,
            ContinuityLayerStatusV1::Empty,
            ContinuityLayerStatusV1::Denied,
            ContinuityLayerStatusV1::Stale,
            ContinuityLayerStatusV1::Locked,
            ContinuityLayerStatusV1::Unavailable,
            ContinuityLayerStatusV1::Timeout,
            ContinuityLayerStatusV1::Invalid,
        ];
        for status in statuses {
            let request = request();
            let provider = ScriptedContinuityProvider::new([ScriptedContinuityResponse::Result(
                result_for(&request, status),
            )]);
            let result = resolve_continuity_fail_soft(&provider, &request).await;
            assert_eq!(result.layers[0].status, status);
        }
    }

    #[tokio::test]
    async fn exact_48_kib_packet_boundary_is_accepted_without_slicing() {
        let request = request();
        let mut result = result_for(&request, ContinuityLayerStatusV1::Ready);
        let packet = result.packet.as_mut().expect("ready result has packet");
        packet.content.clear();
        let overhead =
            canonicalize(packet).expect("packet canonicalizes").len() - packet.content.len();
        packet.content = "a".repeat(MAX_CONTINUITY_PACKET_BYTES - overhead);
        assert_eq!(
            canonicalize(packet).expect("packet canonicalizes").len(),
            MAX_CONTINUITY_PACKET_BYTES
        );
        let expected = packet.content.clone();
        let provider =
            ScriptedContinuityProvider::new([ScriptedContinuityResponse::Result(result)]);
        let resolved = resolve_continuity_fail_soft(&provider, &request).await;
        assert_eq!(resolved.layers[0].status, ContinuityLayerStatusV1::Ready);
        assert_eq!(resolved.packet.expect("ready packet").content, expected);
    }

    #[tokio::test]
    async fn malformed_and_over_budget_results_become_invalid() {
        let base_request = request();
        let mut malformed = result_for(&base_request, ContinuityLayerStatusV1::Ready);
        malformed
            .packet
            .as_mut()
            .expect("ready packet")
            .content
            .clear();
        let provider =
            ScriptedContinuityProvider::new([ScriptedContinuityResponse::Result(malformed)]);
        assert_eq!(
            resolve_continuity_fail_soft(&provider, &base_request)
                .await
                .layers[0]
                .status,
            ContinuityLayerStatusV1::Invalid
        );

        let mut limited = request();
        limited.max_packet_bytes = SafeU53::new(1).expect("safe budget");
        let provider = ScriptedContinuityProvider::new([ScriptedContinuityResponse::Result(
            result_for(&limited, ContinuityLayerStatusV1::Ready),
        )]);
        assert_eq!(
            resolve_continuity_fail_soft(&provider, &limited)
                .await
                .layers[0]
                .status,
            ContinuityLayerStatusV1::Invalid
        );
    }

    #[tokio::test]
    async fn provider_error_and_invalid_request_fail_soft() {
        let base_request = request();
        let provider = ScriptedContinuityProvider::new([ScriptedContinuityResponse::Error]);
        assert_eq!(
            resolve_continuity_fail_soft(&provider, &base_request)
                .await
                .layers[0]
                .status,
            ContinuityLayerStatusV1::Unavailable
        );

        let mut invalid = request();
        invalid.max_packet_bytes =
            SafeU53::new((MAX_CONTINUITY_PACKET_BYTES + 1) as u64).expect("safe integer");
        let provider = ScriptedContinuityProvider::default();
        assert_eq!(
            resolve_continuity_fail_soft(&provider, &invalid)
                .await
                .layers[0]
                .status,
            ContinuityLayerStatusV1::Invalid
        );
    }

    #[tokio::test(start_paused = true)]
    async fn expiry_and_three_second_deadline_become_timeout() {
        let mut expired = request();
        expired.deadline_unix_ms = SafeU53::new(1).expect("safe deadline");
        let provider = ScriptedContinuityProvider::default();
        assert_eq!(
            resolve_continuity_fail_soft(&provider, &expired)
                .await
                .layers[0]
                .status,
            ContinuityLayerStatusV1::Timeout
        );

        let request = request();
        let provider = Arc::new(ScriptedContinuityProvider::new([
            ScriptedContinuityResponse::Delayed {
                delay: Duration::from_secs(4),
                result: result_for(&request, ContinuityLayerStatusV1::Empty),
            },
        ]));
        let task_provider = Arc::clone(&provider);
        let task_request = request.clone();
        let task = tokio::spawn(async move {
            resolve_continuity_fail_soft(task_provider.as_ref(), &task_request).await
        });
        tokio::task::yield_now().await;
        tokio::time::advance(CONTINUITY_RESOLUTION_TIMEOUT).await;
        assert_eq!(
            task.await.expect("resolution task").layers[0].status,
            ContinuityLayerStatusV1::Timeout
        );
    }
}
