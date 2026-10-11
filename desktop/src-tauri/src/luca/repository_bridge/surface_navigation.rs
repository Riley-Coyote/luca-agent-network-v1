//! Fixed, review-only navigation through the existing scoped desktop broker.

use super::*;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum ReviewSurface {
    Onboarding,
    Companion,
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
    active: &Arc<AtomicBool>,
    caller: &UnixStream,
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
    let dispatch_store = crate::luca::managed_dispatch_store::global_dispatch_store(app)?;
    let turn = dispatch_store
        .lock()
        .map_err(|_| "App control is unavailable.")?
        .resolve_unique_cancellable(
            context.owner_pubkey.as_str(),
            conversation_id.as_str(),
            context.resident_pubkey.as_str(),
        )
        .map_err(|_| "App navigation requires one active conversation turn.")?;
    if turn.session_epoch != context.session_epoch.get() {
        return Err("App control session has changed.".into());
    }
    let mut probe = caller
        .try_clone()
        .map_err(|_| "App control caller is unavailable.")?;
    probe
        .set_read_timeout(Some(Duration::from_millis(1)))
        .map_err(|_| "App control caller cannot be monitored.")?;
    let status = crate::luca::surface_control::request(
        app,
        crate::luca::surface_control::ControlScope {
            owner: context.owner_pubkey.as_str().into(),
            resident: context.resident_pubkey.as_str().into(),
            conversation: conversation_id.as_str().into(),
            epoch: context.session_epoch.get(),
            dispatch: turn.dispatch_receipt_id,
        },
        Arc::clone(active),
        &request_id,
        serde_json::json!({
            "controlRequestId": request_id,
            "agentPubkey": context.resident_pubkey.as_str(),
            "observerChannelId": conversation_id.as_str(),
            "request": {
                "type": "polyphonic_surface_request",
                "requestId": request_id,
                "channelId": conversation_id.as_str(),
                "surface": args.surface,
            },
        }),
        || crate::luca::resident_proposals::caller_disconnected(&mut probe),
    )?;
    let completed = status == crate::luca::surface_control::ControlStatus::Completed;
    Ok(RepositoryBrokerResponseV1 {
        protocol: BROKER_PROTOCOL,
        ok: completed,
        content: serde_json::json!({
            "requestId": request_id,
            "requested": true,
            "opened": completed,
            "status": status,
            "connected": false,
            "imported": false,
            "message": if completed { "Review opened in Polyphonic. Opening it did not save settings or grant permission." } else { "App navigation was stopped or failed. Continue in chat; do not retry this turn." },
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
            "companion",
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
