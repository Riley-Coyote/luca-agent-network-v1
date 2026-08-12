//! Restricted semantic Communications MCP personality.
//!
//! This process is only an authenticated adapter to the trusted desktop
//! broker. It cannot sign or publish events, run commands, resolve local
//! paths, or expand the active managed turn's authority. The broker rechecks
//! current custody, membership, cancellation, generation, and turn state for
//! every operation before performing a durable side effect.

use std::{path::PathBuf, sync::Arc, time::Duration};

use nostr::prelude::rand::{rngs::OsRng, RngCore};
use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{CallToolResult, Content, ServerCapabilities, ServerInfo},
    tool, tool_handler, tool_router, ErrorData, ServerHandler,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::UnixStream,
};
use zeroize::Zeroizing;

const BROKER_PROTOCOL: &str = "luca.communications.broker.v1";
const BROKER_RECEIPT_PROTOCOL: &str = "luca.communications.broker-receipt.v1";
const MAX_BROKER_FRAME_BYTES: usize = 768 * 1024;
const MAX_MESSAGE_BYTES: usize = 65_536;
const MAX_REACTION_BYTES: usize = 64;
const MAX_PARTICIPANTS: usize = 64;
const MAX_ROOM_LABEL_BYTES: usize = 120;
const MAX_ROOM_METADATA_BYTES: usize = 1_024;
const MAX_ARTIFACTS: usize = 16;
const MAX_PAGE_ITEMS: usize = 256;
const MAX_SAFE_U53: u64 = 9_007_199_254_740_991;
const BROKER_DEADLINE: Duration = Duration::from_secs(130);
const TURN_REGISTRATION_RETRY_DELAY: Duration = Duration::from_millis(75);
const TURN_REGISTRATION_RETRIES: usize = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BrokerOperation {
    Inbox,
    Conversation,
    Send,
    React,
    Invite,
    CreatePrivateRoom,
}

impl BrokerOperation {
    fn as_str(self) -> &'static str {
        match self {
            Self::Inbox => "inbox",
            Self::Conversation => "conversation",
            Self::Send => "send",
            Self::React => "react",
            Self::Invite => "invite",
            Self::CreatePrivateRoom => "create_private_room",
        }
    }
}

#[derive(Clone)]
struct CommunicationsBrokerClient {
    endpoint: PathBuf,
    capability: Zeroizing<String>,
    capability_generation: u64,
    source_conversation_id: String,
    turn_id: String,
    dispatch_receipt_id: String,
    cancellation_epoch: u64,
}

impl CommunicationsBrokerClient {
    fn from_environment() -> Result<Self, String> {
        let communications_mode = std::env::var("LUCA_COMMUNICATIONS_MODE").ok();
        let repository_mode = std::env::var("LUCA_REPOSITORY_MODE").ok();
        validate_personality_modes(communications_mode.as_deref(), repository_mode.as_deref())?;

        let endpoint = std::env::var("LUCA_COMMUNICATIONS_ENDPOINT")
            .map(PathBuf::from)
            .map_err(|_| "communications MCP endpoint is unavailable".to_owned())?;
        let capability = Zeroizing::new(
            std::env::var("LUCA_COMMUNICATIONS_CAPABILITY")
                .map_err(|_| "communications MCP capability is unavailable".to_owned())?,
        );
        let capability_generation = std::env::var("LUCA_COMMUNICATIONS_CAPABILITY_GENERATION")
            .map_err(|_| "communications MCP generation is unavailable".to_owned())?
            .parse::<u64>()
            .map_err(|_| "communications MCP generation is invalid".to_owned())?;
        let source_conversation_id = std::env::var("LUCA_COMMUNICATIONS_CONVERSATION_ID")
            .map_err(|_| "communications MCP conversation is unavailable".to_owned())?;
        let turn_id = std::env::var("LUCA_COMMUNICATIONS_TURN_ID")
            .map_err(|_| "communications MCP turn is unavailable".to_owned())?;
        let dispatch_receipt_id = std::env::var("LUCA_COMMUNICATIONS_DISPATCH_RECEIPT_ID")
            .map_err(|_| "communications MCP dispatch receipt is unavailable".to_owned())?;
        let cancellation_epoch = std::env::var("LUCA_COMMUNICATIONS_CANCELLATION_EPOCH")
            .map_err(|_| "communications MCP cancellation epoch is unavailable".to_owned())?
            .parse::<u64>()
            .map_err(|_| "communications MCP cancellation epoch is invalid".to_owned())?;

        if !endpoint.is_absolute()
            || endpoint.as_os_str().len() > 4096
            || !is_sha256_ref(capability.as_str())
            || capability_generation == 0
            || capability_generation > MAX_SAFE_U53
            || !is_opaque_id(&source_conversation_id)
            || !is_opaque_id(&turn_id)
            || !is_opaque_id(&dispatch_receipt_id)
            || cancellation_epoch == 0
            || cancellation_epoch > MAX_SAFE_U53
        {
            return Err("communications MCP bootstrap is invalid".into());
        }
        Ok(Self {
            endpoint,
            capability,
            capability_generation,
            source_conversation_id,
            turn_id,
            dispatch_receipt_id,
            cancellation_epoch,
        })
    }

    async fn call<T: Serialize>(
        &self,
        operation: BrokerOperation,
        arguments: T,
    ) -> Result<CallToolResult, ErrorData> {
        let operation_request_id = mint_operation_request_id();
        let frame = BrokerFrameV1 {
            protocol: BROKER_PROTOCOL,
            capability: self.capability.as_str(),
            capability_generation: self.capability_generation,
            source_conversation_id: &self.source_conversation_id,
            turn_id: &self.turn_id,
            dispatch_receipt_id: &self.dispatch_receipt_id,
            cancellation_epoch: self.cancellation_epoch,
            operation_request_id: &operation_request_id,
            operation: operation.as_str(),
            arguments,
        };
        let mut bytes = serde_json::to_vec(&frame)
            .map_err(|_| internal_error("communications request could not be encoded"))?;
        if bytes.len() >= MAX_BROKER_FRAME_BYTES {
            return Err(ErrorData::invalid_params(
                "communications request exceeds its bound",
                None,
            ));
        }
        bytes.push(b'\n');

        let mut retry_count = 0;
        let response = loop {
            let response = self.exchange(&bytes).await?;
            response.validate(operation, self)?;
            if should_retry_turn_not_active(&response) && retry_count < TURN_REGISTRATION_RETRIES {
                retry_count += 1;
                tokio::time::sleep(TURN_REGISTRATION_RETRY_DELAY).await;
                continue;
            }
            break response;
        };

        let receipt = serde_json::to_string(&response.receipt)
            .map_err(|_| internal_error("communications receipt could not be encoded"))?;
        let content = vec![
            Content::text(response.content),
            Content::text(format!("Communication receipt: {receipt}")),
        ];
        if response.ok {
            Ok(CallToolResult::success(content))
        } else {
            Ok(CallToolResult::error(content))
        }
    }

    async fn exchange(&self, bytes: &[u8]) -> Result<BrokerResponseV1, ErrorData> {
        tokio::time::timeout(BROKER_DEADLINE, async {
            let mut stream = UnixStream::connect(&self.endpoint)
                .await
                .map_err(|_| internal_error("communications broker is unavailable"))?;
            stream
                .write_all(bytes)
                .await
                .map_err(|_| internal_error("communications broker request failed"))?;
            stream
                .flush()
                .await
                .map_err(|_| internal_error("communications broker request failed"))?;
            let mut response = Vec::new();
            stream
                .take((MAX_BROKER_FRAME_BYTES + 1) as u64)
                .read_to_end(&mut response)
                .await
                .map_err(|_| internal_error("communications broker response failed"))?;
            if response.len() > MAX_BROKER_FRAME_BYTES || !response.ends_with(b"\n") {
                return Err(internal_error("communications broker response is invalid"));
            }
            serde_json::from_slice::<BrokerResponseV1>(&response)
                .map_err(|_| internal_error("communications broker response is invalid"))
        })
        .await
        .map_err(|_| internal_error("communications broker request timed out"))?
    }
}

#[derive(Serialize)]
struct BrokerFrameV1<'a, T> {
    protocol: &'static str,
    capability: &'a str,
    capability_generation: u64,
    source_conversation_id: &'a str,
    turn_id: &'a str,
    dispatch_receipt_id: &'a str,
    cancellation_epoch: u64,
    operation_request_id: &'a str,
    operation: &'static str,
    arguments: T,
}

fn mint_operation_request_id() -> String {
    let mut bytes = [0_u8; 16];
    OsRng.fill_bytes(&mut bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0],
        bytes[1],
        bytes[2],
        bytes[3],
        bytes[4],
        bytes[5],
        bytes[6],
        bytes[7],
        bytes[8],
        bytes[9],
        bytes[10],
        bytes[11],
        bytes[12],
        bytes[13],
        bytes[14],
        bytes[15],
    )
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BrokerResponseV1 {
    protocol: String,
    ok: bool,
    content: String,
    receipt: BrokerReceiptV1,
}

impl BrokerResponseV1 {
    fn validate(
        &self,
        expected_operation: BrokerOperation,
        client: &CommunicationsBrokerClient,
    ) -> Result<(), ErrorData> {
        if self.protocol != BROKER_PROTOCOL
            || self.receipt.protocol != BROKER_RECEIPT_PROTOCOL
            || self.receipt.operation != expected_operation.as_str()
            || self.receipt.capability_generation != client.capability_generation
            || self.receipt.source_conversation_id != client.source_conversation_id
            || self.receipt.turn_id != client.turn_id
            || self.receipt.dispatch_receipt_id != client.dispatch_receipt_id
            || self.receipt.cancellation_epoch != client.cancellation_epoch
            || !is_opaque_id(&self.receipt.receipt_id)
            || self
                .receipt
                .diagnostic_code
                .as_ref()
                .is_some_and(|value| !is_opaque_id(value))
            || (self.ok && self.receipt.diagnostic_code.is_some())
            || (!self.ok && self.receipt.diagnostic_code.is_none())
        {
            return Err(internal_error("communications broker receipt is invalid"));
        }
        Ok(())
    }
}

fn should_retry_turn_not_active(response: &BrokerResponseV1) -> bool {
    !response.ok && response.receipt.diagnostic_code.as_deref() == Some("turn_not_active")
}

/// Body-free proof that the trusted broker handled one exact request under
/// one capability generation. It deliberately cannot contain message text,
/// raw event JSON, local paths, secrets, or signing material.
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct BrokerReceiptV1 {
    protocol: String,
    receipt_id: String,
    operation: String,
    capability_generation: u64,
    source_conversation_id: String,
    turn_id: String,
    dispatch_receipt_id: String,
    cancellation_epoch: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    diagnostic_code: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CommunicationsInboxCategory {
    #[default]
    All,
    Direct,
    Mentions,
    Threads,
    NeedsAction,
    Agents,
    Reminders,
    Drafts,
}

#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CommunicationsInboxParams {
    /// Resident-scoped Inbox category. The broker never exposes another
    /// resident's private Inbox.
    #[serde(default)]
    category: CommunicationsInboxCategory,
    /// Opaque page cursor returned by an earlier Inbox request.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cursor: Option<String>,
    /// Maximum items, from 1 through 256.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    limit: Option<usize>,
}

impl CommunicationsInboxParams {
    fn validate(&self) -> Result<(), String> {
        validate_cursor_and_limit(self.cursor.as_deref(), self.limit)
    }
}

#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CommunicationsConversationParams {
    /// Authorized conversation to read. Omit to read the current conversation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    conversation_id: Option<String>,
    /// Optional thread root event to read within the conversation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    thread_root_event_id: Option<String>,
    /// Opaque cursor for messages older than the current page.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cursor: Option<String>,
    /// Maximum items, from 1 through 256.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    limit: Option<usize>,
}

impl CommunicationsConversationParams {
    fn validate(&self) -> Result<(), String> {
        if self
            .conversation_id
            .as_ref()
            .is_some_and(|value| !is_opaque_id(value))
            || self
                .thread_root_event_id
                .as_ref()
                .is_some_and(|value| !is_hex64(value))
        {
            return Err("conversation request is invalid".into());
        }
        validate_cursor_and_limit(self.cursor.as_deref(), self.limit)
    }
}

/// Semantic destination selector. Participant-set versions and fingerprints
/// are resolved and frozen only by the trusted desktop.
#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(
    tag = "destination_type",
    rename_all = "snake_case",
    deny_unknown_fields
)]
pub(crate) enum CommunicationsDestination {
    CurrentConversation,
    ExistingConversation {
        conversation_id: String,
    },
    /// Open or reuse an owner-visible direct conversation. The trusted desktop
    /// adds the owner and acting resident and proves same-owner custody.
    DirectParticipants {
        participant_pubkeys: Vec<String>,
    },
}

impl CommunicationsDestination {
    fn validate(&self) -> Result<(), String> {
        match self {
            Self::CurrentConversation => Ok(()),
            Self::ExistingConversation { conversation_id } if is_opaque_id(conversation_id) => {
                Ok(())
            }
            Self::DirectParticipants {
                participant_pubkeys,
            } if valid_unique_pubkeys(participant_pubkeys, MAX_PARTICIPANTS) => Ok(()),
            _ => Err("communication destination is invalid".into()),
        }
    }
}

/// Typed reply shape. No raw event tags can cross this boundary.
#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(tag = "reply_type", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum CommunicationsReplyTarget {
    Message {
        event_id: String,
    },
    Thread {
        thread_root_event_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reply_to_event_id: Option<String>,
    },
}

impl CommunicationsReplyTarget {
    fn validate(&self) -> Result<(), String> {
        match self {
            Self::Message { event_id } if is_hex64(event_id) => Ok(()),
            Self::Thread {
                thread_root_event_id,
                reply_to_event_id,
            } if is_hex64(thread_root_event_id)
                && reply_to_event_id
                    .as_ref()
                    .is_none_or(|value| is_hex64(value)) =>
            {
                Ok(())
            }
            _ => Err("communication reply target is invalid".into()),
        }
    }
}

#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CommunicationsSendParams {
    destination: CommunicationsDestination,
    /// Ordinary UTF-8 message text. It may be empty only with an opaque
    /// artifact handle.
    body: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    reply: Option<CommunicationsReplyTarget>,
    /// Exact public keys to mention. Names never confer identity authority.
    #[serde(default)]
    mention_pubkeys: Vec<String>,
    /// Mentioned same-owner residents for which activation is explicitly
    /// requested. Delivery may succeed even when activation does not.
    #[serde(default)]
    activation_pubkeys: Vec<String>,
    /// Desktop-issued opaque artifact handles. Paths and URLs are not accepted.
    #[serde(default)]
    artifact_handle_ids: Vec<String>,
}

impl CommunicationsSendParams {
    fn validate(&self) -> Result<(), String> {
        self.destination.validate()?;
        if (self.body.is_empty() && self.artifact_handle_ids.is_empty())
            || self.body.len() > MAX_MESSAGE_BYTES
            || self.body.contains('\0')
            || !valid_unique_pubkeys(&self.mention_pubkeys, MAX_PARTICIPANTS)
            || !valid_unique_pubkeys(&self.activation_pubkeys, MAX_PARTICIPANTS)
            || self
                .activation_pubkeys
                .iter()
                .any(|pubkey| !self.mention_pubkeys.contains(pubkey))
            || self.artifact_handle_ids.len() > MAX_ARTIFACTS
            || has_duplicates(&self.artifact_handle_ids)
            || self
                .artifact_handle_ids
                .iter()
                .any(|handle| !is_opaque_id(handle))
        {
            return Err("communication message is invalid".into());
        }
        if let Some(reply) = &self.reply {
            reply.validate()?;
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum CommunicationsReactionMutation {
    Add {
        target_event_id: String,
        reaction: String,
    },
    Remove {
        target_event_id: String,
        reaction_event_id: String,
    },
}

#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CommunicationsReactParams {
    /// Authorized conversation containing the target. Omit for the current
    /// conversation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    conversation_id: Option<String>,
    mutation: CommunicationsReactionMutation,
}

impl CommunicationsReactParams {
    fn validate(&self) -> Result<(), String> {
        if self
            .conversation_id
            .as_ref()
            .is_some_and(|value| !is_opaque_id(value))
        {
            return Err("reaction conversation is invalid".into());
        }
        match &self.mutation {
            CommunicationsReactionMutation::Add {
                target_event_id,
                reaction,
            } if is_hex64(target_event_id)
                && !reaction.is_empty()
                && reaction.trim() == reaction
                && reaction.len() <= MAX_REACTION_BYTES
                && !reaction.contains('\0') =>
            {
                Ok(())
            }
            CommunicationsReactionMutation::Remove {
                target_event_id,
                reaction_event_id,
            } if is_hex64(target_event_id) && is_hex64(reaction_event_id) => Ok(()),
            _ => Err("reaction request is invalid".into()),
        }
    }
}

#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CommunicationsInviteParams {
    /// Existing owner-visible conversation. Omit for the current conversation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    conversation_id: Option<String>,
    /// Exact same-owner resident public key. External identities are not
    /// representable through this restricted tool.
    participant_pubkey: String,
    /// Reserved for COM-103 explicit activation. COM-102 accepts only false
    /// and fails closed before mutation when true.
    #[serde(default)]
    request_activation: bool,
}

#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CommunicationsCreatePrivateRoomParams {
    /// Human-readable private-room label.
    label: String,
    /// Optional bounded purpose presented with the room.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    purpose: Option<String>,
    /// Additional same-owner residents. The trusted desktop always adds the
    /// owner and acting resident and verifies local custody.
    #[serde(default)]
    participant_pubkeys: Vec<String>,
}

impl CommunicationsCreatePrivateRoomParams {
    fn validate(&self) -> Result<(), String> {
        if !valid_bounded_text(&self.label, MAX_ROOM_LABEL_BYTES)
            || self
                .purpose
                .as_ref()
                .is_some_and(|purpose| !valid_bounded_text(purpose, MAX_ROOM_METADATA_BYTES))
            || !valid_unique_pubkeys(&self.participant_pubkeys, MAX_PARTICIPANTS - 2)
        {
            return Err("private room request is invalid".into());
        }
        Ok(())
    }
}

impl CommunicationsInviteParams {
    fn validate(&self) -> Result<(), String> {
        if self.request_activation
            || !is_hex64(&self.participant_pubkey)
            || self
                .conversation_id
                .as_ref()
                .is_some_and(|value| !is_opaque_id(value))
        {
            return Err("same-owner invitation is invalid".into());
        }
        Ok(())
    }
}

#[derive(Clone)]
pub(crate) struct LucaCommunicationsMcp {
    client: Arc<CommunicationsBrokerClient>,
    tool_router: ToolRouter<LucaCommunicationsMcp>,
}

#[tool_router]
impl LucaCommunicationsMcp {
    pub(crate) fn from_environment() -> Result<Self, String> {
        Ok(Self {
            client: Arc::new(CommunicationsBrokerClient::from_environment()?),
            tool_router: Self::tool_router(),
        })
    }

    #[tool(
        name = "communications_inbox",
        description = "Read this resident's authorized Inbox projection. Never exposes another resident's private Inbox."
    )]
    async fn communications_inbox(
        &self,
        Parameters(params): Parameters<CommunicationsInboxParams>,
    ) -> Result<CallToolResult, ErrorData> {
        params.validate().map_err(invalid_params)?;
        self.client.call(BrokerOperation::Inbox, params).await
    }

    #[tool(
        name = "communications_conversation",
        description = "Read a bounded page from an authorized conversation using semantic IDs only. No raw relay events or local paths."
    )]
    async fn communications_conversation(
        &self,
        Parameters(params): Parameters<CommunicationsConversationParams>,
    ) -> Result<CallToolResult, ErrorData> {
        params.validate().map_err(invalid_params)?;
        self.client
            .call(BrokerOperation::Conversation, params)
            .await
    }

    #[tool(
        name = "communications_send",
        description = "Request a typed message, reply, mention, or opaque attachment through Luca's trusted broker. Delivery and agent activation are separate outcomes."
    )]
    async fn communications_send(
        &self,
        Parameters(params): Parameters<CommunicationsSendParams>,
    ) -> Result<CallToolResult, ErrorData> {
        params.validate().map_err(invalid_params)?;
        self.client.call(BrokerOperation::Send, params).await
    }

    #[tool(
        name = "communications_react",
        description = "Add a reaction or remove this resident's exact reaction through a typed semantic request."
    )]
    async fn communications_react(
        &self,
        Parameters(params): Parameters<CommunicationsReactParams>,
    ) -> Result<CallToolResult, ErrorData> {
        params.validate().map_err(invalid_params)?;
        self.client.call(BrokerOperation::React, params).await
    }

    #[tool(
        name = "communications_invite",
        description = "Add one locally verified same-owner agent to an owner-visible conversation without activating it. External invitations and activation are unavailable here."
    )]
    async fn communications_invite(
        &self,
        Parameters(params): Parameters<CommunicationsInviteParams>,
    ) -> Result<CallToolResult, ErrorData> {
        params.validate().map_err(invalid_params)?;
        self.client.call(BrokerOperation::Invite, params).await
    }

    #[tool(
        name = "communications_create_private_room",
        description = "Create or recover one owner-visible private room for locally verified same-owner residents through Luca's existing room operations."
    )]
    async fn communications_create_private_room(
        &self,
        Parameters(params): Parameters<CommunicationsCreatePrivateRoomParams>,
    ) -> Result<CallToolResult, ErrorData> {
        params.validate().map_err(invalid_params)?;
        self.client
            .call(BrokerOperation::CreatePrivateRoom, params)
            .await
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for LucaCommunicationsMcp {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build()).with_server_info(
            rmcp::model::Implementation::new("luca-communications", env!("CARGO_PKG_VERSION")),
        )
    }
}

fn validate_personality_modes(
    communications_mode: Option<&str>,
    repository_mode: Option<&str>,
) -> Result<(), String> {
    if communications_mode != Some("1") {
        return Err("communications MCP mode is unavailable".into());
    }
    if repository_mode == Some("1") {
        return Err("repository and communications MCP modes cannot share one process".into());
    }
    Ok(())
}

fn validate_cursor_and_limit(cursor: Option<&str>, limit: Option<usize>) -> Result<(), String> {
    if cursor.is_some_and(|value| !is_opaque_id(value))
        || limit.is_some_and(|value| value == 0 || value > MAX_PAGE_ITEMS)
    {
        return Err("communication page request is invalid".into());
    }
    Ok(())
}

fn valid_unique_pubkeys(values: &[String], maximum: usize) -> bool {
    values.len() <= maximum && values.iter().all(|value| is_hex64(value)) && !has_duplicates(values)
}

fn has_duplicates(values: &[String]) -> bool {
    values
        .iter()
        .enumerate()
        .any(|(index, value)| values[..index].contains(value))
}

fn valid_bounded_text(value: &str, maximum: usize) -> bool {
    !value.is_empty() && value.trim() == value && value.len() <= maximum && !value.contains('\0')
}

fn is_hex64(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn is_sha256_ref(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value[7..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn is_opaque_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
}

fn invalid_params(message: String) -> ErrorData {
    ErrorData::invalid_params(message, None)
}

fn internal_error(message: &'static str) -> ErrorData {
    ErrorData::internal_error(message, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event_id(byte: char) -> String {
        byte.to_string().repeat(64)
    }

    fn client() -> CommunicationsBrokerClient {
        CommunicationsBrokerClient {
            endpoint: PathBuf::from("/tmp/luca-communications.sock"),
            capability: Zeroizing::new(format!("sha256:{}", "1".repeat(64))),
            capability_generation: 12,
            source_conversation_id: "conversation-1".into(),
            turn_id: "turn-1".into(),
            dispatch_receipt_id: "dispatch-1".into(),
            cancellation_epoch: 7,
        }
    }

    #[test]
    fn exposes_only_the_six_semantic_communication_tools() {
        let mut names = LucaCommunicationsMcp::tool_router()
            .list_all()
            .into_iter()
            .map(|tool| tool.name.to_string())
            .collect::<Vec<_>>();
        names.sort();
        assert_eq!(
            names,
            vec![
                "communications_conversation",
                "communications_create_private_room",
                "communications_inbox",
                "communications_invite",
                "communications_react",
                "communications_send",
            ]
        );
        assert!(!names.iter().any(|name| {
            ["raw", "nostr", "shell", "sign", "delete", "edit", "admin"]
                .iter()
                .any(|forbidden| name.contains(forbidden))
        }));
    }

    #[test]
    fn private_room_shape_is_bounded_and_same_owner_semantic_only() {
        let params: CommunicationsCreatePrivateRoomParams =
            serde_json::from_value(serde_json::json!({
                "label": "Release room",
                "purpose": "Coordinate the functional preview.",
                "participant_pubkeys": [event_id('b')],
            }))
            .expect("private room request");
        assert!(params.validate().is_ok());

        let blank: CommunicationsCreatePrivateRoomParams =
            serde_json::from_value(serde_json::json!({"label": " "})).expect("syntactic request");
        assert!(blank.validate().is_err());

        let duplicate: CommunicationsCreatePrivateRoomParams =
            serde_json::from_value(serde_json::json!({
                "label": "Room",
                "participant_pubkeys": [event_id('c'), event_id('c')],
            }))
            .expect("syntactic request");
        assert!(duplicate.validate().is_err());
    }

    #[test]
    fn repository_and_communications_personalities_are_process_exclusive() {
        assert!(validate_personality_modes(Some("1"), None).is_ok());
        assert!(validate_personality_modes(Some("1"), Some("1")).is_err());
        assert!(validate_personality_modes(None, None).is_err());
    }

    #[test]
    fn send_keeps_reply_and_thread_shapes_typed() {
        let message: CommunicationsSendParams = serde_json::from_value(serde_json::json!({
            "destination": {"destination_type": "current_conversation"},
            "body": "A bounded reply",
            "reply": {"reply_type": "message", "event_id": event_id('1')},
            "mention_pubkeys": [event_id('2')],
            "activation_pubkeys": [event_id('2')],
            "artifact_handle_ids": [],
        }))
        .expect("typed message");
        assert!(message.validate().is_ok());

        let thread: CommunicationsSendParams = serde_json::from_value(serde_json::json!({
            "destination": {"destination_type": "current_conversation"},
            "body": "A bounded thread reply",
            "reply": {
                "reply_type": "thread",
                "thread_root_event_id": event_id('3'),
                "reply_to_event_id": event_id('4')
            }
        }))
        .expect("typed thread reply");
        assert!(thread.validate().is_ok());

        let raw_tags = serde_json::from_value::<CommunicationsSendParams>(serde_json::json!({
            "destination": {"destination_type": "current_conversation"},
            "body": "unsafe",
            "tags": [["e", event_id('5')]]
        }));
        assert!(raw_tags.is_err());
    }

    #[test]
    fn activation_must_be_an_explicit_mention_subset() {
        let params: CommunicationsSendParams = serde_json::from_value(serde_json::json!({
            "destination": {"destination_type": "current_conversation"},
            "body": "hello",
            "activation_pubkeys": [event_id('6')]
        }))
        .expect("syntactic request");
        assert!(params.validate().is_err());
    }

    #[test]
    fn reaction_add_and_remove_are_mutually_typed() {
        let add: CommunicationsReactParams = serde_json::from_value(serde_json::json!({
            "mutation": {
                "action": "add",
                "target_event_id": event_id('7'),
                "reaction": "👍"
            }
        }))
        .expect("add");
        assert!(add.validate().is_ok());

        let remove: CommunicationsReactParams = serde_json::from_value(serde_json::json!({
            "mutation": {
                "action": "remove",
                "target_event_id": event_id('8'),
                "reaction_event_id": event_id('9')
            }
        }))
        .expect("remove");
        assert!(remove.validate().is_ok());

        let destructive = serde_json::from_value::<CommunicationsReactParams>(serde_json::json!({
            "mutation": {
                "action": "delete",
                "target_event_id": event_id('a')
            }
        }));
        assert!(destructive.is_err());
    }

    #[test]
    fn invitation_activation_is_reserved_for_com_103() {
        let membership_only: CommunicationsInviteParams =
            serde_json::from_value(serde_json::json!({
                "participant_pubkey": event_id('d'),
                "request_activation": false,
            }))
            .expect("membership request");
        assert!(membership_only.validate().is_ok());

        let activation: CommunicationsInviteParams = serde_json::from_value(serde_json::json!({
            "participant_pubkey": event_id('d'),
            "request_activation": true,
        }))
        .expect("syntactic request");
        assert!(activation.validate().is_err());
    }

    #[test]
    fn receipt_must_match_operation_and_capability_generation() {
        let client = client();
        let response = BrokerResponseV1 {
            protocol: BROKER_PROTOCOL.into(),
            ok: true,
            content: "published".into(),
            receipt: BrokerReceiptV1 {
                protocol: BROKER_RECEIPT_PROTOCOL.into(),
                receipt_id: "receipt-1".into(),
                operation: "send".into(),
                capability_generation: 12,
                source_conversation_id: "conversation-1".into(),
                turn_id: "turn-1".into(),
                dispatch_receipt_id: "dispatch-1".into(),
                cancellation_epoch: 7,
                diagnostic_code: None,
            },
        };
        assert!(response.validate(BrokerOperation::Send, &client).is_ok());
        assert!(response.validate(BrokerOperation::React, &client).is_err());
        let mut other_generation = client.clone();
        other_generation.capability_generation = 13;
        assert!(response
            .validate(BrokerOperation::Send, &other_generation)
            .is_err());
        let mut later_turn = client.clone();
        later_turn.turn_id = "turn-2".into();
        assert!(response
            .validate(BrokerOperation::Send, &later_turn)
            .is_err());
    }

    #[test]
    fn only_turn_not_active_gets_the_bounded_registration_retry() {
        let mut response = BrokerResponseV1 {
            protocol: BROKER_PROTOCOL.into(),
            ok: false,
            content: "not ready".into(),
            receipt: BrokerReceiptV1 {
                protocol: BROKER_RECEIPT_PROTOCOL.into(),
                receipt_id: "receipt-1".into(),
                operation: "send".into(),
                capability_generation: 12,
                source_conversation_id: "conversation-1".into(),
                turn_id: "turn-1".into(),
                dispatch_receipt_id: "dispatch-1".into(),
                cancellation_epoch: 7,
                diagnostic_code: Some("turn_not_active".into()),
            },
        };
        assert!(should_retry_turn_not_active(&response));
        response.receipt.diagnostic_code = Some("permission_denied".into());
        assert!(!should_retry_turn_not_active(&response));
        response.ok = true;
        response.receipt.diagnostic_code = Some("turn_not_active".into());
        assert!(!should_retry_turn_not_active(&response));
    }

    #[test]
    fn every_tool_invocation_mints_a_distinct_v4_request_id() {
        let first = mint_operation_request_id();
        let second = mint_operation_request_id();
        assert_ne!(first, second);
        assert_eq!(first.len(), 36);
        assert_eq!(&first[14..15], "4");
        assert!(matches!(&first[19..20], "8" | "9" | "a" | "b"));
        assert!(first
            .chars()
            .enumerate()
            .all(
                |(index, value)| matches!(index, 8 | 13 | 18 | 23) && value == '-'
                    || !matches!(index, 8 | 13 | 18 | 23) && value.is_ascii_hexdigit()
            ));
    }

    #[test]
    fn validators_reject_paths_and_unbounded_pages() {
        assert!(is_opaque_id("conversation-1"));
        assert!(!is_opaque_id("../conversation"));
        assert!(validate_cursor_and_limit(Some("cursor-1"), Some(256)).is_ok());
        assert!(validate_cursor_and_limit(Some("cursor-1"), Some(257)).is_err());
    }
}
