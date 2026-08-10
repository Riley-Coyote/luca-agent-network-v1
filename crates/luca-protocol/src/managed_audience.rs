//! Strict managed-resident activation intent for one owner message.

use crate::Hex64;
use serde::{Deserialize, Deserializer, Serialize};

/// Maximum residents that one owner action may ask the desktop to activate.
pub const MAX_MANAGED_AUDIENCE_RESIDENTS: usize = 64;

/// Which app-owned residents may be activated by one owner message.
///
/// This contract is deliberately independent from transport delivery. The
/// ordinary signed event remains visible according to its channel and `p`
/// tags; this value only constrains desktop-owned managed turn staging.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum ManagedAudienceIntentV1 {
    /// Activate the exact resident snapshot for an ordinary conversation turn.
    Conversation {
        /// Exact resident public keys selected by the production composer.
        resident_pubkeys: Vec<Hex64>,
    },
    /// Activate only the exact addressed resident snapshot.
    Directed {
        /// Parent author plus any explicitly mentioned managed residents.
        resident_pubkeys: Vec<Hex64>,
    },
    /// Publish the message without activating a managed resident.
    None,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawManagedAudienceIntentV1 {
    mode: ManagedAudienceModeV1,
    resident_pubkeys: Option<Vec<Hex64>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum ManagedAudienceModeV1 {
    Conversation,
    Directed,
    None,
}

impl ManagedAudienceIntentV1 {
    /// Consume the intent and return its requested resident public keys.
    pub fn into_resident_pubkeys(self) -> Vec<Hex64> {
        match self {
            Self::Conversation { resident_pubkeys } | Self::Directed { resident_pubkeys } => {
                resident_pubkeys
            }
            Self::None => Vec::new(),
        }
    }
}

impl<'de> Deserialize<'de> for ManagedAudienceIntentV1 {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = RawManagedAudienceIntentV1::deserialize(deserializer)?;
        let intent = match (raw.mode, raw.resident_pubkeys) {
            (ManagedAudienceModeV1::Conversation, Some(resident_pubkeys)) => {
                Self::Conversation { resident_pubkeys }
            }
            (ManagedAudienceModeV1::Directed, Some(resident_pubkeys)) => {
                Self::Directed { resident_pubkeys }
            }
            (ManagedAudienceModeV1::None, None) => Self::None,
            (ManagedAudienceModeV1::None, Some(_)) => {
                return Err(serde::de::Error::custom(
                    "none audience must not contain resident_pubkeys",
                ));
            }
            (_, None) => {
                return Err(serde::de::Error::missing_field("resident_pubkeys"));
            }
        };
        let count = match &intent {
            Self::Conversation { resident_pubkeys } | Self::Directed { resident_pubkeys } => {
                resident_pubkeys.len()
            }
            Self::None => 0,
        };
        if count > MAX_MANAGED_AUDIENCE_RESIDENTS {
            return Err(serde::de::Error::custom(
                "managed audience exceeds its resident limit",
            ));
        }
        Ok(intent)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(value: char) -> String {
        value.to_string().repeat(64)
    }

    #[test]
    fn rejects_unknown_fields_and_invalid_pubkeys() {
        let unknown = serde_json::json!({ "mode": "none", "prompt": "private" });
        assert!(serde_json::from_value::<ManagedAudienceIntentV1>(unknown).is_err());

        let invalid = serde_json::json!({
            "mode": "directed",
            "resident_pubkeys": ["not-a-pubkey"]
        });
        assert!(serde_json::from_value::<ManagedAudienceIntentV1>(invalid).is_err());
    }

    #[test]
    fn accepts_a_bounded_exact_snapshot() {
        let intent: ManagedAudienceIntentV1 = serde_json::from_value(serde_json::json!({
            "mode": "conversation",
            "resident_pubkeys": [key('a'), key('b')]
        }))
        .expect("bounded audience should parse");
        assert_eq!(intent.into_resident_pubkeys().len(), 2);
    }

    #[test]
    fn rejects_oversized_snapshots() {
        let intent = serde_json::json!({
            "mode": "conversation",
            "resident_pubkeys": vec![key('a'); MAX_MANAGED_AUDIENCE_RESIDENTS + 1]
        });
        assert!(serde_json::from_value::<ManagedAudienceIntentV1>(intent).is_err());
    }
}
