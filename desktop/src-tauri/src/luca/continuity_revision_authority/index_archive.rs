//! Completed index purges are permanent safety history, not live index capacity.
//! Keep their complete validated receipts on disk and indexed nonce/ID denials,
//! outside the bounded, repeatedly hydrated working ledger. Never archive memory,
//! active records, incomplete purges, or records with derived artifacts.
use super::*;

pub(crate) const SCHEMA: &str = r#"
CREATE TABLE continuity_index_archive (
 owner_pubkey TEXT NOT NULL, lineage_root_id TEXT NOT NULL,
 snapshot_json BLOB NOT NULL, snapshot_fingerprint TEXT NOT NULL,
 PRIMARY KEY(owner_pubkey,lineage_root_id)
);
CREATE TABLE continuity_index_archive_reservations (
 owner_pubkey TEXT NOT NULL, namespace_ref TEXT NOT NULL,
 key_version INTEGER NOT NULL, nonce_b64 TEXT NOT NULL, record_id TEXT NOT NULL,
 PRIMARY KEY(owner_pubkey,namespace_ref,key_version,nonce_b64)
);
CREATE INDEX continuity_index_archive_record_ids
 ON continuity_index_archive_reservations(record_id);
"#;

pub(crate) const OBJECTS: &[(&str, &str)] = &[
    ("table", "continuity_index_archive"),
    ("table", "continuity_index_archive_reservations"),
    ("index", "continuity_index_archive_record_ids"),
];

pub(crate) fn validate_schema(connection: &Connection) -> Result<(), ContinuityStoreError> {
    for (kind, name) in OBJECTS {
        let (actual_kind, actual_sql): (String, String) = connection
            .query_row(
                "SELECT type,sql FROM sqlite_master WHERE name=?1",
                [name],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|_| ContinuityStoreError::SchemaIncompatible)?;
        let prefix = format!("CREATE {} {}", kind.to_uppercase(), name);
        let expected = SCHEMA
            .split(';')
            .find(|statement| statement.trim().starts_with(&prefix))
            .ok_or(ContinuityStoreError::SchemaIncompatible)?;
        if actual_kind != *kind
            || normalize_schema_sql(&actual_sql) != normalize_schema_sql(expected)
        {
            return Err(ContinuityStoreError::SchemaIncompatible);
        }
    }
    Ok(())
}

impl ContinuityStore {
    /// Upgrade the live working set without deleting any safety history. This
    /// runs before admitting a new index so a legacy full ledger can recover.
    pub(crate) fn compact_connected_index_history(
        &mut self,
        owner: &Hex64,
    ) -> Result<(), ContinuityStoreError> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        reject_rotation(&transaction, owner)?;
        let Some(current) = load_generation_in_snapshot(&transaction, owner)? else {
            return Ok(());
        };
        let eligible = current.snapshot.lineages.iter().any(|lineage| {
            lineage.record_type.as_str() == "connected-brain-index-page"
                && lineage
                    .purge_execution
                    .as_ref()
                    .is_some_and(|purge| purge.status == PurgeExecutionStatusV1::Completed)
        });
        if !eligible {
            return Ok(());
        }
        persist_transition(
            &transaction,
            &AuthorityExpectationV1::Existing(current.token.clone()),
            Some(&current),
            current.token.active_root_key_version,
            &current.snapshot,
            false,
            false,
        )?;
        transaction
            .commit()
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        Ok(())
    }
}

pub(super) fn compact(
    transaction: &Transaction<'_>,
    owner: &Hex64,
    snapshot: &RevisionLedgerSnapshotV1,
) -> Result<RevisionLedgerSnapshotV1, ContinuityStoreError> {
    let mut retained = snapshot.clone();
    let mut archived = BTreeSet::new();
    for lineage in &snapshot.lineages {
        if lineage.namespace.kind != ContinuityNamespaceKindV1::OwnerBrain
            || lineage.namespace.owner_pubkey != *owner
            || lineage.record_type.as_str() != "connected-brain-index-page"
            || lineage.lifecycle != RevisionLifecycle::Forgotten
            || !lineage.derived_artifact_refs.is_empty()
            || lineage.purge_execution.as_ref().is_none_or(|purge| {
                purge.status != PurgeExecutionStatusV1::Completed
                    || !purge.artifact_tombstones.is_empty()
            })
        {
            continue;
        }
        let id = &lineage.lineage_root_id;
        let archive = RevisionLedgerSnapshotV1 {
            schema_version: snapshot.schema_version,
            records: Vec::new(),
            lineages: vec![lineage.clone()],
            revision_idempotency: snapshot
                .revision_idempotency
                .iter()
                .filter(|entry| entry.receipt.lineage_root_id == *id)
                .cloned()
                .collect(),
            artifact_idempotency: snapshot
                .artifact_idempotency
                .iter()
                .filter(|entry| entry.receipt.lineage_root_id == *id)
                .cloned()
                .collect(),
        };
        // Cross-table validation proves the archived lineage needs no ciphertext
        // and its terminal receipt accounts for every immutable member.
        validate_snapshot_owner(&archive, owner)?;
        let raw = canonicalize(&archive).map_err(|_| ContinuityStoreError::InvalidRecord)?;
        let fingerprint = archive.fingerprint().map_err(map_continuity_error)?;
        transaction
            .execute(
                "INSERT INTO continuity_index_archive VALUES (?1,?2,?3,?4)",
                params![owner.as_str(), id.as_str(), raw, fingerprint.as_str()],
            )
            .map_err(|_| ContinuityStoreError::ReplayConflict)?;
        let purge = lineage.purge_execution.as_ref().unwrap();
        for tombstone in &purge.record_tombstones {
            reserve(
                transaction,
                owner,
                tombstone.namespace_ref.as_str(),
                tombstone.key_version.get(),
                &tombstone.nonce_b64,
                tombstone.record_id.as_str(),
            )?;
        }
        // Rotation may have retired additional nonces before the final purge.
        for replacement in &lineage.envelope_replacements {
            for (version, nonce) in [
                (
                    replacement.original_key_version.get(),
                    &replacement.original_nonce_b64,
                ),
                (
                    replacement.replacement_key_version.get(),
                    &replacement.replacement_nonce_b64,
                ),
            ] {
                reserve(
                    transaction,
                    owner,
                    lineage.namespace.namespace_ref.as_str(),
                    version,
                    nonce,
                    replacement.record_id.as_str(),
                )?;
            }
        }
        archived.insert(id.clone());
    }
    retained
        .lineages
        .retain(|lineage| !archived.contains(&lineage.lineage_root_id));
    retained
        .revision_idempotency
        .retain(|entry| !archived.contains(&entry.receipt.lineage_root_id));
    retained
        .artifact_idempotency
        .retain(|entry| !archived.contains(&entry.receipt.lineage_root_id));
    validate_snapshot_owner(&retained, owner)?;
    Ok(retained)
}

fn reserve(
    transaction: &Transaction<'_>,
    owner: &Hex64,
    namespace: &str,
    version: u64,
    nonce: &str,
    record: &str,
) -> Result<(), ContinuityStoreError> {
    transaction
        .execute(
            "INSERT INTO continuity_index_archive_reservations VALUES (?1,?2,?3,?4,?5)
         ON CONFLICT(owner_pubkey,namespace_ref,key_version,nonce_b64) DO NOTHING",
            params![owner.as_str(), namespace, version as i64, nonce, record],
        )
        .map_err(|_| ContinuityStoreError::NonceCollision)?;
    let reserved: String = transaction
        .query_row(
            "SELECT record_id FROM continuity_index_archive_reservations
         WHERE owner_pubkey=?1 AND namespace_ref=?2 AND key_version=?3 AND nonce_b64=?4",
            params![owner.as_str(), namespace, version as i64, nonce],
            |row| row.get(0),
        )
        .map_err(|_| ContinuityStoreError::InvalidRecord)?;
    if reserved != record {
        return Err(ContinuityStoreError::NonceCollision);
    }
    Ok(())
}

pub(crate) fn reject_record(
    connection: &Connection,
    record: &ContinuityRecordV1,
) -> Result<(), ContinuityStoreError> {
    let collision: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM continuity_index_archive_reservations WHERE record_id=?1)
         OR EXISTS(SELECT 1 FROM continuity_index_archive_reservations
           WHERE owner_pubkey=?2 AND namespace_ref=?3 AND key_version=?4 AND nonce_b64=?5)",
            params![
                record.record_id.as_str(),
                record.namespace.owner_pubkey.as_str(),
                record.namespace.namespace_ref.as_str(),
                record.key_version.get() as i64,
                record.nonce_b64
            ],
            |row| row.get(0),
        )
        .map_err(|_| ContinuityStoreError::InvalidRecord)?;
    if collision {
        return Err(ContinuityStoreError::NonceCollision);
    }
    Ok(())
}

pub(super) fn reject_snapshot(
    connection: &Connection,
    owner: &Hex64,
    snapshot: &RevisionLedgerSnapshotV1,
) -> Result<(), ContinuityStoreError> {
    for lineage in &snapshot.lineages {
        let retired: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM continuity_index_archive
             WHERE owner_pubkey=?1 AND lineage_root_id=?2)",
                params![owner.as_str(), lineage.lineage_root_id.as_str()],
                |row| row.get(0),
            )
            .map_err(|_| ContinuityStoreError::InvalidRecord)?;
        if retired {
            return Err(ContinuityStoreError::ReplayConflict);
        }
    }
    for record in &snapshot.records {
        reject_record(connection, record)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::luca::continuity_store::{ContinuityStoreCustody, ContinuityStoreOpen};

    /// Opt-in test for an explicitly supplied COPY, never the installed store.
    #[test]
    #[ignore = "requires an explicitly prepared encrypted database copy"]
    fn migrate_copied_index_history() {
        let directory = std::env::var("LUCA_INDEX_MIGRATION_FIXTURE").unwrap();
        assert!(directory.starts_with("/private/tmp/luca-index-migration."));
        let mut store = match ContinuityStore::open(
            std::path::Path::new(&directory),
            ContinuityStoreCustody::Ready,
        )
        .unwrap()
        {
            ContinuityStoreOpen::Ready(store) => store,
            _ => panic!("copy must be ready"),
        };
        let owners = store
            .connection
            .prepare("SELECT owner_pubkey FROM continuity_authority_meta")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert!(
            !owners.is_empty(),
            "fixture must contain existing owner authority"
        );
        for owner in owners {
            let owner = Hex64::parse(owner).unwrap();
            let before = store.load_revision_generation(&owner).unwrap().unwrap();
            let expected = before
                .snapshot
                .lineages
                .iter()
                .filter(|lineage| {
                    lineage.record_type.as_str() == "connected-brain-index-page"
                        && lineage
                            .purge_execution
                            .as_ref()
                            .is_some_and(|purge| purge.status == PurgeExecutionStatusV1::Completed)
                })
                .count();
            assert!(expected > 0, "fixture must contain completed index purges");
            store.compact_connected_index_history(&owner).unwrap();
            let after = store.load_revision_generation(&owner).unwrap().unwrap();
            assert_eq!(
                before.snapshot.records, after.snapshot.records,
                "encrypted current content must be byte-identical"
            );
            assert_eq!(
                before.snapshot.lineages.len() - after.snapshot.lineages.len(),
                expected
            );
            let count: i64 = store
                .connection
                .query_row(
                    "SELECT COUNT(*) FROM continuity_index_archive WHERE owner_pubkey=?1",
                    [owner.as_str()],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count as usize, expected);
            println!(
                "Archived {count} completed index purges; {} live lineages remain",
                after.snapshot.lineages.len()
            );
        }
        drop(store);
        assert!(matches!(
            ContinuityStore::open(
                std::path::Path::new(&directory),
                ContinuityStoreCustody::Ready
            )
            .unwrap(),
            ContinuityStoreOpen::Ready(_)
        ));
    }
}
