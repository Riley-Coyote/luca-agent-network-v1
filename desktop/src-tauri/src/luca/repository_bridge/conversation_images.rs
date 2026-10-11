//! Authenticated attachment delivery. No arbitrary URL proxy, credentials,
//! filesystem search or cross-conversation media lookup is exposed to models.
use crate::luca::resident_proposals::{verify_origin, ResidentProposalScope};
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    url: String,
}

fn owner_attachment(event: &nostr::Event, scope: &ResidentProposalScope, url: &str) -> bool {
    event.kind.as_u16() == 9
        && event.pubkey.to_hex() == scope.owner.as_str()
        && event.verify().is_ok()
        && event.tags.iter().any(|tag| {
            let t = tag.as_slice();
            t.len() == 2 && t[0] == "h" && t[1] == scope.conversation.as_str()
        })
        && event.tags.iter().any(|tag| {
            let t = tag.as_slice();
            t.first().is_some_and(|v| v == "imeta")
                && t.iter().any(|v| v.strip_prefix("url ") == Some(url))
        })
}

pub(super) fn read(
    app: &AppHandle,
    scope: &ResidentProposalScope,
    arguments: Value,
) -> Result<String, String> {
    let request: Request = serde_json::from_value(arguments)
        .map_err(|_| "Supply the exact image URL from this conversation.")?;
    if request.url.len() > 4096 {
        return Err("Image reference is too long.".into());
    }
    verify_origin(app, scope)?;
    let state = app.state::<crate::app_state::AppState>();
    let bytes = tauri::async_runtime::block_on(async {
        tokio::time::timeout(std::time::Duration::from_secs(30),async {
            let events=crate::relay::query_relay(&state,&[json!({"kinds":[9],"authors":[scope.owner.as_str()],"#h":[scope.conversation.as_str()],"limit":64})]).await?;
            if !events.iter().any(|event|owner_attachment(event,scope,&request.url)) {
                return Err("This image was not found among the owner's recent attachments in this conversation. Ask them to attach it here again; do not search personal folders.".into());
            }
            crate::commands::media_download::read_conversation_image_bytes(&request.url,&state).await
        }).await.map_err(|_|"The attachment read timed out.".to_owned())?
    })?;
    verify_origin(app, scope)?;
    // The MCP consumer decodes/resizes and returns an actual image content block,
    // not base64 text for the model. The source bytes never enter receipts/logs.
    Ok(json!({"image_base64":base64::engine::general_purpose::STANDARD.encode(bytes)}).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use luca_protocol::{Hex64, OpaqueId, SafeU53, Sha256Ref};
    use std::sync::{atomic::AtomicBool, Arc};
    #[test]
    fn image_authority_requires_signed_owner_attachment_in_exact_conversation() {
        let keys = nostr::Keys::generate();
        let scope = ResidentProposalScope {
            owner: Hex64::parse(keys.public_key().to_hex()).unwrap(),
            resident: Hex64::parse("ab".repeat(32)).unwrap(),
            session_epoch: SafeU53::new(1).unwrap(),
            binding: Sha256Ref::parse(format!("sha256:{}", "ab".repeat(32))).unwrap(),
            conversation: OpaqueId::parse("room-a").unwrap(),
            active: Arc::new(AtomicBool::new(true)),
        };
        let url = "https://relay.example/media/test.png";
        let event = nostr::EventBuilder::new(nostr::Kind::from(9), "An attached picture")
            .tags([
                nostr::Tag::parse(["h", "room-a"]).unwrap(),
                nostr::Tag::parse(["imeta", &format!("url {url}")]).unwrap(),
            ])
            .sign_with_keys(&keys)
            .unwrap();
        assert!(owner_attachment(&event, &scope, url));
        assert!(!owner_attachment(
            &event,
            &scope,
            "https://relay.example/media/other.png"
        ));
        let mut other = scope.clone();
        other.conversation = OpaqueId::parse("room-b").unwrap();
        assert!(!owner_attachment(&event, &other, url));
        other = scope;
        other.owner = Hex64::parse("cd".repeat(32)).unwrap();
        assert!(!owner_attachment(&event, &other, url));
    }
}
