//! Explicit native-host registration only. No discovery, history read, browser
//! launch, extension installation or permission dialog occurs in this module.
use super::*;
use crate::luca::companion_awareness::{CompanionAwarenessRuntime,LiveAwarenessOwner};

/// First native installer supports explicit macOS Chromium user-data scopes.
/// Chrome-for-Testing 146+ uses its own root; caller must select the real root.
#[derive(Debug,Clone,Copy,PartialEq,Eq,Serialize,Deserialize)]
#[serde(rename_all="snake_case")]
pub(crate) enum BrowserSupportedKindV1 {GoogleChrome,Chromium,ChromeForTesting146Plus}
/// Body-free result; paths, bootstrap capability and user profile never escape.
#[derive(Debug,Clone,Serialize)]
pub(crate) struct BrowserInstallReceiptV1 {pub(crate) browser:BrowserSupportedKindV1,pub(crate) replaced:bool,pub(crate) manifest_ref:Sha256Ref}
/// Trusted host selection, not a renderer/model path or JSON permission token.
/// macOS native host registration is browser-user-data-wide; individual profile
/// isolation comes from separately app-paired extension instance/token authority.
pub(crate) struct BrowserInstallActorV1 {
    owner:Hex64,device:OpaqueId,kind:BrowserSupportedKindV1,user_data:PathBuf,profile:String,
    private_directory:PathBuf,executable:PathBuf,
}
impl std::fmt::Debug for BrowserInstallActorV1 {fn fmt(&self,f:&mut std::fmt::Formatter<'_>)->std::fmt::Result {
    f.debug_struct("BrowserInstallActorV1").field("kind",&self.kind).field("locators",&"[PRIVATE]").finish()}}
impl BrowserInstallActorV1 {
    /// Private host binding for a native-picker capability, not renderer data.
    pub(in crate::luca::companion_awareness) fn matches_scope(&self,owner:&Hex64,device:&OpaqueId,directory:&Path)->bool {
        &self.owner==owner && &self.device==device && self.private_directory==directory
    }
    /// Explicit native UI selection. Validate selected directory metadata only;
    /// no current-home default, profile enumeration, Preferences/history read.
    /// The executable is current_exe, never renderer/tool-selected argv.
    pub(crate) fn select(live:&LiveAwarenessOwner<'_>,runtime:&CompanionAwarenessRuntime,kind:BrowserSupportedKindV1,
        user_data:PathBuf,profile:String)->Result<Self,BrowserBridgeError> {
        let private_directory=runtime.private_directory(live.owner()).map_err(|_|BrowserBridgeError::Unavailable)?;
        let device=runtime.device(live.owner()).map_err(|_|BrowserBridgeError::Unavailable)?;
        let executable=fs::canonicalize(std::env::current_exe().map_err(|_|BrowserBridgeError::Unavailable)?).map_err(|_|BrowserBridgeError::Unavailable)?;
        let actor=Self {owner:live.owner().clone(),device,kind,user_data,profile,private_directory,executable};
        live.with_current(||actor.validate().map_err(|_|crate::luca::companion_awareness::AwarenessStoreError::Invalid))
            .map_err(|_|BrowserBridgeError::UnsafeScope)?;Ok(actor)
    }
    fn validate(&self)->Result<(),BrowserBridgeError> {
        if !cfg!(target_os="macos") || !(self.profile=="Default" || self.profile.strip_prefix("Profile ").is_some_and(|n|!n.is_empty()&&n.bytes().all(|b|b.is_ascii_digit())))
            || self.profile.len()>64 {return Err(BrowserBridgeError::UnsafeScope);}
        verify_directory(&self.user_data)?;verify_directory(&self.user_data.join(&self.profile))?;verify_directory(&self.private_directory)?;
        if !self.executable.is_absolute() || self.executable.starts_with("/Volumes") || self.executable.to_str().is_none()
            || self.executable.components().any(|c|matches!(c,Component::ParentDir|Component::CurDir)) {return Err(BrowserBridgeError::UnsafeScope);}
        let m=fs::symlink_metadata(&self.executable).map_err(|_|BrowserBridgeError::UnsafeScope)?;
        if !m.is_file() || m.file_type().is_symlink() || fs::canonicalize(&self.executable).map_err(|_|BrowserBridgeError::UnsafeScope)?!=self.executable {return Err(BrowserBridgeError::UnsafeScope);}
        #[cfg(unix)] {use std::os::unix::fs::PermissionsExt;if m.permissions().mode()&0o022!=0 || m.permissions().mode()&0o111==0 {return Err(BrowserBridgeError::UnsafeScope);}}
        Ok(())
    }
    /// Bounded fingerprint of an existing exact host manifest for an explicit
    /// UI replacement confirmation. No other native-host configs are inspected.
    pub(crate) fn existing_manifest_ref(&self)->Result<Option<Sha256Ref>,BrowserBridgeError> {
        self.validate()?;existing(&self.target())
    }
    /// Explicit owner install action; no startup caller. Existing registration
    /// may be replaced only if exact current bytes match confirmed_existing.
    /// Writes only this fixed host name and protected trusted wrapper/bootstrap.
    pub(crate) fn install(&self,live:&LiveAwarenessOwner<'_>,runtime:&CompanionAwarenessRuntime,
        confirmed_existing:Option<Sha256Ref>)->Result<BrowserInstallReceiptV1,BrowserBridgeError> {
        if live.owner()!=&self.owner || runtime.device(live.owner()).map_err(|_|BrowserBridgeError::Unavailable)?!=self.device
            || runtime.private_directory(live.owner()).map_err(|_|BrowserBridgeError::Unavailable)?!=self.private_directory {return Err(BrowserBridgeError::UnsafeScope);}
        live.with_current(||self.install_inner(confirmed_existing).map_err(|_|crate::luca::companion_awareness::AwarenessStoreError::Invalid))
            .map_err(|_|BrowserBridgeError::UnsafeScope)
    }
    fn target(&self)->PathBuf {self.user_data.join("NativeMessagingHosts").join(format!("{BROWSER_NATIVE_HOST}.json"))}
    fn install_inner(&self,confirmed_existing:Option<Sha256Ref>)->Result<BrowserInstallReceiptV1,BrowserBridgeError> {
        self.validate()?;let bootstrap=self.private_directory.join(BOOTSTRAP_FILENAME);
        BrowserNativeBootstrapV1::read(&bootstrap)?; // Requires an explicitly started app bridge.
        let target=self.target();let actual=existing(&target)?;
        if actual!=confirmed_existing {return Err(BrowserBridgeError::UnsafeScope);}
        let wrapper=self.private_directory.join("browser-native-host-v1.sh");
        let script=wrapper_bytes(&self.executable,&bootstrap)?;
        if wrapper.try_exists().map_err(|_|BrowserBridgeError::Unavailable)? {
            // Never overwrite an unrelated executable; only the previously fixed
            // app-generated script is eligible for an explicit installer refresh.
            let old=read_owned_executable(&wrapper)?;
            if !old.starts_with(b"#!/bin/sh\n# polyphonic.browser-native-wrapper.v1\n") {return Err(BrowserBridgeError::UnsafeScope);}
        }
        atomic_file(&wrapper,&script,0o700)?;
        let directory=target.parent().ok_or(BrowserBridgeError::UnsafeScope)?;
        let mut create=fs::DirBuilder::new();
        #[cfg(unix)] {use std::os::unix::fs::DirBuilderExt;create.mode(0o700);}
        match create.create(directory) {Ok(())=>{},Err(e)if e.kind()==std::io::ErrorKind::AlreadyExists=>{},Err(_)=>return Err(BrowserBridgeError::Unavailable)}
        verify_directory(directory)?;
        // Recheck confirmation after preparation, immediately before replacement.
        if existing(&target)?!=actual {return Err(BrowserBridgeError::UnsafeScope);}
        let bytes=manifest_bytes(&wrapper)?;
        if actual.is_none() {
            let mut create=fs::OpenOptions::new();create.write(true).create_new(true);
            #[cfg(unix)] {use std::os::unix::fs::OpenOptionsExt;create.mode(0o600);}
            let mut file=create.open(&target).map_err(|_|BrowserBridgeError::UnsafeScope)?;
            file.write_all(&bytes).and_then(|_|file.sync_all()).map_err(|_|BrowserBridgeError::Unavailable)?;
        } else {atomic_file(&target,&bytes,0o600)?;}
        Ok(BrowserInstallReceiptV1 {browser:self.kind,replaced:actual.is_some(),manifest_ref:secret_ref(std::str::from_utf8(&bytes).map_err(|_|BrowserBridgeError::Invalid)?)?})
    }
}
fn existing(path:&Path)->Result<Option<Sha256Ref>,BrowserBridgeError> {
    match fs::symlink_metadata(path) {Err(e)if e.kind()==std::io::ErrorKind::NotFound=>return Ok(None),Err(_)=>return Err(BrowserBridgeError::Unavailable),Ok(_)=>{}}
    let bytes=read_private(path,64*1024)?;Sha256Ref::parse(format!("sha256:{}",hex::encode(Sha256::digest(bytes)))).map(Some).map_err(|_|BrowserBridgeError::Invalid)
}
fn manifest_bytes(wrapper:&Path)->Result<Vec<u8>,BrowserBridgeError> {
    serde_json::to_vec(&serde_json::json!({"name":BROWSER_NATIVE_HOST,"description":"Polyphonic explicit browser awareness","path":wrapper,
        "type":"stdio","allowed_origins":[BROWSER_ORIGIN]})).map_err(|_|BrowserBridgeError::Invalid)
}
fn quote(path:&Path)->Result<String,BrowserBridgeError> {
    let path=path.to_str().ok_or(BrowserBridgeError::UnsafeScope)?;if path.chars().any(char::is_control) {return Err(BrowserBridgeError::UnsafeScope);}
    Ok(format!("'{}'",path.replace('\'',"'\"'\"'")))
}
fn wrapper_bytes(executable:&Path,bootstrap:&Path)->Result<Vec<u8>,BrowserBridgeError> {
    Ok(format!("#!/bin/sh\n# polyphonic.browser-native-wrapper.v1\nexec {} '{}' {} \"$@\"\n",quote(executable)?,NATIVE_ENTRY_FLAG,quote(bootstrap)?).into_bytes())
}
fn read_owned_executable(path:&Path)->Result<Vec<u8>,BrowserBridgeError> {
    let m=fs::symlink_metadata(path).map_err(|_|BrowserBridgeError::UnsafeScope)?;
    if !m.is_file() || m.file_type().is_symlink() || m.len()>8192 {return Err(BrowserBridgeError::UnsafeScope);}
    #[cfg(unix)] {use std::os::unix::fs::{MetadataExt,PermissionsExt};if m.nlink()!=1 || m.permissions().mode()&0o777!=0o700 {return Err(BrowserBridgeError::UnsafeScope);}}
    let mut options=fs::OpenOptions::new();options.read(true);
    #[cfg(unix)] {use std::os::unix::fs::OpenOptionsExt;options.custom_flags(libc::O_NOFOLLOW);}
    let mut bytes=Vec::new();options.open(path).map_err(|_|BrowserBridgeError::UnsafeScope)?.take(8193).read_to_end(&mut bytes).map_err(|_|BrowserBridgeError::Unavailable)?;Ok(bytes)
}
#[cfg(test)]
#[path="installer_tests.rs"]
mod tests;
