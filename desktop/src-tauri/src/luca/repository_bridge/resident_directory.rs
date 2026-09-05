//! Public resident discovery over the existing managed registry and exchange resolver.

use std::{
    collections::{BTreeSet, HashMap},
    ops::Deref,
    process::Child,
};

use luca_protocol::Hex64;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use zeroize::Zeroize;

use crate::{
    app_state::AppState,
    luca::{
        exchange_plan::mentioned_names,
        resident_registry::{
            resolve_owned_resident_name_from_records, ResidentNameResolutionError,
        },
    },
    managed_agents::{AgentDefinition, BackendKind, ManagedAgentRecord, RuntimeBinding},
};

const MAX_RESIDENTS: usize = 64;
const MAX_NAME_BYTES: usize = 256;
const ROUTING_HINT: &str = "Use only a supplied exact mention in an ordinary final reply for a bounded task in this conversation. A resident's final can return through the existing exchange; this directory does not start residents, expose task progress, or provide Stop. Do not guess aliases or public-key mentions. Process status is not authentication or proof that a task will answer.";

/// Clear hydrated resident signing material on every operator-status exit path.
pub(super) struct HydratedRecords(Vec<ManagedAgentRecord>);

impl HydratedRecords {
    /// Load the existing store without retaining another signing-key snapshot.
    pub(super) fn load(app: &AppHandle) -> Result<Self, String> {
        crate::managed_agents::load_managed_agents(app).map(Self)
    }
}

impl Deref for HydratedRecords {
    type Target = [ManagedAgentRecord];

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl Drop for HydratedRecords {
    fn drop(&mut self) {
        for record in &mut self.0 {
            record.private_key_nsec.zeroize();
        }
    }
}

/// Liveness observed through an app-owned child, independently of authentication.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum ProcessStatus {
    Running,
    Stopped,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum MentionStatus {
    Available,
    Ambiguous,
    Unmentionable,
    #[serde(rename = "self")]
    SelfResident,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Resident {
    name: Option<String>,
    resident_pubkey: Hex64,
    runtime_family: &'static str,
    process_status: ProcessStatus,
    name_status: MentionStatus,
    mention_status: MentionStatus,
    mention: Option<String>,
}

/// Bounded, public-only current-owner projection with explicit unavailable state.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Directory {
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'static str>,
    residents: Vec<Resident>,
    truncated: bool,
    routing_hint: &'static str,
}

impl Directory {
    fn unavailable(reason: &'static str) -> Self {
        Self {
            status: "unavailable",
            reason: Some(reason),
            residents: Vec::new(),
            truncated: false,
            routing_hint: ROUTING_HINT,
        }
    }
}

/// Observe only app-tracked child handles; persisted PIDs are not identity proof.
pub(super) fn snapshot(
    app: &AppHandle,
    context: &super::BrokerContext,
    records: &[ManagedAgentRecord],
    personas: &[AgentDefinition],
) -> (Directory, ProcessStatus) {
    let state = app.state::<AppState>();
    let processes = state
        .managed_agent_processes
        .lock()
        .ok()
        .map(|mut tracked| {
            tracked
                .iter_mut()
                .map(|(pubkey, process)| {
                    (
                        pubkey.to_ascii_lowercase(),
                        observe_child(&mut process.child),
                    )
                })
                .collect::<HashMap<_, _>>()
        });
    let active_owner = state
        .signing_keys()
        .ok()
        .map(|keys| keys.public_key().to_hex());
    let directory = from_records(
        records,
        personas,
        &context.owner_pubkey,
        active_owner.as_deref(),
        &context.resident_pubkey,
        processes.as_ref(),
    );
    let process_status = if directory.status == "available" {
        records
            .iter()
            .find(|record| {
                record
                    .pubkey
                    .eq_ignore_ascii_case(context.resident_pubkey.as_str())
            })
            .map(|record| record_process_status(record, processes.as_ref()))
            .unwrap_or(ProcessStatus::Unknown)
    } else {
        ProcessStatus::Unknown
    };
    (directory, process_status)
}

fn observe_child(child: &mut Child) -> ProcessStatus {
    // try_wait uses the retained child identity and caches an observed exit. A
    // signal-0 probe of its PID could instead observe a recycled process.
    match child.try_wait() {
        Ok(None) => ProcessStatus::Running,
        Ok(Some(_)) => ProcessStatus::Stopped,
        Err(_) => ProcessStatus::Unknown,
    }
}

fn record_process_status(
    record: &ManagedAgentRecord,
    processes: Option<&HashMap<String, ProcessStatus>>,
) -> ProcessStatus {
    if !matches!(record.backend, BackendKind::Local) {
        return ProcessStatus::Unknown;
    }
    let Some(processes) = processes else {
        return ProcessStatus::Unknown;
    };
    processes
        .get(&record.pubkey.to_ascii_lowercase())
        .copied()
        .unwrap_or_else(|| {
            if record.runtime_pid.is_some() {
                ProcessStatus::Unknown
            } else {
                ProcessStatus::Stopped
            }
        })
}

fn custody_pubkey(record: &ManagedAgentRecord) -> Option<Hex64> {
    let pubkey = Hex64::parse(record.pubkey.to_ascii_lowercase()).ok()?;
    let keys = nostr::Keys::parse(record.private_key_nsec.trim()).ok()?;
    (keys.public_key().to_hex() == pubkey.as_str()).then_some(pubkey)
}

fn from_records(
    records: &[ManagedAgentRecord],
    personas: &[AgentDefinition],
    owner: &Hex64,
    active_owner: Option<&str>,
    caller: &Hex64,
    processes: Option<&HashMap<String, ProcessStatus>>,
) -> Directory {
    if active_owner != Some(owner.as_str()) {
        return Directory::unavailable("current_owner_unavailable");
    }
    if processes.is_none() {
        return Directory::unavailable("process_observation_unavailable");
    }
    // Exchange currently resolves across all custody-verified identities. Keep
    // even hidden/foreign-owner aliases in that collision set, then filter the
    // public rows by verified owner attestation before applying the output cap.
    let custody = records.iter().map(custody_pubkey).collect::<Vec<_>>();
    let routable = custody.iter().flatten().cloned().collect::<BTreeSet<_>>();
    let mut residents = records
        .iter()
        .zip(&custody)
        .filter_map(|(record, pubkey)| {
            let pubkey = pubkey.as_ref()?;
            let public_key = nostr::PublicKey::from_hex(pubkey.as_str()).ok()?;
            let attested_owner =
                buzz_sdk_pkg::nip_oa::verify_auth_tag(record.auth_tag.as_deref()?, &public_key)
                    .ok()?;
            if attested_owner.to_hex() != owner.as_str() {
                return None;
            }
            let name = record
                .display_name
                .as_deref()
                .and_then(public_name)
                .or_else(|| public_name(&record.name));
            let name_status = name
                .map(|name| alias_status(records, &routable, pubkey, name))
                .unwrap_or(MentionStatus::Unmentionable);
            let (mention_status, mention) = if pubkey == caller {
                (MentionStatus::SelfResident, None)
            } else {
                public_mention(records, &routable, pubkey, record)
            };
            Some(Resident {
                name: name.map(str::to_owned),
                resident_pubkey: pubkey.clone(),
                runtime_family: runtime_identity(record, personas).0,
                process_status: record_process_status(record, processes),
                name_status,
                mention_status,
                mention,
            })
        })
        .collect::<Vec<_>>();
    residents.sort_by_cached_key(|resident| {
        (
            resident.name.as_deref().unwrap_or_default().to_lowercase(),
            resident.resident_pubkey.clone(),
        )
    });
    let mut seen = BTreeSet::new();
    residents.retain(|resident| seen.insert(resident.resident_pubkey.clone()));
    let truncated = residents.len() > MAX_RESIDENTS;
    residents.truncate(MAX_RESIDENTS);
    Directory {
        status: "available",
        reason: None,
        residents,
        truncated,
        routing_hint: ROUTING_HINT,
    }
}

fn public_name(value: &str) -> Option<&str> {
    let name = value.trim();
    (!name.is_empty() && name.len() <= MAX_NAME_BYTES && !name.chars().any(char::is_control))
        .then_some(name)
}

fn alias_status(
    records: &[ManagedAgentRecord],
    routable: &BTreeSet<Hex64>,
    target: &Hex64,
    alias: &str,
) -> MentionStatus {
    if mentioned_names(&format!("@{alias}")) != [alias] {
        return MentionStatus::Unmentionable;
    }
    match resolve_owned_resident_name_from_records(records, routable, alias) {
        Ok(resident) if &resident == target => MentionStatus::Available,
        Err(ResidentNameResolutionError::Ambiguous) => MentionStatus::Ambiguous,
        _ => MentionStatus::Unmentionable,
    }
}

fn public_mention(
    records: &[ManagedAgentRecord],
    routable: &BTreeSet<Hex64>,
    target: &Hex64,
    record: &ManagedAgentRecord,
) -> (MentionStatus, Option<String>) {
    let mut status = MentionStatus::Unmentionable;
    // backend_agent_id participates in resolver collisions, but is deliberately
    // not advertised: a provider's internal locator is not a public alias.
    for alias in [
        record.display_name.as_deref(),
        Some(record.name.as_str()),
        record.slug.as_deref(),
    ]
    .into_iter()
    .flatten()
    .filter_map(public_name)
    {
        match alias_status(records, routable, target, alias) {
            MentionStatus::Available => {
                return (MentionStatus::Available, Some(format!("@{alias}")))
            }
            MentionStatus::Ambiguous => status = MentionStatus::Ambiguous,
            _ => {}
        }
    }
    (status, None)
}

fn runtime_identity<'a>(
    record: &'a ManagedAgentRecord,
    personas: &[AgentDefinition],
) -> (&'static str, Option<&'a str>, bool) {
    match record.native_runtime_binding.as_ref() {
        Some(RuntimeBinding::Hermes {
            runtime_version, ..
        }) => ("hermes", Some(runtime_version), true),
        Some(RuntimeBinding::Openclaw {
            runtime_version, ..
        }) => ("openclaw", Some(runtime_version), true),
        None => {
            let inherited = record
                .persona_id
                .as_deref()
                .and_then(|id| personas.iter().find(|persona| persona.id == id))
                .and_then(|persona| persona.runtime.as_deref());
            (
                super::current_managed_runtime_family(
                    record.runtime.as_deref(),
                    record.agent_command_override.as_deref(),
                    inherited,
                ),
                None,
                false,
            )
        }
    }
}

/// Preserve legacy runtime keys while qualifying their process-only meaning.
pub(super) fn runtime_status(
    record: &ManagedAgentRecord,
    personas: &[AgentDefinition],
    process_status: ProcessStatus,
) -> Value {
    let (family, version, native_binding) = runtime_identity(record, personas);
    let running = record.runtime_pid.is_some();
    let state = if record.last_error.is_some() {
        "degraded"
    } else if running {
        "ready"
    } else {
        "stopped"
    };
    let capability_manifest = crate::luca::runtime_capabilities::manifest(family);
    let surface_navigation = capability_manifest
        .as_ref()
        .map(|manifest| manifest.surface_navigation)
        .unwrap_or("unavailable_unknown_runtime");
    json!({
        "family": family, "version": version, "nativeBinding": native_binding,
        "state": state, "running": running, "ready": state == "ready",
        "capabilityManifest": capability_manifest, "surfaceNavigation": surface_navigation,
        "processStatus": process_status, "readinessBasis": "process_only", "authentication": "unknown",
        "readinessNote": "Legacy state/running/ready use saved process metadata, not verified authentication. processStatus observes only app-tracked children; a running process is not proof of an authenticated reply."
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::ToBech32;
    use std::process::{Command, Stdio};

    fn identity(keys: &nostr::Keys) -> Hex64 {
        Hex64::parse(keys.public_key().to_hex()).expect("synthetic identity")
    }

    fn record(owner: &nostr::Keys, name: &str) -> ManagedAgentRecord {
        let resident = nostr::Keys::generate();
        serde_json::from_value(json!({
            "pubkey": resident.public_key().to_hex(), "name": name,
            "private_key_nsec": resident.secret_key().to_secret_hex(),
            "auth_tag": buzz_sdk_pkg::nip_oa::compute_auth_tag(owner, &resident.public_key(), "").expect("synthetic attestation"),
            "relay_url": "private-relay-canary", "acp_command": "private-acp-canary",
            "agent_command": "private-command-canary", "agent_args": ["private-argument-canary"],
            "mcp_command": "private-mcp-canary", "turn_timeout_seconds": 0,
            "system_prompt": "private-prompt-canary", "provider": "private-provider-canary",
            "model": "private-model-canary", "env_vars": {"PRIVATE_ENV": "private-env-canary"},
            "created_at": "2026-09-05T00:00:00Z", "updated_at": "2026-09-05T00:00:00Z",
            "last_started_at": null, "last_stopped_at": null, "last_exit_code": null,
            "last_error": "private-error-canary", "runtime": "codex"
        })).expect("synthetic managed record")
    }

    fn directory(records: &[ManagedAgentRecord], owner: &nostr::Keys) -> Directory {
        from_records(
            records,
            &[],
            &identity(owner),
            Some(identity(owner).as_str()),
            &identity(owner),
            Some(&HashMap::new()),
        )
    }

    #[test]
    fn signed_current_owner_and_matching_custody_are_both_required() {
        let owner = nostr::Keys::generate();
        let other_owner = nostr::Keys::generate();
        let valid = record(&owner, "Valid");
        let mut mismatched_key = record(&owner, "MismatchedKey");
        mismatched_key.private_key_nsec = nostr::Keys::generate().secret_key().to_secret_hex();
        let mut forged = record(&owner, "Forged");
        forged.auth_tag = valid.auth_tag.clone();
        let mut missing = record(&owner, "Missing");
        missing.auth_tag = None;
        let mut malformed = record(&owner, "Malformed");
        malformed.auth_tag = Some("private-malformed-tag-canary".into());
        let mut invalid_key = record(&owner, "InvalidKey");
        invalid_key.pubkey = "invalid-pubkey".into();
        let mut missing_custody = record(&owner, "MissingCustody");
        missing_custody.private_key_nsec.clear();
        let foreign = record(&other_owner, "ForeignOwner");
        let records = vec![
            valid,
            mismatched_key,
            forged,
            missing,
            malformed,
            invalid_key,
            missing_custody,
            foreign,
        ];
        let result = directory(&records, &owner);
        assert_eq!(result.status, "available");
        assert_eq!(result.residents.len(), 1);
        assert_eq!(result.residents[0].name.as_deref(), Some("Valid"));
        let switched = from_records(
            &records,
            &[],
            &identity(&owner),
            Some(identity(&other_owner).as_str()),
            &identity(&owner),
            Some(&HashMap::new()),
        );
        assert_eq!(switched.status, "unavailable");
        assert!(switched.residents.is_empty());
        let unavailable = from_records(
            &records,
            &[],
            &identity(&owner),
            None,
            &identity(&owner),
            Some(&HashMap::new()),
        );
        assert_eq!(unavailable.reason, Some("current_owner_unavailable"));
        let empty = directory(&[], &owner);
        assert_eq!(empty.status, "available");
        assert!(empty.residents.is_empty());
        assert!(!empty.truncated);
    }

    #[test]
    fn exact_mentions_match_real_scanner_and_resolver_including_hidden_collisions() {
        let owner = nostr::Keys::generate();
        let foreign_owner = nostr::Keys::generate();
        let exact = record(&owner, "Vektor");
        let multiword = record(&owner, "Research Helper");
        let mut aliased = record(&owner, "Existing Helper");
        aliased.slug = Some("existing-helper".into());
        let ambiguous = record(&owner, "Shared");
        let mut hidden = record(&foreign_owner, "Hidden Foreign Name");
        hidden.backend_agent_id = Some("sHaReD".into());
        let records = vec![exact, multiword, aliased, ambiguous, hidden];
        let result = directory(&records, &owner);
        let by_name = |name: &str| {
            result
                .residents
                .iter()
                .find(|row| row.name.as_deref() == Some(name))
                .expect("public row")
        };
        assert_eq!(by_name("Vektor").mention.as_deref(), Some("@Vektor"));
        assert_eq!(
            by_name("Research Helper").mention_status,
            MentionStatus::Unmentionable
        );
        assert_eq!(
            by_name("Existing Helper").name_status,
            MentionStatus::Unmentionable
        );
        assert_eq!(
            by_name("Existing Helper").mention.as_deref(),
            Some("@existing-helper")
        );
        assert_eq!(by_name("Shared").mention_status, MentionStatus::Ambiguous);
        assert!(by_name("Shared").mention.is_none());
        let custody = records.iter().filter_map(custody_pubkey).collect();
        for row in &result.residents {
            if let Some(mention) = &row.mention {
                let tokens = mentioned_names(mention);
                assert_eq!(tokens.len(), 1);
                assert_eq!(
                    resolve_owned_resident_name_from_records(&records, &custody, &tokens[0]),
                    Ok(row.resident_pubkey.clone())
                );
            }
        }
        let caller = custody_pubkey(&records[0]).expect("caller");
        let self_directory = from_records(
            &records,
            &[],
            &identity(&owner),
            Some(identity(&owner).as_str()),
            &caller,
            Some(&HashMap::new()),
        );
        let self_row = self_directory
            .residents
            .iter()
            .find(|row| row.resident_pubkey == caller)
            .expect("self row");
        assert_eq!(self_row.mention_status, MentionStatus::SelfResident);
        assert!(self_row.mention.is_none());
    }

    #[test]
    fn invalid_names_and_identity_references_never_become_guessed_aliases() {
        let owner = nostr::Keys::generate();
        let records = vec![
            record(&owner, "Research Helper"),
            record(&owner, "Écho"),
            record(&owner, "trailing-"),
            record(&owner, &"a".repeat(65)),
            record(&owner, "line\nbreak"),
            record(&owner, &"b".repeat(257)),
        ];
        let result = directory(&records, &owner);
        assert!(result.residents.iter().all(|row| row.mention.is_none()));
        assert!(result
            .residents
            .iter()
            .all(|row| row.mention_status == MentionStatus::Unmentionable));
        assert_eq!(
            result
                .residents
                .iter()
                .filter(|row| row.name.is_none())
                .count(),
            2
        );
        let target = custody_pubkey(&records[0]).expect("target");
        let custody = records.iter().filter_map(custody_pubkey).collect();
        let npub = nostr::PublicKey::from_hex(target.as_str())
            .expect("public key")
            .to_bech32()
            .expect("npub");
        for alias in [target.as_str(), npub.as_str()] {
            assert_eq!(mentioned_names(&format!("@{alias}")), [alias]);
            assert_eq!(
                resolve_owned_resident_name_from_records(&records, &custody, alias),
                Err(ResidentNameResolutionError::NotFound)
            );
            assert_eq!(
                alias_status(&records, &custody, &target, alias),
                MentionStatus::Unmentionable
            );
        }
    }

    #[test]
    fn directory_is_bounded_deduplicated_and_checks_collisions_before_truncating() {
        let owner = nostr::Keys::generate();
        let mut records = (0..65)
            .map(|index| record(&owner, &format!("Resident{index:02}")))
            .collect::<Vec<_>>();
        records[64].slug = Some("Resident00".into());
        records.push(records[1].clone());
        let result = directory(&records, &owner);
        assert!(result.truncated);
        assert_eq!(result.residents.len(), MAX_RESIDENTS);
        assert_eq!(result.residents[0].name.as_deref(), Some("Resident00"));
        assert_eq!(result.residents[0].mention_status, MentionStatus::Ambiguous);
        let identities = result
            .residents
            .iter()
            .map(|row| &row.resident_pubkey)
            .collect::<BTreeSet<_>>();
        assert_eq!(identities.len(), MAX_RESIDENTS);
        records.reverse();
        assert_eq!(
            serde_json::to_value(result).expect("snapshot"),
            serde_json::to_value(directory(&records, &owner)).expect("reverse snapshot")
        );
    }

    #[test]
    fn serialization_is_public_only_and_native_family_stays_native() {
        let owner = nostr::Keys::generate();
        let mut native = record(&owner, "Native");
        native.backend_agent_id = Some("private-backend-canary".into());
        native.native_runtime_binding = Some(RuntimeBinding::Hermes {
            schema_version: 1,
            profile_name: "private-profile-canary".into(),
            hermes_home: "/private/home-canary".into(),
            executable_path: "/private/executable-canary".into(),
            runtime_version: "private-version-canary".into(),
            default_workspace: Some("/private/workspace-canary".into()),
        });
        let private_key = native.private_key_nsec.clone();
        let auth_tag = native.auth_tag.clone().expect("tag");
        let result = directory(&[native], &owner);
        assert_eq!(result.residents[0].runtime_family, "hermes");
        let serialized = serde_json::to_string(&result).expect("public serialization");
        for canary in [
            "private-",
            "/private/",
            "PRIVATE_ENV",
            private_key.as_str(),
            auth_tag.as_str(),
        ] {
            assert!(
                !serialized.contains(canary),
                "private field escaped the projection"
            );
        }
        let public = serde_json::to_value(&result).expect("public shape");
        assert_eq!(
            public["residents"][0]
                .as_object()
                .expect("row")
                .keys()
                .map(String::as_str)
                .collect::<BTreeSet<_>>(),
            BTreeSet::from([
                "name",
                "residentPubkey",
                "runtimeFamily",
                "processStatus",
                "nameStatus",
                "mentionStatus",
                "mention"
            ])
        );
    }

    #[test]
    fn process_status_does_not_adopt_persisted_pids_or_remote_deployments() {
        let owner = nostr::Keys::generate();
        let mut resident = record(&owner, "Resident");
        let mut observed = HashMap::new();
        assert_eq!(
            record_process_status(&resident, Some(&observed)),
            ProcessStatus::Stopped
        );
        for pid in [std::process::id(), u32::MAX] {
            resident.runtime_pid = Some(pid);
            assert_eq!(
                record_process_status(&resident, Some(&observed)),
                ProcessStatus::Unknown
            );
        }
        observed.insert(resident.pubkey.clone(), ProcessStatus::Running);
        assert_eq!(
            record_process_status(&resident, Some(&observed)),
            ProcessStatus::Running
        );
        observed.insert(resident.pubkey.clone(), ProcessStatus::Stopped);
        assert_eq!(
            record_process_status(&resident, Some(&observed)),
            ProcessStatus::Stopped
        );
        resident.backend = BackendKind::Provider {
            id: "private-remote-canary".into(),
            config: json!({"host": "private-host-canary"}),
        };
        assert_eq!(
            record_process_status(&resident, Some(&observed)),
            ProcessStatus::Unknown
        );
        let unavailable = from_records(
            &[resident],
            &[],
            &identity(&owner),
            Some(identity(&owner).as_str()),
            &identity(&owner),
            None,
        );
        assert_eq!(unavailable.status, "unavailable");
        assert_eq!(unavailable.reason, Some("process_observation_unavailable"));
    }

    #[cfg(unix)]
    #[test]
    fn retained_child_observation_proves_live_and_exited_states() {
        struct Fixture(Child);
        impl Drop for Fixture {
            fn drop(&mut self) {
                let _ = self.0.kill();
                let _ = self.0.wait();
            }
        }
        let mut fixture = Fixture(
            Command::new("/bin/sleep")
                .arg("30")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .expect("synthetic child"),
        );
        assert_eq!(observe_child(&mut fixture.0), ProcessStatus::Running);
        fixture.0.kill().expect("stop synthetic child");
        fixture.0.wait().expect("reap synthetic child");
        assert_eq!(observe_child(&mut fixture.0), ProcessStatus::Stopped);
        assert_eq!(observe_child(&mut fixture.0), ProcessStatus::Stopped);
    }

    #[test]
    fn legacy_runtime_shape_is_retained_with_explicit_unknown_authentication() {
        let owner = nostr::Keys::generate();
        let mut resident = record(&owner, "Resident");
        resident.last_error = None;
        for (pid, error, state, running, ready) in [
            (None, None, "stopped", false, false),
            (Some(123), None, "ready", true, true),
            (
                Some(123),
                Some("private-error-canary".to_owned()),
                "degraded",
                true,
                false,
            ),
        ] {
            resident.runtime_pid = pid;
            resident.last_error = error;
            let status = runtime_status(&resident, &[], ProcessStatus::Unknown);
            assert_eq!(status["family"], "codex");
            assert_eq!(status["version"], Value::Null);
            assert_eq!(status["nativeBinding"], false);
            assert_eq!(status["state"], state);
            assert_eq!(status["running"], running);
            assert_eq!(status["ready"], ready);
            assert!(status.get("capabilityManifest").is_some());
            assert!(status.get("surfaceNavigation").is_some());
            assert_eq!(status["processStatus"], "unknown");
            assert_eq!(status["readinessBasis"], "process_only");
            assert_eq!(status["authentication"], "unknown");
            assert!(!status.to_string().contains("private-"));
        }
    }
}
