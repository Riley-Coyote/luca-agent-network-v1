//! Owner-reviewed Brain navigation requests published through observer frames.

use buzz_core::observer::{encrypt_observer_payload, OBSERVER_FRAME_TELEMETRY};
use nostr::{Event, Keys, PublicKey};
use serde::Serialize;

use crate::error::CliError;

const REQUEST_KIND: &str = "brain_review_request";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrainReviewRequest {
    #[serde(rename = "type")]
    request_type: &'static str,
    request_id: String,
    channel_id: String,
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
    payload: BrainReviewRequest,
}

#[derive(Debug)]
pub struct BuiltBrainReviewRequest {
    pub event: Event,
    pub request_id: String,
}

pub fn build_brain_review(
    keys: &Keys,
    owner: &PublicKey,
    channel_id: String,
) -> Result<BuiltBrainReviewRequest, CliError> {
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
        payload: BrainReviewRequest {
            request_type: REQUEST_KIND,
            request_id: request_id.clone(),
            channel_id,
        },
    };
    let encrypted = encrypt_observer_payload(keys, owner, &payload)
        .map_err(|error| CliError::Other(format!("could not encrypt Brain review request: {error}")))?;
    let event = buzz_sdk::build_agent_observer_frame(
        &owner.to_hex(),
        &keys.public_key().to_hex(),
        OBSERVER_FRAME_TELEMETRY,
        &encrypted,
    )
    .map_err(|error| CliError::Other(format!("could not build Brain review request: {error}")))?
    .sign_with_keys(keys)
    .map_err(|error| CliError::Other(format!("could not sign Brain review request: {error}")))?;
    Ok(BuiltBrainReviewRequest { event, request_id })
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::observer::{decrypt_observer_payload, OBSERVER_AGENT_TAG, OBSERVER_FRAME_TAG};

    const CHANNEL: &str = "7c07e659-3610-42f4-9a5e-1e9973c09da9";

    #[test]
    fn review_is_owner_encrypted_and_contains_only_navigation_data() {
        let agent = Keys::generate();
        let owner = Keys::generate();
        let built = build_brain_review(&agent, &owner.public_key(), CHANNEL.into()).unwrap();

        assert_eq!(built.event.kind.as_u16(), 24_200);
        let tags: Vec<Vec<String>> = built
            .event
            .tags
            .iter()
            .map(|tag| tag.as_slice().to_vec())
            .collect();
        assert!(tags
            .iter()
            .any(|tag| tag == &["p", &owner.public_key().to_hex()]));
        assert!(tags
            .iter()
            .any(|tag| tag == &[OBSERVER_AGENT_TAG, &agent.public_key().to_hex()]));
        assert!(tags
            .iter()
            .any(|tag| tag == &[OBSERVER_FRAME_TAG, OBSERVER_FRAME_TELEMETRY]));

        let decrypted: serde_json::Value =
            decrypt_observer_payload(&owner, &built.event).unwrap();
        assert_eq!(decrypted["kind"], REQUEST_KIND);
        assert_eq!(decrypted["channelId"], CHANNEL);
        assert_eq!(decrypted["payload"]["type"], REQUEST_KIND);
        assert_eq!(decrypted["payload"]["channelId"], CHANNEL);
        assert_eq!(
            decrypted["payload"].as_object().unwrap().len(),
            3,
            "the review frame must carry only type, requestId, and channelId"
        );
    }

    #[test]
    fn review_rejects_invalid_channel() {
        let error = build_brain_review(
            &Keys::generate(),
            &Keys::generate().public_key(),
            "general".into(),
        )
        .unwrap_err();
        assert!(error.to_string().contains("invalid channel UUID"));
    }
}
