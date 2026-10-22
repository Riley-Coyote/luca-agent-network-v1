//! Owner settings entry to the same discovered-profile follow operation as chat.
//! No renderer paths, permission choices, runtime binding, or conversation scope.
use std::path::PathBuf;

use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

use super::{
    companion::{managed_resident, projection, CompanionAwarenessStatusV1},
    companion_configuration::{
        already_following, discovered_root, follow_approval_state, follow_approved,
        follow_disclosure, follow_expected, FollowExpected, FollowTarget, Harness,
    },
};
use crate::{
    app_state::AppState,
    luca::{
        companion_awareness::{native_profile::NativeProfileKindV1, LiveAwarenessOwner},
        managed_cognition,
    },
};

#[derive(Clone, Debug, PartialEq, Eq)]
struct FollowReview {
    target: FollowTarget,
    display_name: String,
    root: PathBuf,
    revisions: String,
    expected: FollowExpected,
    // Detect replacement of the approved directory at the same path on macOS.
    directory_identity: Option<(u64, u64)>,
}

fn prepare(app: &AppHandle, resident: &str, harness: Harness) -> Result<FollowReview, String> {
    let state = app.state::<AppState>();
    let live = LiveAwarenessOwner::authenticate(&state).map_err(|e| e.to_string())?;
    let resident = managed_resident(app, resident, live.owner())?;
    let target = FollowTarget {
        owner: live.owner().clone(),
        binding: managed_cognition::active_binding_ref(&resident)
            .map_err(|_| "Start this companion before following work with its current model.")?,
        session_epoch: managed_cognition::active_session_epoch(&resident)
            .map_err(|_| "Start this companion before following work with its current model.")?,
        resident,
    };
    let root = discovered_root(app, harness)?;
    let display_name =
        crate::managed_agents::storage::load_managed_agent_display_name(app, &target.resident)?
            .unwrap_or_else(|| "Your companion".into());
    let display_name: String = display_name
        .chars()
        .filter(|c| !c.is_control())
        .take(80)
        .collect();
    let metadata = std::fs::symlink_metadata(&root).map_err(|_| "The profile is unavailable.")?;
    #[cfg(unix)]
    let directory_identity = {
        use std::os::unix::fs::MetadataExt;
        Some((metadata.dev(), metadata.ino()))
    };
    #[cfg(not(unix))]
    let directory_identity = {
        let _ = metadata;
        None
    };
    Ok(FollowReview {
        revisions: follow_approval_state(&state, &target)?,
        expected: follow_expected(&state, &target, harness, &root)?,
        display_name,
        target,
        root,
        directory_identity,
    })
}

fn review_unchanged(
    approved: bool,
    before: &FollowReview,
    after: &FollowReview,
) -> Result<(), String> {
    if !approved {
        return Err("The request was cancelled. Nothing changed.".into());
    }
    if before != after {
        return Err("The companion, profile, or permissions changed while approval was open. Nothing changed; review this choice again.".into());
    }
    Ok(())
}

/// Discover one harness profile and follow only after a native owner approval.
/// Cancellation leaves selections, grants, history consent, and watchers alone.
#[tauri::command]
pub async fn follow_companion_work(
    resident_pubkey: String,
    kind: NativeProfileKindV1,
    app: AppHandle,
) -> Result<Option<CompanionAwarenessStatusV1>, String> {
    let harness = match kind {
        NativeProfileKindV1::CodexSessions => Harness::Codex,
        NativeProfileKindV1::ClaudeProjects => Harness::ClaudeCode,
    };
    let before_app = app.clone();
    let before_resident = resident_pubkey.clone();
    let (before, is_following) = tauri::async_runtime::spawn_blocking(move || {
        let review = prepare(&before_app, &before_resident, harness)?;
        let state = before_app.state::<AppState>();
        let is_following = already_following(&state, &review.target, harness, &review.root);
        Ok::<_, String>((review, is_following))
    })
    .await
    .map_err(|_| "Companion setup is unavailable.")??;
    if is_following {
        return Ok(None);
    }

    // Only the native human response can approve. Cancellation/disconnection
    // returns before selection, grants, history choices, or watchers are changed.
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .message(format!(
            "{}\n\nCompanion: {}\nProfile: {}",
            follow_disclosure(harness),
            before.display_name,
            before.root.display()
        ))
        .title(format!("Follow {} work", harness.label()))
        .buttons(MessageDialogButtons::YesNo)
        .show(move |approved| {
            let _ = sender.send(approved);
        });
    let approved = receiver
        .await
        .map_err(|_| "Companion approval is unavailable. Nothing changed.")?;
    if !approved {
        return Ok(None);
    }
    tauri::async_runtime::spawn_blocking(move || {
        // Re-authenticate owner and managed membership, the runtime epoch and
        // binding, exact discovered container, and all control/grant revisions.
        let after = prepare(&app, &resident_pubkey, harness)?;
        review_unchanged(approved, &before, &after)?;
        follow_approved(&app, &after.target, harness, after.root, &before.expected)?;
        projection(
            &app.state::<AppState>(),
            &after.target.owner,
            &after.target.resident,
        )
        .map(Some)
    })
    .await
    .map_err(|_| "Companion setup is unavailable.")?
}

#[cfg(test)]
mod tests {
    use super::*;
    use luca_protocol::{Hex64, SafeU53, Sha256Ref};

    fn review() -> FollowReview {
        use crate::luca::companion_awareness::selected_files::tests::Fixture;
        let fixture = Fixture::new();
        let live = LiveAwarenessOwner::authenticate(&fixture.state).unwrap();
        fixture
            .state
            .companion_awareness
            .initialize(&fixture.root, Some(live.owner()));
        let target = FollowTarget {
            owner: live.owner().clone(),
            resident: fixture.resident.clone(),
            binding: Sha256Ref::parse(format!("sha256:{}", "ef".repeat(32))).unwrap(),
            session_epoch: SafeU53::new(1).unwrap(),
        };
        FollowReview {
            expected: follow_expected(&fixture.state, &target, Harness::Codex, &fixture.root)
                .unwrap(),
            target,
            display_name: "Test companion".into(),
            root: fixture.root.clone(),
            revisions: "original-revisions".into(),
            directory_identity: Some((1, 2)),
        }
    }

    #[test]
    fn unchanged_state_never_substitutes_for_explicit_approval() {
        let before = review();
        assert!(review_unchanged(false, &before, &before).is_err());
        assert!(review_unchanged(true, &before, &before).is_ok());
    }

    #[test]
    fn changed_owner_resident_runtime_profile_and_permissions_invalidate_approval() {
        let before = review();
        let mut variants = Vec::new();
        let mut changed = before.clone();
        changed.target.owner = Hex64::parse("01".repeat(32)).unwrap();
        variants.push(changed);
        let mut changed = before.clone();
        changed.target.resident = Hex64::parse("02".repeat(32)).unwrap();
        variants.push(changed);
        let mut changed = before.clone();
        changed.target.binding = Sha256Ref::parse(format!("sha256:{}", "03".repeat(32))).unwrap();
        variants.push(changed);
        let mut changed = before.clone();
        changed.target.session_epoch = SafeU53::new(2).unwrap();
        variants.push(changed);
        let mut changed = before.clone();
        changed.root = PathBuf::from("/another/.codex/sessions");
        variants.push(changed);
        let mut changed = before.clone();
        changed.directory_identity = Some((1, 3));
        variants.push(changed);
        let mut changed = before.clone();
        changed.revisions = "paused-or-revoked".into();
        variants.push(changed);
        for changed in variants {
            assert!(review_unchanged(true, &before, &changed).is_err());
        }
    }

    #[test]
    fn single_source_disclosure_does_not_include_another_harness() {
        let disclosure = follow_disclosure(Harness::Codex);
        assert!(disclosure.contains("Follow Codex"));
        assert!(!disclosure.contains("Claude Code"));
        assert!(disclosure.contains("current model"));
        assert!(disclosure.contains("No old-history import, Brain connection"));
    }
}
