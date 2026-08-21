//! Agent-neutral, bounded artifact and Canvas tool contracts.
//!
//! Tool-visible arguments intentionally omit authority fields. The managed ACP
//! host binds owner, resident, session, turn, conversation, and working root
//! before forwarding an operation to the desktop-owned artifact broker.

use serde::{Deserialize, Serialize};

use crate::{Hex64, OpaqueId, SafeU53};

pub const ARTIFACT_TOOL_PROTOCOL: &str = "luca.artifact.tool.v1";
pub const MAX_ARTIFACT_TITLE_CHARS: usize = 160;
pub const MAX_ARTIFACT_INLINE_BYTES: usize = 5 * 1024 * 1024;
pub const MAX_ARTIFACT_FILE_BYTES: u64 = 100 * 1024 * 1024;
pub const MAX_ARTIFACT_READ_BYTES: usize = 256 * 1024;
pub const MAX_ARTIFACT_LIST_ITEMS: u16 = 100;
pub const MAX_ARTIFACT_RELATIVE_PATH_BYTES: usize = 1024;
pub const MAX_PREVIEW_URL_BYTES: usize = 2048;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactKindV1 {
    Html,
    Markdown,
    Text,
    Code,
    Image,
    Svg,
    Pdf,
    File,
    App,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactReceiptStateV1 {
    Provisional,
    Linked,
    Interrupted,
    Orphaned,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactReadModeV1 {
    Metadata,
    BoundedText,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "source_type", rename_all = "snake_case")]
pub enum ArtifactSourceV1 {
    InlineText {
        content_utf8: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        declared_media_type: Option<String>,
    },
    WorkspaceFile {
        relative_path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        declared_media_type: Option<String>,
    },
    WorkspaceDirectory {
        relative_path: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArtifactCreateArgsV1 {
    pub title: String,
    pub kind: ArtifactKindV1,
    pub source: ArtifactSourceV1,
    pub idempotency_key: OpaqueId,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArtifactUpdateArgsV1 {
    pub artifact_id: OpaqueId,
    pub expected_current_version: SafeU53,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub source: ArtifactSourceV1,
    pub idempotency_key: OpaqueId,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArtifactReadArgsV1 {
    pub artifact_id: OpaqueId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<SafeU53>,
    pub mode: ArtifactReadModeV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArtifactListArgsV1 {
    pub limit: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CanvasPresentArgsV1 {
    pub artifact_id: OpaqueId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<SafeU53>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PreviewAttachArgsV1 {
    pub artifact_id: OpaqueId,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PreviewDetachArgsV1 {
    pub preview_session_id: OpaqueId,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "operation", content = "arguments", rename_all = "snake_case")]
pub enum ArtifactToolOperationV1 {
    ArtifactCreate(ArtifactCreateArgsV1),
    ArtifactUpdate(ArtifactUpdateArgsV1),
    ArtifactRead(ArtifactReadArgsV1),
    ArtifactList(ArtifactListArgsV1),
    CanvasPresent(CanvasPresentArgsV1),
    PreviewAttach(PreviewAttachArgsV1),
    PreviewDetach(PreviewDetachArgsV1),
}

/// Host-only authority binding. This value is never accepted from tool input.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArtifactBrokerBindingV1 {
    pub owner_pubkey: Hex64,
    pub resident_pubkey: Hex64,
    pub session_epoch: SafeU53,
    pub turn_id: OpaqueId,
    pub conversation_id: OpaqueId,
    /// Durable dispatch coordinate used to reject stale or duplicated turn labels.
    pub dispatch_receipt_id: OpaqueId,
    /// Desktop cancellation generation captured when the turn is authorized.
    pub cancellation_epoch: SafeU53,
    /// Opaque handle for a desktop-owned canonical working root.
    pub working_root_id: OpaqueId,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArtifactToolRequestV1 {
    pub protocol: String,
    pub request_id: OpaqueId,
    pub binding: ArtifactBrokerBindingV1,
    pub operation: ArtifactToolOperationV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArtifactMetadataV1 {
    pub artifact_id: OpaqueId,
    pub title: String,
    pub kind: ArtifactKindV1,
    pub current_version: SafeU53,
    pub receipt_state: ArtifactReceiptStateV1,
    pub deleted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "result", rename_all = "snake_case")]
pub enum ArtifactToolOutcomeV1 {
    Committed {
        artifact: ArtifactMetadataV1,
        duplicate: bool,
    },
    Read {
        artifact: ArtifactMetadataV1,
        #[serde(skip_serializing_if = "Option::is_none")]
        content_utf8: Option<String>,
        truncated: bool,
    },
    Listed {
        artifacts: Vec<ArtifactMetadataV1>,
    },
    Presented {
        artifact_id: OpaqueId,
        version: SafeU53,
    },
    PreviewAttached {
        preview_session_id: OpaqueId,
        artifact_id: OpaqueId,
        url: String,
    },
    PreviewDetached {
        preview_session_id: OpaqueId,
    },
    Conflict {
        artifact_id: OpaqueId,
        current_version: SafeU53,
    },
    Rejected {
        code: String,
        message: String,
    },
    Failed {
        code: String,
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArtifactToolResultV1 {
    pub protocol: String,
    pub request_id: OpaqueId,
    pub outcome: ArtifactToolOutcomeV1,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ArtifactProtocolError {
    #[error("artifact protocol is invalid")]
    Protocol,
    #[error("artifact title is invalid")]
    Title,
    #[error("artifact source is invalid")]
    Source,
    #[error("artifact operation exceeds a bound")]
    Bounds,
    #[error("application artifacts require a workspace directory source")]
    AppSource,
    #[error("artifact broker binding is invalid")]
    Binding,
}

fn valid_title(title: &str) -> bool {
    let trimmed = title.trim();
    !trimmed.is_empty() && trimmed.chars().count() <= MAX_ARTIFACT_TITLE_CHARS
}

fn valid_relative_path(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= MAX_ARTIFACT_RELATIVE_PATH_BYTES
        && !path.starts_with('/')
        && !path.starts_with('\\')
        && !path.contains('\0')
        && !path.split(['/', '\\']).any(|part| part == "..")
        && !(path.len() >= 2 && path.as_bytes()[1] == b':')
}

impl ArtifactSourceV1 {
    pub fn validate(&self) -> Result<(), ArtifactProtocolError> {
        match self {
            Self::InlineText {
                content_utf8,
                declared_media_type,
            } => {
                if content_utf8.len() > MAX_ARTIFACT_INLINE_BYTES
                    || declared_media_type
                        .as_ref()
                        .is_some_and(|value| value.len() > 256)
                {
                    return Err(ArtifactProtocolError::Bounds);
                }
            }
            Self::WorkspaceFile {
                relative_path,
                declared_media_type,
            } => {
                if !valid_relative_path(relative_path)
                    || declared_media_type
                        .as_ref()
                        .is_some_and(|value| value.len() > 256)
                {
                    return Err(ArtifactProtocolError::Source);
                }
            }
            Self::WorkspaceDirectory { relative_path } => {
                if !valid_relative_path(relative_path) {
                    return Err(ArtifactProtocolError::Source);
                }
            }
        }
        Ok(())
    }
}

impl ArtifactToolRequestV1 {
    pub fn validate(&self) -> Result<(), ArtifactProtocolError> {
        if self.protocol != ARTIFACT_TOOL_PROTOCOL {
            return Err(ArtifactProtocolError::Protocol);
        }
        if self.binding.cancellation_epoch != self.binding.session_epoch {
            return Err(ArtifactProtocolError::Binding);
        }
        match &self.operation {
            ArtifactToolOperationV1::ArtifactCreate(args) => {
                if !valid_title(&args.title) {
                    return Err(ArtifactProtocolError::Title);
                }
                args.source.validate()?;
                if args.kind == ArtifactKindV1::App
                    && !matches!(args.source, ArtifactSourceV1::WorkspaceDirectory { .. })
                {
                    return Err(ArtifactProtocolError::AppSource);
                }
                if args.kind != ArtifactKindV1::App
                    && matches!(args.source, ArtifactSourceV1::WorkspaceDirectory { .. })
                {
                    return Err(ArtifactProtocolError::Source);
                }
            }
            ArtifactToolOperationV1::ArtifactUpdate(args) => {
                if args.title.as_ref().is_some_and(|title| !valid_title(title)) {
                    return Err(ArtifactProtocolError::Title);
                }
                args.source.validate()?;
            }
            ArtifactToolOperationV1::ArtifactList(args)
                if args.limit == 0 || args.limit > MAX_ARTIFACT_LIST_ITEMS =>
            {
                return Err(ArtifactProtocolError::Bounds);
            }
            ArtifactToolOperationV1::PreviewAttach(args)
                if args.url.is_empty() || args.url.len() > MAX_PREVIEW_URL_BYTES =>
            {
                return Err(ArtifactProtocolError::Bounds);
            }
            _ => {}
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn binding() -> ArtifactBrokerBindingV1 {
        ArtifactBrokerBindingV1 {
            owner_pubkey: Hex64::parse("11".repeat(32)).unwrap(),
            resident_pubkey: Hex64::parse("22".repeat(32)).unwrap(),
            session_epoch: SafeU53::new(7).unwrap(),
            turn_id: OpaqueId::parse("turn-1").unwrap(),
            conversation_id: OpaqueId::parse("conversation-1").unwrap(),
            dispatch_receipt_id: OpaqueId::parse("dispatch-1").unwrap(),
            cancellation_epoch: SafeU53::new(7).unwrap(),
            working_root_id: OpaqueId::parse("root-1").unwrap(),
        }
    }

    fn request(operation: ArtifactToolOperationV1) -> ArtifactToolRequestV1 {
        ArtifactToolRequestV1 {
            protocol: ARTIFACT_TOOL_PROTOCOL.into(),
            request_id: OpaqueId::parse("request-1").unwrap(),
            binding: binding(),
            operation,
        }
    }

    #[test]
    fn app_requires_directory_source() {
        let value = request(ArtifactToolOperationV1::ArtifactCreate(
            ArtifactCreateArgsV1 {
                title: "Local app".into(),
                kind: ArtifactKindV1::App,
                source: ArtifactSourceV1::InlineText {
                    content_utf8: "hello".into(),
                    declared_media_type: None,
                },
                idempotency_key: OpaqueId::parse("idem-1").unwrap(),
            },
        ));
        assert_eq!(value.validate(), Err(ArtifactProtocolError::AppSource));
    }

    #[test]
    fn traversal_is_rejected_before_desktop_resolution() {
        let value = request(ArtifactToolOperationV1::ArtifactCreate(
            ArtifactCreateArgsV1 {
                title: "Escape".into(),
                kind: ArtifactKindV1::Code,
                source: ArtifactSourceV1::WorkspaceFile {
                    relative_path: "../secret".into(),
                    declared_media_type: None,
                },
                idempotency_key: OpaqueId::parse("idem-2").unwrap(),
            },
        ));
        assert_eq!(value.validate(), Err(ArtifactProtocolError::Source));
    }

    #[test]
    fn loopback_policy_is_not_decided_by_tool_input_validation() {
        let value = request(ArtifactToolOperationV1::PreviewAttach(
            PreviewAttachArgsV1 {
                artifact_id: OpaqueId::parse("artifact-1").unwrap(),
                url: "http://127.0.0.1:4173/app".into(),
            },
        ));
        assert_eq!(value.validate(), Ok(()));
    }

    #[test]
    fn cancellation_epoch_must_match_the_managed_session_epoch() {
        let mut value = request(ArtifactToolOperationV1::ArtifactList(ArtifactListArgsV1 {
            limit: 10,
        }));
        value.binding.cancellation_epoch = SafeU53::new(8).unwrap();
        assert_eq!(value.validate(), Err(ArtifactProtocolError::Binding));
    }
}
