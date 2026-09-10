//! Durable storage and loopback-preview implementation for the artifact broker.

use crate::data_dir::BuzzPathExt;
use std::path::{Path, PathBuf};

use luca_protocol::{
    ArtifactBrokerBindingV1, ArtifactKindV1, ArtifactMetadataV1, ArtifactReadModeV1,
    ArtifactToolOperationV1, ArtifactToolOutcomeV1, ArtifactToolRequestV1, ArtifactToolResultV1,
    OpaqueId, SafeU53, ARTIFACT_TOOL_PROTOCOL,
};
use tauri::AppHandle;

use super::{
    artifact_bridge::ArtifactBrokerBackend,
    artifacts::{ArtifactRecord, ArtifactStore, ArtifactStoreError, ArtifactWriteContext},
};

/// Desktop-owned artifact backend shared by every compatible ACP runtime.
pub(crate) struct DesktopArtifactBackend {
    app: AppHandle,
    app_data_dir: PathBuf,
}

impl DesktopArtifactBackend {
    /// Resolve the owner-local storage root without opening a database or
    /// starting any preview process.
    pub(crate) fn new(app: &AppHandle) -> Result<Self, String> {
        let app_data_dir = app
            .buzz_path()
            .app_data_dir()
            .map_err(|_| "artifact storage root is unavailable".to_string())?;
        Ok(Self {
            app: app.clone(),
            app_data_dir,
        })
    }

    fn result(request_id: OpaqueId, outcome: ArtifactToolOutcomeV1) -> ArtifactToolResultV1 {
        ArtifactToolResultV1 {
            protocol: ARTIFACT_TOOL_PROTOCOL.into(),
            request_id,
            outcome,
        }
    }

    fn failed(request_id: OpaqueId, code: &str, message: &str) -> ArtifactToolResultV1 {
        Self::result(
            request_id,
            ArtifactToolOutcomeV1::Failed {
                code: code.into(),
                message: message.into(),
            },
        )
    }

    fn metadata(record: &ArtifactRecord) -> Result<ArtifactMetadataV1, String> {
        Ok(ArtifactMetadataV1 {
            artifact_id: OpaqueId::parse(record.artifact_id.clone())
                .map_err(|_| "stored artifact identity is invalid".to_string())?,
            title: record.title.clone(),
            kind: record.kind,
            current_version: SafeU53::new(record.current_version)
                .map_err(|_| "stored artifact version is invalid".to_string())?,
            receipt_state: record.receipt_state,
            deleted: record.deleted_at.is_some(),
        })
    }

    fn store_error(request_id: OpaqueId, error: ArtifactStoreError) -> ArtifactToolResultV1 {
        if let ArtifactStoreError::Conflict { current_version } = error {
            let Ok(current_version) = SafeU53::new(current_version) else {
                return Self::failed(
                    request_id,
                    "artifact-version-invalid",
                    "The current artifact version is invalid.",
                );
            };
            // The caller supplies the artifact id in the operation. This branch
            // is replaced by `conflict` where that coordinate is available.
            return Self::failed(
                request_id,
                "artifact-version-conflict",
                &format!("The artifact is now at version {}.", current_version.get()),
            );
        }
        let code = error.code();
        let message = match error {
            ArtifactStoreError::InvalidRequest
            | ArtifactStoreError::InvalidSource
            | ArtifactStoreError::UnsafePath
            | ArtifactStoreError::SourceMissing
            | ArtifactStoreError::WorkingRootUnavailable
            | ArtifactStoreError::TooLarge
            | ArtifactStoreError::MediaTypeMismatch
            | ArtifactStoreError::QuotaExceeded
            | ArtifactStoreError::IdempotencyReuse
            | ArtifactStoreError::NotFound
            | ArtifactStoreError::VersionNotFound
            | ArtifactStoreError::Unsupported => "The artifact request was rejected.",
            ArtifactStoreError::Unavailable
            | ArtifactStoreError::SchemaIncompatible
            | ArtifactStoreError::CorruptBlob => "Artifact storage is temporarily unavailable.",
            ArtifactStoreError::Conflict { .. } => "The artifact version changed.",
        };
        Self::failed(request_id, code, message)
    }

    fn dispatch_inner(
        &self,
        request: &ArtifactToolRequestV1,
        canonical_working_root: &Path,
    ) -> Result<ArtifactToolOutcomeV1, ArtifactStoreError> {
        let mut store = ArtifactStore::open(&self.app_data_dir)?;
        let context = ArtifactWriteContext::from_broker(&request.binding);
        require_artifact_conversation_scope(&store, &request.binding, &request.operation)?;
        match &request.operation {
            ArtifactToolOperationV1::ArtifactCreate(args) => {
                let commit = store.create(&context, args, Some(canonical_working_root))?;
                let artifact = Self::metadata(&commit.artifact)
                    .map_err(|_| ArtifactStoreError::SchemaIncompatible)?;
                Ok(ArtifactToolOutcomeV1::Committed {
                    artifact,
                    duplicate: commit.duplicate,
                })
            }
            ArtifactToolOperationV1::ArtifactUpdate(args) => {
                let commit = store.update(&context, args, Some(canonical_working_root))?;
                let artifact = Self::metadata(&commit.artifact)
                    .map_err(|_| ArtifactStoreError::SchemaIncompatible)?;
                Ok(ArtifactToolOutcomeV1::Committed {
                    artifact,
                    duplicate: commit.duplicate,
                })
            }
            ArtifactToolOperationV1::ArtifactRead(args) => {
                let preview = store.read(
                    &request.binding.owner_pubkey,
                    &args.artifact_id,
                    args.version,
                    args.mode,
                )?;
                let artifact = Self::metadata(&preview.artifact)
                    .map_err(|_| ArtifactStoreError::SchemaIncompatible)?;
                let content_utf8 = match preview.content {
                    Some(content) if args.mode == ArtifactReadModeV1::BoundedText => Some(
                        String::from_utf8(content).map_err(|_| ArtifactStoreError::CorruptBlob)?,
                    ),
                    _ => None,
                };
                Ok(ArtifactToolOutcomeV1::Read {
                    artifact,
                    content_utf8,
                    truncated: preview.truncated,
                })
            }
            ArtifactToolOperationV1::ArtifactList(args) => {
                let artifacts = store
                    .list_for_conversation(
                        &request.binding.owner_pubkey,
                        &request.binding.conversation_id,
                        args.limit,
                    )?
                    .iter()
                    .map(Self::metadata)
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|_| ArtifactStoreError::SchemaIncompatible)?;
                Ok(ArtifactToolOutcomeV1::Listed { artifacts })
            }
            ArtifactToolOperationV1::CanvasPresent(args) => {
                let artifact = store.get(&request.binding.owner_pubkey, &args.artifact_id)?;
                if artifact.deleted_at.is_some() {
                    return Err(ArtifactStoreError::NotFound);
                }
                let version = args.version.unwrap_or(
                    SafeU53::new(artifact.current_version)
                        .map_err(|_| ArtifactStoreError::SchemaIncompatible)?,
                );
                store.read(
                    &request.binding.owner_pubkey,
                    &args.artifact_id,
                    Some(version),
                    ArtifactReadModeV1::Metadata,
                )?;
                Ok(ArtifactToolOutcomeV1::Presented {
                    artifact_id: args.artifact_id.clone(),
                    version,
                })
            }
            ArtifactToolOperationV1::PreviewAttach(args) => {
                let artifact = store.get(&request.binding.owner_pubkey, &args.artifact_id)?;
                if artifact.kind != ArtifactKindV1::App || artifact.deleted_at.is_some() {
                    return Err(ArtifactStoreError::InvalidRequest);
                }
                drop(store);
                let session =
                    tauri::async_runtime::block_on(crate::commands::attach_preview_session(
                        &self.app,
                        &request.binding,
                        &args.artifact_id,
                        &args.url,
                    ))
                    .map_err(|_| ArtifactStoreError::InvalidRequest)?;
                let preview_session_id = OpaqueId::parse(session.id)
                    .map_err(|_| ArtifactStoreError::SchemaIncompatible)?;
                Ok(ArtifactToolOutcomeV1::PreviewAttached {
                    preview_session_id,
                    artifact_id: args.artifact_id.clone(),
                    url: session.display_url,
                })
            }
            ArtifactToolOperationV1::PreviewDetach(args) => {
                drop(store);
                crate::commands::detach_preview_session_for_binding(
                    &self.app,
                    &request.binding,
                    &args.preview_session_id,
                )
                .map_err(|_| ArtifactStoreError::InvalidRequest)?;
                Ok(ArtifactToolOutcomeV1::PreviewDetached {
                    preview_session_id: args.preview_session_id.clone(),
                })
            }
        }
    }
}

fn require_artifact_conversation_scope(
    store: &ArtifactStore,
    binding: &ArtifactBrokerBindingV1,
    operation: &ArtifactToolOperationV1,
) -> Result<(), ArtifactStoreError> {
    let artifact_id = match operation {
        ArtifactToolOperationV1::ArtifactUpdate(args) => Some(&args.artifact_id),
        ArtifactToolOperationV1::ArtifactRead(args) => Some(&args.artifact_id),
        ArtifactToolOperationV1::CanvasPresent(args) => Some(&args.artifact_id),
        ArtifactToolOperationV1::PreviewAttach(args) => Some(&args.artifact_id),
        ArtifactToolOperationV1::ArtifactCreate(_)
        | ArtifactToolOperationV1::ArtifactList(_)
        | ArtifactToolOperationV1::PreviewDetach(_) => None,
    };
    if let Some(artifact_id) = artifact_id {
        store.get_for_conversation(&binding.owner_pubkey, &binding.conversation_id, artifact_id)?;
    }
    Ok(())
}

impl ArtifactBrokerBackend for DesktopArtifactBackend {
    fn dispatch(
        &self,
        request: ArtifactToolRequestV1,
        canonical_working_root: &Path,
    ) -> ArtifactToolResultV1 {
        let request_id = request.request_id.clone();
        let conflict_artifact_id = match &request.operation {
            ArtifactToolOperationV1::ArtifactUpdate(args) => Some(args.artifact_id.clone()),
            _ => None,
        };
        match self.dispatch_inner(&request, canonical_working_root) {
            Ok(outcome) => Self::result(request_id, outcome),
            Err(ArtifactStoreError::Conflict { current_version }) => {
                let Some(artifact_id) = conflict_artifact_id else {
                    return Self::failed(
                        request_id,
                        "artifact-version-conflict",
                        "The artifact version changed.",
                    );
                };
                let Ok(current_version) = SafeU53::new(current_version) else {
                    return Self::failed(
                        request_id,
                        "artifact-version-invalid",
                        "The current artifact version is invalid.",
                    );
                };
                Self::result(
                    request_id,
                    ArtifactToolOutcomeV1::Conflict {
                        artifact_id,
                        current_version,
                    },
                )
            }
            Err(error) => Self::store_error(request_id, error),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use luca_protocol::{
        ArtifactCreateArgsV1, ArtifactReadArgsV1, ArtifactSourceV1, ArtifactUpdateArgsV1,
        CanvasPresentArgsV1, Hex64, PreviewAttachArgsV1,
    };

    fn binding(conversation: &str) -> ArtifactBrokerBindingV1 {
        ArtifactBrokerBindingV1 {
            owner_pubkey: Hex64::parse("11".repeat(32)).unwrap(),
            resident_pubkey: Hex64::parse("22".repeat(32)).unwrap(),
            session_epoch: SafeU53::new(7).unwrap(),
            turn_id: OpaqueId::parse("turn-1").unwrap(),
            conversation_id: OpaqueId::parse(conversation).unwrap(),
            dispatch_receipt_id: OpaqueId::parse("dispatch-1").unwrap(),
            cancellation_epoch: SafeU53::new(7).unwrap(),
            working_root_id: OpaqueId::parse("root-1").unwrap(),
        }
    }

    #[test]
    fn metadata_conversion_preserves_durable_identity_and_state() {
        let record = ArtifactRecord {
            artifact_id: "artifact-1".into(),
            title: "Diagram".into(),
            kind: ArtifactKindV1::Svg,
            current_version: 3,
            receipt_state: luca_protocol::ArtifactReceiptStateV1::Linked,
            lifecycle_state: "ready".into(),
            pinned: false,
            created_by_pubkey: "11".repeat(32),
            conversation_id: None,
            source_turn_id: None,
            created_at: "2026-08-21T00:00:00Z".into(),
            updated_at: "2026-08-21T00:00:00Z".into(),
            deleted_at: None,
        };
        let metadata = DesktopArtifactBackend::metadata(&record).unwrap();
        assert_eq!(metadata.artifact_id.as_str(), "artifact-1");
        assert_eq!(metadata.current_version.get(), 3);
        assert!(!metadata.deleted);
    }

    #[test]
    fn referenced_agent_operations_deny_cross_conversation_artifacts() {
        let temp = tempfile::tempdir().unwrap();
        let source_binding = binding("conversation-1");
        let foreign_binding = binding("conversation-2");
        let mut store = ArtifactStore::open(temp.path()).unwrap();
        let created = store
            .create(
                &ArtifactWriteContext::from_broker(&source_binding),
                &ArtifactCreateArgsV1 {
                    title: "Conversation one".into(),
                    kind: ArtifactKindV1::Html,
                    source: ArtifactSourceV1::InlineText {
                        content_utf8: "<h1>private</h1>".into(),
                        declared_media_type: Some("text/html".into()),
                    },
                    idempotency_key: OpaqueId::parse("scope-create").unwrap(),
                },
                None,
            )
            .unwrap();
        let artifact_id = OpaqueId::parse(created.artifact.artifact_id).unwrap();
        let operations = [
            ArtifactToolOperationV1::ArtifactUpdate(ArtifactUpdateArgsV1 {
                artifact_id: artifact_id.clone(),
                expected_current_version: SafeU53::new(1).unwrap(),
                title: None,
                source: ArtifactSourceV1::InlineText {
                    content_utf8: "changed".into(),
                    declared_media_type: None,
                },
                idempotency_key: OpaqueId::parse("scope-update").unwrap(),
            }),
            ArtifactToolOperationV1::ArtifactRead(ArtifactReadArgsV1 {
                artifact_id: artifact_id.clone(),
                version: None,
                mode: ArtifactReadModeV1::Metadata,
            }),
            ArtifactToolOperationV1::CanvasPresent(CanvasPresentArgsV1 {
                artifact_id: artifact_id.clone(),
                version: None,
            }),
            ArtifactToolOperationV1::PreviewAttach(PreviewAttachArgsV1 {
                artifact_id,
                url: "http://127.0.0.1:4173".into(),
            }),
        ];
        for operation in operations {
            assert_eq!(
                require_artifact_conversation_scope(&store, &foreign_binding, &operation),
                Err(ArtifactStoreError::NotFound),
                "{operation:?} crossed its broker conversation boundary",
            );
        }
        assert!(store
            .list_for_conversation(
                &foreign_binding.owner_pubkey,
                &foreign_binding.conversation_id,
                10,
            )
            .unwrap()
            .is_empty());
    }
}
