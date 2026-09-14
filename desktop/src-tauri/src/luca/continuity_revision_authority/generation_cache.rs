//! Reuse one fully validated ciphertext generation while SQLite is unchanged.

use std::sync::Arc;

use super::{
    load_generation_in_snapshot, ContinuityStore, ContinuityStoreError, Hex64,
    StoredRevisionGenerationV1,
};
use rusqlite::{Connection, Transaction};

#[derive(Clone, Copy, PartialEq, Eq)]
struct DatabaseStamp {
    // SQLite documents data_version as connection-local and changed by other
    // connections' commits. Local DML and DDL need their own counters.
    data_version: i64,
    total_changes: u64,
    schema_version: i64,
}

impl DatabaseStamp {
    fn read(connection: &Connection) -> Result<Self, ContinuityStoreError> {
        if !connection.is_autocommit() {
            return Err(ContinuityStoreError::CompareAndSwapConflict);
        }
        Ok(Self {
            data_version: connection
                .query_row("PRAGMA main.data_version", [], |row| row.get(0))
                .map_err(|_| ContinuityStoreError::Unavailable)?,
            total_changes: connection.total_changes(),
            schema_version: connection
                .query_row("PRAGMA main.schema_version", [], |row| row.get(0))
                .map_err(|_| ContinuityStoreError::Unavailable)?,
        })
    }
}

// Deliberately no Debug: the cache must not expose encrypted record material
// or resident metadata in diagnostics. It dies with the owner runtime store.
pub(crate) struct ValidatedGenerationCache {
    stamp: DatabaseStamp,
    generation: Arc<StoredRevisionGenerationV1>,
}

impl ContinuityStore {
    /// Run an immutable read against full validated owner authority. This is
    /// never used by CAS writers and never caches plaintext or failed reads.
    pub(super) fn with_validated_revision_read<T>(
        &self,
        owner: &Hex64,
        read: impl FnOnce(
            &Transaction<'_>,
            Option<&StoredRevisionGenerationV1>,
        ) -> Result<T, ContinuityStoreError>,
    ) -> Result<T, ContinuityStoreError> {
        let before = DatabaseStamp::read(&self.connection)?;
        let cached = {
            let mut cache = self
                .revision_read_cache
                .lock()
                .map_err(|_| ContinuityStoreError::Unavailable)?;
            if cache.as_ref().is_some_and(|entry| {
                entry.stamp != before || entry.generation.token.owner_pubkey != *owner
            }) {
                *cache = None;
            }
            cache.as_ref().map(|entry| Arc::clone(&entry.generation))
        };
        let transaction = self
            .connection
            .unchecked_transaction()
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        let generation = match cached {
            Some(generation) => Some(generation),
            None => load_generation_in_snapshot(&transaction, owner)?.map(Arc::new),
        };
        let result = read(&transaction, generation.as_deref());
        transaction
            .commit()
            .map_err(|_| ContinuityStoreError::Unavailable)?;

        // Check OUTSIDE the transaction. A read transaction can pin the old
        // SQLite data_version even after another connection commits. No data
        // from this operation escapes when an intervening write is detected.
        let after = DatabaseStamp::read(&self.connection)?;
        let mut cache = self
            .revision_read_cache
            .lock()
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        if before != after {
            *cache = None;
            return Err(ContinuityStoreError::CompareAndSwapConflict);
        }
        if result.is_ok() {
            *cache = generation.map(|generation| ValidatedGenerationCache {
                stamp: after,
                generation,
            });
        } else {
            *cache = None;
        }
        result
    }
}
