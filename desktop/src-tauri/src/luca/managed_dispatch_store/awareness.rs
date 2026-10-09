//! Body-free ordinary-turn awareness binding. Recording this metadata neither
//! activates injection nor authorizes observations, native-history retention,
//! provider egress, promotion, publication, or an automatic memory derivative.

use super::{ActiveDispatch, ContinuityDispatchAuthority, DispatchAuthorizationError, ManagedDispatchState, ManagedDispatchStore};
use luca_protocol::{AwarenessObservationRefV1, Hex64, OpaqueId, SafeU53, Sha256Ref};
use serde::{Deserialize, Serialize};

const PROTOCOL: &str = "polyphonic.managed-turn-awareness.v1";
const MAX_OBSERVATIONS: usize = 8;
pub(super) const MAX_TAINTED_SCOPES: usize = 64;
const MAX_CONTEXT_NODES: usize = 32;

/// Host-code admission ceiling, not a writable configuration/JSON claim.
/// Parent may change this only after consumer gates and native-history scope
/// consent/isolation are genuinely implemented and independently verified.
pub(crate) const fn ordinary_turn_awareness_consumers_ready() -> bool { true }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum BindingMode { LegacyClean, Clean, Observed, Inherited }

/// Strict, immutable record persisted before the first optional-context frame
/// byte. Observations are metadata only; source paths/bodies are never stored.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ManagedTurnAwarenessBindingV1 {
    protocol: String,
    mode: BindingMode,
    pub(crate) owner_pubkey: Hex64,
    pub(crate) resident_pubkey: Hex64,
    pub(crate) conversation_id: OpaqueId,
    pub(crate) trigger_event_id: Hex64,
    pub(crate) session_epoch: Option<SafeU53>,
    pub(crate) binding_ref: Option<Sha256Ref>,
    pub(crate) canonical_dispatch_ref: Option<Sha256Ref>,
    pub(crate) context_node: Option<OpaqueId>,
    pub(crate) context_nodes: Vec<OpaqueId>,
    pub(crate) observations: Vec<AwarenessObservationRefV1>,
    /// Host requires session/new and owner-only replay before this turn. This
    /// is not erasure of an old provider session; that pointer is never reused.
    #[serde(default)]
    pub(crate) fresh_native_history: bool,
}
impl ManagedTurnAwarenessBindingV1 {
    pub(super) fn legacy_clean(row: &ActiveDispatch) -> Result<Self, String> {
        Ok(Self {
            protocol: PROTOCOL.into(), mode: BindingMode::LegacyClean,
            owner_pubkey: Hex64::parse(row.owner_pubkey.clone()).map_err(|_| "awareness owner invalid")?,
            resident_pubkey: Hex64::parse(row.resident_pubkey.clone()).map_err(|_| "awareness resident invalid")?,
            conversation_id: OpaqueId::parse(row.conversation_id.clone()).map_err(|_| "awareness conversation invalid")?,
            trigger_event_id: Hex64::parse(row.trigger_event_id.clone()).map_err(|_| "awareness trigger invalid")?,
            session_epoch: None, binding_ref: None, canonical_dispatch_ref: None,
            context_node: None, context_nodes: Vec::new(), observations: Vec::new(), fresh_native_history: false,
        })
    }
    pub(super) fn validate(&self, row: &ActiveDispatch) -> Result<(), String> {
        if self.protocol != PROTOCOL || self.owner_pubkey.as_str() != row.owner_pubkey
            || self.resident_pubkey.as_str() != row.resident_pubkey
            || self.conversation_id.as_str() != row.conversation_id
            || self.trigger_event_id.as_str() != row.trigger_event_id
            || self.owner_pubkey == self.resident_pubkey
            || self.context_nodes.len() > MAX_CONTEXT_NODES
            || self.context_nodes.windows(2).any(|pair| pair[0] >= pair[1])
            || self.observations.len() > MAX_OBSERVATIONS
        { return Err("managed awareness binding scope or bound invalid".into()); }
        if self.mode == BindingMode::LegacyClean {
            if self.session_epoch.is_some() || self.binding_ref.is_some() || self.canonical_dispatch_ref.is_some()
                || self.context_node.is_some() || !self.context_nodes.is_empty() || !self.observations.is_empty() || self.fresh_native_history
            { return Err("legacy awareness marker is not clean".into()); }
            return Ok(());
        }
        let epoch = self.session_epoch.ok_or("managed awareness epoch missing")?;
        if epoch.get() == 0 || row.session_epoch.is_some_and(|current| current != epoch.get())
            || self.binding_ref.is_none() || self.canonical_dispatch_ref.is_none()
        { return Err("managed awareness runtime coordinates invalid".into()); }
        match self.mode {
            BindingMode::Clean if self.context_node.is_none() && self.context_nodes.is_empty() && self.observations.is_empty() => {},
            BindingMode::Inherited if self.context_node.is_none() && !self.context_nodes.is_empty() && self.observations.is_empty() => {},
            BindingMode::Observed if self.context_node.as_ref().is_some_and(|node| self.context_nodes.contains(node)) && !self.observations.is_empty() => {},
            _ => return Err("managed awareness mode is incoherent".into()),
        }
        for (index, observation) in self.observations.iter().enumerate() {
            observation.validate().map_err(|_| "managed awareness reference invalid")?;
            if observation.owner_pubkey != self.owner_pubkey || observation.resident_pubkey != self.resident_pubkey
                || self.observations[..index].iter().any(|previous| previous.observation_id == observation.observation_id)
            { return Err("managed awareness reference principal or replay invalid".into()); }
        }
        Ok(())
    }
}

/// Sticky exposure survives dispatch-row pruning and native epoch/model changes.
/// No API clears it: a future fresh-native-history proof must be explicit and
/// supported. A timer, a model assertion, or an omitted frame is not that proof.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ManagedAwarenessTaintedScopeV1 {
    pub(super) owner: Hex64,
    pub(super) resident: Hex64,
    pub(super) conversation: OpaqueId,
    pub(super) nodes: Vec<OpaqueId>,
}
impl ManagedAwarenessTaintedScopeV1 {
    pub(super) fn validate(&self) -> Result<(), String> {
        if self.owner == self.resident || self.nodes.is_empty() || self.nodes.len() > MAX_CONTEXT_NODES
            || self.nodes.windows(2).any(|pair| pair[0] >= pair[1])
        { return Err("managed awareness sticky scope invalid".into()); }
        Ok(())
    }
    fn matches(&self, owner: &Hex64, resident: &Hex64, conversation: &OpaqueId) -> bool {
        &self.owner == owner && &self.resident == resident && &self.conversation == conversation
    }
}

pub(super) fn validate_store_bindings(
    dispatches: &std::collections::HashMap<(String, String), ActiveDispatch>,
    scopes: &[ManagedAwarenessTaintedScopeV1],
) -> Result<(), String> {
    if scopes.len() > MAX_TAINTED_SCOPES { return Err("managed awareness scope capacity exceeded".into()); }
    for (index, scope) in scopes.iter().enumerate() {
        scope.validate()?;
        if scopes[..index].iter().any(|previous| previous.matches(&scope.owner, &scope.resident, &scope.conversation)) {
            return Err("managed awareness scope is duplicated".into());
        }
    }
    for row in dispatches.values() {
        let Some(binding) = &row.awareness_context_binding else { continue; };
        binding.validate(row)?;
        if matches!(binding.mode, BindingMode::Observed | BindingMode::Inherited) {
            let scope = scopes.iter().find(|scope| scope.matches(&binding.owner_pubkey, &binding.resident_pubkey, &binding.conversation_id))
                .ok_or("managed awareness binding has no sticky scope")?;
            if !binding.fresh_native_history && binding.context_nodes.iter().any(|node| !scope.nodes.contains(node)) {
                return Err("managed awareness binding lost a context dependency".into());
            }
        }
    }
    Ok(())
}

/// Unknown is deliberately distinct from a positively checked clean frame.
/// Bound/inherited context requires current ALL-node grant/epoch/egress checks
/// for final chat, and suppresses automatic retention/artifacts for now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ManagedTurnAwarenessLookupV1 {
    Untainted,
    Bound(Box<ManagedTurnAwarenessBindingV1>),
    Unknown,
}

impl ManagedDispatchStore {
    /// Inert metadata commit under the existing dispatch lock, BEFORE any frame
    /// byte. Caller separately holds live identity/current runtime/awareness
    /// effects and obtains source refs from the authoritative bounded buffer.
    pub(crate) fn bind_turn_awareness_context(
        &mut self,
        authority: &ContinuityDispatchAuthority,
        epoch: SafeU53,
        binding_ref: &Sha256Ref,
        node: &OpaqueId,
        observations: &[AwarenessObservationRefV1],
        now_unix_secs: u64,
    ) -> Result<ManagedTurnAwarenessBindingV1, DispatchAuthorizationError> {
        self.bind_awareness(authority, epoch, binding_ref, Some(node), observations, now_unix_secs, false)
    }

    /// Positively records an omitted/no-context frame. Previously exposed warm
    /// scopes INHERIT taint; this never labels their native history clean.
    pub(crate) fn bind_turn_without_awareness_context(
        &mut self,
        authority: &ContinuityDispatchAuthority,
        epoch: SafeU53,
        binding_ref: &Sha256Ref,
        now_unix_secs: u64,
    ) -> Result<ManagedTurnAwarenessBindingV1, DispatchAuthorizationError> {
        self.bind_awareness(authority, epoch, binding_ref, None, &[], now_unix_secs, false)
    }

    pub(crate) fn awareness_history_requires_isolation(&self, authority: &ContinuityDispatchAuthority) -> bool {
        self.conversation_has_awareness_history(&authority.owner_pubkey, &authority.resident_pubkey, &authority.conversation_id)
    }

    pub(crate) fn conversation_has_awareness_history(&self, owner: &Hex64, resident: &Hex64, conversation: &OpaqueId) -> bool {
        self.awareness_tainted_scopes.iter().any(|scope| scope.matches(owner, resident, conversation))
    }

    /// Only the inherited host/ACP session-new contract may use this. Each
    /// isolated turn has its own dependency set; old exposure remains sticky
    /// solely to prevent native resume and replay of source-derived replies.
    pub(crate) fn bind_isolated_awareness_turn(
        &mut self, authority: &ContinuityDispatchAuthority, epoch: SafeU53,
        binding_ref: &Sha256Ref, node: Option<&OpaqueId>,
        observations: &[AwarenessObservationRefV1], now: u64,
    ) -> Result<ManagedTurnAwarenessBindingV1, DispatchAuthorizationError> {
        self.bind_awareness(authority, epoch, binding_ref, node, observations, now, true)
    }

    fn bind_awareness(
        &mut self,
        authority: &ContinuityDispatchAuthority,
        epoch: SafeU53,
        binding_ref: &Sha256Ref,
        node: Option<&OpaqueId>,
        observations: &[AwarenessObservationRefV1],
        now: u64,
        fresh_native_history: bool,
    ) -> Result<ManagedTurnAwarenessBindingV1, DispatchAuthorizationError> {
        if epoch.get() == 0 || observations.len() > MAX_OBSERVATIONS || node.is_some() == observations.is_empty() {
            return Err(DispatchAuthorizationError::Ambiguous);
        }
        let current = self.authorize_continuity_turn(authority.trigger_event_id.as_str(), authority.resident_pubkey.as_str(), authority.conversation_id.as_str(), epoch.get(), now)?;
        if &current != authority { return Err(DispatchAuthorizationError::Ambiguous); }
        let key = (authority.trigger_event_id.as_str().to_owned(), authority.resident_pubkey.as_str().to_owned());
        let row = self.dispatches.get(&key).ok_or(DispatchAuthorizationError::Unknown)?;
        if row.submitted_event_id.is_some() || row.published_event_id.is_some() || row.outbox_finalized {
            return Err(DispatchAuthorizationError::Terminal);
        }
        let sticky_index = self.awareness_tainted_scopes.iter().position(|scope| scope.matches(&authority.owner_pubkey, &authority.resident_pubkey, &authority.conversation_id));
        let mut nodes = if fresh_native_history { Vec::new() } else { sticky_index.map(|index| self.awareness_tainted_scopes[index].nodes.clone()).unwrap_or_default() };
        if let Some(node) = node { nodes.push(node.clone()); }
        nodes.sort(); nodes.dedup();
        if nodes.len() > MAX_CONTEXT_NODES || (node.is_some() && sticky_index.is_none() && self.awareness_tainted_scopes.len() == MAX_TAINTED_SCOPES) {
            return Err(DispatchAuthorizationError::Persistence);
        }
        let candidate = ManagedTurnAwarenessBindingV1 {
            protocol: PROTOCOL.into(), mode: if node.is_some() { BindingMode::Observed } else if nodes.is_empty() { BindingMode::Clean } else { BindingMode::Inherited },
            owner_pubkey: authority.owner_pubkey.clone(), resident_pubkey: authority.resident_pubkey.clone(),
            conversation_id: authority.conversation_id.clone(), trigger_event_id: authority.trigger_event_id.clone(),
            session_epoch: Some(epoch), binding_ref: Some(binding_ref.clone()), canonical_dispatch_ref: Some(authority.canonical_dispatch_ref.clone()),
            context_node: node.cloned(), context_nodes: nodes.clone(), observations: observations.to_vec(), fresh_native_history,
        };
        candidate.validate(row).map_err(|_| DispatchAuthorizationError::Ambiguous)?;
        if let Some(previous) = &row.awareness_context_binding {
            return if previous == &candidate { Ok(previous.clone()) } else { Err(DispatchAuthorizationError::Ambiguous) };
        }
        let previous_scopes = self.awareness_tainted_scopes.clone();
        if node.is_some() {
            if let Some(index) = sticky_index {
                if !fresh_native_history { self.awareness_tainted_scopes[index].nodes = nodes; }
            }
            else { self.awareness_tainted_scopes.push(ManagedAwarenessTaintedScopeV1 { owner: authority.owner_pubkey.clone(), resident: authority.resident_pubkey.clone(), conversation: authority.conversation_id.clone(), nodes }); }
        }
        self.dispatches.get_mut(&key).ok_or(DispatchAuthorizationError::Unknown)?.awareness_context_binding = Some(candidate.clone());
        if self.persist().is_err() {
            if let Some(row) = self.dispatches.get_mut(&key) { row.awareness_context_binding = None; }
            self.awareness_tainted_scopes = previous_scopes;
            return Err(DispatchAuthorizationError::Persistence);
        }
        Ok(candidate)
    }

    /// Read-only exact lookup. Metadata is not current grant or publication
    /// authority; consumers recheck all returned nodes at their final effects.
    pub(crate) fn turn_awareness_context(&self, owner: &Hex64, resident: &Hex64, conversation: &OpaqueId, dispatch: &Hex64) -> ManagedTurnAwarenessLookupV1 {
        let Some(row) = self.dispatches.get(&(dispatch.as_str().into(), resident.as_str().into())) else { return ManagedTurnAwarenessLookupV1::Unknown; };
        if row.owner_pubkey != owner.as_str() || row.conversation_id != conversation.as_str() { return ManagedTurnAwarenessLookupV1::Unknown; }
        self.awareness_lookup(row)
    }
    /// Accepted final-event ID correlated to the exact owner/resident row. No
    /// plaintext event is read. Caller has independently verified signed event
    /// identity where present; an arbitrary ID/public key alone grants nothing.
    pub(crate) fn final_event_awareness_context(&self, owner: &Hex64, resident: &Hex64, event: &Hex64) -> ManagedTurnAwarenessLookupV1 {
        let mut matches = self.dispatches.values().filter(|row| row.owner_pubkey == owner.as_str() && row.resident_pubkey == resident.as_str()
            && row.state == ManagedDispatchState::Published && row.published_event_id.as_deref() == Some(event.as_str()) && row.submitted_event_id == row.published_event_id);
        let Some(row) = matches.next() else { return ManagedTurnAwarenessLookupV1::Unknown; };
        if matches.next().is_some() { return ManagedTurnAwarenessLookupV1::Unknown; }
        self.awareness_lookup(row)
    }
    /// Conservative initial boundary: automatic memory/carry cannot turn
    /// temporary awareness into retained semantic material without promotion.
    pub(crate) fn automatic_derivatives_allowed_for_final(&self, owner: &Hex64, resident: &Hex64, event: &Hex64) -> bool {
        self.final_event_awareness_context(owner, resident, event) == ManagedTurnAwarenessLookupV1::Untainted
    }
    /// Broker artifacts/publication lack a promoted derivative mapping for
    /// ordinary aware turns. Source-untainted legacy/checked-clean work survives.
    pub(crate) fn broker_artifacts_allowed_for_dispatch(&self, owner: &Hex64, resident: &Hex64, conversation: &OpaqueId, dispatch: &Hex64) -> bool {
        self.turn_awareness_context(owner, resident, conversation, dispatch) == ManagedTurnAwarenessLookupV1::Untainted
    }
    fn awareness_lookup(&self, row: &ActiveDispatch) -> ManagedTurnAwarenessLookupV1 {
        let Some(binding) = &row.awareness_context_binding else { return ManagedTurnAwarenessLookupV1::Unknown; };
        if binding.validate(row).is_err() { return ManagedTurnAwarenessLookupV1::Unknown; }
        let sticky = self.awareness_tainted_scopes.iter().find(|scope| scope.matches(&binding.owner_pubkey, &binding.resident_pubkey, &binding.conversation_id));
        match binding.mode {
            BindingMode::Clean if binding.fresh_native_history => ManagedTurnAwarenessLookupV1::Untainted,
            BindingMode::LegacyClean | BindingMode::Clean if sticky.is_none() => ManagedTurnAwarenessLookupV1::Untainted,
            BindingMode::LegacyClean | BindingMode::Clean => ManagedTurnAwarenessLookupV1::Unknown,
            BindingMode::Observed | BindingMode::Inherited => {
                let Some(sticky) = sticky else { return ManagedTurnAwarenessLookupV1::Unknown; };
                let mut current = binding.clone();
                if !binding.fresh_native_history { current.context_nodes.extend(sticky.nodes.iter().cloned()); current.context_nodes.sort(); current.context_nodes.dedup(); }
                if current.context_nodes.len() > MAX_CONTEXT_NODES { return ManagedTurnAwarenessLookupV1::Unknown; }
                ManagedTurnAwarenessLookupV1::Bound(Box::new(current))
            }
        }
    }
}

#[cfg(test)]
#[path = "awareness_tests.rs"]
mod tests;
