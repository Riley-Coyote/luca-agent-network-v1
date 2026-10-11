//! Explicit container lifecycle and event-only native following. No native home
//! discovery, transcript enumeration, history backfill or polling is performed.
use super::*;
use crate::data_dir::BuzzPathExt;
use crate::luca::companion_awareness::native_profile::NativeProfileKindV1;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Deserialize;
use std::{collections::HashSet, fs, io::{BufRead, BufReader, Read}, path::Path};

/// Concrete desktop bindings from the explicit saved catalogue and app-owned
/// complete purpose ledger. Missing/corrupt/late facts are unavailable, not empty.
pub(crate) fn desktop_source_bindings() -> SourceRuntimeBindingsV1 {
    SourceRuntimeBindingsV1 {
        profile_selection_is_saved: Arc::new(|state, selection| {
            let runtime = &state.companion_awareness;
            let owner = &selection.grant_key().source.owner_pubkey;
            let Ok(directory) = runtime.private_directory(owner) else {return false;};
            let Ok(device) = runtime.device(owner) else {return false;};
            NativeProfileCatalogV1::open(&directory, owner, &device)
                .and_then(|catalog| catalog.contains(selection)).unwrap_or(false)
        }),
        profile_purpose: Arc::new(|state, selection, now| {
            let deadline = Instant::now().checked_add(Duration::from_secs(1))?;
            let excluded = complete_exclusions(state, family(selection.kind()), deadline).ok()?;
            if Instant::now() >= deadline {return None;}
            NativeProfilePurposeFactsV1::new(selection, now.clone(), excluded).ok()
        }),
        exact_exclusions: Arc::new(|state, _, class, _| {
            let family = match class {
                SelectedSourceClassV1::SelectedFile => return Some(HashSet::new()),
                SelectedSourceClassV1::CodexSessionMetadata | SelectedSourceClassV1::CodexSessionVisibleExcerpts => "codex",
                SelectedSourceClassV1::ClaudeSessionMetadata | SelectedSourceClassV1::ClaudeSessionVisibleExcerpts => "claude_code",
            };
            complete_exclusions(state, family, Instant::now().checked_add(Duration::from_secs(1))?).ok()
        }),
        ..Default::default()
    }
}
pub(super) fn family(kind: NativeProfileKindV1) -> &'static str {
    match kind {NativeProfileKindV1::CodexSessions => "codex", NativeProfileKindV1::ClaudeProjects => "claude_code"}
}

impl CompanionSourceRuntimeV1 {
    /// Restart only chat-approved following. This never creates grants, changes
    /// a paused state, rebinds provider consent, or starts other source classes.
    pub(crate) fn restore_following(&self, app:&AppHandle, resident:&Hex64) -> Result<(),AwarenessStoreError> {
        let state=app.state::<AppState>();
        let live=LiveAwarenessOwner::authenticate(&state)?;
        if state.companion_awareness.resident_state(live.owner(),resident)?.paused {return Ok(());}
        let binding=crate::luca::managed_cognition::active_binding_ref(resident).map_err(|_|AwarenessStoreError::Unavailable)?;
        for registration in self.list_profiles(live.owner(),resident)? {
            if !registration.follow_on_launch {continue;}
            let key=registration.selection.grant_key();
            if state.companion_awareness.recheck_native_history_choice(live.owner(),key,&binding).is_err() {continue;}
            let now=crate::luca::continuity_jobs::current_canonical_timestamp().map_err(|_|AwarenessStoreError::Unavailable)?;
            if self.snapshot(live.owner(),resident,&now)?.collecting.contains(key) {continue;}
            // resume_profile rechecks live identity, Pause, current source/grant,
            // locator health and private-session exclusions before any capture.
            self.resume_profile(&live,registration.selection)?;
        }
        Ok(())
    }
    /// Save only an explicitly chosen container/class. Does not register a source,
    /// grant, read, watch or resume it. Parent source/grant commands remain separate.
    pub(crate) fn select_profile(&self, live: &LiveAwarenessOwner<'_>, registration: NativeProfileRegistrationV1)
        -> Result<(), AwarenessStoreError> {
        self.call(live.owner(), |reply| Command::SelectProfile(registration, reply))
    }
    /// Metadata inventory only; all restored profiles remain OFF until Resume.
    pub(crate) fn list_profiles(&self, owner: &Hex64, resident: &Hex64)
        -> Result<Vec<NativeProfileRegistrationV1>, AwarenessStoreError> {
        self.call(owner, |reply| Command::InspectProfiles(resident.clone(), reply))
    }
    /// Explicit current-owner Resume for one saved profile grant/class. There is
    /// no synthetic initial child event, scan or historical capture on startup.
    pub(crate) fn resume_profile(&self, live: &LiveAwarenessOwner<'_>, selection: NativeProfileSelectionV1)
        -> Result<(), AwarenessStoreError> {
        self.call(live.owner(), |reply| Command::Profile(selection, reply))
    }
    /// Backward-compatible host seam, now requires the durable explicit selection.
    pub(crate) fn register_profile(&self, live: &LiveAwarenessOwner<'_>, selection: NativeProfileSelectionV1)
        -> Result<(), AwarenessStoreError> { self.resume_profile(live, selection) }
    /// Narrow metadata removal after the parent's durable grant/source withdrawal.
    pub(crate) fn remove_profile(&self, owner: &Hex64, key: &AwarenessGrantKeyV1)
        -> Result<(), AwarenessStoreError> {
        self.after_grant_withdrawal(owner,key)?;
        self.call(owner, |reply| Command::RemoveProfile(key.clone(),reply))
    }
    /// Host notification only; bounded queue/wake, never actor wait or source read.
    pub(crate) fn profile_changed(&self, owner: &Hex64, key: &AwarenessGrantKeyV1, relative: String)
        -> Result<(), AwarenessStoreError> {
        if relative.len()>4096 || &key.source.owner_pubkey!=owner {return Err(AwarenessStoreError::Invalid);}
        let inner=self.inner.lock().map_err(|_|AwarenessStoreError::Unavailable)?;
        let handle=inner.as_ref().ok_or(AwarenessStoreError::Unavailable)?;
        if &handle.owner!=owner || handle.device!=key.source.device_id || handle.shared.closing.load(Ordering::Acquire) {
            return Err(AwarenessStoreError::Invalid);
        }
        enqueue_child(&handle.commands,&handle.shared,key,relative)
    }
}
fn enqueue_child(commands:&mpsc::SyncSender<Envelope>,shared:&Shared,key:&AwarenessGrantKeyV1,relative:String)
    -> Result<(),AwarenessStoreError> {
    commands.try_send(Envelope {deadline:Instant::now()+COMMAND_DEADLINE,cancelled:Arc::new(AtomicBool::new(false)),
        command:Command::ProfileChanged(key.clone(),relative)}).map_err(|e|match e {
            mpsc::TrySendError::Full(_)=>AwarenessStoreError::Capacity,_=>AwarenessStoreError::Unavailable})?;
    let _=shared.wake.try_send(());Ok(())
}

impl SourceEngine {
    pub(super) fn register_profile(&mut self,state:&AppState,selection:NativeProfileSelectionV1,now:&CanonicalTimestamp)
        -> Result<(),AwarenessStoreError> {
        let key=selection.grant_key().clone();
        if !self.key_current(&key) || !(self.bindings.profile_selection_is_saved)(state,&selection) {
            return Err(AwarenessStoreError::Invalid);
        }
        let registration=self.profile_catalog.as_ref().map_err(|e|*e)?.profiles(&key.resident_pubkey)?
            .into_iter().find(|r|r.selection==selection).ok_or(AwarenessStoreError::Missing)?;
        NativeProfileCatalogV1::verify_metadata(&registration)?;
        if (self.bindings.profile_purpose)(state,&selection,now).is_none() {return Err(AwarenessStoreError::Unavailable);}
        let active=self.shared.facts.lock().map_err(|_|AwarenessStoreError::Unavailable)?.active.clone();
        if !active.contains(&key) && active.len()>=MAX_ACTIVE_SCOPES {return Err(AwarenessStoreError::Capacity);}
        let live=self.authenticate(state)?;
        state.companion_awareness.with_granted_source_read(&live,&key, |_|Ok(()))?;
        self.apply_stop(&state.companion_awareness,&StopScope::Grant(key.clone()))?;
        let current=state.companion_awareness.snapshot(&self.owner,&key)?;
        if current.source.state!=luca_protocol::AwarenessSourceStateV1::Unknown {
            state.companion_awareness.set_source_health(&live,&key.source,current.source_revision,
                luca_protocol::AwarenessSourceStateV1::Unknown,&OpaqueId::parse(format!("profile-resume-{}",uuid::Uuid::new_v4())).map_err(|_|AwarenessStoreError::Invalid)?)?;
        }
        let fault=Arc::new(AtomicBool::new(false));
        let watcher=state.companion_awareness.with_granted_source_read(&live,&key, |_| {
            NativeProfileCatalogV1::verify_metadata(&registration)?;
            start_watcher(&selection,&self.commands,&self.shared,&fault)
        })?;
        let mut adapter=NativeProfileAdapter::new(selection);adapter.set_enabled(true);
        self.profiles.push(ProfileCollector {adapter,pending:VecDeque::new(),_watcher:watcher,fault});
        self.active(&key,true)
    }
    pub(super) fn profile_event(&mut self,key:&AwarenessGrantKeyV1,locator:String)->Result<(),AwarenessStoreError> {
        if !self.key_current(key) || locator.len()>4096 {return Err(AwarenessStoreError::Invalid);}
        if !self.shared.facts.lock().map_err(|_|AwarenessStoreError::Unavailable)?.active.contains(key) {
            return Err(AwarenessStoreError::Missing);
        }
        let profile=self.profiles.iter_mut().find(|p|p.adapter.selection().grant_key()==key).ok_or(AwarenessStoreError::Missing)?;
        let child=profile.adapter.selection().changed_child_ref(&locator)?;
        let existing=profile.pending.iter().position(|p|p.child==child);
        if existing.is_none() && profile.pending.len()==MAX_PENDING_PROFILE_CHILDREN {return Err(AwarenessStoreError::Capacity);}
        profile.adapter.mark_changed(&locator)?;
        if let Some(index)=existing {profile.pending.remove(index);}
        profile.pending.push_back(ChangedProfileChild {child,changed_at:Instant::now()});Ok(())
    }
    pub(super) fn sample_profiles(&mut self,state:&AppState,now:&CanonicalTimestamp) {
        let failed=self.profiles.iter().filter(|p|p.fault.load(Ordering::Acquire))
            .map(|p|p.adapter.selection().grant_key().clone()).collect::<Vec<_>>();
        for key in failed {let _=self.apply_stop(&state.companion_awareness,&StopScope::Grant(key));}
        for profile in &mut self.profiles {
            if profile.pending.front().is_none_or(|p|p.changed_at.elapsed()<DEBOUNCE) {continue;}
            let Some(pending)=profile.pending.pop_front() else {continue;};
            let key=profile.adapter.selection().grant_key().clone();
            let saved=(self.bindings.profile_selection_is_saved)(state,profile.adapter.selection());
            let purpose=(self.bindings.profile_purpose)(state,profile.adapter.selection(),now);
            let activity=(self.bindings.activity)(state,&key,Some(&pending.child),now);
            let result=if saved {profile.adapter.sample_one(state,&state.companion_awareness,now,purpose.as_ref(),activity.as_ref())}
                else {profile.adapter.set_enabled(false);profile.pending.clear();profile.fault.store(true,Ordering::Release);Err(AwarenessStoreError::Invalid)};
            if let Ok(mut facts)=self.shared.facts.lock() {
                match result {
                    Ok(NativeProfileSamplingOutcomeV1::Sampled {session_ref,outcome:SamplingOutcomeV1::Admitted(reference)}) =>
                        facts.remember(reference,SourceMaterialScopeV1::ProfileChild(session_ref)),
                    Ok(NativeProfileSamplingOutcomeV1::Excluded {session_ref}) => facts.child_state(&key,&session_ref,AwarenessMaterialStateV1::Excluded),
                    Ok(NativeProfileSamplingOutcomeV1::Sampled {outcome:SamplingOutcomeV1::Unchanged,..}) => {},
                    _=>facts.child_state(&key,&pending.child,AwarenessMaterialStateV1::Unavailable),
                }
                if !saved {facts.invalidate(&StopScope::Grant(key.clone()));facts.active.retain(|k|k!=&key);}
            }
        }
    }
}

fn relevant_children(event:&Event,selection:&NativeProfileSelectionV1)->Vec<String> {
    if !matches!(event.kind,EventKind::Any|EventKind::Create(_)|EventKind::Modify(_)|EventKind::Remove(_)) || event.paths.len()>32 {
        return Vec::new();
    }
    event.paths.iter().filter_map(|p|p.strip_prefix(selection.transcript_root()).ok()?.to_str())
        .filter(|p|selection.changed_child_ref(p).is_ok()).map(str::to_owned).collect()
}
fn scope_gap(event:&Event,selection:&NativeProfileSelectionV1)->bool {
    event.need_rescan() || event.paths.len()>32 || (event.paths.iter().any(|p|p==selection.transcript_root())
        && matches!(event.kind,EventKind::Remove(_)|EventKind::Modify(notify::event::ModifyKind::Name(_))))
}
fn start_watcher(selection:&NativeProfileSelectionV1,commands:&mpsc::SyncSender<Envelope>,shared:&Arc<Shared>,fault:&Arc<AtomicBool>)
    -> Result<RecommendedWatcher,AwarenessStoreError> {
    // This first connector is macOS/FSEvents. Do not pretend backends which
    // enumerate directory trees to install recursive watches meet this contract.
    if !cfg!(target_os="macos") {return Err(AwarenessStoreError::Unavailable);}
    let watched=selection.clone();let commands=commands.clone();let shared=Arc::clone(shared);let fault=Arc::clone(fault);
    let mut watcher=RecommendedWatcher::new(move |event:notify::Result<Event>| {
        if shared.closing.load(Ordering::Acquire) || fault.load(Ordering::Acquire) {return;}
        let result=match event {
            Ok(event) if scope_gap(&event,&watched) => Err(AwarenessStoreError::Unavailable),
            Ok(event)=>relevant_children(&event,&watched).into_iter().try_for_each(|relative|enqueue_child(&commands,&shared,watched.grant_key(),relative)),
            Err(_)=>Err(AwarenessStoreError::Unavailable),
        };
        if result.is_err() {
            fault.store(true,Ordering::Release);
            if let Ok(mut facts)=shared.facts.lock() {let key=watched.grant_key();facts.invalidate(&StopScope::Grant(key.clone()));facts.active.retain(|k|k!=key);}
            let _=shared.wake.try_send(());
        }
    },Config::default()).map_err(|_|AwarenessStoreError::Unavailable)?;
    watcher.watch(selection.transcript_root(),RecursiveMode::Recursive).map_err(|_|AwarenessStoreError::Unavailable)?;Ok(watcher)
}

#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct PurposeRecord {
    protocol:String,provider_session_id:String,runtime_family:String,purpose:String,
    // Existing native host writer fields, never exposed as companion context.
    app_session_id:Option<String>,resident_pubkey:Option<Hex64>,runtime_binding_ref:Option<String>,
    session_epoch:Option<u64>,created_at:Option<String>,terminal_status:Option<String>,cleanup_status:Option<String>,
}
pub(super) fn complete_exclusions(state:&AppState,family:&str,deadline:Instant)->Result<HashSet<String>,AwarenessStoreError> {
    let app=state.app_handle.lock().map_err(|_|AwarenessStoreError::Unavailable)?.clone().ok_or(AwarenessStoreError::Unavailable)?;
    read_complete_exclusions(&app.buzz_path().app_data_dir().map_err(|_|AwarenessStoreError::Unavailable)?,family,deadline)
}
/// Read only Polyphonic's body-free ledger, not a native profile or transcript.
/// Partial/truncated/unknown records deny; no best-effort skipped exclusion set.
pub(super) fn read_complete_exclusions(app_data:&Path,family:&str,deadline:Instant)->Result<HashSet<String>,AwarenessStoreError> {
    if !matches!(family,"codex"|"claude_code") || Instant::now()>=deadline {return Err(AwarenessStoreError::Unavailable);}
    let directory=app_data.join("luca/runtime-session-purposes");
    let metadata=fs::symlink_metadata(&directory).map_err(|_|AwarenessStoreError::Unavailable)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() || fs::canonicalize(&directory).map_err(|_|AwarenessStoreError::Unavailable)?!=directory {
        return Err(AwarenessStoreError::UnsafePath);
    }
    let mut excluded=HashSet::new();let mut total=0_usize;
    for (index,entry) in fs::read_dir(&directory).map_err(|_|AwarenessStoreError::Unavailable)?.enumerate() {
        if index>=512 || Instant::now()>=deadline {return Err(AwarenessStoreError::Unavailable);}
        let entry=entry.map_err(|_|AwarenessStoreError::Unavailable)?;let path=entry.path();
        if path.extension().and_then(|s|s.to_str())!=Some("jsonl") {continue;}
        let m=fs::symlink_metadata(&path).map_err(|_|AwarenessStoreError::Unavailable)?;
        if !m.is_file() || m.file_type().is_symlink() {return Err(AwarenessStoreError::UnsafePath);}
        #[cfg(unix)] {use std::os::unix::fs::{MetadataExt,PermissionsExt};if m.nlink()!=1 || m.uid()!=metadata.uid() || m.permissions().mode()&0o077!=0 || metadata.permissions().mode()&0o077!=0 {return Err(AwarenessStoreError::UnsafePath);}}
        let mut options=fs::OpenOptions::new();options.read(true);
        #[cfg(unix)] {use std::os::unix::fs::OpenOptionsExt;options.custom_flags(libc::O_NOFOLLOW);}
        let file=options.open(&path).map_err(|_|AwarenessStoreError::Unavailable)?;
        #[cfg(unix)] {use std::os::unix::fs::{MetadataExt,PermissionsExt};let opened=file.metadata().map_err(|_|AwarenessStoreError::UnsafePath)?;
            if opened.dev()!=m.dev() || opened.ino()!=m.ino() || opened.uid()!=metadata.uid() || opened.nlink()!=1 || opened.permissions().mode()&0o777!=0o600 {return Err(AwarenessStoreError::UnsafePath);}}
        let mut reader=BufReader::new(file);
        loop {
            if Instant::now()>=deadline {return Err(AwarenessStoreError::Unavailable);}
            let mut line=String::new();let length=reader.by_ref().take(16*1024+1).read_line(&mut line).map_err(|_|AwarenessStoreError::Unavailable)?;
            if length==0 {break;}
            total=total.checked_add(length).ok_or(AwarenessStoreError::Capacity)?;
            if length>16*1024 || total>8*1024*1024 || !line.ends_with('\n') {return Err(AwarenessStoreError::Unavailable);}
            let row:PurposeRecord=serde_json::from_str(&line).map_err(|_|AwarenessStoreError::Unavailable)?;
            if row.protocol!="polyphonic.runtime-session-purpose.v1" || !matches!(row.purpose.as_str(),"resident_conversation"|"continuity_internal"|"explicit_runtime_task")
                || row.runtime_family.is_empty() || row.runtime_family.len()>64 || !row.runtime_family.bytes().all(|b|b.is_ascii_lowercase()||b.is_ascii_digit()||b==b'_')
                || row.provider_session_id.is_empty() || row.provider_session_id.len()>512 || row.provider_session_id.chars().any(char::is_control) {return Err(AwarenessStoreError::Unavailable);}
            if row.runtime_family==family && row.purpose!="explicit_runtime_task" {
                let native=uuid::Uuid::parse_str(&row.provider_session_id).map_err(|_|AwarenessStoreError::Unavailable)?;
                if native.is_nil() || native.hyphenated().to_string()!=row.provider_session_id {return Err(AwarenessStoreError::Unavailable);}
                excluded.insert(row.provider_session_id);
            }
            if excluded.len()>4096 {return Err(AwarenessStoreError::Capacity);}
        }
    }
    if Instant::now()>=deadline {return Err(AwarenessStoreError::Unavailable);}Ok(excluded)
}

#[cfg(test)]
#[path="profile_runtime_tests.rs"]
mod tests;
