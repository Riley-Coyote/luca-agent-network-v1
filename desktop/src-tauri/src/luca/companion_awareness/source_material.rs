//! Bounded body-free observation correlations and metadata-only retained checks.
//! No raw transcript, discovery, key acquisition, or native invocation occurs.

use super::{StopScope, MAX_MATERIAL_REFS};
use crate::app_state::AppState;
use crate::luca::companion_awareness::{
    catalog::{SelectedSourceClassV1, SelectedSourceSelectionV1},
    AwarenessGrantKeyV1, AwarenessMaterialFactsV1, AwarenessSourceKeyV1, AwarenessStoreError,
};
use luca_protocol::{
    AwarenessMaterialStateV1, AwarenessObservationRefV1, CanonicalTimestamp, Hex64, OpaqueId,
};
use std::{
    collections::{BTreeMap, HashSet, VecDeque},
    path::Path,
    time::{Duration, Instant},
};

/// Exact scope or the separately typed profile's opaque child identity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SourceMaterialScopeV1 {
    Exact(SelectedSourceClassV1),
    ProfileChild(OpaqueId),
    Machine(crate::luca::companion_awareness::machine_activity::MachineObservationClassV1),
    #[cfg(unix)]
    Browser(crate::luca::companion_awareness::browser_bridge::BrowserEventKindV1),
}
/// Complete reference correlation, never a source-wide freshness permission.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SourceMaterialBindingV1 {
    pub(crate) reference: AwarenessObservationRefV1,
    pub(crate) scope: SourceMaterialScopeV1,
}
#[derive(Clone)]
pub(super) struct MaterialRecord {
    pub(super) binding: SourceMaterialBindingV1,
    pub(super) raw_current: bool,
    pub(super) state: AwarenessMaterialStateV1,
}
#[derive(Default)]
pub(super) struct MaterialBook {
    pub(super) owner: Option<Hex64>,
    pub(super) known_exact: Vec<(AwarenessGrantKeyV1, SelectedSourceClassV1)>,
    pub(super) active: Vec<AwarenessGrantKeyV1>,
    pub(super) records: VecDeque<MaterialRecord>,
}
/// Preload before effect locks. No bytes, credentials or live authority.
#[derive(Clone)]
pub(crate) struct SourceMaterialSnapshotV1 {
    pub(super) now: CanonicalTimestamp,
    pub(super) known_exact: Vec<(AwarenessGrantKeyV1, SelectedSourceClassV1)>,
    pub(super) records: Vec<MaterialRecord>,
    pub(crate) collecting: Vec<AwarenessGrantKeyV1>,
}
impl SourceMaterialSnapshotV1 {
    /// Current candidates only; authoritative grant/deny/egress and raw buffer
    /// are rechecked separately at the real consuming effect.
    pub(crate) fn references(&self) -> Vec<AwarenessObservationRefV1> {
        self.records
            .iter()
            .filter(|record| self.raw_current(record))
            .map(|record| record.binding.reference.clone())
            .collect()
    }
    /// Exact sessions reconstruct from immutable catalog scope after restart.
    /// A profile child cannot be guessed from source ID or latest activity.
    /// Missing profile mapping remains unavailable pending durable body-free
    /// observation->child storage in the existing awareness authority.
    pub(crate) fn binding(
        &self,
        reference: &AwarenessObservationRefV1,
    ) -> Option<SourceMaterialBindingV1> {
        if let Some(record) = self
            .records
            .iter()
            .find(|record| &record.binding.reference == reference)
        {
            return Some(record.binding.clone());
        }
        let key = observation_key(reference);
        let (_, class) = self.known_exact.iter().find(|(known, _)| known == &key)?;
        Some(SourceMaterialBindingV1 {
            reference: reference.clone(),
            scope: SourceMaterialScopeV1::Exact(*class),
        })
    }
    /// Each profile child and retained derivative requires preloaded CURRENT
    /// child/exclusion/canonical material facts. The callback must be pure and
    /// keyed by the exact binding, never a blanket profile/source fresh bit.
    /// Retained availability is not sensor/raw liveness or raw re-admission.
    pub(crate) fn resolve(
        &self,
        reference: &AwarenessObservationRefV1,
        retained: bool,
        current_child: impl FnOnce(&SourceMaterialBindingV1, bool) -> Option<AwarenessMaterialFactsV1>,
    ) -> AwarenessMaterialFactsV1 {
        let Some(binding) = self.binding(reference) else {
            return unavailable();
        };
        if retained {
            return current_child(&binding, true).unwrap_or_else(unavailable);
        }
        let Some(record) = self
            .records
            .iter()
            .find(|record| &record.binding.reference == reference)
        else {
            return unavailable();
        };
        if record.state == AwarenessMaterialStateV1::Excluded {
            return AwarenessMaterialFactsV1 {
                source_fresh: false,
                material_state: AwarenessMaterialStateV1::Excluded,
            };
        }
        if !self.raw_current(record) {
            return unavailable();
        }
        match &binding.scope {
            SourceMaterialScopeV1::Exact(_) | SourceMaterialScopeV1::Machine(_) => AwarenessMaterialFactsV1 {
                source_fresh: true,
                material_state: AwarenessMaterialStateV1::Available,
            },
            SourceMaterialScopeV1::ProfileChild(_) => {
                current_child(&binding, false).unwrap_or_else(unavailable)
            }
            #[cfg(unix)]
            SourceMaterialScopeV1::Browser(_) => current_child(&binding,false).unwrap_or_else(unavailable),
        }
    }
    fn raw_current(&self, record: &MaterialRecord) -> bool {
        record.raw_current
            && record.state == AwarenessMaterialStateV1::Available
            && record.binding.reference.captured_at <= self.now
            && self.now < record.binding.reference.expires_at
    }
}
pub(super) fn unavailable() -> AwarenessMaterialFactsV1 {
    AwarenessMaterialFactsV1 {
        source_fresh: false,
        material_state: AwarenessMaterialStateV1::Unavailable,
    }
}
pub(super) fn observation_key(reference: &AwarenessObservationRefV1) -> AwarenessGrantKeyV1 {
    AwarenessGrantKeyV1 {
        source: AwarenessSourceKeyV1 {
            owner_pubkey: reference.owner_pubkey.clone(),
            source_id: reference.source_id.clone(),
            device_id: reference.device_id.clone(),
        },
        resident_pubkey: reference.resident_pubkey.clone(),
    }
}
impl MaterialBook {
    pub(super) fn remember(
        &mut self,
        reference: AwarenessObservationRefV1,
        scope: SourceMaterialScopeV1,
    ) {
        let key = observation_key(&reference);
        // A deny-first stop removes active metadata immediately. A just-finished
        // pre-deny capture cannot make its raw view current again afterward.
        let raw_current = self.active.contains(&key);
        for record in &mut self.records {
            if observation_key(&record.binding.reference) == key && record.binding.scope == scope {
                record.raw_current = false;
            }
        }
        self.records
            .retain(|record| record.binding.reference.observation_id != reference.observation_id);
        if self.records.len() == MAX_MATERIAL_REFS {
            self.records.pop_front();
        }
        self.records.push_back(MaterialRecord {
            binding: SourceMaterialBindingV1 { reference, scope },
            raw_current,
            state: AwarenessMaterialStateV1::Available,
        });
    }
    pub(super) fn invalidate(&mut self, stop: &StopScope) {
        for record in &mut self.records {
            if stop.matches(&observation_key(&record.binding.reference)) {
                record.raw_current = false;
            }
        }
    }
    pub(super) fn child_state(
        &mut self,
        key: &AwarenessGrantKeyV1,
        child: &OpaqueId,
        state: AwarenessMaterialStateV1,
    ) {
        for record in &mut self.records {
            if observation_key(&record.binding.reference) == *key
                && record.binding.scope == SourceMaterialScopeV1::ProfileChild(child.clone())
            {
                record.raw_current = false;
                record.state = state;
            }
        }
    }
    pub(super) fn scope_state(
        &mut self,
        key: &AwarenessGrantKeyV1,
        state: AwarenessMaterialStateV1,
    ) {
        for record in &mut self.records {
            if observation_key(&record.binding.reference) == *key {
                record.raw_current = false;
                record.state = state;
            }
        }
    }
}

/// Metadata-only exclusion result; raw provider UUID/path never leaves it.
pub(crate) struct ExactSelectionExclusionFactsV1 {
    pub(crate) session_ref: Option<OpaqueId>,
    pub(crate) material: AwarenessMaterialFactsV1,
}
impl SelectedSourceSelectionV1 {
    /// Verify this full exact source binding against complete current host
    /// exclusions, with no transcript read, stat, SDK execution or profile scan.
    /// This does not prove current canonical bytes or transcript content. The
    /// caller's retained guard must establish the owned canonical material and
    /// current grant/epoch independently. Ambiguous native names fail closed.
    pub(crate) fn with_safe_exclusion_facts(
        &self,
        reference: &AwarenessObservationRefV1,
        excluded: &HashSet<String>,
    ) -> Result<ExactSelectionExclusionFactsV1, AwarenessStoreError> {
        if self.key() != &observation_key(reference) {
            return Err(AwarenessStoreError::Invalid);
        }
        self.safe_exclusion_scope(excluded)
    }
    pub(super) fn safe_exclusion_scope(
        &self,
        excluded: &HashSet<String>,
    ) -> Result<ExactSelectionExclusionFactsV1, AwarenessStoreError> {
        let (root, relative) = self.metadata_locator();
        if self.class().source_id(root, relative)? != self.key().source.source_id
            || excluded.len() > 4096
        {
            return Err(AwarenessStoreError::Invalid);
        }
        if root
            .components()
            .chain(Path::new(relative).components())
            .any(|part| {
                let name = part.as_os_str().to_string_lossy().to_ascii_lowercase();
                matches!(
                    name.as_str(),
                    "subagents" | "private-cognition" | "runtime-session-purposes" | ".luca"
                )
            })
        {
            return Err(AwarenessStoreError::Unavailable);
        }
        if self.class() == SelectedSourceClassV1::SelectedFile {
            return Ok(ExactSelectionExclusionFactsV1 {
                session_ref: None,
                material: AwarenessMaterialFactsV1 {
                    source_fresh: false,
                    material_state: AwarenessMaterialStateV1::Available,
                },
            });
        }
        let stem = Path::new(relative)
            .file_stem()
            .and_then(|stem| stem.to_str())
            .ok_or(AwarenessStoreError::Unavailable)?;
        let native_id = stem
            .get(stem.len().saturating_sub(36)..)
            .ok_or(AwarenessStoreError::Unavailable)?;
        let uuid =
            uuid::Uuid::parse_str(native_id).map_err(|_| AwarenessStoreError::Unavailable)?;
        if uuid.is_nil() || uuid.hyphenated().to_string() != native_id {
            return Err(AwarenessStoreError::Unavailable);
        }
        if stem != native_id {
            if !matches!(
                self.class(),
                SelectedSourceClassV1::CodexSessionMetadata
                    | SelectedSourceClassV1::CodexSessionVisibleExcerpts
            ) {
                return Err(AwarenessStoreError::Unavailable);
            }
            let prefix = stem
                .strip_suffix(native_id)
                .and_then(|prefix| prefix.strip_suffix('-'))
                .and_then(|prefix| prefix.strip_prefix("rollout-"))
                .ok_or(AwarenessStoreError::Unavailable)?;
            chrono::NaiveDateTime::parse_from_str(prefix, "%Y-%m-%dT%H-%M-%S")
                .map_err(|_| AwarenessStoreError::Unavailable)?;
        }
        let session_ref = crate::luca::connected_brain::native_session_opaque_id(
            &self.key().source.source_id,
            relative,
        )
        .map_err(|_| AwarenessStoreError::Invalid)?;
        let material_state = if excluded.contains(native_id) {
            AwarenessMaterialStateV1::Excluded
        } else {
            AwarenessMaterialStateV1::Available
        };
        Ok(ExactSelectionExclusionFactsV1 {
            session_ref: Some(session_ref),
            material: AwarenessMaterialFactsV1 {
                source_fresh: false,
                material_state,
            },
        })
    }
}

struct RetainedExact {
    key: AwarenessGrantKeyV1,
    facts: AwarenessMaterialFactsV1,
}
struct RetainedProfile {
    binding: crate::luca::companion_awareness::AwarenessProfileChildBindingV1,
    facts: AwarenessMaterialFactsV1,
}
/// Pure preloaded exact-child facts, not a capability. Its short original
/// deadline survives into final callbacks; late use is unavailable.
pub(crate) struct RetainedSourceFactsV1 {
    raw: SourceMaterialSnapshotV1,
    exact: Vec<RetainedExact>,
    profiles: Vec<RetainedProfile>,
    deadline: Instant,
    #[cfg(unix)]
    browser:Option<crate::luca::companion_awareness::browser_runtime::BrowserMaterialSnapshotV1>,
}
impl RetainedSourceFactsV1 {
    /// Combined body-free source candidates prepared before any effect lease.
    pub(crate) fn snapshot(&self)->&SourceMaterialSnapshotV1 {&self.raw}
    /// IO/lock-free final resolver. Fresh exclusions override old raw snapshots;
    /// retained derivatives use durable FULL-ref child correlation, not raw TTL.
    /// The caller separately proves canonical ownership/current grant/deny.
    pub(crate) fn resolve(&self, reference:&AwarenessObservationRefV1, retained:bool) -> AwarenessMaterialFactsV1 {
        if Instant::now()>=self.deadline {return unavailable();}
        #[cfg(unix)]
        if let Some(browser)=&self.browser {
            if browser.binding(reference).is_some() {return browser.resolve(reference,retained);}
        }
        if matches!(self.raw.binding(reference).map(|b|b.scope),Some(SourceMaterialScopeV1::Machine(_))) {
            return if retained {unavailable()} else {self.raw.resolve(reference,false,|_,_|None)};
        }
        let current = self.exact.iter().find(|e|e.key==observation_key(reference)).map(|e|e.facts)
            .or_else(||self.profiles.iter().find(|p|p.binding.reference==*reference).map(|p|p.facts))
            .unwrap_or_else(unavailable);
        if current.material_state!=AwarenessMaterialStateV1::Available || retained {return current;}
        // Current exclusions alone never establish current raw bytes.
        self.raw.resolve(reference,false,|binding,_| {
            let profile=self.profiles.iter().find(|p|p.binding.reference==*reference)?;
            if binding.scope!=SourceMaterialScopeV1::ProfileChild(profile.binding.child.child_ref.clone()) {return None;}
            Some(AwarenessMaterialFactsV1 {source_fresh:true,material_state:current.material_state})
        })
    }
}
/// Existing Library preload seam; all metadata/exclusion work shares <=1s.
/// No native transcript, actor queue wait, signing key or model is touched.
pub(crate) fn preload_retained_source_facts(state:&AppState,owner:&Hex64,resident:&Hex64,now:&CanonicalTimestamp)
    -> Result<RetainedSourceFactsV1,AwarenessStoreError> {
    let deadline=Instant::now().checked_add(Duration::from_secs(1)).ok_or(AwarenessStoreError::Unavailable)?;
    preload_source_facts_before(state,owner,resident,now,deadline)
}
/// Deadline-bounded ordinary-turn/Library preload BEFORE effect leases. Reads
/// only explicit private selection manifests, body-free child correlations and
/// Polyphonic's complete purpose ledger; never native bodies or profile scans.
/// The caller's original deadline is preserved and additionally capped at 1s.
pub(crate) fn preload_source_facts_before(state:&AppState,owner:&Hex64,resident:&Hex64,now:&CanonicalTimestamp,original_deadline:Instant)
    -> Result<RetainedSourceFactsV1,AwarenessStoreError> {
    use crate::luca::companion_awareness::{catalog::SelectedSourceCatalogV1,profile_catalog::NativeProfileCatalogV1};
    let deadline=original_deadline.min(Instant::now().checked_add(Duration::from_secs(1)).ok_or(AwarenessStoreError::Unavailable)?);
    if Instant::now()>=deadline {return Err(AwarenessStoreError::Unavailable);}
    let runtime=&state.companion_awareness;
    let directory=runtime.private_directory(owner)?;let device=runtime.device(owner)?;
    let selected=SelectedSourceCatalogV1::open(&directory,owner,&device)?.selections(resident)?;
    let profiles=NativeProfileCatalogV1::open(&directory,owner,&device)?.profiles(resident)?;
    let correlations=runtime.profile_child_bindings(owner,resident)?;
    let mut raw=state.companion_sources.snapshot(owner,resident,now)?;
    raw.known_exact=selected.iter().map(|s|(s.key().clone(),s.class())).collect();
    #[cfg(unix)]
    let browser=state.companion_browser.snapshot(owner,resident,now).ok();
    #[cfg(unix)]
    if let Some(snapshot)=&browser {
        for reference in snapshot.references() {
            if let Some(kind)=snapshot.binding(&reference) {
                raw.records.push(MaterialRecord {binding:SourceMaterialBindingV1 {reference,scope:SourceMaterialScopeV1::Browser(kind)},raw_current:true,state:AwarenessMaterialStateV1::Available});
            }
        }
    }
    let mut cache=BTreeMap::<&'static str,Option<HashSet<String>>>::new();
    let mut exact=Vec::new();
    for selection in selected {
        let family=match selection.class() {
            SelectedSourceClassV1::SelectedFile=>None,
            SelectedSourceClassV1::CodexSessionMetadata|SelectedSourceClassV1::CodexSessionVisibleExcerpts=>Some("codex"),
            SelectedSourceClassV1::ClaudeSessionMetadata|SelectedSourceClassV1::ClaudeSessionVisibleExcerpts=>Some("claude_code"),
        };
        let empty=HashSet::new();
        let facts=match family {
            None=>selection.safe_exclusion_scope(&empty).ok(),
            Some(family)=>cache.entry(family).or_insert_with(||super::profiles::complete_exclusions(state,family,deadline).ok())
                .as_ref().and_then(|set|selection.safe_exclusion_scope(set).ok()),
        };
        exact.push(RetainedExact {key:selection.key().clone(),facts:facts.map(|f|f.material).unwrap_or_else(unavailable)});
    }
    let mut profile_facts=Vec::new();
    for registration in profiles {
        let selection=&registration.selection;let family=super::profiles::family(selection.kind());
        let excluded=cache.entry(family).or_insert_with(||super::profiles::complete_exclusions(state,family,deadline).ok());
        let tokens=excluded.as_ref().and_then(|ids|ids.iter().map(|id|selection.exclusion_token(id)).collect::<Result<HashSet<_>,_>>().ok());
        for binding in correlations.iter().filter(|b|observation_key(&b.reference)==*selection.grant_key()) {
            let facts=match &tokens {
                None=>unavailable(),
                Some(tokens)=>AwarenessMaterialFactsV1 {source_fresh:false,material_state:
                    if tokens.contains(&binding.child.exclusion_token) {AwarenessMaterialStateV1::Excluded}
                    else {AwarenessMaterialStateV1::Available}},
            };
            profile_facts.push(RetainedProfile {binding:binding.clone(),facts});
        }
    }
    if Instant::now()>=deadline {return Err(AwarenessStoreError::Unavailable);}
    Ok(RetainedSourceFactsV1 {raw,exact,profiles:profile_facts,deadline,#[cfg(unix)] browser})
}

#[cfg(test)]
#[path="source_material_tests.rs"]
mod tests;
