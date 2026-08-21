use nostr::PublicKey;

use crate::brain_review::build_brain_review;
use crate::client::BuzzClient;
use crate::error::CliError;
use crate::BrainCmd;

pub async fn dispatch(command: BrainCmd, client: &BuzzClient) -> Result<(), CliError> {
    match command {
        BrainCmd::DraftReview { channel } => {
            let owner = require_owner(client)?;
            let built = build_brain_review(client.keys(), &owner, channel)?;
            let response = client.publish_ephemeral_event(built.event).await?;
            let mut output: serde_json::Value = serde_json::from_str(&response)
                .map_err(|error| CliError::Other(format!("invalid relay response: {error}")))?;
            if let Some(object) = output.as_object_mut() {
                object.insert("request_id".into(), built.request_id.into());
                object.insert("connected".into(), false.into());
                object.insert(
                    "message".into(),
                    "Brain review opened in Polyphonic. Nothing connects until the owner confirms it."
                        .into(),
                );
            }
            println!("{output}");
            Ok(())
        }
    }
}

fn require_owner(client: &BuzzClient) -> Result<PublicKey, CliError> {
    let hex = client
        .auth_tag_owner_hex()
        .ok_or_else(|| CliError::Auth("Brain review requests require BUZZ_AUTH_TAG".into()))?;
    PublicKey::parse(&hex)
        .map_err(|error| CliError::Auth(format!("invalid owner attestation: {error}")))
}
