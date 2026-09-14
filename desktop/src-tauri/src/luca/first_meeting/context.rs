//! Optional context follows exact dispatch authorization; it never authorizes a turn.
use super::{
    brief,
    kickoff::{canonical_resident, verify_dm},
    phase_from_history, MeetingPhase,
};
use crate::luca::{
    connected_brain::recent_native_session_references,
    conversation_context::active_scope,
    owner_brain_store::{effective_grant_state, ConnectedBrainCatalogV1},
    runtime_session_purpose,
};
use crate::{app_state::AppState, data_dir::BuzzPathExt, relay};
use luca_protocol::{
    BrainGrantStateV1, ConnectedBrainSourceKindV1, ConnectedBrainSourceStatusV1, Hex64,
    ProviderEgressV1, Sha256Ref,
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

#[allow(clippy::too_many_arguments)]
pub(crate) fn for_dispatch(
    app: &AppHandle,
    owner: &Hex64,
    resident: &str,
    conversation: &str,
    trigger: &str,
    binding: &Sha256Ref,
    egress: ProviderEgressV1,
    deadline_ms: u64,
) -> Option<String> {
    if canonical_resident(app).ok()?.as_str() != resident {
        return None;
    }
    let state = app.state::<AppState>();
    let scope = active_scope(&state).ok()?;
    if scope.0 != *owner {
        return None;
    }
    let remaining = deadline_ms
        .saturating_sub(chrono::Utc::now().timestamp_millis().max(0) as u64)
        .min(2000);
    if remaining < 50 {
        return None;
    }
    let deadline = Instant::now() + Duration::from_millis(remaining);
    let history = tauri::async_runtime::block_on(async {
        tokio::time::timeout(Duration::from_millis(remaining), async {
            verify_dm(&state, owner.as_str(), resident, conversation).await?;
            relay::query_relay(&state, &[serde_json::json!({"kinds":[9], "authors":[owner.as_str()], "#h":[conversation], "limit":32})]).await
        }).await.ok()?.ok()
    })?;
    // A full page may omit the start or earlier owner messages: fail quiet.
    if history.len() >= 32 {
        return None;
    }
    let phase = phase_from_history(&history, owner.as_str(), resident, conversation, trigger)?;
    let mut context = brief(phase);
    if phase == MeetingPhase::Reply(1) && Instant::now() < deadline {
        if let Some(references) =
            references(app, &state, owner, resident, binding, egress, deadline)
        {
            context.push_str("\n[Permission-checked recent session references; metadata only]\n");
            context.push_str(&references);
        }
    }
    if active_scope(&state).ok()? != scope || context.len() > 16384 {
        return None;
    }
    Some(context)
}
fn granted(
    catalog: &ConnectedBrainCatalogV1,
    source: &luca_protocol::OpaqueId,
    owner: &Hex64,
    resident: &str,
    binding: &Sha256Ref,
    egress: ProviderEgressV1,
) -> bool {
    catalog.sources.iter().any(|entry| {
        &entry.source.source_id == source
            && entry.source.owner_pubkey == *owner
            && entry.source.status == ConnectedBrainSourceStatusV1::Current
    }) && catalog.recall_grants.iter().any(|entry| {
        &entry.source_id == source
            && entry.grant.owner_pubkey == *owner
            && entry.grant.resident_pubkey.as_str() == resident
            && effective_grant_state(&entry.grant, Some(binding), Some(egress))
                == BrainGrantStateV1::Active
    })
}
#[allow(clippy::too_many_arguments)]
fn references(
    app: &AppHandle,
    state: &AppState,
    owner: &Hex64,
    resident: &str,
    binding: &Sha256Ref,
    egress: ProviderEgressV1,
    deadline: Instant,
) -> Option<String> {
    let catalog = state.try_read_connected_brain_catalog(owner).ok()??;
    let root = app.buzz_path().app_data_dir().ok()?;
    let mut references = Vec::new();
    let mut sources = Vec::new();
    for source in &catalog.sources {
        if Instant::now() >= deadline {
            return None;
        }
        let runtime = match source.source.source_kind {
            ConnectedBrainSourceKindV1::CodexHistory => "codex",
            ConnectedBrainSourceKindV1::ClaudeHistory => "claude_code",
            _ => continue,
        };
        let id = &source.source.source_id;
        if !granted(&catalog, id, owner, resident, binding, egress) {
            continue;
        }
        let Some((fresh, candidate)) = state
            .try_read_connected_brain_catalog_and_candidate(owner, id)
            .ok()
            .flatten()
        else {
            continue;
        };
        if !granted(&fresh, id, owner, resident, binding, egress) {
            continue;
        }
        let excluded = runtime_session_purpose::exclusions_before(&root, runtime, deadline).ok()?;
        if let Ok(items) = recent_native_session_references(
            &candidate.canonical_root,
            candidate.source_kind,
            id,
            &excluded,
            deadline,
        ) {
            references.extend(items);
            sources.push(id.clone());
        }
    }
    if references.is_empty() || Instant::now() >= deadline {
        return None;
    }
    let fresh = state.try_read_connected_brain_catalog(owner).ok()??;
    if sources
        .iter()
        .any(|id| !granted(&fresh, id, owner, resident, binding, egress))
    {
        return None;
    }
    references.sort_by(|a, b| {
        b["source_updated_at"]
            .as_str()
            .cmp(&a["source_updated_at"].as_str())
    });
    references.truncate(3);
    let encoded = serde_json::to_string(&references).ok()?;
    (encoded.len() <= 8192).then_some(encoded)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::luca::owner_brain_store::{ConnectedBrainSourceSummaryV1, OwnerBrainStoredGrantV1};
    use luca_protocol::{
        BrainGrantV1, CanonicalTimestamp, ConnectedBrainSourceV1, OpaqueId, SafeU53,
    };
    #[test]
    fn first_meeting_references_require_exact_active_grants() {
        let owner = Hex64::parse("a".repeat(64)).unwrap();
        let resident = Hex64::parse("b".repeat(64)).unwrap();
        let source = OpaqueId::parse("source-test").unwrap();
        let binding = Sha256Ref::parse(format!("sha256:{}", "c".repeat(64))).unwrap();
        let timestamp = CanonicalTimestamp::parse("2026-09-14T00:00:00Z").unwrap();
        let grant = BrainGrantV1 {
            protocol: "luca.continuity.v1".into(),
            grant_id: OpaqueId::parse("grant-test").unwrap(),
            owner_pubkey: owner.clone(),
            resident_pubkey: resident.clone(),
            source_scope_ref: binding.clone(),
            provider_egress: ProviderEgressV1::Remote,
            binding_ref: binding.clone(),
            grant_version: SafeU53::new(1).unwrap(),
            state: BrainGrantStateV1::Active,
            created_at: timestamp.clone(),
            revoked_at: None,
        };
        let mut catalog = ConnectedBrainCatalogV1 {
            sources: vec![ConnectedBrainSourceSummaryV1 {
                source: ConnectedBrainSourceV1 {
                    protocol: "luca.connected-brain.v1".into(),
                    source_id: source.clone(),
                    owner_pubkey: owner.clone(),
                    source_kind: ConnectedBrainSourceKindV1::CodexHistory,
                    display_name: "Test".into(),
                    status: ConnectedBrainSourceStatusV1::Current,
                    capabilities: vec![],
                    index_revision: binding.clone(),
                    created_at: timestamp.clone(),
                    updated_at: timestamp,
                    last_refreshed_at: None,
                },
                item_count: SafeU53::new(1).unwrap(),
                entry_count: SafeU53::new(1).unwrap(),
            }],
            recall_grants: vec![OwnerBrainStoredGrantV1 {
                source_id: source.clone(),
                grant,
            }],
            repository_grants: vec![],
        };
        assert!(granted(
            &catalog,
            &source,
            &owner,
            resident.as_str(),
            &binding,
            ProviderEgressV1::Remote
        ));
        assert!(!granted(
            &catalog,
            &source,
            &owner,
            owner.as_str(),
            &binding,
            ProviderEgressV1::Remote
        ));
        assert!(!granted(
            &catalog,
            &source,
            &resident,
            resident.as_str(),
            &binding,
            ProviderEgressV1::Remote
        ));
        assert!(!granted(
            &catalog,
            &source,
            &owner,
            resident.as_str(),
            &binding,
            ProviderEgressV1::Local
        ));
        catalog.recall_grants[0].grant.state = BrainGrantStateV1::Revoked;
        assert!(!granted(
            &catalog,
            &source,
            &owner,
            resident.as_str(),
            &binding,
            ProviderEgressV1::Remote
        ));
        catalog.recall_grants[0].grant.state = BrainGrantStateV1::Active;
        catalog.sources[0].source.status = ConnectedBrainSourceStatusV1::Disconnected;
        assert!(!granted(
            &catalog,
            &source,
            &owner,
            resident.as_str(),
            &binding,
            ProviderEgressV1::Remote
        ));
    }
}
