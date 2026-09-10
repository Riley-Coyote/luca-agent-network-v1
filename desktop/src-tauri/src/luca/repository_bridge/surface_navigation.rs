//! Fixed, review-only navigation through the existing scoped desktop broker.

use super::*;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum ReviewSurface {
    Onboarding,
    Runtime,
    NativeAgents,
    Brain,
    Profile,
    Appearance,
    Recovery,
    Access,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OpenSurfaceArgs {
    surface: ReviewSurface,
}

pub(super) fn request(
    app: &AppHandle,
    context: &BrokerContext,
    conversation_id: &OpaqueId,
    arguments: Value,
) -> Result<RepositoryBrokerResponseV1, String> {
    let args: OpenSurfaceArgs = serde_json::from_value(arguments)
        .map_err(|_| "review surface arguments are invalid".to_owned())?;
    uuid::Uuid::parse_str(conversation_id.as_str())
        .map_err(|_| "review conversation is invalid".to_owned())?;
    let state = app.state::<crate::app_state::AppState>();
    if state.signing_keys()?.public_key().to_hex() != context.owner_pubkey.as_str() {
        return Err("review owner has changed".into());
    }
    // The broker has already verified the live, conversation-scoped capability.
    // Resolve identity from that scope, never from model-supplied parameters.
    let request_id = uuid::Uuid::new_v4().to_string();
    app.emit(
        "polyphonic-native-surface-request",
        serde_json::json!({
            "agentPubkey": context.resident_pubkey.as_str(),
            "observerChannelId": conversation_id.as_str(),
            "request": {
                "type": "polyphonic_surface_request",
                "requestId": request_id,
                "channelId": conversation_id.as_str(),
                "surface": args.surface,
            },
        }),
    )
    .map_err(|_| "the desktop could not receive the review request".to_owned())?;
    Ok(RepositoryBrokerResponseV1 {
        protocol: BROKER_PROTOCOL,
        ok: true,
        content: serde_json::json!({
            "requestId": request_id,
            "requested": true,
            "connected": false,
            "imported": false,
            "message": "Review requested in Polyphonic. The owner must review and confirm any connection or change.",
        }).to_string(),
        receipt: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn review_navigation_accepts_only_fixed_surfaces_without_authority_or_paths() {
        for surface in [
            "onboarding",
            "runtime",
            "native_agents",
            "brain",
            "profile",
            "appearance",
            "recovery",
            "access",
        ] {
            assert!(serde_json::from_value::<OpenSurfaceArgs>(
                serde_json::json!({"surface": surface})
            )
            .is_ok());
        }
        for invalid in [
            serde_json::json!({"surface": "connect"}),
            serde_json::json!({"surface": "brain", "path": "/private"}),
            serde_json::json!({"surface": "brain", "agentPubkey": "forged"}),
            serde_json::json!({"surface": "brain", "channelId": "other"}),
            serde_json::json!({"surface": "brain", "approved": true}),
        ] {
            assert!(serde_json::from_value::<OpenSurfaceArgs>(invalid).is_err());
        }
    }
}
