//! Setup-mode listener for not-ready agents.
//!
//! When the desktop determines an agent is `NotReady` (missing provider,
//! model, or credentials), it spawns `buzz-acp` with a setup-mode payload
//! instead of starting the normal agent pool. This module implements that
//! early-branch path:
//!
//! ```text
//! Config::from_cli()
//!   └─ SetupPayload::from_env()?
//!        ├─ Some(payload) → run_setup_listener(config, payload)  [this module]
//!        └─ None          → normal pool path (unchanged)
//! ```
//!
//! # Contract (NON-NEGOTIABLE)
//!
//! * **Desktop is the ONLY readiness source.** `buzz-acp` trusts the payload
//!   passed by the desktop and does NOT re-derive readiness.
//! * **Normal startup gains no second readiness path.** The early branch is
//!   entered only when `BUZZ_ACP_SETUP_PAYLOAD` is set.
//! * Setup publication follows the configured identity boundary: legacy
//!   harnesses sign locally, while Luca-managed residents use the existing
//!   typed relay-auth and final-publication broker.
//!
//! # Nudge mechanics
//!
//! Connect → subscribe → on each matching event:
//! 1. Apply `ignore_self` gate.
//! 2. Apply the `classify_author` gate (same as normal mode) so the nudge goes
//!    only to authors the real agent would answer.
//! 3. Require an explicit @mention via `event_mentions_agent`.
//! 4. Apply `filter::match_event` so channel/kind rules still constrain.
//! 5. Build and publish a nudge reply (surface-correct copy).
//! 6. Deduplicate by event-id (reconnect replay must not double-nudge).

use std::{collections::HashSet, sync::Arc};

use anyhow::Result;
use buzz_core::kind::{
    KIND_MEMBER_ADDED_NOTIFICATION, KIND_MEMBER_REMOVED_NOTIFICATION, KIND_STREAM_MESSAGE,
    KIND_WORKFLOW_APPROVAL_REQUESTED,
};
use nostr::EventId;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ── Availability mirror ────────────────────────────────────────────────────────

/// Granular install/auth state for a CLI-backed ACP harness.
///
/// Mirrors the desktop `AcpAvailabilityStatus` enum (and the FE
/// `AcpAvailabilityStatus` type in `api/types.ts`). Carried on
/// `RequirementPayload::CliLogin` so the sentinel JSON the desktop parses
/// contains the exact wire literals the FE expects.
///
/// buzz-acp is a separate crate and must NOT depend on desktop types —
/// this explicit mirror is the correct pattern (same as the rest of
/// `RequirementPayload` as "the Rust counterpart to desktop's `Requirement`").
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AcpAvailabilityStatus {
    /// Adapter + CLI both present; may still need login.
    Available,
    /// ACP adapter binary missing; underlying CLI may be present.
    AdapterMissing,
    /// ACP adapter binary is from the deprecated package (< 1.0). Reinstall required.
    AdapterOutdated,
    /// CLI binary missing; ACP adapter may be present.
    CliMissing,
    /// Neither adapter nor CLI found.
    NotInstalled,
}

use crate::{
    classify_author,
    config::{Config, IdentityConfig},
    event_mentions_agent, filter,
    luca_final_publisher::{ManagedFinalPublisherContext, ManagedFinalTurn},
    relay::{HarnessRelay, RelayEventPublisher},
};

// ── Payload ───────────────────────────────────────────────────────────────────

/// Env var carrying the JSON-encoded setup payload.
pub(crate) const SETUP_PAYLOAD_ENV_VAR: &str = "BUZZ_ACP_SETUP_PAYLOAD";

/// A single missing requirement, surface-discriminated so the nudge copy
/// names exactly what to set and where.
///
/// This is the Rust counterpart to the desktop's `Requirement` type
/// (`managed_agents/readiness.rs`). Desktop serializes it; `buzz-acp`
/// deserializes and renders copy from it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "surface", rename_all = "snake_case")]
pub(crate) enum RequirementPayload {
    /// A normalized dropdown field (provider or model) missing.
    NormalizedField { field: String },
    /// An env-backed credential that is absent.
    EnvKey { key: String },
    /// A CLI authentication step that must be completed interactively.
    CliLogin {
        probe_args: Vec<String>,
        setup_copy: String,
        /// Granular install/auth state — determines copy and CTA routing on
        /// the desktop card. `Available` means tooling is present but login
        /// is needed; the other three variants mean the tooling itself is
        /// missing and the probe was skipped.
        availability: AcpAvailabilityStatus,
    },
    /// The CLI is installed but its config file could not be parsed.
    /// Informational only — no in-app action can fix an external config file.
    CliConfigInvalid {
        probe_args: Vec<String>,
        setup_copy: String,
        /// One-line stderr excerpt identifying the parse error.
        diagnostic: String,
    },
    /// Git for Windows is missing; open Agent runtimes for the installation guide.
    GitBash,
}

impl RequirementPayload {
    /// Human-readable instruction fragment for the nudge copy.
    fn instruction(&self) -> String {
        match self {
            RequirementPayload::NormalizedField { field } => {
                format!("set the **{}** field in Edit Agent dropdowns", field)
            }
            RequirementPayload::EnvKey { key } => {
                format!("set `{}` in Edit Agent → Environment variables", key)
            }
            RequirementPayload::CliLogin {
                setup_copy,
                availability,
                probe_args,
            } => match availability {
                AcpAvailabilityStatus::Available => setup_copy.clone(),
                AcpAvailabilityStatus::AdapterMissing => {
                    let harness = probe_args
                        .first()
                        .map(String::as_str)
                        .unwrap_or("the agent");
                    format!(
                        "install the {} ACP adapter (open Agent runtimes in Settings to diagnose)",
                        harness
                    )
                }
                AcpAvailabilityStatus::AdapterOutdated => {
                    let harness = probe_args
                        .first()
                        .map(String::as_str)
                        .unwrap_or("the agent");
                    format!(
                        "reinstall the {} ACP adapter — the installed version is outdated (open Agent runtimes in Settings to diagnose)",
                        harness
                    )
                }
                AcpAvailabilityStatus::CliMissing => {
                    let harness = probe_args
                        .first()
                        .map(String::as_str)
                        .unwrap_or("the agent");
                    format!(
                        "install {} CLI (open Agent runtimes in Settings to diagnose)",
                        harness
                    )
                }
                AcpAvailabilityStatus::NotInstalled => {
                    let harness = probe_args
                        .first()
                        .map(String::as_str)
                        .unwrap_or("the agent");
                    format!(
                        "install {} (open Agent runtimes in Settings to diagnose)",
                        harness
                    )
                }
            },
            RequirementPayload::CliConfigInvalid {
                probe_args,
                diagnostic,
                ..
            } => {
                let cli = probe_args.first().map(String::as_str).unwrap_or("the CLI");
                let config_file = format!("~/.{}/config.toml", cli);
                format!(
                    "{} is invalid: {} — fix the config and restart the agent",
                    config_file, diagnostic
                )
            }
            RequirementPayload::GitBash => {
                "install Git for Windows (open Agent runtimes in Settings to diagnose)".to_string()
            }
        }
    }
}

/// The full setup payload passed by the desktop when spawning in setup mode.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct SetupPayload {
    /// Human-readable agent display name (for the nudge message).
    pub agent_name: String,
    /// Hex-encoded agent pubkey. Carried so the desktop card can open
    /// the Edit Agent dialog for this agent directly from the nudge.
    pub agent_pubkey: String,
    /// Surface-discriminated list of missing requirements.
    pub requirements: Vec<RequirementPayload>,
}

impl SetupPayload {
    /// Read and deserialize the setup payload from the env var, if present.
    ///
    /// Returns `Ok(None)` when the env var is absent (normal mode).
    /// Returns `Err` if the var is present but malformed.
    pub(crate) fn from_env() -> Result<Option<Self>> {
        Self::from_raw_env_value(std::env::var(SETUP_PAYLOAD_ENV_VAR).ok())
    }

    /// Parse an optional raw env-var value into a `SetupPayload`.
    ///
    /// `None` or empty string → `Ok(None)` (normal mode, no setup payload).
    /// Non-empty, valid JSON → `Ok(Some(payload))`.
    /// Non-empty, malformed JSON → `Err`.
    ///
    /// This is the pure core of `from_env()` and is the preferred target for
    /// unit tests — it requires no global env mutation and is safe to call
    /// concurrently.
    pub(crate) fn from_raw_env_value(raw: Option<String>) -> Result<Option<Self>> {
        let raw = match raw {
            Some(v) if !v.is_empty() => v,
            _ => return Ok(None),
        };
        let payload = serde_json::from_str::<Self>(&raw)
            .map_err(|e| anyhow::anyhow!("malformed {SETUP_PAYLOAD_ENV_VAR}: {e}"))?;
        Ok(Some(payload))
    }

    /// Build the nudge message body from the requirements.
    ///
    /// The body contains two parts separated by a blank line:
    /// 1. Human-readable markdown (unchanged; used by CLI and non-card clients).
    /// 2. A fenced `buzz:config-nudge` sentinel block containing the structured
    ///    payload as JSON. The desktop client parses this block to render a
    ///    `ConfigNudgeCard`; clients that don't understand it see a code block.
    fn nudge_body(&self) -> String {
        let prose = if self.requirements.is_empty() {
            format!(
                "**{}** needs configuration before it can respond. Open Edit Agent to configure it.",
                self.agent_name,
            )
        } else {
            let steps: Vec<String> = self
                .requirements
                .iter()
                .map(|r| format!("- {}", r.instruction()))
                .collect();

            let has_doctor_requirement = self
                .requirements
                .iter()
                .any(|r| matches!(r, RequirementPayload::GitBash));
            let all_external = self
                .requirements
                .iter()
                .all(|r| matches!(r, RequirementPayload::CliConfigInvalid { .. }));
            let any_external = self
                .requirements
                .iter()
                .any(|r| matches!(r, RequirementPayload::CliConfigInvalid { .. }));

            let footer = if has_doctor_requirement {
                "Open Agent runtimes in Settings, install Git for Windows, then re-check and restart the agent.".to_string()
            } else if all_external {
                // All requirements are external config files — Edit Agent cannot
                // help. Don't send the user there.
                "Fix the config file(s) and restart the agent.".to_string()
            } else if any_external {
                // Mixed: some Luca-managed fields, some external config.
                "Open the agent in Luca Settings for the Luca-managed fields; fix the external CLI config files manually and restart the agent.".to_string()
            } else {
                // All Luca-managed.
                "Open the agent in Luca Settings to set these.".to_string()
            };

            format!(
                "**{}** needs configuration before it can respond:\n{}\n\n{}",
                self.agent_name,
                steps.join("\n"),
                footer,
            )
        };

        // SAFETY: `self` is fully `Serialize`; this can only fail if the types
        // contain non-string map keys, which they don't — panic is acceptable.
        let sentinel_json =
            serde_json::to_string(self).expect("SetupPayload must be serializable to JSON");

        format!("{}\n\n```buzz:config-nudge\n{}\n```", prose, sentinel_json)
    }
}

// ── setup listener ────────────────────────────────────────────────────────────

/// Run the setup-mode event loop.
///
/// Connects to the relay, subscribes to channels, and responds to @mentions
/// of this agent with a surface-correct setup nudge. Never starts the agent
/// pool. Reconnects on relay close (mirroring normal mode) so the nudge
/// listener survives transient disconnects; `nudged_event_ids` deduplication
/// guards against replay on reconnect.
pub(crate) async fn run_setup_listener(config: Config, payload: SetupPayload) -> Result<()> {
    tracing::info!(
        agent = %payload.agent_name,
        requirements = payload.requirements.len(),
        "buzz-acp entering setup mode"
    );

    let pubkey_hex = config.identity.public_key().to_hex();

    // Parse BUZZ_AUTH_TAG for relay membership / NIP-OA.
    let relay_auth_tag: Option<nostr::Tag> = if config.identity.is_managed() {
        None
    } else {
        std::env::var("BUZZ_AUTH_TAG")
            .ok()
            .filter(|s| !s.is_empty())
            .and_then(|s| buzz_sdk::nip_oa::parse_auth_tag(&s).ok())
    };

    let startup_watermark: u64 = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let mut relay = match &config.identity {
        IdentityConfig::Legacy(keys) => {
            HarnessRelay::connect(&config.relay_url, keys, &pubkey_hex, relay_auth_tag).await
        }
        IdentityConfig::Managed {
            resident_pubkey,
            broker,
            owner_attestation,
            ..
        } => {
            HarnessRelay::connect_managed(
                &config.relay_url,
                resident_pubkey.clone(),
                Arc::clone(broker),
                owner_attestation.clone(),
            )
            .await
        }
    }
    .map_err(|e| anyhow::anyhow!("setup-mode relay connect error: {e}"))?;

    if let Err(e) = relay.set_startup_watermark(startup_watermark).await {
        tracing::warn!("setup-mode: failed to set startup watermark: {e}");
    }

    relay
        .subscribe_membership_notifications()
        .await
        .map_err(|e| anyhow::anyhow!("setup-mode membership subscribe error: {e}"))?;

    tracing::info!("setup-mode: connected and subscribed to membership notifications");

    // Resolve owner for author-gate (same priority as normal mode).
    let startup_owner = crate::resolve_agent_owner(&config);
    let owner_cache = crate::OwnerCache::new(startup_owner.clone());

    // Discover channels and subscribe (using a "mentions" rule so we get
    // notified when someone @-mentions the agent).
    let channel_info_map = relay
        .discover_channels()
        .await
        .map_err(|e| anyhow::anyhow!("setup-mode channel discovery error: {e}"))?;

    tracing::info!(
        "setup-mode: discovered {} channel(s)",
        channel_info_map.len()
    );

    let channel_ids: Vec<Uuid> = channel_info_map.keys().copied().collect();

    // Build subscription rules: mentions only (setup mode must not react to
    // every message in a channel).
    let rules = build_setup_subscription_rules(&config);

    let channel_filters = crate::config::resolve_channel_filters(&config, &channel_ids, &rules);

    if channel_filters.is_empty() {
        tracing::warn!(
            "setup-mode: no channel subscriptions resolved — nudge listener will sit idle"
        );
    }

    for (channel_id, filter) in &channel_filters {
        if let Err(e) = relay.subscribe_channel(*channel_id, filter.clone()).await {
            tracing::warn!("setup-mode: failed to subscribe to channel {channel_id}: {e}");
        } else {
            tracing::info!("setup-mode: subscribed to channel {channel_id}");
        }
    }

    let publisher = match &config.identity {
        IdentityConfig::Legacy(keys) => SetupNudgePublisher::Legacy {
            relay: relay.event_publisher(),
            keys: keys.clone(),
        },
        IdentityConfig::Managed {
            resident_pubkey,
            broker,
            session_epoch,
            ..
        } => SetupNudgePublisher::Managed(ManagedFinalPublisherContext {
            broker: Arc::clone(broker),
            owner_pubkey: crate::managed_final_owner(startup_owner.as_deref())?,
            resident_pubkey: resident_pubkey.clone(),
            session_epoch: *session_epoch,
        }),
    };
    let rest_client = relay.rest_client();

    // Deduplicate by event-id so reconnect replay cannot double-nudge.
    let mut nudged_event_ids: HashSet<EventId> = HashSet::new();

    loop {
        let Some(buzz_event) = relay.next_event().await else {
            tracing::warn!("setup-mode: relay event stream ended — requesting reconnect");
            if let Err(e) = relay.reconnect().await {
                tracing::error!("setup-mode: relay background task is gone: {e} — exiting");
                break;
            }
            continue;
        };

        let kind_u32 = buzz_event.event.kind.as_u16() as u32;

        // Handle membership notifications so we subscribe to new channels
        // and drop removed ones — no session/queue drain needed (no pool).
        if kind_u32 == KIND_MEMBER_ADDED_NOTIFICATION
            || kind_u32 == KIND_MEMBER_REMOVED_NOTIFICATION
        {
            handle_setup_membership(&mut relay, &buzz_event, &config, &rules, &channel_ids).await;
            continue;
        }

        // Ignore non-message kinds (relay housekeeping, etc.).
        if kind_u32 != KIND_STREAM_MESSAGE && kind_u32 != KIND_WORKFLOW_APPROVAL_REQUESTED {
            continue;
        }

        // ignore_self: don't react to our own messages.
        if buzz_event.event.pubkey.to_hex() == pubkey_hex {
            continue;
        }

        // Require an explicit @mention of this agent — setup mode must not
        // nudge on every channel event even if subscribe_mode is "all".
        if !event_mentions_agent(&buzz_event.event, &pubkey_hex) {
            continue;
        }

        // Apply the same author gate as normal mode so the nudge only goes
        // to authors the real agent would have answered.
        let author_hex = buzz_event.event.pubkey.to_hex();
        // The exchange gate does not apply here: setup mode never runs a turn,
        // it only tells the author the resident is not configured yet. Being
        // admitted at all is the whole test.
        let allowed = classify_author(
            &config.respond_to,
            &config.respond_to_allowlist,
            &author_hex,
            &owner_cache,
            &rest_client,
        )
        .await
            != crate::AuthorAdmission::Denied;

        // Apply channel/kind filter rules.
        let filter_matched = filter::match_event(
            &buzz_event.event,
            buzz_event.channel_id,
            &rules,
            &pubkey_hex,
        )
        .await
        .is_some();

        // Pure gate: author gate verdict + event-id dedup.
        if !should_nudge_for_setup_event(
            publisher.managed_owner(),
            &buzz_event.event,
            allowed,
            filter_matched,
            &mut nudged_event_ids,
        ) {
            continue;
        }

        // Build and publish the setup nudge.
        if let Err(e) = publish_setup_nudge(
            &publisher,
            buzz_event.channel_id,
            &buzz_event.event,
            &payload,
        )
        .await
        {
            tracing::warn!("setup-mode: failed to publish nudge: {e}");
        } else {
            tracing::info!(
                channel_id = %buzz_event.channel_id,
                event_id = %buzz_event.event.id,
                "setup-mode: nudge published"
            );
        }
    }

    Ok(())
}

enum SetupNudgePublisher {
    Legacy {
        relay: RelayEventPublisher,
        keys: nostr::Keys,
    },
    Managed(ManagedFinalPublisherContext),
}

impl SetupNudgePublisher {
    fn managed_owner(&self) -> Option<&luca_protocol::Hex64> {
        match self {
            Self::Legacy { .. } => None,
            Self::Managed(context) => Some(&context.owner_pubkey),
        }
    }
}

/// Apply the narrower managed publication authority before event-id dedup.
///
/// Legacy setup listeners preserve their existing event surface. A managed
/// final, however, is authorized only for the configured owner's exact valid
/// kind:9 dispatch, so workflow events and non-owner messages must never enter
/// the dedup set and then fail later at the typed broker boundary.
#[must_use]
fn should_nudge_for_setup_event(
    managed_owner: Option<&luca_protocol::Hex64>,
    event: &nostr::Event,
    author_allowed: bool,
    filter_matched: bool,
    nudged_event_ids: &mut HashSet<EventId>,
) -> bool {
    if managed_owner.is_some_and(|owner| !ManagedFinalTurn::is_eligible_trigger(owner, event, None))
    {
        tracing::debug!(
            event_id = %event.id,
            "setup-mode: event is outside managed publication authority"
        );
        return false;
    }
    should_nudge_for_event(event.id, author_allowed, filter_matched, nudged_event_ids)
}

/// Outcome of the pure per-event gate checks in setup mode.
///
/// Callers compute the async gates (`classify_author`, `filter::match_event`)
/// up-front, then pass the boolean results here. This helper handles
/// everything that is synchronous and stateful: the author gate verdict
/// and event-id dedup.
///
/// Returns `true` when the event should produce a nudge.
#[must_use]
pub(crate) fn should_nudge_for_event(
    event_id: EventId,
    author_allowed: bool,
    filter_matched: bool,
    nudged_event_ids: &mut HashSet<EventId>,
) -> bool {
    if !author_allowed {
        tracing::debug!("setup-mode: event filtered by author gate");
        return false;
    }
    if !filter_matched {
        return false;
    }
    if !nudged_event_ids.insert(event_id) {
        tracing::debug!(%event_id, "setup-mode: skipping already-nudged event");
        return false;
    }
    true
}

/// Build the subscription rules used in setup mode.
///
/// Always uses "mentions" mode: setup mode must not react to every event.
/// Even if the agent's normal config is `subscribe_mode = all`, setup mode
/// enforces explicit @mention filtering (see `event_mentions_agent` call in
/// the loop above).
fn build_setup_subscription_rules(config: &Config) -> Vec<filter::SubscriptionRule> {
    use crate::config::SubscribeMode;

    let kinds = config
        .kinds_override
        .clone()
        .unwrap_or_else(|| vec![KIND_STREAM_MESSAGE, KIND_WORKFLOW_APPROVAL_REQUESTED]);

    match &config.subscribe_mode {
        // Config mode: load the actual rules, but they will be filtered by
        // the explicit event_mentions_agent check in the main loop anyway.
        SubscribeMode::Config => match crate::config::load_rules(&config.config_path) {
            Ok(rules) => rules,
            Err(e) => {
                tracing::warn!(
                    "setup-mode: could not load config rules ({e}); falling back to mentions"
                );
                vec![mentions_rule(kinds)]
            }
        },
        _ => vec![mentions_rule(kinds)],
    }
}

fn mentions_rule(kinds: Vec<u32>) -> filter::SubscriptionRule {
    use std::sync::{atomic::AtomicU32, Arc};
    filter::SubscriptionRule {
        name: "setup-mentions".into(),
        channels: filter::ChannelScope::All("all".into()),
        kinds,
        require_mention: true,
        filter: None,
        compiled_filter: None,
        consecutive_timeouts: Arc::new(AtomicU32::new(0)),
        prompt_tag: Some("@mention".into()),
    }
}

/// Handle membership add/remove events in setup mode.
///
/// Subscribe new channels; unsubscribe removed ones. No queue/session
/// teardown — there is no pool.
async fn handle_setup_membership(
    relay: &mut HarnessRelay,
    buzz_event: &crate::relay::BuzzEvent,
    config: &Config,
    rules: &[filter::SubscriptionRule],
    _initial_channel_ids: &[Uuid],
) {
    let kind_u32 = buzz_event.event.kind.as_u16() as u32;
    let channel_id = buzz_event.channel_id;

    if kind_u32 == KIND_MEMBER_ADDED_NOTIFICATION {
        // Subscribe to the newly-joined channel.
        let ids = vec![channel_id];
        let filters = crate::config::resolve_channel_filters(config, &ids, rules);
        for (cid, filter) in filters {
            if let Err(e) = relay.subscribe_channel(cid, filter).await {
                tracing::warn!("setup-mode: failed to subscribe to new channel {cid}: {e}");
            } else {
                tracing::info!("setup-mode: subscribed to new channel {cid}");
            }
        }
    } else if kind_u32 == KIND_MEMBER_REMOVED_NOTIFICATION {
        if let Err(e) = relay.unsubscribe_channel(channel_id).await {
            tracing::warn!("setup-mode: failed to unsubscribe from channel {channel_id}: {e}");
        }
    }
}

/// Build and publish a setup nudge reply to the triggering event.
///
/// Legacy publication keeps the historical flat reply to the thread root.
/// Managed publication uses the exact app-staged dispatch route and typed
/// broker, just like an ordinary managed final. Both paths P-tag the asker.
async fn publish_setup_nudge(
    publisher: &SetupNudgePublisher,
    channel_id: Uuid,
    triggering_event: &nostr::Event,
    payload: &SetupPayload,
) -> Result<()> {
    match publisher {
        SetupNudgePublisher::Legacy { relay, keys } => {
            publish_legacy_setup_nudge(relay, keys, channel_id, triggering_event, payload).await
        }
        SetupNudgePublisher::Managed(context) => {
            let turn_id = triggering_event.id.to_hex();
            let turn = ManagedFinalTurn::from_triggering_event(
                context,
                &turn_id,
                channel_id,
                triggering_event,
                None,
            )
            .map_err(|error| anyhow::anyhow!("invalid managed setup nudge route: {error}"))?;
            let now_unix_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
                .try_into()
                .unwrap_or(u64::MAX);
            match turn
                .handoff(
                    Arc::clone(&context.broker),
                    payload.nudge_body(),
                    now_unix_ms,
                )
                .await?
            {
                luca_protocol::ManagedMessagePublishResultV1::Published { .. }
                | luca_protocol::ManagedMessagePublishResultV1::Replayed { .. } => Ok(()),
                result => Err(anyhow::anyhow!(
                    "managed setup nudge publication was not accepted: {result:?}"
                )),
            }
        }
    }
}

async fn publish_legacy_setup_nudge(
    publisher: &RelayEventPublisher,
    keys: &nostr::Keys,
    channel_id: Uuid,
    triggering_event: &nostr::Event,
    payload: &SetupPayload,
) -> Result<()> {
    use buzz_sdk::ThreadRef;

    // Parse NIP-10 thread tags to determine reply target.
    let thread_tags = crate::queue::parse_thread_tags(triggering_event);

    let thread_ref = if let Some(root_str) = &thread_tags.root_event_id {
        // Threaded event: reply flat to the root.
        let root_id = nostr::EventId::from_hex(root_str)
            .map_err(|e| anyhow::anyhow!("invalid root event id: {e}"))?;
        Some(ThreadRef {
            root_event_id: root_id,
            parent_event_id: root_id,
        })
    } else {
        // Top-level event: reply to the triggering event.
        Some(ThreadRef {
            root_event_id: triggering_event.id,
            parent_event_id: triggering_event.id,
        })
    };

    let body = payload.nudge_body();
    let author_hex = triggering_event.pubkey.to_hex();

    let event_builder = buzz_sdk::build_message(
        channel_id,
        &body,
        thread_ref.as_ref(),
        &[&author_hex], // p-tag the asker
        false,
        &[],
    )
    .map_err(|e| anyhow::anyhow!("failed to build setup nudge: {e}"))?;

    let signed = event_builder
        .sign_with_keys(keys)
        .map_err(|e| anyhow::anyhow!("failed to sign setup nudge: {e}"))?;

    publisher
        .publish_event(signed)
        .await
        .map_err(|e| anyhow::anyhow!("failed to publish setup nudge: {e}"))?;

    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn setup_payload_from_raw_returns_none_when_absent() {
        // None → Ok(None): normal startup, no setup payload.
        let result = SetupPayload::from_raw_env_value(None).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn setup_payload_from_raw_returns_none_on_empty_string() {
        // Empty string → Ok(None): treated the same as absent.
        let result = SetupPayload::from_raw_env_value(Some(String::new())).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn setup_payload_from_raw_returns_err_on_malformed_json() {
        // Malformed JSON → Err: no global env mutation, safe to run concurrently.
        let result = SetupPayload::from_raw_env_value(Some("not-valid-json{{{".into()));
        assert!(result.is_err(), "malformed JSON must return Err");
    }

    #[test]
    fn setup_payload_deserializes_correctly() {
        let json = r#"{
            "agent_name": "Fizz",
            "agent_pubkey": "aabbccddeeff0011",
            "requirements": [
                {"surface": "normalized_field", "field": "provider"},
                {"surface": "env_key", "key": "ANTHROPIC_API_KEY"}
            ]
        }"#;
        let payload: SetupPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.agent_name, "Fizz");
        assert_eq!(payload.requirements.len(), 2);
    }

    #[test]
    fn setup_payload_deserializes_git_bash_requirement() {
        let payload: SetupPayload = serde_json::from_str(
            r#"{"agent_name":"Buzz Agent","agent_pubkey":"test","requirements":[{"surface":"git_bash"}]}"#,
        )
        .unwrap();
        assert!(matches!(
            payload.requirements.as_slice(),
            [RequirementPayload::GitBash]
        ));
    }

    #[test]
    fn nudge_body_names_all_requirements() {
        let payload = SetupPayload {
            agent_name: "Fizz".to_string(),
            agent_pubkey: "test".to_string(),
            requirements: vec![
                RequirementPayload::NormalizedField {
                    field: "provider".to_string(),
                },
                RequirementPayload::EnvKey {
                    key: "ANTHROPIC_API_KEY".to_string(),
                },
            ],
        };
        let body = payload.nudge_body();
        assert!(
            body.contains("provider"),
            "nudge body should mention the missing provider field"
        );
        assert!(
            body.contains("ANTHROPIC_API_KEY"),
            "nudge body should mention the missing env key"
        );
        assert!(body.contains("Fizz"), "nudge body should name the agent");
    }

    #[test]
    fn nudge_body_codex_copy_does_not_mention_openai_api_key() {
        let payload = SetupPayload {
            agent_name: "Codex".to_string(),
            agent_pubkey: "test".to_string(),
            requirements: vec![RequirementPayload::CliLogin {
                probe_args: vec![
                    "codex".to_string(),
                    "login".to_string(),
                    "status".to_string(),
                ],
                setup_copy: "run `codex login`".to_string(),
                availability: AcpAvailabilityStatus::Available,
            }],
        };
        let body = payload.nudge_body();
        assert!(
            !body.contains("OPENAI_API_KEY"),
            "codex nudge must not mention OPENAI_API_KEY; got: {body:?}"
        );
        assert!(
            body.contains("codex login"),
            "codex nudge must mention `codex login`; got: {body:?}"
        );
    }

    #[test]
    fn nudge_body_runtime_install_copy_points_to_agent_runtimes() {
        for availability in [
            AcpAvailabilityStatus::AdapterMissing,
            AcpAvailabilityStatus::AdapterOutdated,
            AcpAvailabilityStatus::CliMissing,
            AcpAvailabilityStatus::NotInstalled,
        ] {
            let payload = SetupPayload {
                agent_name: "Codex".to_string(),
                agent_pubkey: "test".to_string(),
                requirements: vec![RequirementPayload::CliLogin {
                    probe_args: vec!["codex".to_string()],
                    setup_copy: "run `codex login`".to_string(),
                    availability,
                }],
            };
            let body = payload.nudge_body();
            assert!(
                body.contains("Agent runtimes in Settings"),
                "runtime install nudge must point to Agent runtimes; got: {body:?}"
            );
            assert!(
                !body.contains("Doctor"),
                "runtime install nudge must not point to the removed Doctor section; got: {body:?}"
            );
        }
    }

    #[test]
    fn nudge_body_git_bash_copy_points_to_agent_runtimes() {
        let payload = SetupPayload {
            agent_name: "Buzz Agent".to_string(),
            agent_pubkey: "test".to_string(),
            requirements: vec![RequirementPayload::GitBash],
        };
        let body = payload.nudge_body();
        assert!(
            body.contains("Open Agent runtimes in Settings"),
            "Git Bash nudge must point to Agent runtimes; got: {body:?}"
        );
        assert!(
            !body.contains("Doctor"),
            "Git Bash nudge must not point to the removed Doctor section; got: {body:?}"
        );
    }

    #[test]
    fn nudge_body_empty_requirements_falls_back_to_generic() {
        let payload = SetupPayload {
            agent_name: "Fizz".to_string(),
            agent_pubkey: "test".to_string(),
            requirements: vec![],
        };
        let body = payload.nudge_body();
        assert!(body.contains("Fizz"));
        assert!(body.contains("needs configuration"));
    }

    // ── config-invalid footer tests ────────────────────────────────────────────

    fn make_cli_config_invalid(cli: &str, diagnostic: &str) -> RequirementPayload {
        RequirementPayload::CliConfigInvalid {
            probe_args: vec![cli.to_string()],
            setup_copy: String::new(),
            diagnostic: diagnostic.to_string(),
        }
    }

    #[test]
    fn nudge_body_all_config_invalid_omits_edit_agent_footer() {
        // An all-CliConfigInvalid requirements list must NOT send users to
        // Edit Agent (which cannot fix an external config file).
        let payload = SetupPayload {
            agent_name: "Codex".to_string(),
            agent_pubkey: "test".to_string(),
            requirements: vec![make_cli_config_invalid(
                "codex",
                "unknown variant `ultra` for field `model_reasoning_effort`",
            )],
        };
        let body = payload.nudge_body();
        assert!(
            !body.contains("Open Edit Agent"),
            "all-config-invalid nudge must not mention Open Edit Agent; got: {body:?}"
        );
        assert!(
            body.contains("config.toml"),
            "nudge must name the config file; got: {body:?}"
        );
        assert!(
            body.contains("restart the agent"),
            "nudge must include restart guidance; got: {body:?}"
        );
    }

    #[test]
    fn nudge_body_mixed_requirements_uses_split_footer() {
        // Mixed list: one Luca-managed env key + one external config invalid.
        // Footer must address both sides.
        let payload = SetupPayload {
            agent_name: "Codex".to_string(),
            agent_pubkey: "test".to_string(),
            requirements: vec![
                RequirementPayload::EnvKey {
                    key: "SOME_API_KEY".to_string(),
                },
                make_cli_config_invalid("codex", "unknown variant `gpt-5.6-sol`"),
            ],
        };
        let body = payload.nudge_body();
        assert!(
            body.contains("Open the agent in Luca Settings"),
            "mixed nudge must mention Luca Settings for managed fields; got: {body:?}"
        );
        assert!(
            body.contains("fix the external CLI config"),
            "mixed nudge must mention fixing the external config; got: {body:?}"
        );
    }

    #[test]
    fn nudge_body_all_buzz_managed_retains_original_footer() {
        // Pure Buzz-managed requirements → original "Open Edit Agent" footer unchanged.
        let payload = SetupPayload {
            agent_name: "Fizz".to_string(),
            agent_pubkey: "test".to_string(),
            requirements: vec![RequirementPayload::EnvKey {
                key: "ANTHROPIC_API_KEY".to_string(),
            }],
        };
        let body = payload.nudge_body();
        assert!(
            body.contains("Open the agent in Luca Settings to set these."),
            "all-managed nudge must use the original Edit Agent footer; got: {body:?}"
        );
    }

    // ── sentinel block tests ───────────────────────────────────────────────────

    #[test]
    fn nudge_body_contains_sentinel_block() {
        // The body must end with a ```buzz:config-nudge fence so the desktop
        // can detect and strip it before rendering the ConfigNudgeCard.
        let payload = SetupPayload {
            agent_name: "Fizz".to_string(),
            agent_pubkey: "test".to_string(),
            requirements: vec![RequirementPayload::EnvKey {
                key: "ANTHROPIC_API_KEY".to_string(),
            }],
        };
        let body = payload.nudge_body();
        assert!(
            body.contains("```buzz:config-nudge\n"),
            "body must open the sentinel fence; got: {body:?}"
        );
        assert!(
            body.ends_with("```"),
            "body must close the sentinel fence; got: {body:?}"
        );
    }

    #[test]
    fn nudge_body_sentinel_round_trips_payload() {
        // The JSON inside the sentinel block must deserialize back to an
        // equivalent SetupPayload (same agent_name and requirements).
        let payload = SetupPayload {
            agent_name: "Atlas".to_string(),
            agent_pubkey: "ddeeff00".to_string(),
            requirements: vec![
                RequirementPayload::NormalizedField {
                    field: "model".to_string(),
                },
                RequirementPayload::EnvKey {
                    key: "OPENAI_API_KEY".to_string(),
                },
                RequirementPayload::CliLogin {
                    probe_args: vec!["codex".to_string(), "login".to_string()],
                    setup_copy: "run `codex login`".to_string(),
                    availability: AcpAvailabilityStatus::Available,
                },
            ],
        };
        let body = payload.nudge_body();

        // Extract the JSON between the fence markers.
        let fence_open = "```buzz:config-nudge\n";
        let fence_close = "\n```";
        let start = body
            .rfind(fence_open)
            .expect("sentinel open fence not found")
            + fence_open.len();
        let end = body[start..]
            .rfind(fence_close)
            .expect("sentinel close fence not found")
            + start;
        let json = &body[start..end];

        let recovered: SetupPayload =
            serde_json::from_str(json).expect("sentinel JSON must deserialize");
        assert_eq!(recovered.agent_name, payload.agent_name);
        assert_eq!(recovered.agent_pubkey, payload.agent_pubkey);
        assert_eq!(recovered.requirements.len(), payload.requirements.len());
    }

    #[test]
    fn nudge_body_prose_still_present_with_sentinel() {
        // Existing prose checks must pass — the sentinel is APPENDED, not a
        // replacement, so all prior `body.contains(...)` invariants hold.
        let payload = SetupPayload {
            agent_name: "Fizz".to_string(),
            agent_pubkey: "test".to_string(),
            requirements: vec![
                RequirementPayload::NormalizedField {
                    field: "provider".to_string(),
                },
                RequirementPayload::EnvKey {
                    key: "ANTHROPIC_API_KEY".to_string(),
                },
            ],
        };
        let body = payload.nudge_body();
        assert!(body.contains("provider"), "prose must name the field");
        assert!(
            body.contains("ANTHROPIC_API_KEY"),
            "prose must name the key"
        );
        assert!(body.contains("Fizz"), "prose must name the agent");
        // Sentinel is also present.
        assert!(
            body.contains("```buzz:config-nudge"),
            "sentinel must follow"
        );
    }

    // ── should_nudge_for_event gate tests ─────────────────────────────────────
    //
    // These tests exercise the loop-wiring for the two safety-critical guards:
    // (a) non-allowlisted author → no nudge, (b) same event-id → exactly one
    // nudge. They use the extracted `should_nudge_for_event` helper, which is
    // the exact code the live loop calls.

    fn fake_event_id(byte: u8) -> EventId {
        EventId::from_byte_array([byte; 32])
    }

    #[test]
    fn test_non_allowlisted_author_returns_no_nudge() {
        // author_allowed = false → should return false regardless of other args.
        let mut dedup: HashSet<EventId> = HashSet::new();
        let event_id = fake_event_id(0xAA);

        let result = should_nudge_for_event(
            event_id, false, // author NOT allowed
            true,  // filter matched — would otherwise nudge
            &mut dedup,
        );

        assert!(!result, "non-allowlisted author must not produce a nudge");
        // Dedup set must remain empty — no phantom insertion for blocked author.
        assert!(
            dedup.is_empty(),
            "dedup set must not record event for blocked author"
        );
    }

    #[test]
    fn test_same_event_id_twice_nudges_exactly_once() {
        // The first call with a given event-id should return true; the second
        // call with the identical id must return false (replay dedup).
        let mut dedup: HashSet<EventId> = HashSet::new();
        let event_id = fake_event_id(0xBB);

        let first = should_nudge_for_event(
            event_id, true, // allowed
            true, // matched
            &mut dedup,
        );
        assert!(first, "first occurrence must be accepted");

        // Simulate reconnect replay: same event arrives again.
        let second = should_nudge_for_event(
            event_id, true, // allowed
            true, // matched
            &mut dedup,
        );
        assert!(
            !second,
            "replay of the same event-id must be rejected (dedup)"
        );
    }

    fn signed_setup_trigger(
        author: &nostr::Keys,
        resident: &nostr::Keys,
        kind: u32,
    ) -> nostr::Event {
        let channel = "11111111-1111-4111-8111-111111111111";
        let resident_pubkey = resident.public_key().to_hex();
        nostr::EventBuilder::new(nostr::Kind::Custom(kind as u16), "help")
            .tags([
                nostr::Tag::parse(["h", channel]).expect("h tag"),
                nostr::Tag::parse(["p", resident_pubkey.as_str()]).expect("p tag"),
            ])
            .sign_with_keys(author)
            .expect("signed setup trigger")
    }

    fn fixture_pubkey(keys: &nostr::Keys) -> luca_protocol::Hex64 {
        luca_protocol::Hex64::parse(keys.public_key().to_hex()).expect("fixture pubkey")
    }

    #[test]
    fn managed_setup_gate_accepts_exact_owner_kind_nine() {
        let owner = nostr::Keys::generate();
        let resident = nostr::Keys::generate();
        let trigger = signed_setup_trigger(&owner, &resident, KIND_STREAM_MESSAGE);
        let owner_pubkey = fixture_pubkey(&owner);
        let mut dedup = HashSet::new();

        assert!(should_nudge_for_setup_event(
            Some(&owner_pubkey),
            &trigger,
            true,
            true,
            &mut dedup,
        ));
        assert_eq!(dedup, HashSet::from([trigger.id]));
    }

    #[test]
    fn managed_setup_gate_skips_workflow_approval_event() {
        let owner = nostr::Keys::generate();
        let resident = nostr::Keys::generate();
        let trigger = signed_setup_trigger(&owner, &resident, KIND_WORKFLOW_APPROVAL_REQUESTED);
        let owner_pubkey = fixture_pubkey(&owner);
        let mut dedup = HashSet::new();

        assert!(!should_nudge_for_setup_event(
            Some(&owner_pubkey),
            &trigger,
            true,
            true,
            &mut dedup,
        ));
        assert!(dedup.is_empty());
    }

    #[test]
    fn managed_setup_gate_skips_non_owner_kind_nine() {
        let owner = nostr::Keys::generate();
        let sibling = nostr::Keys::generate();
        let resident = nostr::Keys::generate();
        let trigger = signed_setup_trigger(&sibling, &resident, KIND_STREAM_MESSAGE);
        let owner_pubkey = fixture_pubkey(&owner);
        let mut dedup = HashSet::new();

        assert!(!should_nudge_for_setup_event(
            Some(&owner_pubkey),
            &trigger,
            true,
            true,
            &mut dedup,
        ));
        assert!(dedup.is_empty());
    }

    #[test]
    fn unsupported_managed_setup_triggers_never_mutate_dedup() {
        let owner = nostr::Keys::generate();
        let sibling = nostr::Keys::generate();
        let resident = nostr::Keys::generate();
        let workflow = signed_setup_trigger(&owner, &resident, KIND_WORKFLOW_APPROVAL_REQUESTED);
        let non_owner = signed_setup_trigger(&sibling, &resident, KIND_STREAM_MESSAGE);
        let owner_pubkey = fixture_pubkey(&owner);
        let sentinel = fake_event_id(0xCC);
        let mut dedup = HashSet::from([sentinel]);

        for trigger in [&workflow, &non_owner] {
            assert!(!should_nudge_for_setup_event(
                Some(&owner_pubkey),
                trigger,
                true,
                true,
                &mut dedup,
            ));
        }
        assert_eq!(dedup, HashSet::from([sentinel]));
    }

    #[test]
    fn legacy_setup_gate_preserves_workflow_approval_behavior() {
        let owner = nostr::Keys::generate();
        let resident = nostr::Keys::generate();
        let trigger = signed_setup_trigger(&owner, &resident, KIND_WORKFLOW_APPROVAL_REQUESTED);
        let mut dedup = HashSet::new();

        assert!(should_nudge_for_setup_event(
            None, &trigger, true, true, &mut dedup,
        ));
        assert_eq!(dedup, HashSet::from([trigger.id]));
    }

    #[test]
    fn managed_setup_nudge_uses_exact_owner_dispatch_for_typed_publication() {
        use luca_protocol::{Hex64, SafeU53};
        use nostr::{EventBuilder, Keys, Kind, Tag};

        let owner = Keys::generate();
        let resident = Keys::generate();
        let channel_id =
            Uuid::parse_str("11111111-1111-4111-8111-111111111111").expect("fixture channel");
        let channel = channel_id.to_string();
        let resident_pubkey = resident.public_key().to_hex();
        let trigger = EventBuilder::new(Kind::Custom(KIND_STREAM_MESSAGE as u16), "help")
            .tags([
                Tag::parse(["h", channel.as_str()]).expect("h tag"),
                Tag::parse(["p", resident_pubkey.as_str()]).expect("p tag"),
            ])
            .sign_with_keys(&owner)
            .expect("signed trigger");
        let owner_pubkey = Hex64::parse(owner.public_key().to_hex()).expect("owner pubkey");
        let resident_pubkey = Hex64::parse(resident_pubkey).expect("resident pubkey");
        let turn_id = trigger.id.to_hex();

        let turn = ManagedFinalTurn::from_triggering_event_parts(
            &owner_pubkey,
            &resident_pubkey,
            SafeU53::new(7).expect("session epoch"),
            &turn_id,
            channel_id,
            &trigger,
            None,
        )
        .expect("managed setup route");
        let payload = SetupPayload {
            agent_name: "Anima".to_owned(),
            agent_pubkey: resident_pubkey.as_str().to_owned(),
            requirements: vec![RequirementPayload::CliLogin {
                probe_args: vec!["claude".to_owned(), "auth".to_owned(), "status".to_owned()],
                setup_copy: "run `claude login`".to_owned(),
                availability: AcpAvailabilityStatus::Available,
            }],
        };
        let expected_body = payload.nudge_body();
        let request = turn
            .request(expected_body.clone())
            .expect("typed setup publication request");

        assert_eq!(request.turn_id.as_str(), trigger.id.to_hex());
        assert_eq!(request.dispatch_receipt_id.as_str(), trigger.id.to_hex());
        assert_eq!(request.owner_pubkey, owner_pubkey.clone());
        assert_eq!(request.resident_pubkey, resident_pubkey);
        assert_eq!(request.conversation_id.as_str(), channel);
        assert_eq!(request.resolved_p_tags, vec![owner_pubkey]);
        assert_eq!(request.final_draft, expected_body);
    }

    #[test]
    fn managed_setup_nudge_rejects_unadmitted_sibling_trigger() {
        use luca_protocol::{Hex64, SafeU53};
        use nostr::{EventBuilder, Keys, Kind, Tag};

        let owner = Keys::generate();
        let resident = Keys::generate();
        let sibling = Keys::generate();
        let channel_id =
            Uuid::parse_str("22222222-2222-4222-8222-222222222222").expect("fixture channel");
        let channel = channel_id.to_string();
        let trigger = EventBuilder::new(Kind::Custom(KIND_STREAM_MESSAGE as u16), "help")
            .tags([Tag::parse(["h", channel.as_str()]).expect("h tag")])
            .sign_with_keys(&sibling)
            .expect("signed trigger");
        let turn_id = trigger.id.to_hex();

        let result = ManagedFinalTurn::from_triggering_event_parts(
            &Hex64::parse(owner.public_key().to_hex()).expect("owner pubkey"),
            &Hex64::parse(resident.public_key().to_hex()).expect("resident pubkey"),
            SafeU53::new(7).expect("session epoch"),
            &turn_id,
            channel_id,
            &trigger,
            None,
        );

        assert!(
            result.is_err(),
            "setup mode must not invent exchange admission for a sibling trigger"
        );
    }

    // ── availability round-trip tests ─────────────────────────────────────────
    //
    // These tests prove the desktop→buzz-acp→sentinel path preserves the
    // `availability` field. They simulate what actually happens at runtime:
    // desktop serializes a `cli_login` JSON blob → buzz-acp parses it via
    // `from_raw_env_value` → `nudge_body()` re-serializes into the sentinel →
    // the sentinel JSON is extracted and checked for the `availability` field.
    //
    // This guards the prior regression where `RequirementPayload::CliLogin`
    // had no `availability` field, so serde silently dropped it during
    // deserialization and the desktop card never rendered.

    fn extract_sentinel_json(body: &str) -> String {
        let fence_open = "```buzz:config-nudge\n";
        let fence_close = "\n```";
        let start = body
            .rfind(fence_open)
            .expect("sentinel open fence not found")
            + fence_open.len();
        let end = body[start..]
            .rfind(fence_close)
            .expect("sentinel close fence not found")
            + start;
        body[start..end].to_string()
    }

    fn make_desktop_cli_login_json(availability: &str) -> String {
        // Simulate the JSON desktop's runtime.rs emits — a full SetupPayload
        // with one cli_login requirement carrying the given availability state.
        format!(
            r#"{{"agent_name":"TestAgent","agent_pubkey":"aa","requirements":[{{"surface":"cli_login","probe_args":["claude"],"setup_copy":"run claude login","availability":"{availability}"}}]}}"#
        )
    }

    #[test]
    fn cli_login_availability_available_survives_sentinel_round_trip() {
        let raw = make_desktop_cli_login_json("available");
        let payload = SetupPayload::from_raw_env_value(Some(raw))
            .unwrap()
            .expect("must parse");
        let body = payload.nudge_body();
        let sentinel_json = extract_sentinel_json(&body);
        assert!(
            sentinel_json.contains(r#""availability":"available""#),
            "sentinel must carry availability=available; got: {sentinel_json:?}"
        );
    }

    #[test]
    fn cli_login_availability_adapter_missing_survives_sentinel_round_trip() {
        let raw = make_desktop_cli_login_json("adapter_missing");
        let payload = SetupPayload::from_raw_env_value(Some(raw))
            .unwrap()
            .expect("must parse");
        let body = payload.nudge_body();
        let sentinel_json = extract_sentinel_json(&body);
        assert!(
            sentinel_json.contains(r#""availability":"adapter_missing""#),
            "sentinel must carry availability=adapter_missing; got: {sentinel_json:?}"
        );
    }

    #[test]
    fn cli_login_availability_cli_missing_survives_sentinel_round_trip() {
        let raw = make_desktop_cli_login_json("cli_missing");
        let payload = SetupPayload::from_raw_env_value(Some(raw))
            .unwrap()
            .expect("must parse");
        let body = payload.nudge_body();
        let sentinel_json = extract_sentinel_json(&body);
        assert!(
            sentinel_json.contains(r#""availability":"cli_missing""#),
            "sentinel must carry availability=cli_missing; got: {sentinel_json:?}"
        );
    }

    #[test]
    fn cli_login_availability_not_installed_survives_sentinel_round_trip() {
        let raw = make_desktop_cli_login_json("not_installed");
        let payload = SetupPayload::from_raw_env_value(Some(raw))
            .unwrap()
            .expect("must parse");
        let body = payload.nudge_body();
        let sentinel_json = extract_sentinel_json(&body);
        assert!(
            sentinel_json.contains(r#""availability":"not_installed""#),
            "sentinel must carry availability=not_installed; got: {sentinel_json:?}"
        );
    }
}
