//! Persisted nonce uniqueness projection for revision-authority snapshots.

use std::collections::BTreeMap;

use luca_continuity::RevisionLedgerSnapshotV1;
use luca_protocol::{Hex64, SafeU53};
use rusqlite::{params, Connection, Transaction};

use super::{parse_safe, require_loaded_count, ContinuityStoreError};

pub(super) fn persist_nonce_reservations(
    transaction: &Transaction<'_>,
    owner: &Hex64,
    generation: SafeU53,
    snapshot: &RevisionLedgerSnapshotV1,
) -> Result<(), ContinuityStoreError> {
    for ((namespace_ref, key_version, nonce), (record_id, state)) in
        expected_nonce_reservations(snapshot)?
    {
        transaction
            .execute(
                "INSERT INTO continuity_nonce_reservations VALUES (?1,?2,?3,?4,?5,?6,?7)",
                params![
                    owner.as_str(),
                    generation.get() as i64,
                    namespace_ref,
                    key_version as i64,
                    nonce,
                    record_id,
                    state
                ],
            )
            .map_err(|_| ContinuityStoreError::NonceCollision)?;
    }
    Ok(())
}

type NonceReservationMap = BTreeMap<(String, u64, String), (String, &'static str)>;

fn expected_nonce_reservations(
    snapshot: &RevisionLedgerSnapshotV1,
) -> Result<NonceReservationMap, ContinuityStoreError> {
    let mut reservations = NonceReservationMap::new();
    for record in &snapshot.records {
        if reservations
            .insert(
                (
                    record.namespace.namespace_ref.as_str().to_owned(),
                    record.key_version.get(),
                    record.nonce_b64.clone(),
                ),
                (record.record_id.as_str().to_owned(), "live"),
            )
            .is_some()
        {
            return Err(ContinuityStoreError::NonceCollision);
        }
    }
    for lineage in &snapshot.lineages {
        for replacement in &lineage.envelope_replacements {
            for key in [
                (
                    lineage.namespace.namespace_ref.as_str().to_owned(),
                    replacement.original_key_version.get(),
                    replacement.original_nonce_b64.clone(),
                ),
                (
                    lineage.namespace.namespace_ref.as_str().to_owned(),
                    replacement.replacement_key_version.get(),
                    replacement.replacement_nonce_b64.clone(),
                ),
            ] {
                if let Some((existing_record, _)) = reservations.get(&key) {
                    if existing_record != replacement.record_id.as_str() {
                        return Err(ContinuityStoreError::NonceCollision);
                    }
                } else {
                    reservations
                        .insert(key, (replacement.record_id.as_str().to_owned(), "retired"));
                }
            }
        }
        if let Some(purge) = &lineage.purge_execution {
            for tombstone in &purge.record_tombstones {
                let key = (
                    tombstone.namespace_ref.as_str().to_owned(),
                    tombstone.key_version.get(),
                    tombstone.nonce_b64.clone(),
                );
                if let Some((existing_record, _)) = reservations.get(&key) {
                    if existing_record != tombstone.record_id.as_str() {
                        return Err(ContinuityStoreError::NonceCollision);
                    }
                }
                reservations.insert(key, (tombstone.record_id.as_str().to_owned(), "purged"));
            }
        }
    }
    Ok(reservations)
}

pub(super) fn validate_nonce_reservations(
    connection: &Connection,
    owner: &Hex64,
    generation: SafeU53,
    expected_count: usize,
    snapshot: &RevisionLedgerSnapshotV1,
) -> Result<(), ContinuityStoreError> {
    let expected = expected_nonce_reservations(snapshot)?;
    let mut statement = connection
        .prepare(
            "SELECT namespace_ref,key_version,nonce_b64,record_id,reservation_state
             FROM continuity_nonce_reservations
             WHERE owner_pubkey=?1 AND authority_generation=?2
             ORDER BY namespace_ref,key_version,nonce_b64",
        )
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    let rows = statement
        .query_map(params![owner.as_str(), generation.get() as i64], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    let mut actual = BTreeMap::new();
    for row in rows {
        let (namespace_ref, version, nonce, record_id, state) =
            row.map_err(|_| ContinuityStoreError::InvalidRecord)?;
        let state = match state.as_str() {
            "live" => "live",
            "retired" => "retired",
            "purged" => "purged",
            _ => return Err(ContinuityStoreError::InvalidRecord),
        };
        let key = (namespace_ref, parse_safe(version)?.get(), nonce);
        if actual.insert(key, (record_id, state)).is_some() {
            return Err(ContinuityStoreError::NonceCollision);
        }
    }
    require_loaded_count(expected_count, actual.len())?;
    if actual != expected {
        return Err(ContinuityStoreError::NonceCollision);
    }
    Ok(())
}
