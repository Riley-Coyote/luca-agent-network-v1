//! Bounded desktop-mediated permission requests for managed residents.
//!
//! This is deliberately not a signing operation.  The ACP host may ask the
//! desktop to select an option already advertised by its runtime, but cannot
//! supply a capability, change a resident, or reuse a decision from another
//! turn.

use serde::{Deserialize, Serialize};

use crate::{
    Hex64, ManagedPresentationActivityKindV1, OpaqueId, SafeU53,
    MAX_MANAGED_PRESENTATION_ACTIVITY_DETAIL_BYTES,
};

/// Stable wire identifier for the managed local permission protocol.
pub const MANAGED_PERMISSION_PROTOCOL: &str = "luca.managed.permission.v1";
/// Hard desktop decision deadline. Expiry resolves to the ACP cancelled path.
pub const MANAGED_PERMISSION_TIMEOUT_SECS: u64 = 120;

/// Maximum bytes in an MCP server or tool identifier on a permission request.
///
/// The presentation emitter in `buzz-acp` bounds the same identifiers with the
/// same rule; [`is_mcp_identifier`] is the one definition both sides mean.
pub const MAX_PERMISSION_MCP_IDENTIFIER_BYTES: usize = 128;
/// Maximum bytes in a bare command word (`git`, never `/usr/bin/git`).
pub const MAX_PERMISSION_COMMAND_TOKEN_BYTES: usize = 64;
/// Maximum leading argv words carried beside a command word.
pub const MAX_PERMISSION_COMMAND_ARGV_PREFIX: usize = 2;
/// Maximum segments one compound command may be remembered as.
///
/// A real agent command is `ls -la /x; echo "exit=$?"`, not a pipeline of
/// thirty. Past this bound the whole line is answered once and remembered
/// nowhere, which is the same failure an unsplittable line already has.
pub const MAX_PERMISSION_COMMAND_SEGMENTS: usize = 8;
/// Maximum bytes in one argv prefix word.
pub const MAX_PERMISSION_ARGV_TOKEN_BYTES: usize = 64;
/// Maximum bytes in one absolute filesystem path.
pub const MAX_PERMISSION_PATH_BYTES: usize = 4096;
/// Maximum bytes in one bare host name.
pub const MAX_PERMISSION_DOMAIN_BYTES: usize = 255;
/// Maximum bytes in one runtime tool identifier.
pub const MAX_PERMISSION_TOOL_NAME_BYTES: usize = 256;
/// Maximum bytes in one ACP `ToolKind` string.
pub const MAX_PERMISSION_TOOL_KIND_BYTES: usize = 32;

/// The only terminal outcome categories for a desktop-managed permission request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ManagedPermissionDispositionV1 {
    /// Select one exact option advertised by the runtime. The desktop never
    /// infers an allow/reject semantic from a display label.
    Selected,
    Cancelled,
}

/// Bounded, display-safe description of an option advertised by the active ACP runtime.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ManagedPermissionOptionV1 {
    /// Exact opaque option identifier returned by the runtime.
    pub option_id: String,
    /// Runtime-provided display label for the desktop approval card.
    pub name: String,
    /// Runtime-provided semantic kind, retained for display rather than policy inference.
    pub kind: String,
}

/// One plain executable invocation inside a command line.
///
/// A compound command (`ls -la /x; echo "exit=$?"`) is a sequence of these,
/// and the owner's "Always here" remembers one rule per segment. A segment is
/// only ever minted for a plain invocation: no redirection, no substitution,
/// no environment assignment, no `sudo`. When any part of a line fails that
/// test the whole line yields no segments at all — half a command is never
/// remembered.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommandSegmentV1 {
    /// Bare command word this segment runs.
    pub token: String,
    /// At most two leading argv words, under the same rule as
    /// [`ManagedPermissionRequestV1::command_argv_prefix`].
    #[serde(default)]
    pub argv_prefix: Vec<String>,
}

impl CommandSegmentV1 {
    /// Whether this segment is the bounded, bare shape a rule can be minted from.
    pub fn is_bounded(&self) -> bool {
        is_bare_command_token(&self.token)
            && self.argv_prefix.len() <= MAX_PERMISSION_COMMAND_ARGV_PREFIX
            && self
                .argv_prefix
                .iter()
                .all(|value| is_command_argv_token(value))
    }
}

/// A permission request received from an ACP runtime. `option_ids` is the
/// exact runtime-advertised set; desktop must select one of these strings or
/// return `cancelled`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ManagedPermissionRequestV1 {
    /// Must equal [`MANAGED_PERMISSION_PROTOCOL`].
    pub protocol: String,
    /// Desktop-managed resident that owns this host session.
    pub resident_pubkey: Hex64,
    /// Fresh desktop epoch for this ACP host.
    pub session_epoch: SafeU53,
    /// Harness-assigned turn receiving the runtime permission prompt.
    pub turn_id: OpaqueId,
    /// App-resolved conversation/channel receiving this turn; heartbeat turns
    /// are deliberately not eligible for desktop approval cards.
    pub conversation_id: OpaqueId,
    /// Canonical JSON representation of the ACP JSON-RPC request id.
    pub acp_request_id: String,
    /// Bounded runtime-provided title for the desktop approval card.
    pub title: String,
    /// Optional runtime tool-call correlation id, never treated as authority.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    /// Optional bounded action preview for display only. It is never authority
    /// for the selected runtime option or the operation that later executes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_preview: Option<String>,
    /// Exact, bounded set of runtime-advertised choices.
    pub options: Vec<ManagedPermissionOptionV1>,
    /// Owner trigger event that opened this turn. `None` on heartbeat and
    /// continuity turns, which have no owner message to answer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dispatch_receipt_id: Option<OpaqueId>,
    /// ACP `ToolKind` exactly as the runtime reported it ("execute", "edit",
    /// "read", "delete", "fetch", "search", "think", "other"). Never authority.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_kind: Option<String>,
    /// Coarse activity category, so the card can speak the same words the
    /// activity line already used for this step.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activity_kind: Option<ManagedPresentationActivityKindV1>,
    /// Runtime tool identifier: `Bash`, `mcp__luca-repositories__repo_read`,
    /// `mcp.luca-artifacts-0123abcdef45.artifact_create`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    /// MCP server identifier parsed out of the tool name, when there was one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mcp_server: Option<String>,
    /// MCP tool identifier parsed out of the tool name, when there was one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mcp_tool: Option<String>,
    /// Bare command word the runtime is asking to run.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command_token: Option<String>,
    /// At most two leading argv words, enough to tell `git status` from
    /// `git push` and nothing like a whole command line.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub command_argv_prefix: Vec<String>,
    /// Every plain invocation in the command line, in order.
    ///
    /// One segment for a simple command; several for a compound one. The two
    /// legacy fields above stay in step with this: with exactly one segment
    /// they repeat it, and with several they are absent, so a reader that
    /// knows nothing about segments sees "nothing to remember here" rather
    /// than a token that covers only part of what would run.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub command_segments: Vec<CommandSegmentV1>,
    /// Absolute path the operation touches, display-safe and bounded.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// Bare host the operation reaches, never a URL or a query.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub domain: Option<String>,
    /// Whether the operation writes. `None` when the runtime did not say.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub write: Option<bool>,
}

/// Desktop's one-shot answer to [`ManagedPermissionRequestV1`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ManagedPermissionDecisionV1 {
    /// Must equal [`MANAGED_PERMISSION_PROTOCOL`].
    pub protocol: String,
    /// Resident copied from the bound request.
    pub resident_pubkey: Hex64,
    /// Session epoch copied from the bound request.
    pub session_epoch: SafeU53,
    /// Turn id copied from the bound request.
    pub turn_id: OpaqueId,
    /// Conversation id copied from the bound request.
    pub conversation_id: OpaqueId,
    /// Canonical ACP JSON-RPC request id copied from the request.
    pub acp_request_id: String,
    /// Whether desktop selected a runtime option or cancelled the request.
    pub disposition: ManagedPermissionDispositionV1,
    /// Required only for selected; it must exactly equal one advertised
    /// option id from the corresponding request.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub option_id: Option<String>,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ManagedPermissionError {
    #[error("managed permission protocol is invalid")]
    Protocol,
    #[error("managed permission request has no bounded option ids")]
    Options,
    #[error("managed permission decision does not bind the request")]
    Binding,
    #[error("managed permission option was not advertised by the runtime")]
    Option,
}

impl ManagedPermissionRequestV1 {
    /// Verify this request is bounded and suitable for local desktop presentation.
    pub fn validate(&self) -> Result<(), ManagedPermissionError> {
        if self.protocol != MANAGED_PERMISSION_PROTOCOL
            || self.acp_request_id.is_empty()
            || self.acp_request_id.len() > 512
            || self.title.len() > 512
            || self
                .tool_call_id
                .as_ref()
                .is_some_and(|value| value.len() > 512)
            || self.action_preview.as_ref().is_some_and(|value| {
                value.is_empty()
                    || value.len() > MAX_MANAGED_PRESENTATION_ACTIVITY_DETAIL_BYTES
                    || !is_display_safe(value)
            })
            || self.options.is_empty()
            || self.options.len() > 32
            || self.options.iter().any(|option| {
                option.option_id.is_empty()
                    || option.option_id.len() > 256
                    || option.name.len() > 512
                    || option.kind.len() > 128
            })
            || self.tool_kind.as_ref().is_some_and(|value| {
                value.is_empty() || value.len() > MAX_PERMISSION_TOOL_KIND_BYTES
            })
            || self.tool_name.as_ref().is_some_and(|value| {
                value.is_empty()
                    || value.len() > MAX_PERMISSION_TOOL_NAME_BYTES
                    || !is_display_safe(value)
            })
            || self
                .mcp_server
                .as_ref()
                .is_some_and(|value| !is_mcp_identifier(value))
            || self
                .mcp_tool
                .as_ref()
                .is_some_and(|value| !is_mcp_identifier(value))
            || self
                .command_token
                .as_ref()
                .is_some_and(|value| !is_bare_command_token(value))
            || self.command_argv_prefix.len() > MAX_PERMISSION_COMMAND_ARGV_PREFIX
            || !self
                .command_argv_prefix
                .iter()
                .all(|value| is_command_argv_token(value))
            || self.command_segments.len() > MAX_PERMISSION_COMMAND_SEGMENTS
            || !self
                .command_segments
                .iter()
                .all(CommandSegmentV1::is_bounded)
            || !self.legacy_command_fields_agree()
            || self
                .path
                .as_ref()
                .is_some_and(|value| !is_permission_path(value))
            || self
                .domain
                .as_ref()
                .is_some_and(|value| !is_permission_domain(value))
        {
            return Err(ManagedPermissionError::Protocol);
        }
        Ok(())
    }
}

impl ManagedPermissionRequestV1 {
    /// Whether the legacy single-command fields say the same thing the
    /// segments do.
    ///
    /// This is the compatibility contract in one place: one segment repeats
    /// itself into `command_token`/`command_argv_prefix`; several leave both
    /// empty. A frame that claims a single token beside a compound command
    /// would let an older desktop remember one part of a line that runs
    /// several, so it is refused outright.
    fn legacy_command_fields_agree(&self) -> bool {
        match self.command_segments.as_slice() {
            [] => true,
            [only] => {
                self.command_token.as_deref() == Some(only.token.as_str())
                    && self.command_argv_prefix == only.argv_prefix
            }
            _ => self.command_token.is_none() && self.command_argv_prefix.is_empty(),
        }
    }
}

/// One MCP server or tool identifier.
///
/// This is the single definition of the rule: non-empty, at most
/// [`MAX_PERMISSION_MCP_IDENTIFIER_BYTES`], `[A-Za-z0-9._-]` throughout, and
/// alphanumeric in the first position. `buzz-acp` bounds the identifiers it
/// puts on a presentation frame the same way, so a rule minted from a card can
/// never name something the emitter would have refused to show.
pub fn is_mcp_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_PERMISSION_MCP_IDENTIFIER_BYTES
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric() || (index > 0 && matches!(byte, b'-' | b'_' | b'.'))
        })
}

/// One bare command word — `git`, never `/usr/bin/git`, `-rf`, or `a; b`.
pub fn is_bare_command_token(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_PERMISSION_COMMAND_TOKEN_BYTES
        && !value.starts_with('-')
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'+' | b'-'))
}

/// One leading argv word beside a command token.
pub fn is_command_argv_token(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_PERMISSION_ARGV_TOKEN_BYTES
        && value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'@' | b'+' | b'-')
        })
}

/// One bare lowercase host — `github.com`, never a URL, port, or path.
pub fn is_permission_domain(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_PERMISSION_DOMAIN_BYTES
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'-')
        })
}

/// One absolute, display-safe filesystem path.
pub fn is_permission_path(value: &str) -> bool {
    value.starts_with('/') && value.len() <= MAX_PERMISSION_PATH_BYTES && is_display_safe(value)
}

pub(crate) fn is_display_safe(value: &str) -> bool {
    !value.chars().any(|character| {
        character.is_control()
            || matches!(
                character,
                '\u{2028}' | '\u{2029}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}'
            )
    })
}

impl ManagedPermissionDecisionV1 {
    /// Verify that a desktop decision is bound to this exact request and option set.
    pub fn validate_for(
        &self,
        request: &ManagedPermissionRequestV1,
    ) -> Result<(), ManagedPermissionError> {
        request.validate()?;
        if self.protocol != MANAGED_PERMISSION_PROTOCOL
            || self.resident_pubkey != request.resident_pubkey
            || self.session_epoch != request.session_epoch
            || self.turn_id != request.turn_id
            || self.conversation_id != request.conversation_id
            || self.acp_request_id != request.acp_request_id
        {
            return Err(ManagedPermissionError::Binding);
        }
        match self.disposition {
            ManagedPermissionDispositionV1::Cancelled if self.option_id.is_none() => Ok(()),
            ManagedPermissionDispositionV1::Selected => match self.option_id.as_deref() {
                Some(id)
                    if request
                        .options
                        .iter()
                        .any(|candidate| candidate.option_id == id) =>
                {
                    Ok(())
                }
                _ => Err(ManagedPermissionError::Option),
            },
            ManagedPermissionDispositionV1::Cancelled => Err(ManagedPermissionError::Option),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> ManagedPermissionRequestV1 {
        ManagedPermissionRequestV1 {
            protocol: MANAGED_PERMISSION_PROTOCOL.into(),
            resident_pubkey: Hex64::parse("11".repeat(32)).unwrap(),
            session_epoch: SafeU53::new(2).unwrap(),
            turn_id: OpaqueId::parse("turn-1").unwrap(),
            conversation_id: OpaqueId::parse("conversation-1").unwrap(),
            acp_request_id: "7".into(),
            title: "Write file".into(),
            tool_call_id: Some("tool-1".into()),
            action_preview: Some("src/app.ts".into()),
            options: vec![
                ManagedPermissionOptionV1 {
                    option_id: "allow-7".into(),
                    name: "Allow".into(),
                    kind: "allow_once".into(),
                },
                ManagedPermissionOptionV1 {
                    option_id: "reject-7".into(),
                    name: "Reject".into(),
                    kind: "reject_once".into(),
                },
            ],
            dispatch_receipt_id: Some(OpaqueId::parse("dispatch-1").unwrap()),
            tool_kind: Some("edit".into()),
            activity_kind: Some(ManagedPresentationActivityKindV1::File),
            tool_name: Some("mcp__luca-repositories__repo_apply_patch".into()),
            mcp_server: Some("luca-repositories".into()),
            mcp_tool: Some("repo_apply_patch".into()),
            command_token: Some("git".into()),
            command_argv_prefix: vec!["status".into(), "--short".into()],
            command_segments: vec![CommandSegmentV1 {
                token: "git".into(),
                argv_prefix: vec!["status".into(), "--short".into()],
            }],
            path: Some("/redacted/project/src/app.ts".into()),
            domain: Some("github.com".into()),
            write: Some(true),
        }
    }

    const NEW_REQUEST_KEYS: &[&str] = &[
        "dispatch_receipt_id",
        "tool_kind",
        "activity_kind",
        "tool_name",
        "mcp_server",
        "mcp_tool",
        "command_token",
        "command_argv_prefix",
        "command_segments",
        "path",
        "domain",
        "write",
    ];

    #[test]
    fn decision_must_bind_exact_runtime_option() {
        let request = request();
        let decision = ManagedPermissionDecisionV1 {
            protocol: MANAGED_PERMISSION_PROTOCOL.into(),
            resident_pubkey: request.resident_pubkey.clone(),
            session_epoch: request.session_epoch,
            turn_id: request.turn_id.clone(),
            conversation_id: request.conversation_id.clone(),
            acp_request_id: request.acp_request_id.clone(),
            disposition: ManagedPermissionDispositionV1::Selected,
            option_id: Some("invented".into()),
        };
        assert_eq!(
            decision.validate_for(&request),
            Err(ManagedPermissionError::Option)
        );
    }

    #[test]
    fn stale_epoch_is_rejected() {
        let request = request();
        let decision = ManagedPermissionDecisionV1 {
            protocol: MANAGED_PERMISSION_PROTOCOL.into(),
            resident_pubkey: request.resident_pubkey.clone(),
            session_epoch: SafeU53::new(3).unwrap(),
            turn_id: request.turn_id.clone(),
            conversation_id: request.conversation_id.clone(),
            acp_request_id: request.acp_request_id.clone(),
            disposition: ManagedPermissionDispositionV1::Cancelled,
            option_id: None,
        };
        assert_eq!(
            decision.validate_for(&request),
            Err(ManagedPermissionError::Binding)
        );
    }

    #[test]
    fn action_preview_is_optional_and_display_safe() {
        let mut json = serde_json::to_value(request()).expect("request json");
        json.as_object_mut()
            .expect("request object")
            .remove("action_preview");
        let mut value: ManagedPermissionRequestV1 =
            serde_json::from_value(json).expect("legacy request without preview");
        assert_eq!(value.action_preview, None);
        assert_eq!(value.validate(), Ok(()));

        value.action_preview = Some("a".repeat(MAX_MANAGED_PRESENTATION_ACTIVITY_DETAIL_BYTES + 1));
        assert_eq!(value.validate(), Err(ManagedPermissionError::Protocol));

        value.action_preview = Some("safe\u{202e}spoofed".into());
        assert_eq!(value.validate(), Err(ManagedPermissionError::Protocol));
    }

    #[test]
    fn legacy_request_without_match_fields_still_validates() {
        let mut json = serde_json::to_value(request()).expect("request json");
        let object = json.as_object_mut().expect("request object");
        for key in NEW_REQUEST_KEYS {
            assert!(object.remove(*key).is_some(), "fixture is missing {key}");
        }

        let value: ManagedPermissionRequestV1 =
            serde_json::from_value(json).expect("legacy harness request");
        assert_eq!(value.dispatch_receipt_id, None);
        assert_eq!(value.tool_kind, None);
        assert_eq!(value.activity_kind, None);
        assert_eq!(value.tool_name, None);
        assert_eq!(value.mcp_server, None);
        assert_eq!(value.mcp_tool, None);
        assert_eq!(value.command_token, None);
        assert!(value.command_argv_prefix.is_empty());
        assert!(value.command_segments.is_empty());
        assert_eq!(value.path, None);
        assert_eq!(value.domain, None);
        assert_eq!(value.write, None);
        assert_eq!(value.validate(), Ok(()));
    }

    #[test]
    fn command_token_rejects_paths_flags_and_metacharacters() {
        assert!(is_bare_command_token("git"));
        assert!(is_bare_command_token("python3.12"));
        assert!(is_bare_command_token("g++"));
        for rejected in [
            "/usr/bin/git",
            "-rf",
            "a;b",
            "a|b",
            "$(x)",
            "",
            "git status",
        ] {
            assert!(
                !is_bare_command_token(rejected),
                "{rejected} is not a bare command token"
            );
        }

        let mut value = request();
        value.command_token = Some("/usr/bin/git".into());
        assert_eq!(value.validate(), Err(ManagedPermissionError::Protocol));
    }

    #[test]
    fn match_fields_are_bounded() {
        let over = |mutate: fn(&mut ManagedPermissionRequestV1)| {
            let mut value = request();
            mutate(&mut value);
            assert_eq!(value.validate(), Err(ManagedPermissionError::Protocol));
        };

        over(|value| value.tool_kind = Some("k".repeat(MAX_PERMISSION_TOOL_KIND_BYTES + 1)));
        over(|value| value.tool_name = Some("t".repeat(MAX_PERMISSION_TOOL_NAME_BYTES + 1)));
        over(|value| {
            value.mcp_server = Some("s".repeat(MAX_PERMISSION_MCP_IDENTIFIER_BYTES + 1));
        });
        over(|value| value.mcp_tool = Some("t".repeat(MAX_PERMISSION_MCP_IDENTIFIER_BYTES + 1)));
        over(|value| {
            value.command_segments.clear();
            value.command_token = Some("c".repeat(MAX_PERMISSION_COMMAND_TOKEN_BYTES + 1));
        });
        over(|value| {
            value.command_segments.clear();
            value.command_argv_prefix = vec!["a".into(); MAX_PERMISSION_COMMAND_ARGV_PREFIX + 1];
        });
        over(|value| {
            value.command_segments.clear();
            value.command_argv_prefix = vec!["a".repeat(MAX_PERMISSION_ARGV_TOKEN_BYTES + 1)];
        });
        over(|value| {
            value.path = Some(format!("/{}", "p".repeat(MAX_PERMISSION_PATH_BYTES)));
        });
        over(|value| value.path = Some("relative/path.ts".into()));
        over(|value| value.domain = Some("d".repeat(MAX_PERMISSION_DOMAIN_BYTES + 1)));
        over(|value| value.domain = Some("Example.com".into()));

        // Exactly at the bound is still accepted.
        let mut at_bound = request();
        at_bound.command_token = None;
        at_bound.command_argv_prefix.clear();
        at_bound.command_segments = vec![
            CommandSegmentV1 {
                token: "echo".into(),
                argv_prefix: Vec::new(),
            };
            MAX_PERMISSION_COMMAND_SEGMENTS
        ];
        at_bound.tool_kind = Some("k".repeat(MAX_PERMISSION_TOOL_KIND_BYTES));
        at_bound.path = Some(format!("/{}", "p".repeat(MAX_PERMISSION_PATH_BYTES - 1)));
        at_bound.domain = Some("d".repeat(MAX_PERMISSION_DOMAIN_BYTES));
        assert_eq!(at_bound.validate(), Ok(()));
    }

    fn segment(token: &str, argv_prefix: &[&str]) -> CommandSegmentV1 {
        CommandSegmentV1 {
            token: token.into(),
            argv_prefix: argv_prefix.iter().map(|word| (*word).to_owned()).collect(),
        }
    }

    fn compound(segments: Vec<CommandSegmentV1>) -> ManagedPermissionRequestV1 {
        let mut value = request();
        value.command_token = None;
        value.command_argv_prefix = Vec::new();
        value.command_segments = segments;
        value
    }

    #[test]
    fn legacy_request_without_segments_still_validates() {
        // A harness that predates compound commands sends a token and no
        // segments at all. Nothing about that frame changed.
        let mut json = serde_json::to_value(request()).expect("request json");
        assert!(json
            .as_object_mut()
            .expect("request object")
            .remove("command_segments")
            .is_some());

        let value: ManagedPermissionRequestV1 =
            serde_json::from_value(json).expect("legacy harness request");
        assert!(value.command_segments.is_empty());
        assert_eq!(value.command_token.as_deref(), Some("git"));
        assert_eq!(value.validate(), Ok(()));
    }

    #[test]
    fn command_segments_are_bounded() {
        let over = |value: ManagedPermissionRequestV1| {
            assert_eq!(value.validate(), Err(ManagedPermissionError::Protocol));
        };

        over(compound(vec![
            segment("echo", &[]);
            MAX_PERMISSION_COMMAND_SEGMENTS + 1
        ]));
        over(compound(vec![
            segment("ls", &[]),
            segment("/usr/bin/echo", &[]),
        ]));
        over(compound(vec![segment("ls", &[]), segment("-rf", &[])]));
        over(compound(vec![segment("ls", &[]), segment("", &[])]));
        over(compound(vec![
            segment("ls", &[]),
            segment("npm", &["run", "build", "extra"]),
        ]));
        over(compound(vec![
            segment("ls", &[]),
            CommandSegmentV1 {
                token: "npm".into(),
                argv_prefix: vec!["a".repeat(MAX_PERMISSION_ARGV_TOKEN_BYTES + 1)],
            },
        ]));

        // The two real shapes from the first walk.
        assert_eq!(
            compound(vec![segment("ls", &[]), segment("echo", &[])]).validate(),
            Ok(())
        );
        let mut single = request();
        single.command_token = Some("npm".into());
        single.command_argv_prefix = vec!["run".into(), "build".into()];
        single.command_segments = vec![segment("npm", &["run", "build"])];
        assert_eq!(single.validate(), Ok(()));
    }

    #[test]
    fn legacy_command_fields_must_agree_with_the_segments() {
        // One segment repeats itself into the legacy pair...
        let mut mismatched = request();
        mismatched.command_segments = vec![segment("git", &["push"])];
        assert_eq!(mismatched.validate(), Err(ManagedPermissionError::Protocol));

        let mut missing = request();
        missing.command_token = None;
        missing.command_argv_prefix = Vec::new();
        missing.command_segments = vec![segment("git", &["status", "--short"])];
        assert_eq!(missing.validate(), Err(ManagedPermissionError::Protocol));

        // ...and several leave it empty, so a reader that knows nothing about
        // segments remembers nothing rather than half the line.
        let mut half = request();
        half.command_segments = vec![segment("git", &["status", "--short"]), segment("echo", &[])];
        assert_eq!(half.validate(), Err(ManagedPermissionError::Protocol));

        let mut whole = half.clone();
        whole.command_token = None;
        whole.command_argv_prefix = Vec::new();
        assert_eq!(whole.validate(), Ok(()));
    }

    #[test]
    fn command_segments_round_trip() {
        let value = compound(vec![segment("ls", &[]), segment("echo", &["hello"])]);
        let json = serde_json::to_value(&value).expect("request json");
        assert_eq!(
            json.get("command_segments"),
            Some(&serde_json::json!([
                {"token": "ls", "argv_prefix": []},
                {"token": "echo", "argv_prefix": ["hello"]}
            ]))
        );
        assert!(json.get("command_token").is_none());
        assert!(json.get("command_argv_prefix").is_none());
        let back: ManagedPermissionRequestV1 = serde_json::from_value(json).expect("round trip");
        assert_eq!(back, value);
        assert_eq!(back.validate(), Ok(()));
    }

    #[test]
    fn mcp_identifier_rule_matches_the_presentation_rule() {
        for accepted in [
            "luca-repositories",
            "repo_read",
            "luca-artifacts-0123abcdef45",
            "buzz",
            "a",
            &"a".repeat(MAX_PERMISSION_MCP_IDENTIFIER_BYTES),
        ] {
            assert!(is_mcp_identifier(accepted), "{accepted} should be accepted");
        }
        for rejected in [
            "",
            "-leading",
            ".leading",
            "_leading",
            "has space",
            "has/slash",
            "has:colon",
            &"a".repeat(MAX_PERMISSION_MCP_IDENTIFIER_BYTES + 1),
        ] {
            assert!(
                !is_mcp_identifier(rejected),
                "{rejected} should be rejected"
            );
        }
    }
}
