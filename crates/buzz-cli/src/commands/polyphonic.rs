use nostr::PublicKey;

use crate::client::BuzzClient;
use crate::error::CliError;
use crate::polyphonic_surface::build_surface_request;
use crate::PolyphonicCmd;

pub async fn dispatch(command: PolyphonicCmd, client: &BuzzClient) -> Result<(), CliError> {
    match command {
        PolyphonicCmd::Open { channel, surface } => {
            let owner = require_owner(client)?;
            let surface_name = surface.to_string();
            let built = build_surface_request(client.keys(), &owner, channel, surface)?;
            let response = client.publish_ephemeral_event(built.event).await?;
            let mut output: serde_json::Value = serde_json::from_str(&response)
                .map_err(|error| CliError::Other(format!("invalid relay response: {error}")))?;
            if let Some(object) = output.as_object_mut() {
                object.insert("request_id".into(), built.request_id.into());
                object.insert("surface".into(), surface_name.into());
                object.insert("opened".into(), true.into());
                object.insert(
                    "message".into(),
                    "Requested the owner-scoped Polyphonic surface.".into(),
                );
            }
            println!("{output}");
            Ok(())
        }
    }
}

fn require_owner(client: &BuzzClient) -> Result<PublicKey, CliError> {
    let hex = client.auth_tag_owner_hex().ok_or_else(|| {
        CliError::Auth("Polyphonic surface requests require BUZZ_AUTH_TAG".into())
    })?;
    PublicKey::parse(&hex)
        .map_err(|error| CliError::Auth(format!("invalid owner attestation: {error}")))
}
