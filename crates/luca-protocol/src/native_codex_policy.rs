//! Verified native Codex permissions, carried only in the local task-host pipe.
use serde::{Deserialize, Serialize};

/// Known native approval policies; unknown/granular policies are not guessed.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum NativeCodexApprovalV1 {
    /// No interactive approvals; sandbox restrictions still apply.
    Never,
    /// Ask when the native runtime requires approval.
    OnRequest,
    /// Legacy native ask-after-failure policy.
    OnFailure,
    /// Native untrusted-command policy.
    Untrusted,
}

/// The owned noninteractive CLI cannot relay automatic/native approval reviews.
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NativeCodexReviewerV1 {
    /// Native owner approval, never substituted with automatic review.
    #[default]
    User,
}

/// Native sandbox forms that the owned CLI continuation can reproduce exactly.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
pub enum NativeCodexSandboxV1 {
    /// Native read-only sandbox.
    ReadOnly {},
    /// Native workspace sandbox and its explicit exceptions.
    WorkspaceWrite {
        /// Additional paths already granted by the native session.
        #[serde(default)]
        writable_roots: Vec<String>,
        /// Native network permission.
        #[serde(default)]
        network_access: bool,
        /// Whether the native session excludes the environment's temp directory.
        #[serde(default)]
        exclude_tmpdir_env_var: bool,
        /// Whether the native session excludes /tmp.
        #[serde(default)]
        exclude_slash_tmp: bool,
    },
    /// Full access only when it was explicitly recorded in the native session.
    DangerFullAccess {},
}

/// Exact latest permission evidence, never a model-selected override.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct NativeCodexPolicyV1 {
    /// Native approval behavior.
    pub approval_policy: NativeCodexApprovalV1,
    /// Explicit reviewer; legacy native records used the owner by default.
    #[serde(default)]
    pub approvals_reviewer: NativeCodexReviewerV1,
    /// Native filesystem/network sandbox.
    pub sandbox_policy: NativeCodexSandboxV1,
}

impl NativeCodexPolicyV1 {
    /// Bound native path metadata before constructing command-line arguments.
    pub fn is_bounded(&self) -> bool {
        // `exec` is noninteractive and forces `never`. Do not silently change
        // an interactive or granular native approval contract to fit it.
        if self.approval_policy != NativeCodexApprovalV1::Never {
            return false;
        }
        match &self.sandbox_policy {
            NativeCodexSandboxV1::WorkspaceWrite { writable_roots, .. } => {
                writable_roots.len() <= 128
                    && writable_roots.iter().all(|root| {
                        root.len() <= 4096
                            && root.starts_with('/')
                            && !root.chars().any(char::is_control)
                            && !std::path::Path::new(root)
                                .components()
                                .any(|part| matches!(part, std::path::Component::ParentDir))
                    })
            }
            _ => true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_policy_is_strict_bounded_and_never_guessed() {
        for value in [
            serde_json::json!({"approval_policy":"unknown","sandbox_policy":{"type":"read-only"}}),
            serde_json::json!({"approval_policy":"never","sandbox_policy":{"type":"external-sandbox"}}),
            serde_json::json!({"approval_policy":"never","sandbox_policy":{"type":"read-only","network_access":true}}),
        ] {
            assert!(serde_json::from_value::<NativeCodexPolicyV1>(value).is_err());
        }
        for roots in [
            vec!["relative"],
            vec!["/synthetic/../elsewhere"],
            vec!["/synthetic\nsecret"],
        ] {
            let policy: NativeCodexPolicyV1 = serde_json::from_value(serde_json::json!({"approval_policy":"never","sandbox_policy":{"type":"workspace-write","writable_roots":roots}})).unwrap();
            assert!(!policy.is_bounded());
        }
        let value =
            serde_json::json!({"approval_policy":"never","sandbox_policy":{"type":"read-only"}});
        let policy: NativeCodexPolicyV1 = serde_json::from_value(value.clone()).unwrap();
        assert!(policy.is_bounded());
        assert_eq!(
            serde_json::to_value(policy).unwrap(),
            serde_json::json!({"approval_policy":"never","approvals_reviewer":"user","sandbox_policy":{"type":"read-only"}})
        );
        let interactive: NativeCodexPolicyV1 = serde_json::from_value(serde_json::json!({"approval_policy":"on-request","sandbox_policy":{"type":"read-only"}})).unwrap();
        assert!(!interactive.is_bounded());
        assert!(serde_json::from_value::<NativeCodexPolicyV1>(serde_json::json!({"approval_policy":"never","approvals_reviewer":"auto_review","sandbox_policy":{"type":"read-only"}})).is_err());
    }
}
