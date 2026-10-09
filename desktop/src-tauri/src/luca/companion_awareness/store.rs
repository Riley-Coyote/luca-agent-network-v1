//! Host-owned, body-free awareness authority and dependency invalidation.
//!
//! This store needs neither resident keys nor continuity decryption nor a model.
//! Callers must authenticate the retained public owner/window scope; an incoming
//! public key is not authentication. Keep this file outside native worker tool
//! scopes: a private keyless SQLite file is not tamper protection from a process
//! with unrestricted filesystem writes. The host wrapper must serialize deny,
//! buffer invalidation, and final effect rechecks. Nothing here erases bytes an
//! external process/provider already received or controls app-owned native work.

use std::path::Path;

use luca_protocol::{
    canonical_sha256, recheck_awareness_eligibility, AwarenessAuthoritySnapshotV1,
    AwarenessChoicesV1, AwarenessError, AwarenessGrantStateV1, AwarenessGrantV1,
    AwarenessMaterialStateV1, AwarenessObservationRefV1, AwarenessSourceStateV1, AwarenessSourceV1,
    AwarenessUseV1, CanonicalTimestamp, Hex64, OpaqueId, SafeU53, AWARENESS_PROTOCOL,
};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::Serialize;

pub(crate) use super::schema::AWARENESS_STORE_FILENAME;
const MAX_NODES: i64 = 16_384;
const MAX_PARENTS: usize = 32;
const MAX_RECORD_BYTES: usize = 4096;
pub(crate) use super::types::*;
#[path="profile_children.rs"]
mod profile_children;
/// Narrow SQLite authority. It stores metadata/deny edges, never semantic memory.
pub(crate) struct AwarenessStore {
    connection: Connection,
}

impl AwarenessStore {
    /// Open only the explicit private internal file. No folder creation, path
    /// repair, keychain access, scanning, model use, or collector startup occurs.
    pub(crate) fn open(path: &Path) -> Result<Self, AwarenessStoreError> {
        Ok(Self {
            connection: super::schema::open_database(path)?,
        })
    }

    /// Explicit owner Pause/Resume with actor-bound CAS/replay. Pause invalidates
    /// this companion's old contexts even after a later explicit Resume. It can
    /// commit with no signing key, model, source or continuity store available.
    pub(crate) fn set_resident_paused(
        &mut self,
        owner: &Hex64,
        resident: &Hex64,
        expected_revision: Option<SafeU53>,
        paused: bool,
        now: &CanonicalTimestamp,
        operation: &OpaqueId,
    ) -> Result<AwarenessMutationReceiptV1, AwarenessStoreError> {
        if owner == resident {
            return Err(AwarenessStoreError::Invalid);
        }
        mutate(
            &mut self.connection,
            owner,
            operation,
            serde_json::json!(["resident_pause", resident, expected_revision, paused, now]),
            |tx| {
                let current = load_resident(tx, owner, resident)?;
                if expected_revision.map(SafeU53::get)
                    != (current.revision.get() > 0).then_some(current.revision.get())
                {
                    return Err(AwarenessStoreError::Conflict);
                }
                let revision = increment(current.revision)?;
                let changed_at = current
                    .changed_at
                    .as_ref()
                    .filter(|old| *old > now)
                    .unwrap_or(now);
                tx.execute("INSERT INTO awareness_residents VALUES (?1,?2,?3,?4,?5) ON CONFLICT(owner,resident) DO UPDATE SET revision=excluded.revision,paused=excluded.paused,changed_at=excluded.changed_at",params![owner.as_str(),resident.as_str(),revision.get(),paused,changed_at.as_str()])?;
                // Pause invalidates compiled/queued ephemeral work, not canonical
                // promotion. Marker 2 cannot be mistaken for withdrawal marker 1.
                let count = if paused {
                    tx.execute("UPDATE awareness_nodes SET quarantined=2 WHERE owner=?1 AND resident=?2 AND kind IN ('context','job') AND quarantined=0",params![owner.as_str(),resident.as_str()])?
                } else {
                    0
                };
                Ok(AwarenessMutationReceiptV1 {
                    source_revision: None,
                    deny_epoch: None,
                    grant_revision: None,
                    resident_revision: Some(revision),
                    quarantined_nodes: count,
                    replayed: false,
                })
            },
        )
    }

    /// Body-free persisted Pause state; an absent row is fail-closed.
    pub(crate) fn resident_state(
        &self,
        owner: &Hex64,
        resident: &Hex64,
    ) -> Result<AwarenessResidentStateV1, AwarenessStoreError> {
        load_resident(&self.connection, owner, resident)
    }

    /// Register a new source as Unknown with no implicit companion grant.
    pub(crate) fn register_source(
        &mut self,
        key: &AwarenessSourceKeyV1,
        operation: &OpaqueId,
    ) -> Result<AwarenessMutationReceiptV1, AwarenessStoreError> {
        mutate(
            &mut self.connection,
            &key.owner_pubkey,
            operation,
            serde_json::json!(["register", key]),
            |tx| {
                if load_source(tx, key).optional_store()?.is_some() {
                    return Err(AwarenessStoreError::Conflict);
                }
                tx.execute(
                    "INSERT INTO awareness_sources VALUES (?1,?2,?3,1,0,'unknown')",
                    params![
                        key.owner_pubkey.as_str(),
                        key.source_id.as_str(),
                        key.device_id.as_str()
                    ],
                )?;
                Ok(receipt(
                    SafeU53::new(1).map_err(|_| AwarenessStoreError::Invalid)?,
                    SafeU53::new(0).map_err(|_| AwarenessStoreError::Invalid)?,
                    None,
                    0,
                ))
            },
        )
    }

    /// Publish verified health with source-revision CAS. Disabled state is set
    /// only by withdrawal, which also invalidates the associated material.
    pub(crate) fn set_source_health(
        &mut self,
        key: &AwarenessSourceKeyV1,
        expected_revision: SafeU53,
        state: AwarenessSourceStateV1,
        operation: &OpaqueId,
    ) -> Result<AwarenessMutationReceiptV1, AwarenessStoreError> {
        if state == AwarenessSourceStateV1::Disabled {
            return Err(AwarenessStoreError::Invalid);
        }
        mutate(
            &mut self.connection,
            &key.owner_pubkey,
            operation,
            serde_json::json!(["health", key, expected_revision, state]),
            |tx| {
                let (source, revision) = load_source(tx, key)?;
                if revision != expected_revision {
                    return Err(AwarenessStoreError::Conflict);
                }
                let next = increment(revision)?;
                tx.execute("UPDATE awareness_sources SET revision=?4,state=?5 WHERE owner=?1 AND source=?2 AND device=?3", params![key.owner_pubkey.as_str(),key.source_id.as_str(),key.device_id.as_str(),next.get(),source_state(state)])?;
                Ok(receipt(next, source.deny_epoch, None, 0))
            },
        )
    }

    /// Insert/update one explicit grant with exact CAS and stable grant ID.
    /// Every update quarantines old dependencies, even when choices are widened.
    pub(crate) fn put_grant(
        &mut self,
        grant: &AwarenessGrantV1,
        expected_revision: Option<SafeU53>,
        operation: &OpaqueId,
    ) -> Result<AwarenessMutationReceiptV1, AwarenessStoreError> {
        grant.validate()?;
        mutate(
            &mut self.connection,
            &grant.owner_pubkey,
            operation,
            serde_json::json!(["grant", grant, expected_revision]),
            |tx| {
                let key = grant_key(grant);
                let (source, source_revision) = load_source(tx, &key.source)?;
                if grant.deny_epoch != source.deny_epoch {
                    return Err(AwarenessStoreError::Conflict);
                }
                let old = load_grant(tx, &key).optional_store()?;
                let expected_next = match (&old, expected_revision) {
                    (None, None) => SafeU53::new(1).map_err(|_| AwarenessStoreError::Invalid)?,
                    (Some(old), Some(expected))
                        if old.grant_revision == expected && old.grant_id == grant.grant_id =>
                    {
                        increment(expected)?
                    }
                    _ => return Err(AwarenessStoreError::Conflict),
                };
                if grant.grant_revision != expected_next {
                    return Err(AwarenessStoreError::Conflict);
                }
                let choices = encode(&grant.choices)?;
                tx.execute("INSERT INTO awareness_grants VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
                ON CONFLICT(owner,resident,source,device) DO UPDATE SET revision=excluded.revision,epoch=excluded.epoch,state=excluded.state,choices=excluded.choices", params![grant.owner_pubkey.as_str(),grant.resident_pubkey.as_str(),grant.source_id.as_str(),grant.device_id.as_str(),grant.grant_id.as_str(),grant.grant_revision.get(),grant.deny_epoch.get(),grant_state(grant.state),choices])?;
                let count = if old.is_some() {
                    quarantine(
                        tx,
                        &grant.owner_pubkey,
                        Some(&grant.resident_pubkey),
                        Some(&grant.grant_id),
                        None,
                    )?
                } else {
                    0
                };
                Ok(receipt(
                    source_revision,
                    source.deny_epoch,
                    Some(grant.grant_revision),
                    count,
                ))
            },
        )
    }

    /// Deny exactly this companion's grant, without advancing the shared source
    /// epoch or changing unrelated companions. No decryption/model is required.
    pub(crate) fn withdraw_grant(
        &mut self,
        key: &AwarenessGrantKeyV1,
        expected_revision: SafeU53,
        kind: AwarenessWithdrawalV1,
        operation: &OpaqueId,
    ) -> Result<AwarenessMutationReceiptV1, AwarenessStoreError> {
        mutate(
            &mut self.connection,
            &key.source.owner_pubkey,
            operation,
            serde_json::json!(["withdraw_grant", key, expected_revision, kind]),
            |tx| {
                let (source, source_revision) = load_source(tx, &key.source)?;
                let grant = load_grant(tx, key)?;
                if grant.grant_revision != expected_revision {
                    return Err(AwarenessStoreError::Conflict);
                }
                let next = increment(grant.grant_revision)?;
                tx.execute("UPDATE awareness_grants SET revision=?5,epoch=?6,state='revoked' WHERE owner=?1 AND resident=?2 AND source=?3 AND device=?4",params![key.source.owner_pubkey.as_str(),key.resident_pubkey.as_str(),key.source.source_id.as_str(),key.source.device_id.as_str(),next.get(),source.deny_epoch.get()])?;
                let count = quarantine(
                    tx,
                    &key.source.owner_pubkey,
                    Some(&key.resident_pubkey),
                    Some(&grant.grant_id),
                    None,
                )?;
                Ok(receipt(
                    source_revision,
                    source.deny_epoch,
                    Some(next),
                    count,
                ))
            },
        )
    }

    /// Source-wide disconnect/Forget atomically advances the deny epoch, revokes
    /// associated grants, and quarantines the transitive dependency closure.
    pub(crate) fn withdraw_source(
        &mut self,
        key: &AwarenessSourceKeyV1,
        expected_revision: SafeU53,
        kind: AwarenessWithdrawalV1,
        operation: &OpaqueId,
    ) -> Result<AwarenessMutationReceiptV1, AwarenessStoreError> {
        mutate(
            &mut self.connection,
            &key.owner_pubkey,
            operation,
            serde_json::json!(["withdraw_source", key, expected_revision, kind]),
            |tx| {
                let (source, revision) = load_source(tx, key)?;
                if revision != expected_revision {
                    return Err(AwarenessStoreError::Conflict);
                }
                let next_revision = increment(revision)?;
                let epoch = increment(source.deny_epoch)?;
                let highest: Option<u64> = tx.query_row("SELECT max(revision) FROM awareness_grants WHERE owner=?1 AND source=?2 AND device=?3",params![key.owner_pubkey.as_str(),key.source_id.as_str(),key.device_id.as_str()], |row| row.get(0))?;
                if let Some(highest) = highest {
                    increment(safe(highest)?)?;
                }
                tx.execute("UPDATE awareness_sources SET revision=?4,epoch=?5,state='disabled' WHERE owner=?1 AND source=?2 AND device=?3", params![key.owner_pubkey.as_str(),key.source_id.as_str(),key.device_id.as_str(),next_revision.get(),epoch.get()])?;
                tx.execute("UPDATE awareness_grants SET revision=revision+1,epoch=?4,state='revoked' WHERE owner=?1 AND source=?2 AND device=?3",params![key.owner_pubkey.as_str(),key.source_id.as_str(),key.device_id.as_str(),epoch.get()])?;
                let count = quarantine(tx, &key.owner_pubkey, None, None, Some(key))?;
                Ok(receipt(next_revision, epoch, None, count))
            },
        )
    }

    /// Read an exact current scope. Missing/unknown/revoked records never default
    /// to active. Returned state is metadata, not live caller authentication.
    pub(crate) fn snapshot(
        &self,
        key: &AwarenessGrantKeyV1,
    ) -> Result<AwarenessStoredAuthorityV1, AwarenessStoreError> {
        let (source, source_revision) = load_source(&self.connection, &key.source)?;
        let grant = load_grant(&self.connection, key)?;
        Ok(AwarenessStoredAuthorityV1 {
            source,
            source_revision,
            grant,
        })
    }

    /// Source metadata is usable for issuing an explicit first grant, not access.
    pub(crate) fn source_snapshot(
        &self,
        key: &AwarenessSourceKeyV1,
    ) -> Result<(AwarenessSourceV1, SafeU53), AwarenessStoreError> {
        load_source(&self.connection, key)
    }

    /// Next monotonic stream coordinate for one exact grant. This is metadata,
    /// not a read grant or reservation: the host serializes sampling per source,
    /// and admission still rejects a competing/stale sequence transactionally.
    pub(crate) fn next_sequence(
        &self,
        key: &AwarenessGrantKeyV1,
    ) -> Result<SafeU53, AwarenessStoreError> {
        let current = self.snapshot(key)?;
        let highest: Option<u64> = self.connection.query_row(
            "SELECT max(sequence) FROM awareness_observations WHERE owner=?1 AND resident=?2 AND grant_id=?3",
            params![key.source.owner_pubkey.as_str(), key.resident_pubkey.as_str(), current.grant.grant_id.as_str()],
            |row| row.get(0),
        )?;
        increment(safe(highest.unwrap_or(0))?)
    }

    /// List only one exact owner's chosen companion, including revoked scopes
    /// for keyless withdrawal UI. IDs never resolve sensitive source labels.
    pub(crate) fn list_grants(
        &self,
        owner: &Hex64,
        resident: &Hex64,
        limit: usize,
    ) -> Result<AwarenessGrantListV1, AwarenessStoreError> {
        if owner == resident || !(1..=64).contains(&limit) {
            return Err(AwarenessStoreError::Invalid);
        }
        let mut statement = self.connection.prepare("SELECT source,device FROM awareness_grants WHERE owner=?1 AND resident=?2 ORDER BY source,device LIMIT ?3")?;
        let rows = statement.query_map(
            params![owner.as_str(), resident.as_str(), limit + 1],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )?;
        let mut entries = Vec::new();
        let mut truncated = false;
        for row in rows {
            if entries.len() == limit {
                truncated = true;
                break;
            }
            let (source, device) = row?;
            let key = AwarenessGrantKeyV1 {
                source: AwarenessSourceKeyV1 {
                    owner_pubkey: owner.clone(),
                    source_id: OpaqueId::parse(source).map_err(|_| AwarenessStoreError::Invalid)?,
                    device_id: OpaqueId::parse(device).map_err(|_| AwarenessStoreError::Invalid)?,
                },
                resident_pubkey: resident.clone(),
            };
            entries.push(self.snapshot(&key)?);
        }
        Ok(AwarenessGrantListV1 { entries, truncated })
    }

    /// Re-admit raw material only against exact stored metadata, current grants,
    /// exclusion/freshness facts, and actual capture/expiry timestamps.
    pub(crate) fn recheck_raw_observation(
        &self,
        observation: &AwarenessObservationRefV1,
        facts: &AwarenessHostFactsV1<'_>,
        intended_use: AwarenessUseV1<'_>,
    ) -> Result<(), AwarenessStoreError> {
        let stored = load_observation(
            &self.connection,
            facts.owner_pubkey,
            facts.resident_pubkey,
            &observation.observation_id,
        )?;
        if stored != *observation {
            return Err(AwarenessStoreError::Denied(AwarenessError::Binding));
        }
        require_node(
            &self.connection,
            facts.owner_pubkey,
            facts.resident_pubkey,
            &observation.observation_id,
        )?;
        check_current(&self.connection, observation, facts, intended_use, true)
    }

    /// Register only dependency IDs of existing host objects. This is not a
    /// memory commit or permission to reuse a raw payload. The host must recheck
    /// raw admission before the actual context/job/promotion side effect.
    pub(crate) fn register_dependent(
        &mut self,
        node: &OpaqueId,
        kind: AwarenessDependentKindV1,
        parents: &[OpaqueId],
        facts: &AwarenessHostFactsV1<'_>,
        mut resolve: impl FnMut(&AwarenessObservationRefV1, bool) -> AwarenessMaterialFactsV1,
    ) -> Result<bool, AwarenessStoreError> {
        let mut parents = parents.to_vec();
        parents.sort();
        if parents.is_empty()
            || parents.len() > MAX_PARENTS
            || parents.windows(2).any(|pair| pair[0] == pair[1])
            || parents.contains(node)
        {
            return Err(AwarenessStoreError::Invalid);
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if load_resident(&tx, facts.owner_pubkey, facts.resident_pubkey)?.paused {
            return Err(AwarenessStoreError::Paused);
        }
        for parent in &parents {
            check_dependency(
                &tx,
                parent,
                facts,
                AwarenessUseV1 {
                    promote: kind == AwarenessDependentKindV1::Promoted,
                    ..Default::default()
                },
                &mut resolve,
            )?;
        }
        let existing =
            node_kind(&tx, facts.owner_pubkey, facts.resident_pubkey, node).optional_store()?;
        if let Some(existing) = existing {
            require_node(&tx, facts.owner_pubkey, facts.resident_pubkey, node)?;
            let stored = direct_parents(&tx, facts.owner_pubkey, facts.resident_pubkey, node)?;
            if existing != kind.wire() || stored != parents {
                return Err(AwarenessStoreError::ReplayConflict);
            }
            tx.commit()?;
            return Ok(true);
        }
        capacity(&tx)?;
        tx.execute(
            "INSERT INTO awareness_nodes VALUES (?1,?2,?3,?4,0)",
            params![
                facts.owner_pubkey.as_str(),
                facts.resident_pubkey.as_str(),
                node.as_str(),
                kind.wire()
            ],
        )?;
        for parent in &parents {
            tx.execute(
                "INSERT INTO awareness_edges VALUES (?1,?2,?3,?4)",
                params![
                    facts.owner_pubkey.as_str(),
                    facts.resident_pubkey.as_str(),
                    parent.as_str(),
                    node.as_str()
                ],
            )?;
        }
        tx.commit()?;
        Ok(false)
    }

    /// Check authority/quarantine and TTL of ephemeral dependency paths. Only
    /// paths through an explicitly promoted canonical reference outlive raw TTL;
    /// its body still belongs to the existing canonical memory authority.
    pub(crate) fn recheck_dependency(
        &self,
        node: &OpaqueId,
        facts: &AwarenessHostFactsV1<'_>,
        intended_use: AwarenessUseV1<'_>,
        mut resolve: impl FnMut(&AwarenessObservationRefV1, bool) -> AwarenessMaterialFactsV1,
    ) -> Result<(), AwarenessStoreError> {
        check_dependency(&self.connection, node, facts, intended_use, &mut resolve)
    }

    /// Saved creations must bind a genuine promoted node, never an ephemeral
    /// observation/context/job whose expiry or Pause semantics differ.
    pub(crate) fn recheck_promoted_artifact(
        &self,
        node: &OpaqueId,
        facts: &AwarenessHostFactsV1<'_>,
        resolve: impl FnMut(&AwarenessObservationRefV1, bool) -> AwarenessMaterialFactsV1,
    ) -> Result<(), AwarenessStoreError> {
        if node_kind(
            &self.connection,
            facts.owner_pubkey,
            facts.resident_pubkey,
            node,
        )? != AwarenessDependentKindV1::Promoted.wire()
        {
            return Err(AwarenessStoreError::Invalid);
        }
        self.recheck_dependency(node, facts, AwarenessUseV1::default(), resolve)
    }
}

fn receipt(
    source_revision: SafeU53,
    deny_epoch: SafeU53,
    grant_revision: Option<SafeU53>,
    quarantined_nodes: usize,
) -> AwarenessMutationReceiptV1 {
    AwarenessMutationReceiptV1 {
        source_revision: Some(source_revision),
        deny_epoch: Some(deny_epoch),
        grant_revision,
        resident_revision: None,
        quarantined_nodes,
        replayed: false,
    }
}
fn mutate(
    connection: &mut Connection,
    owner: &Hex64,
    operation: &OpaqueId,
    request: serde_json::Value,
    apply: impl FnOnce(&Transaction<'_>) -> Result<AwarenessMutationReceiptV1, AwarenessStoreError>,
) -> Result<AwarenessMutationReceiptV1, AwarenessStoreError> {
    let fingerprint = canonical_sha256(&request).map_err(|_| AwarenessStoreError::Invalid)?;
    let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let old: Option<(String,Vec<u8>)> = tx.query_row("SELECT request_ref,CASE WHEN length(receipt)<=4096 THEN receipt END FROM awareness_operations WHERE owner=?1 AND operation_id=?2",params![owner.as_str(),operation.as_str()],|row| Ok((row.get(0)?,row.get(1)?))).optional()?;
    if let Some((stored, bytes)) = old {
        if stored != fingerprint {
            return Err(AwarenessStoreError::ReplayConflict);
        }
        let mut result: AwarenessMutationReceiptV1 = decode(&bytes)?;
        result.replayed = true;
        tx.commit()?;
        return Ok(result);
    }
    let result = apply(&tx)?;
    tx.execute(
        "INSERT INTO awareness_operations VALUES (?1,?2,?3,?4)",
        params![
            owner.as_str(),
            operation.as_str(),
            fingerprint,
            encode(&result)?
        ],
    )?;
    tx.commit()?;
    Ok(result)
}
fn load_source(
    connection: &Connection,
    key: &AwarenessSourceKeyV1,
) -> Result<(AwarenessSourceV1, SafeU53), AwarenessStoreError> {
    let value: Option<(u64,u64,String)> = connection.query_row("SELECT revision,epoch,state FROM awareness_sources WHERE owner=?1 AND source=?2 AND device=?3",params![key.owner_pubkey.as_str(),key.source_id.as_str(),key.device_id.as_str()],|row| Ok((row.get(0)?,row.get(1)?,row.get(2)?))).optional()?;
    let (revision, epoch, state) = value.ok_or(AwarenessStoreError::Missing)?;
    let state = match state.as_str() {
        "current" => AwarenessSourceStateV1::Current,
        "disabled" => AwarenessSourceStateV1::Disabled,
        "unavailable" => AwarenessSourceStateV1::Unavailable,
        "unknown" => AwarenessSourceStateV1::Unknown,
        _ => return Err(AwarenessStoreError::Invalid),
    };
    if revision == 0 {
        return Err(AwarenessStoreError::Invalid);
    }
    Ok((
        AwarenessSourceV1 {
            protocol: AWARENESS_PROTOCOL.into(),
            owner_pubkey: key.owner_pubkey.clone(),
            source_id: key.source_id.clone(),
            device_id: key.device_id.clone(),
            deny_epoch: safe(epoch)?,
            state,
        },
        safe(revision)?,
    ))
}
fn load_resident(
    connection: &Connection,
    owner: &Hex64,
    resident: &Hex64,
) -> Result<AwarenessResidentStateV1, AwarenessStoreError> {
    let row:Option<(u64,bool,String)>=connection.query_row("SELECT revision,paused,CASE WHEN length(changed_at)=20 THEN changed_at END FROM awareness_residents WHERE owner=?1 AND resident=?2",params![owner.as_str(),resident.as_str()],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).optional()?;
    match row {
        None => Ok(AwarenessResidentStateV1 {
            revision: safe(0)?,
            paused: true,
            changed_at: None,
        }),
        Some((revision, paused, changed_at)) if revision > 0 => Ok(AwarenessResidentStateV1 {
            revision: safe(revision)?,
            paused,
            changed_at: Some(
                CanonicalTimestamp::parse(changed_at).map_err(|_| AwarenessStoreError::Invalid)?,
            ),
        }),
        Some(_) => Err(AwarenessStoreError::Invalid),
    }
}
fn load_grant(
    connection: &Connection,
    key: &AwarenessGrantKeyV1,
) -> Result<AwarenessGrantV1, AwarenessStoreError> {
    let value: Option<(String,u64,u64,String,Vec<u8>)> = connection.query_row("SELECT grant_id,revision,epoch,state,CASE WHEN length(choices)<=4096 THEN choices END FROM awareness_grants WHERE owner=?1 AND resident=?2 AND source=?3 AND device=?4",params![key.source.owner_pubkey.as_str(),key.resident_pubkey.as_str(),key.source.source_id.as_str(),key.source.device_id.as_str()],|row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?))).optional()?;
    let (id, revision, epoch, state, choices) = value.ok_or(AwarenessStoreError::Missing)?;
    let state = match state.as_str() {
        "active" => AwarenessGrantStateV1::Active,
        "revoked" => AwarenessGrantStateV1::Revoked,
        _ => return Err(AwarenessStoreError::Invalid),
    };
    let grant = AwarenessGrantV1 {
        protocol: AWARENESS_PROTOCOL.into(),
        grant_id: OpaqueId::parse(id).map_err(|_| AwarenessStoreError::Invalid)?,
        owner_pubkey: key.source.owner_pubkey.clone(),
        resident_pubkey: key.resident_pubkey.clone(),
        source_id: key.source.source_id.clone(),
        device_id: key.source.device_id.clone(),
        grant_revision: safe(revision)?,
        deny_epoch: safe(epoch)?,
        state,
        choices: decode::<AwarenessChoicesV1>(&choices)?,
    };
    grant.validate()?;
    Ok(grant)
}
fn grant_key(grant: &AwarenessGrantV1) -> AwarenessGrantKeyV1 {
    AwarenessGrantKeyV1 {
        source: AwarenessSourceKeyV1 {
            owner_pubkey: grant.owner_pubkey.clone(),
            source_id: grant.source_id.clone(),
            device_id: grant.device_id.clone(),
        },
        resident_pubkey: grant.resident_pubkey.clone(),
    }
}
fn load_observation(
    connection: &Connection,
    owner: &Hex64,
    resident: &Hex64,
    id: &OpaqueId,
) -> Result<AwarenessObservationRefV1, AwarenessStoreError> {
    let row: Option<(String,String,String,u64,Vec<u8>)> = connection.query_row("SELECT source,device,grant_id,sequence,CASE WHEN length(reference)<=4096 THEN reference END FROM awareness_observations WHERE owner=?1 AND resident=?2 AND observation_id=?3",params![owner.as_str(),resident.as_str(),id.as_str()],|row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?))).optional()?;
    let (source, device, grant, sequence, bytes) = row.ok_or(AwarenessStoreError::Missing)?;
    let value: AwarenessObservationRefV1 = decode(&bytes)?;
    if &value.owner_pubkey != owner
        || &value.resident_pubkey != resident
        || &value.observation_id != id
        || value.source_id.as_str() != source
        || value.device_id.as_str() != device
        || value.grant_id.as_str() != grant
        || value.sequence.get() != sequence
    {
        return Err(AwarenessStoreError::Invalid);
    }
    Ok(value)
}
fn check_current(
    connection: &Connection,
    observation: &AwarenessObservationRefV1,
    facts: &AwarenessHostFactsV1<'_>,
    intended_use: AwarenessUseV1<'_>,
    raw: bool,
) -> Result<(), AwarenessStoreError> {
    observation.validate()?;
    let control = load_resident(connection, facts.owner_pubkey, facts.resident_pubkey)?;
    if control.revision.get() == 0 || (raw && control.paused) {
        return Err(AwarenessStoreError::Paused);
    }
    // Whole-second clocks need conservative equality rejection after Resume.
    // This applies only to raw material, never already promoted canonical notes.
    if raw
        && control
            .changed_at
            .as_ref()
            .is_some_and(|floor| &observation.captured_at <= floor)
    {
        return Err(AwarenessError::Stale.into());
    }
    let key = AwarenessGrantKeyV1 {
        source: AwarenessSourceKeyV1 {
            owner_pubkey: facts.owner_pubkey.clone(),
            source_id: observation.source_id.clone(),
            device_id: observation.device_id.clone(),
        },
        resident_pubkey: facts.resident_pubkey.clone(),
    };
    let (source, _) = load_source(connection, &key.source)?;
    let grant = load_grant(connection, &key)?;
    let authority = AwarenessAuthoritySnapshotV1 {
        owner_pubkey: facts.owner_pubkey,
        resident_pubkey: facts.resident_pubkey,
        source: &source,
        grant: &grant,
        source_fresh: facts.source_fresh,
        material_state: facts.material_state,
        now: facts.now,
    };
    if raw {
        return recheck_awareness_eligibility(&authority, observation, intended_use)
            .map_err(Into::into);
    }
    // Retained dependency checks deliberately do not re-admit expired raw bytes.
    if observation.owner_pubkey != *facts.owner_pubkey
        || observation.resident_pubkey != *facts.resident_pubkey
        || observation.grant_id != grant.grant_id
    {
        return Err(AwarenessError::Binding.into());
    }
    if observation.grant_revision != grant.grant_revision
        || observation.deny_epoch != source.deny_epoch
        || grant.deny_epoch != source.deny_epoch
    {
        return Err(AwarenessError::Stale.into());
    }
    // Retained permission is not sensor liveness: a closed browser cannot erase
    // legitimate canonical promotion. Explicit Disabled/withdrawal, grant/epoch,
    // exclusion, and canonical material availability still deny retained use.
    if source.state == AwarenessSourceStateV1::Disabled {
        return Err(AwarenessError::SourceNotCurrent.into());
    }
    if grant.state != AwarenessGrantStateV1::Active {
        return Err(AwarenessError::Revoked.into());
    }
    match facts.material_state {
        AwarenessMaterialStateV1::Excluded => return Err(AwarenessError::Excluded.into()),
        AwarenessMaterialStateV1::Unavailable => return Err(AwarenessError::Unavailable.into()),
        AwarenessMaterialStateV1::Available => {}
    }
    if !grant.choices.observe {
        return Err(AwarenessError::ObservationDenied.into());
    }
    if intended_use.retain && !grant.choices.retain {
        return Err(AwarenessError::RetentionDenied.into());
    }
    if intended_use.promote && !grant.choices.promote {
        return Err(AwarenessError::PromotionDenied.into());
    }
    if intended_use.provider_egress_binding.is_some()
        && intended_use.provider_egress_binding != grant.choices.provider_egress_binding.as_ref()
    {
        return Err(AwarenessError::EgressDenied.into());
    }
    Ok(())
}
fn node_kind(
    connection: &Connection,
    owner: &Hex64,
    resident: &Hex64,
    node: &OpaqueId,
) -> Result<String, AwarenessStoreError> {
    connection
        .query_row(
            "SELECT kind FROM awareness_nodes WHERE owner=?1 AND resident=?2 AND node_id=?3",
            params![owner.as_str(), resident.as_str(), node.as_str()],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(AwarenessStoreError::Missing)
}
fn require_node(
    connection: &Connection,
    owner: &Hex64,
    resident: &Hex64,
    node: &OpaqueId,
) -> Result<(), AwarenessStoreError> {
    let value: Option<i64> = connection
        .query_row(
            "SELECT quarantined FROM awareness_nodes WHERE owner=?1 AND resident=?2 AND node_id=?3",
            params![owner.as_str(), resident.as_str(), node.as_str()],
            |row| row.get(0),
        )
        .optional()?;
    match value {
        Some(0) => Ok(()),
        Some(1) => Err(AwarenessStoreError::Quarantined),
        Some(2) => Err(AwarenessStoreError::Suspended),
        Some(_) => Err(AwarenessStoreError::Invalid),
        None => Err(AwarenessStoreError::Missing),
    }
}
fn direct_parents(
    connection: &Connection,
    owner: &Hex64,
    resident: &Hex64,
    node: &OpaqueId,
) -> Result<Vec<OpaqueId>, AwarenessStoreError> {
    let mut statement = connection.prepare("SELECT parent FROM awareness_edges WHERE owner=?1 AND resident=?2 AND child=?3 ORDER BY parent")?;
    let rows = statement.query_map(
        params![owner.as_str(), resident.as_str(), node.as_str()],
        |row| row.get::<_, String>(0),
    )?;
    rows.map(|row| OpaqueId::parse(row?).map_err(|_| AwarenessStoreError::Invalid))
        .collect()
}
fn check_dependency(
    connection: &Connection,
    node: &OpaqueId,
    facts: &AwarenessHostFactsV1<'_>,
    intended_use: AwarenessUseV1<'_>,
    resolve: &mut impl FnMut(&AwarenessObservationRefV1, bool) -> AwarenessMaterialFactsV1,
) -> Result<(), AwarenessStoreError> {
    require_node(connection, facts.owner_pubkey, facts.resident_pubkey, node)?;
    if node_kind(connection, facts.owner_pubkey, facts.resident_pubkey, node)? != "promoted"
        && load_resident(connection, facts.owner_pubkey, facts.resident_pubkey)?.paused
    {
        return Err(AwarenessStoreError::Paused);
    }
    // Preserve both modes when a root has promoted and ephemeral paths.
    let mut statement = connection.prepare("WITH RECURSIVE ancestors(id,retained) AS (
        SELECT node_id,(kind='promoted') FROM awareness_nodes WHERE owner=?1 AND resident=?2 AND node_id=?3
        UNION SELECT e.parent,(a.retained OR p.kind='promoted') FROM awareness_edges e JOIN ancestors a ON e.child=a.id JOIN awareness_nodes p ON p.owner=e.owner AND p.resident=e.resident AND p.node_id=e.parent WHERE e.owner=?1 AND e.resident=?2)
        SELECT n.node_id,n.kind,n.quarantined,a.retained FROM awareness_nodes n JOIN ancestors a ON n.node_id=a.id WHERE n.owner=?1 AND n.resident=?2")?;
    let rows = statement.query_map(
        params![
            facts.owner_pubkey.as_str(),
            facts.resident_pubkey.as_str(),
            node.as_str()
        ],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, bool>(3)?,
            ))
        },
    )?;
    let mut roots = 0;
    for row in rows {
        let (id, kind, quarantined, retained) = row?;
        if quarantined == 1 {
            return Err(AwarenessStoreError::Quarantined);
        }
        if quarantined == 2 && !retained {
            return Err(AwarenessStoreError::Suspended);
        }
        if !(0..=2).contains(&quarantined) {
            return Err(AwarenessStoreError::Invalid);
        }
        if kind == "observation" {
            roots += 1;
            let id = OpaqueId::parse(id).map_err(|_| AwarenessStoreError::Invalid)?;
            let observation =
                load_observation(connection, facts.owner_pubkey, facts.resident_pubkey, &id)?;
            let material = resolve(&observation, retained);
            let root_facts = AwarenessHostFactsV1 {
                owner_pubkey: facts.owner_pubkey,
                resident_pubkey: facts.resident_pubkey,
                now: facts.now,
                source_fresh: material.source_fresh,
                material_state: material.material_state,
            };
            check_current(
                connection,
                &observation,
                &root_facts,
                AwarenessUseV1 {
                    promote: intended_use.promote || retained,
                    ..intended_use
                },
                !retained,
            )?;
        }
    }
    if roots == 0 {
        return Err(AwarenessStoreError::Missing);
    }
    Ok(())
}
fn quarantine(
    connection: &Connection,
    owner: &Hex64,
    resident: Option<&Hex64>,
    grant: Option<&OpaqueId>,
    source: Option<&AwarenessSourceKeyV1>,
) -> Result<usize, AwarenessStoreError> {
    Ok(connection.execute("WITH RECURSIVE affected(owner,resident,id) AS (
        SELECT owner,resident,observation_id FROM awareness_observations WHERE owner=?1 AND (?2 IS NULL OR resident=?2) AND (?3 IS NULL OR grant_id=?3) AND (?4 IS NULL OR (source=?4 AND device=?5))
        UNION SELECT e.owner,e.resident,e.child FROM awareness_edges e JOIN affected a ON e.owner=a.owner AND e.resident=a.resident AND e.parent=a.id)
        UPDATE awareness_nodes SET quarantined=1 WHERE quarantined!=1 AND (owner,resident,node_id) IN (SELECT owner,resident,id FROM affected)",params![owner.as_str(),resident.map(Hex64::as_str),grant.map(OpaqueId::as_str),source.map(|source| source.source_id.as_str()),source.map(|source| source.device_id.as_str())])?)
}
fn capacity(connection: &Connection) -> Result<(), AwarenessStoreError> {
    let count: i64 =
        connection.query_row("SELECT count(*) FROM awareness_nodes", [], |row| row.get(0))?;
    if count >= MAX_NODES {
        return Err(AwarenessStoreError::Capacity);
    }
    Ok(())
}
fn source_state(state: AwarenessSourceStateV1) -> &'static str {
    match state {
        AwarenessSourceStateV1::Current => "current",
        AwarenessSourceStateV1::Disabled => "disabled",
        AwarenessSourceStateV1::Unavailable => "unavailable",
        AwarenessSourceStateV1::Unknown => "unknown",
    }
}
fn grant_state(state: AwarenessGrantStateV1) -> &'static str {
    match state {
        AwarenessGrantStateV1::Active => "active",
        AwarenessGrantStateV1::Revoked => "revoked",
    }
}
fn safe(value: u64) -> Result<SafeU53, AwarenessStoreError> {
    SafeU53::new(value).map_err(|_| AwarenessStoreError::Invalid)
}
fn increment(value: SafeU53) -> Result<SafeU53, AwarenessStoreError> {
    safe(
        value
            .get()
            .checked_add(1)
            .ok_or(AwarenessStoreError::Capacity)?,
    )
    .map_err(|_| AwarenessStoreError::Capacity)
}
fn encode(value: &impl Serialize) -> Result<Vec<u8>, AwarenessStoreError> {
    let bytes = serde_json::to_vec(value).map_err(|_| AwarenessStoreError::Invalid)?;
    if bytes.len() > MAX_RECORD_BYTES {
        return Err(AwarenessStoreError::Capacity);
    }
    Ok(bytes)
}
fn decode<T: serde::de::DeserializeOwned>(bytes: &[u8]) -> Result<T, AwarenessStoreError> {
    if bytes.len() > MAX_RECORD_BYTES {
        return Err(AwarenessStoreError::Invalid);
    }
    serde_json::from_slice(bytes).map_err(|_| AwarenessStoreError::Invalid)
}
trait OptionalStore<T> {
    fn optional_store(self) -> Result<Option<T>, AwarenessStoreError>;
}
impl<T> OptionalStore<T> for Result<T, AwarenessStoreError> {
    fn optional_store(self) -> Result<Option<T>, AwarenessStoreError> {
        match self {
            Ok(value) => Ok(Some(value)),
            Err(AwarenessStoreError::Missing) => Ok(None),
            Err(error) => Err(error),
        }
    }
}
