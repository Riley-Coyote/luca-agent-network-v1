//! Private browser configuration, never history, page bodies or semantic memory.
//! Opening restores only host metadata. Tokens are stored hashed; only the
//! native host's separate fixed private bootstrap contains its bridge secret.
use super::browser_bridge::{BrowserBridgeError,BrowserEventKindV1,BROWSER_NATIVE_HOST};
use super::{AwarenessGrantKeyV1,AwarenessSourceKeyV1};
use luca_protocol::{canonical_sha256,Hex64,OpaqueId,SafeU53,Sha256Ref};
use serde::{Deserialize,Serialize};
use sha2::{Digest,Sha256};
use std::{collections::HashSet,fs,io::{Read,Write},path::{Component,Path,PathBuf}};

pub(crate) const BROWSER_ORIGIN:&str="chrome-extension://cgeconjecinkbflofoimhcegaiebecgg/";
pub(crate) const NATIVE_ENTRY_FLAG:&str="--polyphonic-browser-awareness-native-host";
const CATALOG_FILENAME:&str="browser-pairings-v1.json";
pub(crate) const BOOTSTRAP_FILENAME:&str="browser-native-host-v1.json";
const MAX_CONFIG_BYTES:usize=256*1024;
const MAX_PAIRINGS:usize=32;
pub(crate) const KINDS:[BrowserEventKindV1;3]=[BrowserEventKindV1::Visit,BrowserEventKindV1::Bookmark,BrowserEventKindV1::Excerpt];

/// Immutable, owner-approved host site policy. Native Chrome site permission
/// remains separate; no empty/default policy can admit every website.
#[derive(Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct BrowserSitePolicyV1 {allowed:Vec<String>,excluded:Vec<String>}
impl BrowserSitePolicyV1 {
    /// Explicit exact origins only, no wildcard, path, userinfo, query or fragment.
    pub(crate) fn new(mut allowed:Vec<String>,mut excluded:Vec<String>)->Result<Self,BrowserBridgeError> {
        allowed.sort();allowed.dedup();excluded.sort();excluded.dedup();
        if allowed.is_empty() || allowed.len()>32 || excluded.len()>32 || allowed.iter().chain(&excluded).any(|s|exact_origin(s).is_err()) {
            return Err(BrowserBridgeError::UnsafeScope);
        }
        Ok(Self {allowed,excluded})
    }
    /// Pure final URL policy; sanitized native URL is still untrusted reference.
    pub(crate) fn permits(&self,url:&str)->bool {
        let Ok(url)=reqwest::Url::parse(url) else{return false;};let origin=url.origin().ascii_serialization();
        self.allowed.contains(&origin) && !self.excluded.contains(&origin)
    }
    fn validate(&self)->Result<(),BrowserBridgeError> {
        if Self::new(self.allowed.clone(),self.excluded.clone())?!=*self {return Err(BrowserBridgeError::Invalid);}Ok(())
    }
}
impl std::fmt::Debug for BrowserSitePolicyV1 {fn fmt(&self,f:&mut std::fmt::Formatter<'_>)->std::fmt::Result {f.write_str("BrowserSitePolicyV1([PRIVATE CONFIGURATION])")}}
fn exact_origin(value:&str)->Result<(),BrowserBridgeError> {
    if value.len()>2048 || value.contains('*') {return Err(BrowserBridgeError::UnsafeScope);}
    let url=reqwest::Url::parse(value).map_err(|_|BrowserBridgeError::UnsafeScope)?;
    if !matches!(url.scheme(),"https"|"http") || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some()
        || url.query().is_some() || url.fragment().is_some() || url.path()!="/" || url.origin().ascii_serialization()!=value {return Err(BrowserBridgeError::UnsafeScope);}Ok(())
}

#[derive(Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct BrowserPairingV1 {
    pub(super) profile:OpaqueId,pub(super) pairing_id:OpaqueId,pub(super) resident:Hex64,pub(super) token_ref:Sha256Ref,
    pub(super) policy:BrowserSitePolicyV1,pub(super) enabled:bool,
    pub(super) last_sequence:SafeU53,pub(super) last_event_ref:Option<Sha256Ref>,
}
impl BrowserPairingV1 {
    /// Each class/principal/profile/host-issued pairing/policy has a distinct
    /// source identity; repairs cannot inherit the old pairing's denied grants.
    pub(super) fn key(&self,owner:&Hex64,device:&OpaqueId,kind:BrowserEventKindV1)->Result<AwarenessGrantKeyV1,BrowserBridgeError> {
        let digest=canonical_sha256(&serde_json::json!(["polyphonic.browser-source.v1",owner,&self.resident,device,&self.profile,&self.pairing_id,kind,&self.policy,BROWSER_ORIGIN]))
            .map_err(|_|BrowserBridgeError::Invalid)?;
        Ok(AwarenessGrantKeyV1 {source:AwarenessSourceKeyV1 {owner_pubkey:owner.clone(),source_id:OpaqueId::parse(format!("browser-source:{digest}")).map_err(|_|BrowserBridgeError::Invalid)?,device_id:device.clone()},resident_pubkey:self.resident.clone()})
    }
}
#[derive(Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {protocol:String,owner:Hex64,device:OpaqueId,revision:SafeU53,pairs:Vec<BrowserPairingV1>}
impl Manifest {
    fn validate(&self,owner:&Hex64,device:&OpaqueId)->Result<(),BrowserBridgeError> {
        if self.protocol!="polyphonic.browser-pairings.v1" || &self.owner!=owner || &self.device!=device || self.revision.get()==0 || self.pairs.len()>MAX_PAIRINGS {return Err(BrowserBridgeError::Invalid);}
        let mut ids=HashSet::new();for pair in &self.pairs {
            if pair.resident==*owner || !valid_profile(&pair.profile) || !ids.insert(pair.profile.clone()) {return Err(BrowserBridgeError::Invalid);}
            pair.policy.validate()?;for kind in KINDS {pair.key(owner,device,kind)?;}
        }Ok(())
    }
}
pub(super) struct BrowserCatalogV1 {directory:PathBuf,owner:Hex64,device:OpaqueId,manifest:Option<Manifest>}
impl BrowserCatalogV1 {
    pub(super) fn open(directory:&Path,owner:&Hex64,device:&OpaqueId)->Result<Self,BrowserBridgeError> {
        verify_directory(directory)?;let path=directory.join(CATALOG_FILENAME);let manifest=read_optional::<Manifest>(&path,MAX_CONFIG_BYTES)?;
        if let Some(saved)=&manifest {saved.validate(owner,device)?;}
        Ok(Self {directory:directory.to_owned(),owner:owner.clone(),device:device.clone(),manifest})
    }
    pub(super) fn pairs(&self)->Result<Vec<BrowserPairingV1>,BrowserBridgeError> {self.ensure_current()?;Ok(self.manifest.as_ref().map(|m|m.pairs.clone()).unwrap_or_default())}
    pub(super) fn pair(&self,profile:&OpaqueId)->Result<BrowserPairingV1,BrowserBridgeError> {
        self.pairs()?.into_iter().find(|p|&p.profile==profile).ok_or(BrowserBridgeError::Unavailable)
    }
    pub(super) fn put(&mut self,pair:BrowserPairingV1)->Result<(),BrowserBridgeError> {
        let mut pairs=self.pairs()?;
        // A repair first needs keyless disconnect of the old pairing. Replacing
        // an enabled binding cannot quietly move it to a new companion/token.
        if let Some(prior)=pairs.iter_mut().find(|p|p.profile==pair.profile) {
            if prior.enabled {return Err(BrowserBridgeError::UnsafeScope);}*prior=pair;
        } else {if pairs.len()>=MAX_PAIRINGS {return Err(BrowserBridgeError::Unavailable);}pairs.push(pair);}
        self.save(pairs)
    }
    pub(super) fn reserve(&mut self,expected:&BrowserPairingV1,sequence:SafeU53,event_ref:&Sha256Ref)->Result<(),BrowserBridgeError> {
        let mut pairs=self.pairs()?;let pair=pairs.iter_mut().find(|p|p.profile==expected.profile).ok_or(BrowserBridgeError::Unavailable)?;
        if !pair.enabled || pair!=expected || sequence.get()<=pair.last_sequence.get() {return Err(BrowserBridgeError::UnsafeScope);}
        pair.last_sequence=sequence;pair.last_event_ref=Some(event_ref.clone());self.save(pairs)
    }
    pub(super) fn disable(&mut self,profile:&OpaqueId,resident:&Hex64)->Result<BrowserPairingV1,BrowserBridgeError> {
        let mut pairs=self.pairs()?;let pair=pairs.iter_mut().find(|p|&p.profile==profile && &p.resident==resident).ok_or(BrowserBridgeError::Unavailable)?;
        pair.enabled=false;let disabled=pair.clone();self.save(pairs)?;Ok(disabled)
    }
    fn ensure_current(&self)->Result<(),BrowserBridgeError> {
        let latest=read_optional::<Manifest>(&self.directory.join(CATALOG_FILENAME),MAX_CONFIG_BYTES)?;
        if let Some(saved)=&latest {saved.validate(&self.owner,&self.device)?;}
        if latest!=self.manifest {return Err(BrowserBridgeError::UnsafeScope);}Ok(())
    }
    fn save(&mut self,pairs:Vec<BrowserPairingV1>)->Result<(),BrowserBridgeError> {
        self.ensure_current()?;let revision=self.manifest.as_ref().map_or(1,|m|m.revision.get().saturating_add(1));
        let next=Manifest {protocol:"polyphonic.browser-pairings.v1".into(),owner:self.owner.clone(),device:self.device.clone(),revision:SafeU53::new(revision).map_err(|_|BrowserBridgeError::Unavailable)?,pairs};next.validate(&self.owner,&self.device)?;
        let bytes=serde_json::to_vec(&next).map_err(|_|BrowserBridgeError::Invalid)?;
        atomic_file(&self.directory.join(CATALOG_FILENAME),&bytes,0o600)?;self.manifest=Some(next);Ok(())
    }
}
/// Native bootstrap is local protected configuration, never extension wire.
#[derive(Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct BrowserNativeBootstrapV1 {
    protocol:String,pub(super) endpoint:PathBuf,pub(super) capability:String,
    origin:String,host_name:String,
}
impl BrowserNativeBootstrapV1 {
    pub(super) fn new(endpoint:PathBuf,capability:String)->Result<Self,BrowserBridgeError> {
        let value=Self {protocol:"polyphonic.browser-native-bootstrap.v1".into(),endpoint,capability,origin:BROWSER_ORIGIN.into(),host_name:BROWSER_NATIVE_HOST.into()};value.validate()?;Ok(value)
    }
    fn validate(&self)->Result<(),BrowserBridgeError> {
        if self.protocol!="polyphonic.browser-native-bootstrap.v1" || self.origin!=BROWSER_ORIGIN || self.host_name!=BROWSER_NATIVE_HOST
            || self.capability.len()!=64 || !self.capability.bytes().all(|b|b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
            || !self.endpoint.starts_with("/private/tmp") || self.endpoint.as_os_str().as_encoded_bytes().len()>=104
            || self.endpoint.file_name().and_then(|s|s.to_str()).is_none_or(|s|!s.starts_with("browser-")||!s.ends_with(".sock")) {return Err(BrowserBridgeError::UnsafeScope);}Ok(())
    }
    pub(super) fn write(&self,directory:&Path)->Result<PathBuf,BrowserBridgeError> {
        verify_directory(directory)?;let path=directory.join(BOOTSTRAP_FILENAME);
        if let Some(old)=read_optional::<Self>(&path,8192)? {old.validate()?;}
        atomic_file(&path,&serde_json::to_vec(self).map_err(|_|BrowserBridgeError::Invalid)?,0o600)?;Ok(path)
    }
    /// Read only the fixed private owned bootstrap; never launch/fix/create an app.
    pub(crate) fn read(path:&Path)->Result<Self,BrowserBridgeError> {
        if path.file_name().and_then(|s|s.to_str())!=Some(BOOTSTRAP_FILENAME) {return Err(BrowserBridgeError::UnsafeScope);}
        verify_directory(path.parent().ok_or(BrowserBridgeError::UnsafeScope)?)?;
        let value=read_optional::<Self>(path,8192)?.ok_or(BrowserBridgeError::Unavailable)?;value.validate()?;
        let parent=value.endpoint.parent().ok_or(BrowserBridgeError::UnsafeScope)?;verify_directory(parent)?;Ok(value)
    }
}
pub(super) fn valid_profile(profile:&OpaqueId)->bool {
    profile.as_str().strip_prefix("profile-").and_then(|s|uuid::Uuid::parse_str(s).ok().map(|id|(id,s)))
        .is_some_and(|(id,s)|!id.is_nil() && id.get_version_num()==4 && id.hyphenated().to_string()==s)
}
pub(super) fn secret_ref(secret:&str)->Result<Sha256Ref,BrowserBridgeError> {
    let digest=hex::encode(Sha256::digest(secret.as_bytes()));
    Sha256Ref::parse(format!("sha256:{digest}")).map_err(|_|BrowserBridgeError::Invalid)
}
pub(super) fn fresh_secret()->String {format!("{}{}",uuid::Uuid::new_v4().simple(),uuid::Uuid::new_v4().simple())}
pub(super) fn same_secret_ref(left:&Sha256Ref,right:&Sha256Ref)->bool {
    left.as_str().bytes().zip(right.as_str().bytes()).fold(0_u8,|different,(a,b)|different|(a^b))==0
}
pub(super) fn verify_directory(path:&Path)->Result<(),BrowserBridgeError> {
    if !path.is_absolute() || path.starts_with("/Volumes") || path.components().any(|c|matches!(c,Component::ParentDir|Component::CurDir)) {return Err(BrowserBridgeError::UnsafeScope);}
    let metadata=fs::symlink_metadata(path).map_err(|_|BrowserBridgeError::UnsafeScope)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() || fs::canonicalize(path).map_err(|_|BrowserBridgeError::UnsafeScope)?!=path {return Err(BrowserBridgeError::UnsafeScope);}
    #[cfg(unix)] {use std::os::unix::fs::PermissionsExt;if metadata.permissions().mode()&0o777!=0o700 {return Err(BrowserBridgeError::UnsafeScope);}}Ok(())
}
fn read_optional<T:serde::de::DeserializeOwned>(path:&Path,bound:usize)->Result<Option<T>,BrowserBridgeError> {
    match fs::symlink_metadata(path) {Err(e)if e.kind()==std::io::ErrorKind::NotFound=>return Ok(None),Err(_)=>return Err(BrowserBridgeError::Unavailable),Ok(_)=>{}}
    let bytes=read_private(path,bound)?;
    serde_json::from_slice(&bytes).map(Some).map_err(|_|BrowserBridgeError::Invalid)
}
pub(super) fn read_private(path:&Path,bound:usize)->Result<Vec<u8>,BrowserBridgeError> {
    let m=fs::symlink_metadata(path).map_err(|_|BrowserBridgeError::Unavailable)?;
    if !m.is_file() || m.file_type().is_symlink() || m.len()>bound as u64 {return Err(BrowserBridgeError::UnsafeScope);}
    #[cfg(unix)] {use std::os::unix::fs::{MetadataExt,PermissionsExt};let parent=fs::metadata(path.parent().ok_or(BrowserBridgeError::UnsafeScope)?).map_err(|_|BrowserBridgeError::UnsafeScope)?;
        if m.nlink()!=1 || m.uid()!=parent.uid() || m.permissions().mode()&0o777!=0o600 {return Err(BrowserBridgeError::UnsafeScope);}}
    let mut options=fs::OpenOptions::new();options.read(true);
    #[cfg(unix)] {use std::os::unix::fs::OpenOptionsExt;options.custom_flags(libc::O_NOFOLLOW);}
    let file=options.open(path).map_err(|_|BrowserBridgeError::Unavailable)?;
    #[cfg(unix)] {use std::os::unix::fs::MetadataExt;let opened=file.metadata().map_err(|_|BrowserBridgeError::UnsafeScope)?;
        if opened.dev()!=m.dev() || opened.ino()!=m.ino() || opened.nlink()!=1 {return Err(BrowserBridgeError::UnsafeScope);}}
    let mut bytes=Vec::new();file.take(bound as u64+1).read_to_end(&mut bytes).map_err(|_|BrowserBridgeError::Unavailable)?;
    if bytes.len()>bound {return Err(BrowserBridgeError::UnsafeScope);}Ok(bytes)
}
pub(super) fn atomic_file(path:&Path,bytes:&[u8],mode:u32)->Result<(),BrowserBridgeError> {
    if bytes.len()>MAX_CONFIG_BYTES {return Err(BrowserBridgeError::Unavailable);}let parent=path.parent().ok_or(BrowserBridgeError::UnsafeScope)?;verify_directory(parent)?;
    let temp=parent.join(format!(".browser-owned-{}.tmp",uuid::Uuid::new_v4()));let mut options=fs::OpenOptions::new();options.write(true).create_new(true);
    #[cfg(unix)] {use std::os::unix::fs::OpenOptionsExt;options.mode(mode);}
    let mut file=options.open(&temp).map_err(|_|BrowserBridgeError::Unavailable)?;
    file.write_all(bytes).and_then(|_|file.sync_all()).map_err(|_|BrowserBridgeError::Unavailable)?;
    fs::rename(&temp,path).map_err(|_|BrowserBridgeError::Unavailable)?;
    fs::File::open(parent).and_then(|f|f.sync_all()).map_err(|_|BrowserBridgeError::Unavailable)?;Ok(())
}

#[path="browser_configuration/installer.rs"]
mod installer;
pub(crate) use installer::{BrowserInstallActorV1,BrowserInstallReceiptV1,BrowserSupportedKindV1};
#[cfg(test)]
#[path="browser_configuration_tests.rs"]
pub(crate) mod tests;
