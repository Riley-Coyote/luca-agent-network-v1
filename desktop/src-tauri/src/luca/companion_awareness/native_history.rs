//! A separate, default-off destination choice for native conversation history.
//! No raw body, locator, transcript or credential is stored here. This does not
//! change frozen awareness grants or enable local raw archival retention.

use super::*;
use luca_protocol::Sha256Ref;
use serde::{Deserialize, Serialize};

pub(crate) const NATIVE_HISTORY_DISCLOSURE_REVISION: u32 = 1;
const PROTOCOL: &str = "polyphonic.awareness.native-history.v1";
const MAX_CHOICES: i64 = 128;

/// Saved choice, not a reusable admission token. Every native-context effect
/// rechecks the current grant, model/provider binding, epoch and exclusions.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct NativeHistoryChoiceV1 {
    protocol: String,
    owner_pubkey: Hex64,
    resident_pubkey: Hex64,
    source_id: OpaqueId,
    device_id: OpaqueId,
    pub(crate) revision: SafeU53,
    pub(crate) allowed: bool,
    /// Explicit useful-note consent. Legacy promotion/history choices never
    /// imply semantic memory; missing fields deserialize OFF without migration.
    #[serde(default)]
    pub(crate) semantic_notes: bool,
    grant_ref: Sha256Ref,
    pub(crate) binding_ref: Option<Sha256Ref>,
    disclosure_revision: u32,
    pub(crate) changed_at: CanonicalTimestamp,
}

impl NativeHistoryChoiceV1 {
    fn valid_for(&self, key: &AwarenessGrantKeyV1, revision: u64) -> bool {
        self.protocol == PROTOCOL
            && self.revision.get() == revision
            && revision > 0
            && self.owner_pubkey == key.source.owner_pubkey
            && self.resident_pubkey == key.resident_pubkey
            && self.source_id == key.source.source_id
            && self.device_id == key.source.device_id
            && self.owner_pubkey != self.resident_pubkey
            && self.disclosure_revision == NATIVE_HISTORY_DISCLOSURE_REVISION
            && (!self.allowed || self.binding_ref.is_some())
            && (!self.semantic_notes || self.allowed)
    }
}

impl AwarenessStore {
    /// Inspect metadata only. Missing consent is OFF, never inferred from
    /// Observe, meaningful-note promotion or ordinary provider egress.
    pub(crate) fn native_history_choice(
        &self,
        key: &AwarenessGrantKeyV1,
    ) -> Result<Option<NativeHistoryChoiceV1>, AwarenessStoreError> {
        load_choice(&self.connection, key)
    }

    /// Exact owner-requested CAS choice. Host wrapper supplies current live
    /// identity for widening and derives binding from the actual native runtime.
    pub(crate) fn set_native_history_choice(
        &mut self,
        key: &AwarenessGrantKeyV1,
        expected: SafeU53,
        allowed: bool,
        current_binding: Option<&Sha256Ref>,
        now: &CanonicalTimestamp,
        operation: &OpaqueId,
    ) -> Result<(NativeHistoryChoiceV1, bool), AwarenessStoreError> {
        if key.source.owner_pubkey == key.resident_pubkey {
            return Err(AwarenessStoreError::Invalid);
        }
        let receipt = super::mutate(
            &mut self.connection,
            &key.source.owner_pubkey,
            operation,
            serde_json::json!([
                PROTOCOL,
                key,
                expected,
                allowed,
                current_binding,
                now,
                NATIVE_HISTORY_DISCLOSURE_REVISION
            ]),
            |tx| {
                let previous = load_choice(tx, key)?;
                if previous.as_ref().map_or(0, |choice| choice.revision.get()) != expected.get() {
                    return Err(AwarenessStoreError::Conflict);
                }
                let (source, _) = super::load_source(tx, &key.source)?;
                let grant = super::load_grant(tx, key)?;
                if allowed
                    && (source.state == AwarenessSourceStateV1::Disabled
                        || grant.state != AwarenessGrantStateV1::Active
                        || !grant.choices.observe
                        || current_binding.is_none()
                        || grant.choices.provider_egress_binding.as_ref() != current_binding
                        || grant.deny_epoch != source.deny_epoch)
                {
                    return Err(AwarenessStoreError::Invalid);
                }
                if previous.is_none() {
                    let count: i64 = tx.query_row("SELECT count(*) FROM awareness_native_history WHERE owner=?1 AND resident=?2",
                        params![key.source.owner_pubkey.as_str(), key.resident_pubkey.as_str()], |row| row.get(0))?;
                    if count >= MAX_CHOICES {
                        return Err(AwarenessStoreError::Capacity);
                    }
                }
                let current_grant_ref = grant_ref(&grant)?;
                let binding_ref = allowed.then(|| current_binding.cloned()).flatten();
                let semantic_notes = previous.as_ref().is_some_and(|previous| {
                    allowed
                        && previous.allowed
                        && previous.semantic_notes
                        && previous.grant_ref == current_grant_ref
                        && previous.binding_ref == binding_ref
                });
                let choice = NativeHistoryChoiceV1 {
                    protocol: PROTOCOL.into(),
                    owner_pubkey: key.source.owner_pubkey.clone(),
                    resident_pubkey: key.resident_pubkey.clone(),
                    source_id: key.source.source_id.clone(),
                    device_id: key.source.device_id.clone(),
                    revision: super::increment(expected)?,
                    allowed,
                    semantic_notes,
                    grant_ref: current_grant_ref,
                    binding_ref,
                    disclosure_revision: NATIVE_HISTORY_DISCLOSURE_REVISION,
                    changed_at: now.clone(),
                };
                tx.execute("INSERT INTO awareness_native_history VALUES (?1,?2,?3,?4,?5,?6) ON CONFLICT(owner,resident,source,device) DO UPDATE SET revision=excluded.revision,choice=excluded.choice",
                    params![key.source.owner_pubkey.as_str(),key.resident_pubkey.as_str(),key.source.source_id.as_str(),key.source.device_id.as_str(),choice.revision.get(),super::encode(&choice)?])?;
                Ok(AwarenessMutationReceiptV1 {
                    source_revision: None,
                    deny_epoch: Some(source.deny_epoch),
                    grant_revision: Some(grant.grant_revision),
                    resident_revision: None,
                    quarantined_nodes: 0,
                    replayed: false,
                })
            },
        )?;
        // A replay cannot restore an old ON choice after a newer OFF operation.
        let choice = load_choice(&self.connection, key)?.ok_or(AwarenessStoreError::Missing)?;
        Ok((choice, receipt.replayed))
    }

    /// Host-only reviewed useful-note choice, or preservation of an exact
    /// previously reviewed choice through an owned unchanged-scope refresh.
    /// Ordinary promotion and native-history setters cannot newly enable this.
    pub(crate) fn set_semantic_note_choice(
        &mut self,
        key: &AwarenessGrantKeyV1,
        expected: SafeU53,
        allowed: bool,
        binding: Option<&Sha256Ref>,
        now: &CanonicalTimestamp,
        operation: &OpaqueId,
    ) -> Result<(NativeHistoryChoiceV1, bool), AwarenessStoreError> {
        if key.source.owner_pubkey == key.resident_pubkey {
            return Err(AwarenessStoreError::Invalid);
        }
        let receipt = super::mutate(
            &mut self.connection,
            &key.source.owner_pubkey,
            operation,
            serde_json::json!([
                PROTOCOL,
                "semantic_notes",
                key,
                expected,
                allowed,
                binding,
                now
            ]),
            |tx| {
                let mut choice = load_choice(tx, key)?.ok_or(AwarenessStoreError::Missing)?;
                if choice.revision != expected {
                    return Err(AwarenessStoreError::Conflict);
                }
                let (source, _) = super::load_source(tx, &key.source)?;
                let grant = super::load_grant(tx, key)?;
                if allowed
                    && (!choice.allowed
                        || binding.is_none()
                        || choice.binding_ref.as_ref() != binding
                        || choice.grant_ref != grant_ref(&grant)?
                        || grant.state != AwarenessGrantStateV1::Active
                        || !grant.choices.observe
                        || !grant.choices.promote
                        || grant.choices.provider_egress_binding.as_ref() != binding
                        || grant.deny_epoch != source.deny_epoch
                        || source.state == AwarenessSourceStateV1::Disabled)
                {
                    return Err(AwarenessStoreError::Invalid);
                }
                choice.revision = super::increment(expected)?;
                choice.semantic_notes = allowed;
                choice.changed_at = now.clone();
                tx.execute(
                    "UPDATE awareness_native_history SET revision=?5,choice=?6 WHERE owner=?1 AND resident=?2 AND source=?3 AND device=?4",
                    params![key.source.owner_pubkey.as_str(), key.resident_pubkey.as_str(), key.source.source_id.as_str(), key.source.device_id.as_str(), choice.revision.get(), super::encode(&choice)?],
                )?;
                Ok(AwarenessMutationReceiptV1 {
                    source_revision: None,
                    deny_epoch: Some(source.deny_epoch),
                    grant_revision: Some(grant.grant_revision),
                    resident_revision: None,
                    quarantined_nodes: 0,
                    replayed: false,
                })
            },
        )?;
        let choice = load_choice(&self.connection, key)?.ok_or(AwarenessStoreError::Missing)?;
        Ok((choice, receipt.replayed))
    }

    /// Permission only, not a body lease. Effects must also hold the existing
    /// pause, source ancestry, native binding and retained-material fences.
    pub(crate) fn recheck_semantic_note_choice(
        &self,
        key: &AwarenessGrantKeyV1,
        binding: &Sha256Ref,
    ) -> Result<(), AwarenessStoreError> {
        self.recheck_native_history_choice(key, binding)?;
        let choice = load_choice(&self.connection, key)?.ok_or(AwarenessStoreError::Invalid)?;
        let grant = super::load_grant(&self.connection, key)?;
        if !choice.semantic_notes || !grant.choices.promote {
            return Err(AwarenessStoreError::Invalid);
        }
        Ok(())
    }

    /// This proves destination consent only, not capture/material availability,
    /// transport framing, native-history deletion, promotion or publication.
    pub(crate) fn recheck_native_history_choice(
        &self,
        key: &AwarenessGrantKeyV1,
        binding: &Sha256Ref,
    ) -> Result<(), AwarenessStoreError> {
        let choice = load_choice(&self.connection, key)?.ok_or(AwarenessStoreError::Invalid)?;
        let (source, _) = super::load_source(&self.connection, &key.source)?;
        let grant = super::load_grant(&self.connection, key)?;
        if !choice.allowed
            || choice.binding_ref.as_ref() != Some(binding)
            || choice.grant_ref != grant_ref(&grant)?
            || grant.state != AwarenessGrantStateV1::Active
            || !grant.choices.observe
            || grant.choices.provider_egress_binding.as_ref() != Some(binding)
            || grant.deny_epoch != source.deny_epoch
            || source.state == AwarenessSourceStateV1::Disabled
        {
            return Err(AwarenessStoreError::Invalid);
        }
        Ok(())
    }
}

fn grant_ref(grant: &AwarenessGrantV1) -> Result<Sha256Ref, AwarenessStoreError> {
    let hash = canonical_sha256(&serde_json::json!({ "domain": PROTOCOL, "grant": grant }))
        .map_err(|_| AwarenessStoreError::Invalid)?;
    Sha256Ref::parse(format!("sha256:{hash}")).map_err(|_| AwarenessStoreError::Invalid)
}
fn load_choice(
    connection: &Connection,
    key: &AwarenessGrantKeyV1,
) -> Result<Option<NativeHistoryChoiceV1>, AwarenessStoreError> {
    let row: Option<(u64, Vec<u8>)> = connection.query_row(
        "SELECT revision, CASE WHEN length(choice)<=4096 THEN choice END FROM awareness_native_history WHERE owner=?1 AND resident=?2 AND source=?3 AND device=?4",
        params![key.source.owner_pubkey.as_str(),key.resident_pubkey.as_str(),key.source.source_id.as_str(),key.source.device_id.as_str()],
        |row| Ok((row.get(0)?,row.get(1)?))).optional()?;
    row.map(|(revision, bytes)| {
        let choice = super::decode::<NativeHistoryChoiceV1>(&bytes)?;
        if !choice.valid_for(key, revision) {
            return Err(AwarenessStoreError::Invalid);
        }
        Ok(choice)
    })
    .transpose()
}

#[cfg(test)]
#[path = "native_history_tests.rs"]
mod tests;
