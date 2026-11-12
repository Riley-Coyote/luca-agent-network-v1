//! Exact host-issued turn proof for the local runtime-task proposal transport.

use crate::{canonical_sha256, Hex64, OpaqueId, SafeU53, Sha256Ref};
use hmac::{Hmac, KeyInit, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use subtle::ConstantTimeEq;

/// A gate captures this lease once per call; it never adopts a later turn.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeTaskTurnProofV1 {
    /// Exact signed owner trigger, not a model-supplied event selection.
    pub trigger_event_id: Hex64,
    /// Host logical turn identity.
    pub turn_id: OpaqueId,
    /// Exact managed session cancellation epoch.
    pub cancellation_epoch: SafeU53,
    /// Monotonic gate lease generation within this managed process.
    pub lease_generation: SafeU53,
    /// Domain-separated HMAC over scope, lease and canonical arguments.
    pub signature: Sha256Ref,
}

/// Derive a domain-separated HMAC using the existing local session capability.
/// This is never the conversation capability exposed to a model descendant.
pub fn runtime_task_turn_signature(
    master: &Sha256Ref,
    resident: &Hex64,
    session_epoch: SafeU53,
    binding: &Sha256Ref,
    conversation: &OpaqueId,
    proof: &RuntimeTaskTurnProofV1,
    arguments: &serde_json::Value,
) -> Result<Sha256Ref, String> {
    if proof.lease_generation.get() == 0 || proof.cancellation_epoch != session_epoch {
        return Err("Runtime task turn lease is invalid.".into());
    }
    let material = canonical_sha256(&serde_json::json!({
        "domain": "luca.repository.runtime-task-turn.v1",
        "operation": "propose_runtime_task",
        "resident": resident, "session_epoch": session_epoch, "binding": binding,
        "conversation": conversation, "trigger": proof.trigger_event_id,
        "turn": proof.turn_id, "epoch": proof.cancellation_epoch,
        "generation": proof.lease_generation, "arguments": arguments,
    }))
    .map_err(|_| "Runtime task turn proof is invalid.".to_owned())?;
    let mut mac = Hmac::<Sha256>::new_from_slice(master.as_str().as_bytes())
        .map_err(|_| "Runtime task turn key is invalid.")?;
    mac.update(material.as_bytes());
    let signature = format!("sha256:{}", hex::encode(mac.finalize().into_bytes()));
    Sha256Ref::parse(signature).map_err(|_| "Runtime task turn proof is invalid.".into())
}

/// Verify without short-circuit comparison of secret-derived signature bytes.
pub fn runtime_task_turn_signature_matches(expected: &Sha256Ref, presented: &Sha256Ref) -> bool {
    bool::from(
        expected
            .as_str()
            .as_bytes()
            .ct_eq(presented.as_str().as_bytes()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn proof_binds_exact_turn_arguments_generation_and_session() {
        let hash = |byte: &str| Sha256Ref::parse(format!("sha256:{}", byte.repeat(32))).unwrap();
        let master = hash("11");
        let binding = hash("22");
        let resident = Hex64::parse("33".repeat(32)).unwrap();
        let epoch = SafeU53::new(7).unwrap();
        let conversation = OpaqueId::parse("home").unwrap();
        let mut proof = RuntimeTaskTurnProofV1 {
            trigger_event_id: Hex64::parse("44".repeat(32)).unwrap(),
            turn_id: OpaqueId::parse("turn-1").unwrap(),
            cancellation_epoch: epoch,
            lease_generation: SafeU53::new(1).unwrap(),
            signature: hash("00"),
        };
        let args = serde_json::json!({"purpose":"ask"});
        let first = runtime_task_turn_signature(
            &master,
            &resident,
            epoch,
            &binding,
            &conversation,
            &proof,
            &args,
        )
        .unwrap();
        // Independent RFC 8785 + HMAC-SHA-256 fixture (Node crypto).
        assert_eq!(
            first.as_str(),
            "sha256:9fff55aee7da0005ae202c4de4e160c95e6fbb0709b844953bdd730f8ab5655b"
        );
        proof.turn_id = OpaqueId::parse("turn-2").unwrap();
        assert_ne!(
            first,
            runtime_task_turn_signature(
                &master,
                &resident,
                epoch,
                &binding,
                &conversation,
                &proof,
                &args
            )
            .unwrap()
        );
        proof.turn_id = OpaqueId::parse("turn-1").unwrap();
        assert_ne!(
            first,
            runtime_task_turn_signature(
                &master,
                &resident,
                epoch,
                &binding,
                &conversation,
                &proof,
                &serde_json::json!({"purpose":"work"})
            )
            .unwrap()
        );
        proof.lease_generation = SafeU53::new(2).unwrap();
        assert_ne!(
            first,
            runtime_task_turn_signature(
                &master,
                &resident,
                epoch,
                &binding,
                &conversation,
                &proof,
                &args
            )
            .unwrap()
        );
        assert!(runtime_task_turn_signature(
            &master,
            &resident,
            SafeU53::new(8).unwrap(),
            &binding,
            &conversation,
            &proof,
            &args
        )
        .is_err());
    }
}
