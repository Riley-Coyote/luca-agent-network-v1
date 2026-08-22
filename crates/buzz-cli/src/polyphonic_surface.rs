//! Body-free requests that open an owner-reviewed Polyphonic surface.

use buzz_core::observer::{encrypt_observer_payload, OBSERVER_FRAME_TELEMETRY};
use nostr::{Event, Keys, PublicKey};
use serde::Serialize;

use crate::{error::CliError, PolyphonicSurfaceArg};

const REQUEST_KIND: &str = "polyphonic_surface_request";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SurfaceRequest {
    #[serde(rename = "type")]
    request_type: &'static str,
    request_id: String,
    channel_id: String,
    surface: PolyphonicSurfaceArg,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ObserverEvent {
    seq: u64,
    timestamp: String,
    kind: &'static str,
    agent_index: Option<usize>,
    channel_id: Option<String>,
    session_id: Option<String>,
    turn_id: Option<String>,
    payload: SurfaceRequest,
}

pub struct BuiltSurfaceRequest {
    pub event: Event,
    pub request_id: String,
}

pub fn build_surface_request(
    keys: &Keys,
    owner: &PublicKey,
    channel_id: String,
    surface: PolyphonicSurfaceArg,
) -> Result<BuiltSurfaceRequest, CliError> {
    let channel_id = channel_id.trim().to_owned();
    uuid::Uuid::parse_str(&channel_id)
        .map_err(|_| CliError::Usage(format!("invalid channel UUID: {channel_id}")))?;
    let request_id = uuid::Uuid::new_v4().to_string();
    let payload = ObserverEvent {
        seq: 0,
        timestamp: chrono::Utc::now().to_rfc3339(),
        kind: REQUEST_KIND,
        agent_index: None,
        channel_id: Some(channel_id.clone()),
        session_id: None,
        turn_id: None,
        payload: SurfaceRequest {
            request_type: REQUEST_KIND,
            request_id: request_id.clone(),
            channel_id,
            surface,
        },
    };
    let encrypted = encrypt_observer_payload(keys, owner, &payload)
        .map_err(|error| CliError::Other(format!("could not encrypt surface request: {error}")))?;
    let event = buzz_sdk::build_agent_observer_frame(
        &owner.to_hex(),
        &keys.public_key().to_hex(),
        OBSERVER_FRAME_TELEMETRY,
        &encrypted,
    )
    .map_err(|error| CliError::Other(format!("could not build surface request: {error}")))?
    .sign_with_keys(keys)
    .map_err(|error| CliError::Other(format!("could not sign surface request: {error}")))?;
    Ok(BuiltSurfaceRequest { event, request_id })
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::observer::decrypt_observer_payload;

    #[test]
    fn request_is_owner_encrypted_and_body_free() {
        let agent = Keys::generate();
        let owner = Keys::generate();
        let built = build_surface_request(
            &agent,
            &owner.public_key(),
            "7c07e659-3610-42f4-9a5e-1e9973c09da9".into(),
            PolyphonicSurfaceArg::Access,
        )
        .unwrap();
        let decrypted: serde_json::Value = decrypt_observer_payload(&owner, &built.event).unwrap();
        assert_eq!(decrypted["payload"]["surface"], "access");
        assert_eq!(decrypted["payload"].as_object().unwrap().len(), 4);
    }
}
