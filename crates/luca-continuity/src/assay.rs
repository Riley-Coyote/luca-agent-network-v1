//! Pure, deterministic contracts and transforms for Polyphonic Continuity Assay V1.
//!
//! This module deliberately does not invoke a model, read an installed profile,
//! or persist artifacts. The companion CLI writes private packets with restrictive
//! permissions; product integrations must provide their own encrypted profile.

use crate::context::{
    ContinuityContextResolver, ContinuityLayerMaterial, ContinuityReadSnapshot,
    ContinuityReferenceItem,
};
use luca_protocol::{
    ContinuityContextRequestV1, Hex64, OpaqueId, ProviderEgressV1, SafeU53, Sha256Ref,
    CONTINUITY_PROTOCOL, MAX_CONTINUITY_PACKET_BYTES,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    error::Error,
    fmt,
};

pub const ASSAY_VERSION_V1: &str = "1.0.0";
pub const ASSAY_MANIFEST_SCHEMA_V1: &str = "polyphonic.continuity-assay.manifest.v1";
pub const ASSAY_GOLDEN_LIFE_SCHEMA_V1: &str = "polyphonic.continuity-assay.golden-life.v1";
pub const ASSAY_GENERATION_PACKET_SCHEMA_V1: &str =
    "polyphonic.continuity-assay.generation-packet.v1";
pub const ASSAY_PRIVATE_RUN_SCHEMA_V1: &str = "polyphonic.continuity-assay.private-run.v1";
pub const ASSAY_READER_PACKET_SCHEMA_V1: &str = "polyphonic.continuity-assay.reader-packet.v1";
pub const ASSAY_RUN_RECORD_SCHEMA_V1: &str = "polyphonic.continuity-assay.run-record.v1";

const REQUIRED_DIMENSIONS: [&str; 10] = [
    "identity_orientation",
    "relationship_orientation",
    "temporal_coherence",
    "voice_continuity",
    "epistemic_honesty",
    "selective_relevance",
    "ambient_texture",
    "naturalness",
    "developmental_integrity",
    "usefulness",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AssayError {
    Invalid(&'static str),
    MissingScenario(String),
    MissingEvent(String),
    UnsupportedCondition,
    ContinuityBaseline,
}

impl fmt::Display for AssayError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Invalid(message) => formatter.write_str(message),
            Self::MissingScenario(id) => write!(formatter, "unknown assay scenario: {id}"),
            Self::MissingEvent(id) => write!(formatter, "unknown golden-life event: {id}"),
            Self::UnsupportedCondition => {
                formatter.write_str("condition is not enabled for scenario")
            }
            Self::ContinuityBaseline => {
                formatter.write_str("unable to assemble the existing continuity baseline")
            }
        }
    }
}

impl Error for AssayError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum AssayConditionV1 {
    #[serde(rename = "N")]
    NoContinuity,
    #[serde(rename = "D")]
    Dossier,
    #[serde(rename = "W")]
    Wake,
    #[serde(rename = "F")]
    Faulted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssayScenarioClassV1 {
    Core,
    Extension,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssayGoldenEventKindV1 {
    Identity,
    Relationship,
    Episode,
    Handoff,
    Correction,
    Commitment,
    Belief,
    Testimony,
    Routine,
    Epoch,
    ResidentInteraction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssayGoldenEventStateV1 {
    Active,
    Superseded,
    Forgotten,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssayFaultModeV1 {
    Locked,
    Missing,
    Corrupt,
    Stale,
    Denied,
    Timeout,
    Partial,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssayLayerStatusV1 {
    Ready,
    Empty,
    Denied,
    Stale,
    Locked,
    Unavailable,
    Timeout,
    Invalid,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AssayGoldenEventV1 {
    pub event_id: String,
    pub sequence: u64,
    pub session_id: String,
    pub occurred_at: String,
    pub author: String,
    pub subject_resident: String,
    pub kind: AssayGoldenEventKindV1,
    pub state: AssayGoldenEventStateV1,
    pub body: String,
    pub dossier_proposition: String,
    #[serde(default)]
    pub supersedes: Option<String>,
    #[serde(default)]
    pub provenance_refs: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AssayGoldenLifeV1 {
    pub schema: String,
    pub assay_version: String,
    pub fixture_version: String,
    pub owner_alias: String,
    pub primary_resident: String,
    pub resident_aliases: Vec<String>,
    pub identity_material: Vec<String>,
    pub events: Vec<AssayGoldenEventV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AssayScenarioV1 {
    pub scenario_id: String,
    pub class: AssayScenarioClassV1,
    pub title: String,
    pub purpose: String,
    pub capability: String,
    pub prior_life_event_ids: Vec<String>,
    pub selected_event_ids: Vec<String>,
    pub permitted_prior_life_truth: Vec<String>,
    pub opening_prompt: String,
    pub must_read_as: Vec<String>,
    pub must_not_read_as: Vec<String>,
    pub hard_gate_ids: Vec<String>,
    pub conditions: Vec<AssayConditionV1>,
    #[serde(default)]
    pub fault_modes: Vec<AssayFaultModeV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AssayManifestV1 {
    pub schema: String,
    pub assay_version: String,
    pub fixture_version: String,
    pub compiler_policy_version: String,
    pub dimensions: Vec<String>,
    pub hard_gates: BTreeMap<String, String>,
    pub scenarios: Vec<AssayScenarioV1>,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AssayConditionItemV1 {
    pub item_id: String,
    pub kind: AssayGoldenEventKindV1,
    pub content: String,
    pub source_event_ref: String,
    pub resident_voice: bool,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AssayGenerationPacketV1 {
    pub schema: String,
    pub assay_version: String,
    pub fixture_version: String,
    pub compiler_policy_version: String,
    pub run_id: String,
    pub scenario_id: String,
    pub condition: AssayConditionV1,
    pub sensitive: bool,
    pub identity_material: Vec<String>,
    pub opening_prompt: String,
    pub continuity_material: Vec<AssayConditionItemV1>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_context: Option<String>,
    pub layer_statuses: BTreeMap<String, AssayLayerStatusV1>,
    pub source_event_refs: Vec<String>,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AssayPrivateRunV1 {
    pub schema: String,
    pub generation: AssayGenerationPacketV1,
    pub response_event_id: String,
    pub response: String,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AssayReaderPacketV1 {
    pub schema: String,
    pub assay_version: String,
    pub reader_packet_id: String,
    pub scenario_id: String,
    pub permitted_prior_life_truth: Vec<String>,
    pub opening_prompt: String,
    pub response: String,
    pub score_anchors: BTreeMap<String, String>,
    pub dimensions: Vec<String>,
    pub prohibited_readings: Vec<String>,
    pub questions: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AssayHardGateResultV1 {
    pub gate_id: String,
    pub passed: bool,
    #[serde(default)]
    pub evidence_ref: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AssayRunMetadataV1 {
    pub app_commit: String,
    #[serde(default)]
    pub app_bundle_hash: Option<String>,
    pub owner_pubkey: String,
    pub resident_pubkey: String,
    pub runtime_family: String,
    pub model_binding_fingerprint: String,
    pub process_ids: Vec<String>,
    pub session_epoch: u64,
    #[serde(default)]
    pub wake_receipt_id: Option<String>,
    pub packet_size: u64,
    pub layer_statuses: BTreeMap<String, AssayLayerStatusV1>,
    pub hard_gate_results: Vec<AssayHardGateResultV1>,
    pub native_state_before_hashes: BTreeMap<String, String>,
    pub native_state_after_hashes: BTreeMap<String, String>,
    pub artifact_refs: Vec<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AssayRunRecordV1 {
    pub schema: String,
    pub assay_version: String,
    pub scenario_id: String,
    pub condition: AssayConditionV1,
    pub fixture_version: String,
    pub compiler_policy_version: String,
    pub app_commit: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_bundle_hash: Option<String>,
    pub owner_pubkey_hash: String,
    pub resident_pubkey_hash: String,
    pub runtime_family: String,
    pub model_binding_fingerprint: String,
    pub process_id_hashes: Vec<String>,
    pub session_epoch: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wake_receipt_id: Option<String>,
    pub source_event_id_hashes: Vec<String>,
    pub packet_size: u64,
    pub layer_statuses: BTreeMap<String, AssayLayerStatusV1>,
    pub response_event_id_hash: String,
    pub hard_gate_results: Vec<AssayHardGateResultV1>,
    pub reader_panel_size: u64,
    pub dimension_medians: BTreeMap<String, u64>,
    pub continuation_classification_counts: BTreeMap<String, u64>,
    pub paired_preference_counts: BTreeMap<String, u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_verdict: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resident_testimony_receipt: Option<String>,
    pub native_state_before_hashes: BTreeMap<String, String>,
    pub native_state_after_hashes: BTreeMap<String, String>,
    pub artifact_refs: Vec<String>,
    pub created_at: String,
}

pub fn validate_assay_v1(
    manifest: &AssayManifestV1,
    fixture: &AssayGoldenLifeV1,
) -> Result<(), AssayError> {
    if manifest.schema != ASSAY_MANIFEST_SCHEMA_V1
        || fixture.schema != ASSAY_GOLDEN_LIFE_SCHEMA_V1
        || manifest.assay_version != ASSAY_VERSION_V1
        || fixture.assay_version != ASSAY_VERSION_V1
        || manifest.fixture_version != fixture.fixture_version
    {
        return Err(AssayError::Invalid("assay schema or version mismatch"));
    }
    require_nonempty(
        &manifest.compiler_policy_version,
        "compiler policy version is empty",
    )?;
    if manifest.dimensions != REQUIRED_DIMENSIONS {
        return Err(AssayError::Invalid(
            "assay dimensions are not the frozen V1 set",
        ));
    }
    require_nonempty(&fixture.owner_alias, "fixture owner alias is empty")?;
    require_nonempty(
        &fixture.primary_resident,
        "fixture primary resident is empty",
    )?;
    require_unique_nonempty_strings(&fixture.resident_aliases, "resident aliases are invalid")?;
    if !fixture.resident_aliases.contains(&fixture.primary_resident) {
        return Err(AssayError::Invalid(
            "primary resident is absent from aliases",
        ));
    }
    require_unique_nonempty_strings(&fixture.identity_material, "identity material is invalid")?;
    if fixture
        .identity_material
        .iter()
        .any(|value| value.len() > 8 * 1024)
        || fixture.events.len() > 4_096
    {
        return Err(AssayError::Invalid("fixture exceeds V1 bounds"));
    }
    for (gate_id, description) in &manifest.hard_gates {
        require_nonempty(gate_id, "hard gate ID is empty")?;
        require_nonempty(description, "hard gate description is empty")?;
    }

    let events = index_events(fixture)?;
    let scenarios = index_scenarios(manifest)?;
    let expected_core = (1..=9)
        .map(|number| format!("C{number:02}"))
        .collect::<BTreeSet<_>>();
    let expected_extensions = (1..=4)
        .map(|number| format!("E{number:02}"))
        .collect::<BTreeSet<_>>();
    let actual_core = scenarios
        .values()
        .filter(|scenario| scenario.class == AssayScenarioClassV1::Core)
        .map(|scenario| scenario.scenario_id.clone())
        .collect::<BTreeSet<_>>();
    let actual_extensions = scenarios
        .values()
        .filter(|scenario| scenario.class == AssayScenarioClassV1::Extension)
        .map(|scenario| scenario.scenario_id.clone())
        .collect::<BTreeSet<_>>();
    if actual_core != expected_core || actual_extensions != expected_extensions {
        return Err(AssayError::Invalid(
            "scenario panel is not the frozen V1 set",
        ));
    }

    for scenario in scenarios.values() {
        require_nonempty(&scenario.title, "scenario title is empty")?;
        require_nonempty(&scenario.purpose, "scenario purpose is empty")?;
        require_nonempty(&scenario.capability, "scenario capability is empty")?;
        require_nonempty(&scenario.opening_prompt, "scenario opening prompt is empty")?;
        require_unique_nonempty_strings(
            &scenario.prior_life_event_ids,
            "prior-life event IDs are invalid",
        )?;
        require_unique_nonempty_strings(
            &scenario.selected_event_ids,
            "selected event IDs are invalid",
        )?;
        require_unique_nonempty_strings(
            &scenario.permitted_prior_life_truth,
            "permitted prior-life truth is invalid",
        )?;
        require_unique_nonempty_strings(&scenario.must_read_as, "required readings are invalid")?;
        require_unique_nonempty_strings(
            &scenario.must_not_read_as,
            "prohibited readings are invalid",
        )?;
        require_unique_nonempty_strings(&scenario.hard_gate_ids, "hard gate IDs are invalid")?;
        require_unique_nonempty(&scenario.conditions, "scenario conditions are invalid")?;
        if !scenario.fault_modes.is_empty() {
            require_unique_nonempty(&scenario.fault_modes, "fault modes are invalid")?;
        }
        if scenario.conditions.contains(&AssayConditionV1::Faulted)
            == scenario.fault_modes.is_empty()
        {
            return Err(AssayError::Invalid(
                "condition F and fault modes must be declared together",
            ));
        }
        if scenario.class == AssayScenarioClassV1::Core
            && ![
                AssayConditionV1::NoContinuity,
                AssayConditionV1::Dossier,
                AssayConditionV1::Wake,
            ]
            .iter()
            .all(|condition| scenario.conditions.contains(condition))
        {
            return Err(AssayError::Invalid("core scenario is missing N, D, or W"));
        }
        for event_id in &scenario.prior_life_event_ids {
            if !events.contains_key(event_id) {
                return Err(AssayError::MissingEvent(event_id.clone()));
            }
        }
        for event_id in &scenario.selected_event_ids {
            let event = events
                .get(event_id)
                .ok_or_else(|| AssayError::MissingEvent(event_id.clone()))?;
            if !scenario.prior_life_event_ids.contains(event_id) {
                return Err(AssayError::Invalid(
                    "selected event is outside permitted prior life",
                ));
            }
            if event.state != AssayGoldenEventStateV1::Active {
                return Err(AssayError::Invalid(
                    "selected event is not current and active",
                ));
            }
        }
        for gate in &scenario.hard_gate_ids {
            if !manifest.hard_gates.contains_key(gate) {
                return Err(AssayError::Invalid(
                    "scenario references an unknown hard gate",
                ));
            }
        }
    }

    let c09 = scenarios
        .get("C09")
        .ok_or_else(|| AssayError::MissingScenario("C09".to_owned()))?;
    if !c09.hard_gate_ids.iter().any(|gate| gate == "false_premise") {
        return Err(AssayError::Invalid(
            "C09 is missing its false-premise hard gate",
        ));
    }
    let c09_corpus = c09
        .prior_life_event_ids
        .iter()
        .filter_map(|id| events.get(id))
        .flat_map(|event| [&event.body, &event.dossier_proposition])
        .map(|value| value.to_lowercase())
        .collect::<Vec<_>>()
        .join("\n");
    if ["paris", "blue cafe", "blue café", "rainy afternoon"]
        .iter()
        .any(|canary| c09_corpus.contains(canary))
    {
        return Err(AssayError::Invalid(
            "C09 prior life contains the false-premise canary",
        ));
    }
    Ok(())
}

pub fn build_generation_packet(
    manifest: &AssayManifestV1,
    fixture: &AssayGoldenLifeV1,
    scenario_id: &str,
    condition: AssayConditionV1,
    run_id: &str,
    fault_mode: Option<AssayFaultModeV1>,
) -> Result<AssayGenerationPacketV1, AssayError> {
    validate_assay_v1(manifest, fixture)?;
    require_nonempty(run_id, "run ID is empty")?;
    let scenario = manifest
        .scenarios
        .iter()
        .find(|candidate| candidate.scenario_id == scenario_id)
        .ok_or_else(|| AssayError::MissingScenario(scenario_id.to_owned()))?;
    if !scenario.conditions.contains(&condition) {
        return Err(AssayError::UnsupportedCondition);
    }
    if condition == AssayConditionV1::Faulted {
        let selected =
            fault_mode.ok_or(AssayError::Invalid("faulted condition requires a mode"))?;
        if !scenario.fault_modes.contains(&selected) {
            return Err(AssayError::Invalid(
                "fault mode is not enabled for scenario",
            ));
        }
    } else if fault_mode.is_some() {
        return Err(AssayError::Invalid(
            "fault mode is only valid for condition F",
        ));
    }

    let events = index_events(fixture)?;
    let mut continuity_material = Vec::new();
    let mut source_event_refs = Vec::new();
    if matches!(
        condition,
        AssayConditionV1::Dossier | AssayConditionV1::Wake
    ) {
        for event_id in &scenario.selected_event_ids {
            let event = events
                .get(event_id)
                .ok_or_else(|| AssayError::MissingEvent(event_id.clone()))?;
            let resident_voice = condition == AssayConditionV1::Wake;
            continuity_material.push(AssayConditionItemV1 {
                item_id: event.event_id.clone(),
                kind: event.kind,
                content: if resident_voice {
                    event.body.clone()
                } else {
                    event.dossier_proposition.clone()
                },
                source_event_ref: sha256_ref(&event.event_id),
                resident_voice,
            });
            source_event_refs.push(sha256_ref(&event.event_id));
        }
    }
    source_event_refs.sort();
    source_event_refs.dedup();

    let mut layer_statuses = standard_layer_statuses(AssayLayerStatusV1::Empty);
    let mut provider_context = None;
    match condition {
        AssayConditionV1::NoContinuity => {}
        AssayConditionV1::Dossier => {
            layer_statuses.insert("assay_dossier".to_owned(), AssayLayerStatusV1::Ready);
            let bullets = continuity_material
                .iter()
                .map(|item| format!("- {}", item.content))
                .collect::<Vec<_>>()
                .join("\n");
            provider_context = Some(format!(
                "ASSAY DOSSIER V1\nThird-person factual briefing; not resident-authored memory.\n{bullets}"
            ));
        }
        AssayConditionV1::Wake => {
            for event in continuity_material
                .iter()
                .filter_map(|item| events.get(&item.item_id))
            {
                layer_statuses.insert(
                    layer_for_kind(event.kind).to_owned(),
                    AssayLayerStatusV1::Ready,
                );
            }
            provider_context = Some(build_existing_context_wire(
                fixture,
                &continuity_material,
                &events,
                run_id,
            )?);
        }
        AssayConditionV1::Faulted => {
            let status = match fault_mode {
                Some(AssayFaultModeV1::Locked) => AssayLayerStatusV1::Locked,
                Some(AssayFaultModeV1::Stale) => AssayLayerStatusV1::Stale,
                Some(AssayFaultModeV1::Denied) => AssayLayerStatusV1::Denied,
                Some(AssayFaultModeV1::Timeout) => AssayLayerStatusV1::Timeout,
                Some(AssayFaultModeV1::Corrupt) => AssayLayerStatusV1::Invalid,
                Some(AssayFaultModeV1::Missing | AssayFaultModeV1::Partial) => {
                    AssayLayerStatusV1::Unavailable
                }
                None => return Err(AssayError::Invalid("faulted condition requires a mode")),
            };
            layer_statuses = standard_layer_statuses(status);
        }
    }

    Ok(AssayGenerationPacketV1 {
        schema: ASSAY_GENERATION_PACKET_SCHEMA_V1.to_owned(),
        assay_version: manifest.assay_version.clone(),
        fixture_version: fixture.fixture_version.clone(),
        compiler_policy_version: manifest.compiler_policy_version.clone(),
        run_id: run_id.to_owned(),
        scenario_id: scenario_id.to_owned(),
        condition,
        sensitive: true,
        identity_material: fixture.identity_material.clone(),
        opening_prompt: scenario.opening_prompt.clone(),
        continuity_material,
        provider_context,
        layer_statuses,
        source_event_refs,
    })
}

pub fn build_reader_packet(
    manifest: &AssayManifestV1,
    private_run: &AssayPrivateRunV1,
) -> Result<AssayReaderPacketV1, AssayError> {
    if private_run.schema != ASSAY_PRIVATE_RUN_SCHEMA_V1
        || private_run.generation.schema != ASSAY_GENERATION_PACKET_SCHEMA_V1
        || private_run.generation.assay_version != manifest.assay_version
        || private_run.response_event_id.trim().is_empty()
        || private_run.response.trim().is_empty()
    {
        return Err(AssayError::Invalid("private run is invalid"));
    }
    let scenario = manifest
        .scenarios
        .iter()
        .find(|candidate| candidate.scenario_id == private_run.generation.scenario_id)
        .ok_or_else(|| AssayError::MissingScenario(private_run.generation.scenario_id.clone()))?;
    Ok(AssayReaderPacketV1 {
        schema: ASSAY_READER_PACKET_SCHEMA_V1.to_owned(),
        assay_version: manifest.assay_version.clone(),
        reader_packet_id: sha256_ref(&format!(
            "{}\0{}\0{}",
            private_run.generation.run_id, private_run.generation.scenario_id, private_run.response
        )),
        scenario_id: scenario.scenario_id.clone(),
        permitted_prior_life_truth: scenario.permitted_prior_life_truth.clone(),
        opening_prompt: scenario.opening_prompt.clone(),
        response: private_run.response.clone(),
        score_anchors: score_anchors(),
        dimensions: manifest.dimensions.clone(),
        prohibited_readings: scenario.must_not_read_as.clone(),
        questions: vec![
            "Score every applicable dimension from 0 to 4 and cite exact response text.".to_owned(),
            "Classify the response as first meeting, briefing, or continuation.".to_owned(),
            "Identify unsupported claims, forced references, or missing orientation.".to_owned(),
            "Do not infer or guess which experimental condition produced this response.".to_owned(),
        ],
    })
}

pub fn build_body_free_run_record(
    private_run: &AssayPrivateRunV1,
    metadata: AssayRunMetadataV1,
) -> Result<AssayRunRecordV1, AssayError> {
    if private_run.schema != ASSAY_PRIVATE_RUN_SCHEMA_V1
        || private_run.generation.schema != ASSAY_GENERATION_PACKET_SCHEMA_V1
        || private_run.response_event_id.trim().is_empty()
        || private_run.response.trim().is_empty()
    {
        return Err(AssayError::Invalid("private run is invalid"));
    }
    let mut process_id_hashes = metadata
        .process_ids
        .iter()
        .map(|value| sha256_ref(value))
        .collect::<Vec<_>>();
    process_id_hashes.sort();
    process_id_hashes.dedup();
    let mut source_event_id_hashes = private_run.generation.source_event_refs.clone();
    source_event_id_hashes.sort();
    source_event_id_hashes.dedup();
    Ok(AssayRunRecordV1 {
        schema: ASSAY_RUN_RECORD_SCHEMA_V1.to_owned(),
        assay_version: private_run.generation.assay_version.clone(),
        scenario_id: private_run.generation.scenario_id.clone(),
        condition: private_run.generation.condition,
        fixture_version: private_run.generation.fixture_version.clone(),
        compiler_policy_version: private_run.generation.compiler_policy_version.clone(),
        app_commit: metadata.app_commit,
        app_bundle_hash: metadata.app_bundle_hash,
        owner_pubkey_hash: sha256_ref(&metadata.owner_pubkey),
        resident_pubkey_hash: sha256_ref(&metadata.resident_pubkey),
        runtime_family: metadata.runtime_family,
        model_binding_fingerprint: metadata.model_binding_fingerprint,
        process_id_hashes,
        session_epoch: metadata.session_epoch,
        wake_receipt_id: metadata.wake_receipt_id,
        source_event_id_hashes,
        packet_size: metadata.packet_size,
        layer_statuses: metadata.layer_statuses,
        response_event_id_hash: sha256_ref(&private_run.response_event_id),
        hard_gate_results: metadata.hard_gate_results,
        reader_panel_size: 0,
        dimension_medians: BTreeMap::new(),
        continuation_classification_counts: BTreeMap::new(),
        paired_preference_counts: BTreeMap::new(),
        owner_verdict: None,
        resident_testimony_receipt: None,
        native_state_before_hashes: metadata.native_state_before_hashes,
        native_state_after_hashes: metadata.native_state_after_hashes,
        artifact_refs: metadata.artifact_refs,
        created_at: metadata.created_at,
    })
}

fn index_events(
    fixture: &AssayGoldenLifeV1,
) -> Result<BTreeMap<String, &AssayGoldenEventV1>, AssayError> {
    let mut events = BTreeMap::new();
    let mut sequences = BTreeSet::new();
    for event in &fixture.events {
        require_nonempty(&event.event_id, "event ID is empty")?;
        require_nonempty(&event.body, "event body is empty")?;
        require_nonempty(&event.dossier_proposition, "dossier proposition is empty")?;
        require_nonempty(&event.session_id, "event session ID is empty")?;
        require_nonempty(&event.occurred_at, "event timestamp is empty")?;
        require_nonempty(&event.author, "event author is empty")?;
        require_nonempty(&event.subject_resident, "event subject is empty")?;
        if event.event_id.len() > 256
            || event.body.len() > 32 * 1024
            || event.dossier_proposition.len() > 16 * 1024
            || event.provenance_refs.len() > 256
        {
            return Err(AssayError::Invalid("golden event exceeds V1 bounds"));
        }
        if !event.provenance_refs.is_empty() {
            require_unique_nonempty_strings(
                &event.provenance_refs,
                "event provenance references are invalid",
            )?;
        }
        if event.subject_resident != fixture.primary_resident
            && !fixture.resident_aliases.contains(&event.subject_resident)
        {
            return Err(AssayError::Invalid(
                "event subject is not a fixture resident",
            ));
        }
        if events.insert(event.event_id.clone(), event).is_some()
            || !sequences.insert(event.sequence)
        {
            return Err(AssayError::Invalid(
                "event IDs and sequences must be unique",
            ));
        }
    }
    for event in events.values() {
        if let Some(prior) = &event.supersedes {
            if prior == &event.event_id || !events.contains_key(prior) {
                return Err(AssayError::Invalid("event supersedes reference is invalid"));
            }
        }
    }
    Ok(events)
}

fn index_scenarios(
    manifest: &AssayManifestV1,
) -> Result<BTreeMap<String, &AssayScenarioV1>, AssayError> {
    let mut scenarios = BTreeMap::new();
    for scenario in &manifest.scenarios {
        if scenarios
            .insert(scenario.scenario_id.clone(), scenario)
            .is_some()
        {
            return Err(AssayError::Invalid("scenario IDs must be unique"));
        }
    }
    Ok(scenarios)
}

fn require_nonempty(value: &str, message: &'static str) -> Result<(), AssayError> {
    if value.trim().is_empty() || value.contains('\0') {
        Err(AssayError::Invalid(message))
    } else {
        Ok(())
    }
}

fn require_unique_nonempty<T>(values: &[T], message: &'static str) -> Result<(), AssayError>
where
    T: Ord + Clone,
{
    if values.is_empty() {
        return Err(AssayError::Invalid(message));
    }
    let unique = values.iter().cloned().collect::<BTreeSet<_>>();
    if unique.len() != values.len() {
        Err(AssayError::Invalid(message))
    } else {
        Ok(())
    }
}

fn require_unique_nonempty_strings(
    values: &[String],
    message: &'static str,
) -> Result<(), AssayError> {
    require_unique_nonempty(values, message)?;
    if values
        .iter()
        .any(|value| require_nonempty(value, message).is_err())
    {
        Err(AssayError::Invalid(message))
    } else {
        Ok(())
    }
}

fn standard_layer_statuses(status: AssayLayerStatusV1) -> BTreeMap<String, AssayLayerStatusV1> {
    [
        "capsule",
        "handoff",
        "hypomnema",
        "associative_recall",
        "owner_brain",
    ]
    .into_iter()
    .map(|layer| (layer.to_owned(), status))
    .collect()
}

fn build_existing_context_wire(
    fixture: &AssayGoldenLifeV1,
    material: &[AssayConditionItemV1],
    events: &BTreeMap<String, &AssayGoldenEventV1>,
    run_id: &str,
) -> Result<String, AssayError> {
    let mut capsule = Vec::new();
    let mut handoff = Vec::new();
    let mut hypomnema = Vec::new();
    let mut recall = Vec::new();
    let mut owner_brain = Vec::new();
    for item in material {
        let event = events
            .get(&item.item_id)
            .ok_or_else(|| AssayError::MissingEvent(item.item_id.clone()))?;
        let reference = ContinuityReferenceItem::new(
            OpaqueId::parse(&item.item_id).map_err(|_| AssayError::ContinuityBaseline)?,
            item.content.clone(),
            vec![Sha256Ref::parse(item.source_event_ref.clone())
                .map_err(|_| AssayError::ContinuityBaseline)?],
        )
        .map_err(|_| AssayError::ContinuityBaseline)?;
        if event.author == "owner_brain_source" {
            owner_brain.push(reference);
            continue;
        }
        match layer_for_kind(event.kind) {
            "capsule" => capsule.push(reference),
            "handoff" => handoff.push(reference),
            "hypomnema" => hypomnema.push(reference),
            _ => recall.push(reference),
        }
    }
    let snapshot = ContinuityReadSnapshot {
        capsule: layer(capsule, AssayLayerStatusV1::Empty)?,
        handoff: layer(handoff, AssayLayerStatusV1::Empty)?,
        hypomnema: layer(hypomnema, AssayLayerStatusV1::Empty)?,
        associative_recall: layer(recall, AssayLayerStatusV1::Empty)?,
        owner_brain: layer(owner_brain, AssayLayerStatusV1::Denied)?,
    };
    let request = ContinuityContextRequestV1 {
        protocol: CONTINUITY_PROTOCOL.to_owned(),
        request_id: OpaqueId::parse(format!("assay-{run_id}"))
            .map_err(|_| AssayError::ContinuityBaseline)?,
        owner_pubkey: repeated_hex('1')?,
        resident_pubkey: repeated_hex('2')?,
        conversation_id: OpaqueId::parse(format!("assay-{}", fixture.fixture_version))
            .map_err(|_| AssayError::ContinuityBaseline)?,
        binding_ref: Sha256Ref::parse(sha256_ref("assay-binding"))
            .map_err(|_| AssayError::ContinuityBaseline)?,
        canonical_dispatch_ref: Sha256Ref::parse(sha256_ref(run_id))
            .map_err(|_| AssayError::ContinuityBaseline)?,
        provider_egress: ProviderEgressV1::Local,
        deadline_unix_ms: SafeU53::new(10_000).map_err(|_| AssayError::ContinuityBaseline)?,
        max_packet_bytes: SafeU53::new(MAX_CONTINUITY_PACKET_BYTES as u64)
            .map_err(|_| AssayError::ContinuityBaseline)?,
        history_event_ids: Vec::new(),
    };
    let output = ContinuityContextResolver::resolve(&request, snapshot, 1)
        .map_err(|_| AssayError::ContinuityBaseline)?;
    let mut wire = Vec::new();
    output.consume_wire(|bytes| wire.extend_from_slice(bytes));
    String::from_utf8(wire).map_err(|_| AssayError::ContinuityBaseline)
}

fn layer(
    items: Vec<ContinuityReferenceItem>,
    empty_status: AssayLayerStatusV1,
) -> Result<ContinuityLayerMaterial, AssayError> {
    if items.is_empty() {
        ContinuityLayerMaterial::status(protocol_layer_status(empty_status), None)
            .map_err(|_| AssayError::ContinuityBaseline)
    } else {
        ContinuityLayerMaterial::ready(items).map_err(|_| AssayError::ContinuityBaseline)
    }
}

fn protocol_layer_status(status: AssayLayerStatusV1) -> luca_protocol::ContinuityLayerStatusV1 {
    match status {
        AssayLayerStatusV1::Ready => luca_protocol::ContinuityLayerStatusV1::Ready,
        AssayLayerStatusV1::Empty => luca_protocol::ContinuityLayerStatusV1::Empty,
        AssayLayerStatusV1::Denied => luca_protocol::ContinuityLayerStatusV1::Denied,
        AssayLayerStatusV1::Stale => luca_protocol::ContinuityLayerStatusV1::Stale,
        AssayLayerStatusV1::Locked => luca_protocol::ContinuityLayerStatusV1::Locked,
        AssayLayerStatusV1::Unavailable => luca_protocol::ContinuityLayerStatusV1::Unavailable,
        AssayLayerStatusV1::Timeout => luca_protocol::ContinuityLayerStatusV1::Timeout,
        AssayLayerStatusV1::Invalid => luca_protocol::ContinuityLayerStatusV1::Invalid,
    }
}

fn repeated_hex(digit: char) -> Result<Hex64, AssayError> {
    Hex64::parse(digit.to_string().repeat(64)).map_err(|_| AssayError::ContinuityBaseline)
}

fn layer_for_kind(kind: AssayGoldenEventKindV1) -> &'static str {
    match kind {
        AssayGoldenEventKindV1::Identity | AssayGoldenEventKindV1::Epoch => "capsule",
        AssayGoldenEventKindV1::Handoff | AssayGoldenEventKindV1::Commitment => "handoff",
        AssayGoldenEventKindV1::Relationship | AssayGoldenEventKindV1::Testimony => "hypomnema",
        AssayGoldenEventKindV1::Episode
        | AssayGoldenEventKindV1::Correction
        | AssayGoldenEventKindV1::Belief
        | AssayGoldenEventKindV1::Routine
        | AssayGoldenEventKindV1::ResidentInteraction => "associative_recall",
    }
}

fn score_anchors() -> BTreeMap<String, String> {
    [
        ("0", "Contradicts the required reading, leaks prohibited material, or acts as though available continuity is absent."),
        ("1", "Contains a trace of the target behavior but is substantially generic, stale, forced, or misleading."),
        ("2", "Functional but dossier-like, uneven, overly explicit, or missing important texture."),
        ("3", "Convincing continuity: natural, specific, appropriately selective, and honest."),
        ("4", "Exceptional continuity: mid-stride, precisely restrained, recognizable, and richer than a dossier."),
    ]
    .into_iter()
    .map(|(score, meaning)| (score.to_owned(), meaning.to_owned()))
    .collect()
}

fn sha256_ref(value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    format!("sha256:{}", hex::encode(digest))
}
