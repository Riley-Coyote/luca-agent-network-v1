//! Explicit private profile metadata only. Opening restores OFF; no home lookup,
//! source read, history scan, watcher, grant or model is created by this catalogue.
use super::{native_profile::{NativeProfileKindV1,NativeProfileObservationClassV1,NativeProfileSelectionV1},
    AwarenessGrantKeyV1,AwarenessSourceKeyV1,AwarenessStoreError,LiveAwarenessOwner};
use luca_protocol::{Hex64,OpaqueId,SafeU53};
use serde::{Deserialize,Serialize};
use std::{fs,io::{Read,Write},path::{Component,Path,PathBuf},collections::HashSet};

pub(crate) const PROFILE_CATALOG_FILENAME:&str="native-profiles-v1.json";
const PROTOCOL:&str="polyphonic.awareness-native-profiles.v1";
const MAX_PROFILES:usize=32;
const MAX_BYTES:usize=256*1024;

/// Host-owned selection, not renderer permission. Optional config is explicitly
/// chosen metadata only; neither a native home nor credentials are discovered.
#[derive(Clone,PartialEq,Eq)]
pub(crate) struct NativeProfileRegistrationV1 {
    pub(crate) selection:NativeProfileSelectionV1,
    pub(crate) profile_config:Option<PathBuf>,
    /// Set only by the explicit chat-led follow approval. Not itself a grant.
    pub(crate) follow_on_launch:bool,
}
impl std::fmt::Debug for NativeProfileRegistrationV1 {
    fn fmt(&self,f:&mut std::fmt::Formatter<'_>)->std::fmt::Result {
        f.debug_struct("NativeProfileRegistrationV1").field("key",self.selection.grant_key())
            .field("kind",&self.selection.kind()).field("class",&self.selection.class())
            .field("locators",&"[REDACTED]").finish()
    }
}
#[derive(Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
struct SavedProfile {resident:Hex64,source:OpaqueId,root:PathBuf,kind:NativeProfileKindV1,
    class:NativeProfileObservationClassV1,profile_config:Option<PathBuf>,
    #[serde(default)] follow_on_launch:bool}
#[derive(Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {protocol:String,owner:Hex64,device:OpaqueId,revision:SafeU53,profiles:Vec<SavedProfile>}
impl Manifest {
    fn registration(&self,p:&SavedProfile)->Result<NativeProfileRegistrationV1,AwarenessStoreError> {
        pure_locator(&p.root)?;
        let expected=match p.kind {NativeProfileKindV1::CodexSessions=>"sessions",NativeProfileKindV1::ClaudeProjects=>"projects"};
        if p.root.file_name().and_then(|s|s.to_str())!=Some(expected){return Err(AwarenessStoreError::Invalid);}
        if let Some(config)=&p.profile_config {pure_locator(config)?;}
        Ok(NativeProfileRegistrationV1 {selection:NativeProfileSelectionV1::new(AwarenessGrantKeyV1 {
            source:AwarenessSourceKeyV1 {owner_pubkey:self.owner.clone(),source_id:p.source.clone(),device_id:self.device.clone()},
            resident_pubkey:p.resident.clone()},p.root.clone(),p.kind,p.class)?,profile_config:p.profile_config.clone(),follow_on_launch:p.follow_on_launch})
    }
    fn validate(&self,owner:&Hex64,device:&OpaqueId)->Result<(),AwarenessStoreError> {
        if self.protocol!=PROTOCOL || &self.owner!=owner || &self.device!=device || self.revision.get()==0 || self.profiles.len()>MAX_PROFILES {
            return Err(AwarenessStoreError::Invalid);
        }
        let mut seen=HashSet::new();
        for profile in &self.profiles {self.registration(profile)?;
            if !seen.insert((profile.resident.clone(),profile.source.clone())){return Err(AwarenessStoreError::Invalid);}}
        Ok(())
    }
}

pub(crate) struct NativeProfileCatalogV1 {path:PathBuf,owner:Hex64,device:OpaqueId,saved:Option<Manifest>}
impl NativeProfileCatalogV1 {
    /// Fixed private internal path; unrecognized files are never adopted/repaired.
    pub(crate) fn open(directory:&Path,owner:&Hex64,device:&OpaqueId)->Result<Self,AwarenessStoreError> {
        let path=directory.join(PROFILE_CATALOG_FILENAME);let saved=read_manifest(&path,owner,device)?;
        Ok(Self {path,owner:owner.clone(),device:device.clone(),saved})
    }
    /// Metadata-only explicit choices. Callers must keep every returned handle OFF.
    pub(crate) fn profiles(&self,resident:&Hex64)->Result<Vec<NativeProfileRegistrationV1>,AwarenessStoreError> {
        self.ensure_current()?;match &self.saved {None=>Ok(Vec::new()),Some(m)=>m.profiles.iter()
            .filter(|p|&p.resident==resident).map(|p|m.registration(p)).collect()}
    }
    /// Exact immutable saved selection only, never source health or consent.
    pub(crate) fn contains(&self,selection:&NativeProfileSelectionV1)->Result<bool,AwarenessStoreError> {
        Ok(self.profiles(&selection.grant_key().resident_pubkey)?.iter().any(|p|&p.selection==selection))
    }
    /// Verify only explicit locator metadata again at Resume, never source bytes.
    pub(super) fn verify_metadata(registration:&NativeProfileRegistrationV1)->Result<(),AwarenessStoreError> {
        metadata_locator(registration.selection.transcript_root(),true)?;
        if let Some(config)=&registration.profile_config {metadata_locator(config,false)?;}
        Ok(())
    }
    /// Explicit current-owner selection. Validate FS metadata only; never open a
    /// transcript/config body or enable a watcher/grant while saving.
    pub(crate) fn select(&mut self,live:&LiveAwarenessOwner<'_>,registration:NativeProfileRegistrationV1)->Result<(),AwarenessStoreError> {
        if live.owner()!=&self.owner || registration.selection.grant_key().source.owner_pubkey!=self.owner
            || registration.selection.grant_key().source.device_id!=self.device {return Err(AwarenessStoreError::Invalid);}
        live.with_current(|| {metadata_locator(registration.selection.transcript_root(),true)?;
            if let Some(config)=&registration.profile_config {metadata_locator(config,false)?;}
            self.save_registration(registration)})
    }
    fn save_registration(&mut self,registration:NativeProfileRegistrationV1)->Result<(),AwarenessStoreError> {
        self.ensure_current()?;
        let mut next=self.saved.clone().unwrap_or(Manifest {protocol:PROTOCOL.into(),owner:self.owner.clone(),device:self.device.clone(),
            revision:SafeU53::new(1).map_err(|_|AwarenessStoreError::Invalid)?,profiles:Vec::new()});
        let key=registration.selection.grant_key();
        let entry=SavedProfile {resident:key.resident_pubkey.clone(),source:key.source.source_id.clone(),root:registration.selection.transcript_root().to_path_buf(),
            kind:registration.selection.kind(),class:registration.selection.class(),profile_config:registration.profile_config,follow_on_launch:registration.follow_on_launch};
        if let Some(prior)=next.profiles.iter().find(|p|p.resident==entry.resident && p.source==entry.source) {
            if prior==&entry {return Ok(());}
            let mut same_locator=prior.clone();same_locator.follow_on_launch=entry.follow_on_launch;
            if same_locator!=entry {return Err(AwarenessStoreError::Conflict);}
            next.profiles.retain(|p|p.resident!=entry.resident || p.source!=entry.source);
        }
        if next.profiles.len()==MAX_PROFILES {return Err(AwarenessStoreError::Capacity);}
        if self.saved.is_some(){next.revision=SafeU53::new(next.revision.get().checked_add(1).ok_or(AwarenessStoreError::Capacity)?).map_err(|_|AwarenessStoreError::Capacity)?;}
        next.profiles.push(entry);next.validate(&self.owner,&self.device)?;self.write(&next)?;self.saved=Some(next);Ok(())
    }
    /// Configuration removal is narrowing only; durable grant/source withdrawal
    /// and owned watcher stop must precede this host call.
    pub(crate) fn remove(&mut self,owner:&Hex64,key:&AwarenessGrantKeyV1)->Result<(),AwarenessStoreError> {
        if owner!=&self.owner || key.source.owner_pubkey!=self.owner || key.source.device_id!=self.device {return Err(AwarenessStoreError::Invalid);}
        self.ensure_current()?;let Some(mut next)=self.saved.clone() else{return Ok(());};
        let before=next.profiles.len();next.profiles.retain(|p|p.resident!=key.resident_pubkey || p.source!=key.source.source_id);
        if before==next.profiles.len(){return Ok(());}
        next.revision=SafeU53::new(next.revision.get().checked_add(1).ok_or(AwarenessStoreError::Capacity)?).map_err(|_|AwarenessStoreError::Capacity)?;
        self.write(&next)?;self.saved=Some(next);Ok(())
    }
    fn ensure_current(&self)->Result<(),AwarenessStoreError> {
        if read_manifest(&self.path,&self.owner,&self.device)?!=self.saved {return Err(AwarenessStoreError::Conflict);}Ok(())
    }
    fn write(&self,next:&Manifest)->Result<(),AwarenessStoreError> {
        self.ensure_current()?;validate_catalog_path(&self.path)?;
        let bytes=serde_json::to_vec(next).map_err(|_|AwarenessStoreError::Invalid)?;
        if bytes.len()>MAX_BYTES {return Err(AwarenessStoreError::Capacity);}
        let parent=self.path.parent().ok_or(AwarenessStoreError::UnsafePath)?;
        let temp=parent.join(format!(".native-profiles-{}.tmp",uuid::Uuid::new_v4()));
        let mut options=fs::OpenOptions::new();options.write(true).create_new(true);
        #[cfg(unix)]{use std::os::unix::fs::OpenOptionsExt;options.mode(0o600);}
        let mut file=options.open(&temp).map_err(|_|AwarenessStoreError::Unavailable)?;
        let result=(||{file.write_all(&bytes).map_err(|_|AwarenessStoreError::Unavailable)?;file.sync_all().map_err(|_|AwarenessStoreError::Unavailable)?;
            self.ensure_current()?;fs::rename(&temp,&self.path).map_err(|_|AwarenessStoreError::Unavailable)?;
            fs::File::open(parent).and_then(|f|f.sync_all()).map_err(|_|AwarenessStoreError::Unavailable)})();
        if result.is_err(){let _=fs::remove_file(&temp);}result
    }
}
fn pure_locator(path:&Path)->Result<(),AwarenessStoreError> {
    if !path.is_absolute() || path.starts_with("/Volumes") || path.to_str().is_none() || path.as_os_str().as_encoded_bytes().len()>4096
        || path.components().any(|p|matches!(p,Component::ParentDir|Component::CurDir))
        || path.to_string_lossy().chars().any(char::is_control) {return Err(AwarenessStoreError::UnsafePath);}Ok(())
}
fn metadata_locator(path:&Path,directory:bool)->Result<(),AwarenessStoreError> {
    pure_locator(path)?;let metadata=fs::symlink_metadata(path).map_err(|_|AwarenessStoreError::Unavailable)?;
    if metadata.file_type().is_symlink() || metadata.is_dir()!=directory || (!directory && !metadata.is_file())
        || fs::canonicalize(path).map_err(|_|AwarenessStoreError::Unavailable)?!=path {return Err(AwarenessStoreError::UnsafePath);}Ok(())
}
fn validate_catalog_path(path:&Path)->Result<(),AwarenessStoreError> {
    pure_locator(path)?;if path.file_name().and_then(|s|s.to_str())!=Some(PROFILE_CATALOG_FILENAME){return Err(AwarenessStoreError::UnsafePath);}
    let parent=path.parent().ok_or(AwarenessStoreError::UnsafePath)?;metadata_locator(parent,true)?;
    #[cfg(unix)]{use std::os::unix::fs::PermissionsExt; if fs::metadata(parent).map_err(|_|AwarenessStoreError::UnsafePath)?.permissions().mode()&0o777!=0o700 {return Err(AwarenessStoreError::UnsafePath);}}
    match fs::symlink_metadata(path) {
        Ok(m)=>{if !m.is_file() || m.file_type().is_symlink(){return Err(AwarenessStoreError::UnsafePath);}
            #[cfg(unix)]{use std::os::unix::fs::{MetadataExt,PermissionsExt};if m.nlink()!=1 || m.permissions().mode()&0o777!=0o600
                || m.uid()!=fs::metadata(parent).map_err(|_|AwarenessStoreError::UnsafePath)?.uid() {return Err(AwarenessStoreError::UnsafePath);}}}
        Err(e)if e.kind()==std::io::ErrorKind::NotFound=>{},Err(_)=>return Err(AwarenessStoreError::UnsafePath)}Ok(())
}
fn read_manifest(path:&Path,owner:&Hex64,device:&OpaqueId)->Result<Option<Manifest>,AwarenessStoreError> {
    validate_catalog_path(path)?;let mut options=fs::OpenOptions::new();options.read(true);
    #[cfg(unix)] {use std::os::unix::fs::OpenOptionsExt;options.custom_flags(libc::O_NOFOLLOW);}
    let mut file=match options.open(path){Ok(f)=>f,Err(e)if e.kind()==std::io::ErrorKind::NotFound=>return Ok(None),Err(_)=>return Err(AwarenessStoreError::Unavailable)};
    #[cfg(unix)] {use std::os::unix::fs::{MetadataExt,PermissionsExt};let opened=file.metadata().map_err(|_|AwarenessStoreError::UnsafePath)?;
        let current=fs::symlink_metadata(path).map_err(|_|AwarenessStoreError::UnsafePath)?;
        if !opened.is_file() || opened.nlink()!=1 || opened.permissions().mode()&0o777!=0o600 || opened.dev()!=current.dev() || opened.ino()!=current.ino() || opened.uid()!=current.uid() {
            return Err(AwarenessStoreError::UnsafePath);
        }}
    let mut bytes=Vec::new();Read::by_ref(&mut file).take((MAX_BYTES+1)as u64).read_to_end(&mut bytes).map_err(|_|AwarenessStoreError::Unavailable)?;
    if bytes.len()>MAX_BYTES {return Err(AwarenessStoreError::Capacity);}
    let manifest:Manifest=serde_json::from_slice(&bytes).map_err(|_|AwarenessStoreError::Invalid)?;
    manifest.validate(owner,device)?;Ok(Some(manifest))
}

#[cfg(test)]
#[path="profile_catalog_tests.rs"]
mod tests;
