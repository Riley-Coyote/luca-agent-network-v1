//! Body-free, local awareness contracts and side-effect-free eligibility checks.
//!
//! These records do not enable observation, prove current authority, or provide
//! encryption. Sensitive locators and content belong to later protected local
//! storage. Source/content/model claims must never construct current authority.
//! The host must resolve exact stored evidence and recheck its authoritative
//! state at ingress, dispatch, memory commit, and publication. Capture, replay
//! protection, durable revocation, clock enforcement, and dependency quarantine
//! remain host-integration work. No Brain recall, action, publication, or access
//! for another resident is implied by an awareness grant.

use crate::{CanonicalTimestamp, Hex64, OpaqueId, SafeU53, Sha256Ref};
use serde::{Deserialize, Serialize};

/// Frozen discriminator for the initial awareness contract.
pub const AWARENESS_PROTOCOL: &str = "polyphonic.awareness.v1";
/// Maximum lifetime of one ephemeral observation reference, in seconds.
pub const MAX_AWARENESS_OBSERVATION_TTL_SECS: i64 = 15 * 60;

/// Body-free contract or eligibility failure; never includes source content.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum AwarenessError {
    /// Unsupported contract version.
    #[error("awareness protocol is invalid")]
    Protocol,
    /// Invalid principal, revision, sequence, or observation lifetime.
    #[error("awareness metadata is invalid")]
    Invalid,
    /// The exact owner, selected resident, source, device, or grant differs.
    #[error("awareness binding does not match current authority")]
    Binding,
    /// A grant revision or deny epoch is no longer current.
    #[error("awareness authority is stale")]
    Stale,
    /// Source health is disabled, unavailable, unknown, or not fresh.
    #[error("awareness source is not current")]
    SourceNotCurrent,
    /// The host's current grant is revoked.
    #[error("awareness grant is revoked")]
    Revoked,
    /// Private-browsing or otherwise excluded material cannot be admitted.
    #[error("awareness material is excluded")]
    Excluded,
    /// The host cannot currently resolve the exact material.
    #[error("awareness material is unavailable")]
    Unavailable,
    /// The observation has reached its expiry.
    #[error("awareness observation is expired")]
    Expired,
    /// Observation is the baseline capability for every permitted use.
    #[error("awareness observation is not granted")]
    ObservationDenied,
    /// Retention beyond the ephemeral lifetime requires a separate choice.
    #[error("awareness retention is not granted")]
    RetentionDenied,
    /// Promotion into the existing canonical memory authority is not granted.
    #[error("awareness promotion is not granted")]
    PromotionDenied,
    /// Provider egress requires the exact host-selected provider binding.
    #[error("awareness provider egress is not granted")]
    EgressDenied,
}

/// Descriptive source health; a serialized value is not current authority.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AwarenessSourceStateV1 {
    /// The host has established availability; freshness is checked separately.
    Current,
    /// The owner disabled the source.
    Disabled,
    /// The source cannot be accessed.
    Unavailable,
    /// Availability has not been established.
    Unknown,
}

/// Status recorded by the host's grant authority, never self-issued by content.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AwarenessGrantStateV1 {
    /// The recorded choice remains active, subject to all current checks.
    Active,
    /// The host revoked the choice.
    Revoked,
}

/// Independent owner choices for one selected resident and exact source scope.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AwarenessChoicesV1 {
    /// Permit ephemeral observation; every other use also requires this choice.
    pub observe: bool,
    /// Permit retaining raw material beyond its ephemeral observation lifetime.
    pub retain: bool,
    /// Permit proposing meaningful material to the existing memory authority.
    /// This does not retain the raw observation or authorize arbitrary writes.
    pub promote: bool,
    /// Exact provider/runtime binding allowed to receive material; `None` denies
    /// provider egress. A change of binding requires a new host-owned choice.
    pub provider_egress_binding: Option<Sha256Ref>,
}

/// Body-free source identity; its opaque ID resolves one exact host-owned scope.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "RawAwarenessSourceV1")]
pub struct AwarenessSourceV1 {
    /// Exact contract version.
    pub protocol: String,
    /// Owner of this source.
    pub owner_pubkey: Hex64,
    /// Opaque exact source/scope, not a path, browser profile, or account name.
    pub source_id: OpaqueId,
    /// Exact installation/device on which the source is available.
    pub device_id: OpaqueId,
    /// Host-owned deny generation; old observations must not survive a change.
    pub deny_epoch: SafeU53,
    /// Descriptive health, reloaded from authority before each use.
    pub state: AwarenessSourceStateV1,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawAwarenessSourceV1 {
    protocol: String,
    owner_pubkey: Hex64,
    source_id: OpaqueId,
    device_id: OpaqueId,
    deny_epoch: SafeU53,
    state: AwarenessSourceStateV1,
}

impl TryFrom<RawAwarenessSourceV1> for AwarenessSourceV1 {
    type Error = AwarenessError;

    fn try_from(raw: RawAwarenessSourceV1) -> Result<Self, Self::Error> {
        let value = Self {
            protocol: raw.protocol,
            owner_pubkey: raw.owner_pubkey,
            source_id: raw.source_id,
            device_id: raw.device_id,
            deny_epoch: raw.deny_epoch,
            state: raw.state,
        };
        value.validate()?;
        Ok(value)
    }
}

impl AwarenessSourceV1 {
    /// Validate the version; existing scalar types bound every other field.
    pub fn validate(&self) -> Result<(), AwarenessError> {
        validate_protocol(&self.protocol)
    }
}

/// Body-free grant record for exactly one selected companion, source, and device.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "RawAwarenessGrantV1")]
pub struct AwarenessGrantV1 {
    /// Exact contract version.
    pub protocol: String,
    /// Host-issued grant identity.
    pub grant_id: OpaqueId,
    /// Exact owner principal.
    pub owner_pubkey: Hex64,
    /// Exact selected companion; no current/future-resident wildcard exists.
    pub resident_pubkey: Hex64,
    /// Exact source scope resolved by the host.
    pub source_id: OpaqueId,
    /// Exact source device.
    pub device_id: OpaqueId,
    /// Positive host-owned grant revision.
    pub grant_revision: SafeU53,
    /// Source deny epoch under which this choice was issued.
    pub deny_epoch: SafeU53,
    /// Host-recorded active or revoked state.
    pub state: AwarenessGrantStateV1,
    /// Separate access, retention, promotion, and provider-egress choices.
    pub choices: AwarenessChoicesV1,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawAwarenessGrantV1 {
    protocol: String,
    grant_id: OpaqueId,
    owner_pubkey: Hex64,
    resident_pubkey: Hex64,
    source_id: OpaqueId,
    device_id: OpaqueId,
    grant_revision: SafeU53,
    deny_epoch: SafeU53,
    state: AwarenessGrantStateV1,
    choices: AwarenessChoicesV1,
}

impl TryFrom<RawAwarenessGrantV1> for AwarenessGrantV1 {
    type Error = AwarenessError;

    fn try_from(raw: RawAwarenessGrantV1) -> Result<Self, Self::Error> {
        let value = Self {
            protocol: raw.protocol,
            grant_id: raw.grant_id,
            owner_pubkey: raw.owner_pubkey,
            resident_pubkey: raw.resident_pubkey,
            source_id: raw.source_id,
            device_id: raw.device_id,
            grant_revision: raw.grant_revision,
            deny_epoch: raw.deny_epoch,
            state: raw.state,
            choices: raw.choices,
        };
        value.validate()?;
        Ok(value)
    }
}

impl AwarenessGrantV1 {
    /// Validate the exact version, distinct owner/resident, and positive revision.
    pub fn validate(&self) -> Result<(), AwarenessError> {
        validate_protocol(&self.protocol)?;
        if self.owner_pubkey == self.resident_pubkey || self.grant_revision.get() == 0 {
            return Err(AwarenessError::Invalid);
        }
        Ok(())
    }
}

/// Bounded metadata referencing evidence, never its body or sensitive locator.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "RawAwarenessObservationRefV1")]
pub struct AwarenessObservationRefV1 {
    /// Exact contract version.
    pub protocol: String,
    /// Host-issued exact observation identity.
    pub observation_id: OpaqueId,
    /// Exact owner principal.
    pub owner_pubkey: Hex64,
    /// Exact selected companion.
    pub resident_pubkey: Hex64,
    /// Exact source scope.
    pub source_id: OpaqueId,
    /// Exact source device.
    pub device_id: OpaqueId,
    /// Grant under which the host admitted the observation.
    pub grant_id: OpaqueId,
    /// Grant revision at admission; equality is required at every later use.
    pub grant_revision: SafeU53,
    /// Source deny epoch at admission.
    pub deny_epoch: SafeU53,
    /// Positive source sequence; persistent ordering/replay enforcement is later.
    pub sequence: SafeU53,
    /// Reference to exact source evidence; a digest alone does not prove truth.
    pub evidence_ref: Sha256Ref,
    /// Host-recorded capture time, not a source/model clock assertion.
    pub captured_at: CanonicalTimestamp,
    /// Exclusive expiry, later than capture and within the frozen TTL ceiling.
    pub expires_at: CanonicalTimestamp,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawAwarenessObservationRefV1 {
    protocol: String,
    observation_id: OpaqueId,
    owner_pubkey: Hex64,
    resident_pubkey: Hex64,
    source_id: OpaqueId,
    device_id: OpaqueId,
    grant_id: OpaqueId,
    grant_revision: SafeU53,
    deny_epoch: SafeU53,
    sequence: SafeU53,
    evidence_ref: Sha256Ref,
    captured_at: CanonicalTimestamp,
    expires_at: CanonicalTimestamp,
}

impl TryFrom<RawAwarenessObservationRefV1> for AwarenessObservationRefV1 {
    type Error = AwarenessError;

    fn try_from(raw: RawAwarenessObservationRefV1) -> Result<Self, Self::Error> {
        let value = Self {
            protocol: raw.protocol,
            observation_id: raw.observation_id,
            owner_pubkey: raw.owner_pubkey,
            resident_pubkey: raw.resident_pubkey,
            source_id: raw.source_id,
            device_id: raw.device_id,
            grant_id: raw.grant_id,
            grant_revision: raw.grant_revision,
            deny_epoch: raw.deny_epoch,
            sequence: raw.sequence,
            evidence_ref: raw.evidence_ref,
            captured_at: raw.captured_at,
            expires_at: raw.expires_at,
        };
        value.validate()?;
        Ok(value)
    }
}

impl AwarenessObservationRefV1 {
    /// Validate identity/revision bounds and the strictly positive, bounded TTL.
    pub fn validate(&self) -> Result<(), AwarenessError> {
        validate_protocol(&self.protocol)?;
        let lifetime = unix_seconds(&self.expires_at)? - unix_seconds(&self.captured_at)?;
        if self.owner_pubkey == self.resident_pubkey
            || self.grant_revision.get() == 0
            || self.sequence.get() == 0
            || !(1..=MAX_AWARENESS_OBSERVATION_TTL_SECS).contains(&lifetime)
        {
            return Err(AwarenessError::Invalid);
        }
        Ok(())
    }
}

/// Host-resolved material eligibility, deliberately not a deserializable claim.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AwarenessMaterialStateV1 {
    /// The host can resolve this exact evidence under current source policy.
    Available,
    /// Exact evidence cannot be resolved or has not yet been established.
    Unavailable,
    /// Private-browsing or another host-enforced exclusion; broad grants lose.
    Excluded,
}

/// Trusted host snapshot, never reconstructed from model/content/JSON claims.
/// No serialization implementation is supplied for this authority boundary.
pub struct AwarenessAuthoritySnapshotV1<'a> {
    /// Owner currently authenticated by the host.
    pub owner_pubkey: &'a Hex64,
    /// Exact companion currently selected by the owner.
    pub resident_pubkey: &'a Hex64,
    /// Source state reloaded from the host's current authority.
    pub source: &'a AwarenessSourceV1,
    /// Grant reloaded from the host's current authority, not an incoming DTO.
    pub grant: &'a AwarenessGrantV1,
    /// Host-established freshness; stale or unverified health must be false.
    pub source_fresh: bool,
    /// Host-resolved availability/exclusion for the exact observation evidence.
    pub material_state: AwarenessMaterialStateV1,
    /// Trusted host time; this pure function does not read or police a clock.
    pub now: &'a CanonicalTimestamp,
}

/// Actual intended use selected by the host, never by observed content.
#[derive(Debug, Clone, Copy, Default)]
pub struct AwarenessUseV1<'a> {
    /// Retain raw material beyond the ephemeral lifetime.
    pub retain: bool,
    /// Propose meaningful material to canonical memory; raw retention is separate.
    pub promote: bool,
    /// Exact current provider binding receiving material, if any.
    pub provider_egress_binding: Option<&'a Sha256Ref>,
}

/// Recheck exact bindings, current authority, source/exclusion state, time, and
/// independently chosen capabilities. `Ok` is only a decision over this
/// host-supplied snapshot, not a transferable capability or side effect.
/// The host must repeat this check at ingress/dispatch/commit/publication and
/// atomically enforce revocation there; this function creates no deny barrier.
pub fn recheck_awareness_eligibility(
    authority: &AwarenessAuthoritySnapshotV1<'_>,
    observation: &AwarenessObservationRefV1,
    intended_use: AwarenessUseV1<'_>,
) -> Result<(), AwarenessError> {
    let source = authority.source;
    let grant = authority.grant;
    source.validate()?;
    grant.validate()?;
    observation.validate()?;
    if source.owner_pubkey != *authority.owner_pubkey
        || grant.owner_pubkey != *authority.owner_pubkey
        || observation.owner_pubkey != *authority.owner_pubkey
        || grant.resident_pubkey != *authority.resident_pubkey
        || observation.resident_pubkey != *authority.resident_pubkey
        || grant.source_id != source.source_id
        || observation.source_id != source.source_id
        || grant.device_id != source.device_id
        || observation.device_id != source.device_id
        || observation.grant_id != grant.grant_id
    {
        return Err(AwarenessError::Binding);
    }
    if observation.grant_revision != grant.grant_revision
        || grant.deny_epoch != source.deny_epoch
        || observation.deny_epoch != source.deny_epoch
    {
        return Err(AwarenessError::Stale);
    }
    if source.state != AwarenessSourceStateV1::Current || !authority.source_fresh {
        return Err(AwarenessError::SourceNotCurrent);
    }
    if grant.state == AwarenessGrantStateV1::Revoked {
        return Err(AwarenessError::Revoked);
    }
    match authority.material_state {
        AwarenessMaterialStateV1::Excluded => return Err(AwarenessError::Excluded),
        AwarenessMaterialStateV1::Unavailable => return Err(AwarenessError::Unavailable),
        AwarenessMaterialStateV1::Available => {}
    }
    if authority.now < &observation.captured_at {
        return Err(AwarenessError::Unavailable);
    }
    if authority.now >= &observation.expires_at {
        return Err(AwarenessError::Expired);
    }
    if !grant.choices.observe {
        return Err(AwarenessError::ObservationDenied);
    }
    if intended_use.retain && !grant.choices.retain {
        return Err(AwarenessError::RetentionDenied);
    }
    if intended_use.promote && !grant.choices.promote {
        return Err(AwarenessError::PromotionDenied);
    }
    if let Some(binding) = intended_use.provider_egress_binding {
        if grant.choices.provider_egress_binding.as_ref() != Some(binding) {
            return Err(AwarenessError::EgressDenied);
        }
    }
    Ok(())
}

fn validate_protocol(protocol: &str) -> Result<(), AwarenessError> {
    if protocol != AWARENESS_PROTOCOL {
        return Err(AwarenessError::Protocol);
    }
    Ok(())
}

fn unix_seconds(value: &CanonicalTimestamp) -> Result<i64, AwarenessError> {
    chrono::DateTime::parse_from_rfc3339(value.as_str())
        .map(|value| value.timestamp())
        .map_err(|_| AwarenessError::Invalid)
}
