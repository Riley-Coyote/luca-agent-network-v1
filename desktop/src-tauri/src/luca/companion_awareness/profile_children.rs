//! Additive opaque observation→native-child correlation in the existing authority.
//! Native UUID, path, transcript/header and raw payload never enter this table.
use super::*;
use luca_protocol::Sha256Ref;

impl AwarenessStore {
    /// Admit an exact observation with no inferred native-child claim.
    pub(crate) fn admit_observation(&mut self,observation:&AwarenessObservationRefV1,
        facts:&AwarenessHostFactsV1<'_>)->Result<bool,AwarenessStoreError> {
        self.admit_correlated(observation,facts,None)
    }
    /// Atomically persist trusted opaque child identity with a FULL observation.
    pub(crate) fn admit_profile_observation(&mut self,observation:&AwarenessObservationRefV1,
        facts:&AwarenessHostFactsV1<'_>,child:&AwarenessProfileChildV1)->Result<bool,AwarenessStoreError> {
        self.admit_correlated(observation,facts,Some(child))
    }
    fn admit_correlated(&mut self,observation:&AwarenessObservationRefV1,facts:&AwarenessHostFactsV1<'_>,
        child:Option<&AwarenessProfileChildV1>)->Result<bool,AwarenessStoreError> {
        let tx=self.connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        check_current(&tx,observation,facts,AwarenessUseV1::default(),true)?;
        if let Some(old)=load_observation(&tx,&observation.owner_pubkey,&observation.resident_pubkey,&observation.observation_id).optional_store()? {
            if old!=*observation || load_child(&tx,observation)?.as_ref()!=child {return Err(AwarenessStoreError::ReplayConflict);}
            require_node(&tx,&observation.owner_pubkey,&observation.resident_pubkey,&observation.observation_id)?;
            tx.commit()?;return Ok(true);
        }
        capacity(&tx)?;
        let highest:Option<u64>=tx.query_row("SELECT max(sequence) FROM awareness_observations WHERE owner=?1 AND resident=?2 AND grant_id=?3",
            params![observation.owner_pubkey.as_str(),observation.resident_pubkey.as_str(),observation.grant_id.as_str()],|row|row.get(0))?;
        if highest.is_some_and(|n|observation.sequence.get()<=n){return Err(AwarenessStoreError::Conflict);}
        tx.execute("INSERT INTO awareness_observations VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",params![observation.owner_pubkey.as_str(),observation.resident_pubkey.as_str(),
            observation.observation_id.as_str(),observation.source_id.as_str(),observation.device_id.as_str(),observation.grant_id.as_str(),observation.sequence.get(),encode(observation)?])?;
        tx.execute("INSERT INTO awareness_nodes VALUES(?1,?2,?3,'observation',0)",params![observation.owner_pubkey.as_str(),observation.resident_pubkey.as_str(),observation.observation_id.as_str()])?;
        if let Some(child)=child {tx.execute("INSERT INTO awareness_profile_children VALUES(?1,?2,?3,?4,?5,?6)",params![observation.owner_pubkey.as_str(),observation.resident_pubkey.as_str(),
            observation.observation_id.as_str(),child.child_ref.as_str(),child.exclusion_token.as_str(),reference_ref(observation)?.as_str()])?;}
        tx.commit()?;Ok(false)
    }
    /// Body-free exact full-reference lookup. A caller cannot substitute a newer
    /// observation/source-wide status for the requested retained derivative root.
    pub(crate) fn profile_child(&self,reference:&AwarenessObservationRefV1)->Result<Option<AwarenessProfileChildV1>,AwarenessStoreError> {
        let stored=load_observation(&self.connection,&reference.owner_pubkey,&reference.resident_pubkey,&reference.observation_id)?;
        if stored!=*reference {return Err(AwarenessStoreError::Invalid);}
        load_child(&self.connection,reference)
    }
    /// Bounded metadata preload before effect locks; source bodies are never read.
    pub(crate) fn profile_children(&self,owner:&Hex64,resident:&Hex64)->Result<Vec<AwarenessProfileChildBindingV1>,AwarenessStoreError> {
        let mut statement=self.connection.prepare("SELECT observation_id FROM awareness_profile_children WHERE owner=?1 AND resident=?2 ORDER BY observation_id LIMIT 4097")?;
        let ids=statement.query_map(params![owner.as_str(),resident.as_str()],|row|row.get::<_,String>(0))?.collect::<Result<Vec<_>,_>>()?;
        if ids.len()>4096 {return Err(AwarenessStoreError::Capacity);}
        ids.into_iter().map(|id|{let id=OpaqueId::parse(id).map_err(|_|AwarenessStoreError::Invalid)?;
            let reference=load_observation(&self.connection,owner,resident,&id)?;
            let child=load_child(&self.connection,&reference)?.ok_or(AwarenessStoreError::Invalid)?;
            Ok(AwarenessProfileChildBindingV1 {reference,child})}).collect()
    }
}
fn reference_ref(reference:&AwarenessObservationRefV1)->Result<Sha256Ref,AwarenessStoreError> {
    let digest=luca_protocol::canonical_sha256(reference).map_err(|_|AwarenessStoreError::Invalid)?;
    Sha256Ref::parse(format!("sha256:{digest}")).map_err(|_|AwarenessStoreError::Invalid)
}
fn load_child(connection:&Connection,reference:&AwarenessObservationRefV1)->Result<Option<AwarenessProfileChildV1>,AwarenessStoreError> {
    let row:Option<(String,String,String)>=connection.query_row("SELECT child_ref,exclusion_token,reference_ref FROM awareness_profile_children WHERE owner=?1 AND resident=?2 AND observation_id=?3",
        params![reference.owner_pubkey.as_str(),reference.resident_pubkey.as_str(),reference.observation_id.as_str()],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).optional()?;
    let Some((child,token,binding))=row else {return Ok(None);};
    if binding!=reference_ref(reference)?.as_str(){return Err(AwarenessStoreError::Invalid);}
    Ok(Some(AwarenessProfileChildV1 {child_ref:OpaqueId::parse(child).map_err(|_|AwarenessStoreError::Invalid)?,
        exclusion_token:Sha256Ref::parse(token).map_err(|_|AwarenessStoreError::Invalid)?}))
}

#[cfg(test)]
#[path="profile_children_tests.rs"]
mod tests;
