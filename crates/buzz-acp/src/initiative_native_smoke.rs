//! Explicit, ignored native assay: no personal observation, tools, publication,
//! native settings mutation or transcript persistence. This proves the adapter
//! roundtrip only, not the full desktop coordinator/continuity/Library loop.

use super::*;
use crate::acp::StopReason;
use crate::continuity_runtime_policy::{
    private_continuity_runtime_policy, ContinuityRuntimeAdapter,
};
use luca_protocol::{canonical_sha256, CanonicalTimestamp, SafeU53, Sha256Ref};
use std::path::PathBuf;

/// Never runs as part of the normal suite. The caller chooses an already
/// installed Claude ACP command; this test never installs or authenticates it.
#[tokio::test]
#[ignore = "opt-in model use: requires POLYPHONIC_INITIATIVE_SMOKE_COMMAND"]
async fn claude_tool_free_nonpersisting_native_authorship_roundtrip() {
    let command = PathBuf::from(
        std::env::var("POLYPHONIC_INITIATIVE_SMOKE_COMMAND").expect("explicit native adapter"),
    );
    assert!(command.is_absolute() && command.is_file());
    let directory = std::env::temp_dir().join(format!(
        "polyphonic-initiative-native-smoke-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir(&directory).expect("disposable directory");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))
            .expect("private directory");
    }
    let mut client =
        AcpClient::spawn_managed(command.to_str().expect("UTF-8 adapter"), &[], &[], false)
            .await
            .expect("spawn owned native adapter");
    // Always shut down the exact owned process before reporting an assertion.
    let outcome =
        tokio::time::timeout(Duration::from_secs(180), roundtrip(&mut client, &directory)).await;
    client.shutdown().await;
    std::fs::remove_dir(&directory).expect("empty disposable scratch directory");
    match outcome {
        Ok(Ok(model)) => println!(
            "Native Claude authorship passed; selected model: {model}; tools disabled; persistence disabled."
        ),
        Ok(Err(error)) => panic!("Native initiative assay failed: {error}"),
        Err(_) => panic!("Native initiative assay exceeded its original deadline"),
    }
}

async fn roundtrip(client: &mut AcpClient, directory: &std::path::Path) -> Result<String, String> {
    client
        .initialize()
        .await
        .map_err(|_| "adapter initialization")?;
    let policy = private_continuity_runtime_policy(
        ContinuityRuntimeAdapter {
            package: "claude-agent-acp",
            version: "0.61.0",
        },
        None,
        &[],
    )
    .map_err(|_| "private adapter policy")?;
    let mut metadata = nonpersisting_initiative_metadata(policy.session_metadata)
        .map_err(|_| "nonpersisting metadata")?
        .ok_or("missing private metadata")?;
    // Claude's supported system-prompt extension is metadata, not the standard
    // ACP top-level field. This persona is invented, never a user's agent data.
    let persona = initiative_pursuit_tests::assembled_persona();
    metadata["systemPrompt"] = serde_json::json!(&persona);
    let session = client
        .session_new_full_with_meta(
            directory.to_str().ok_or("scratch encoding")?,
            Vec::new(),
            None,
            Some(metadata),
        )
        .await
        .map_err(|_| "private native session creation")?;
    let option = session.raw["configOptions"]
        .as_array()
        .and_then(|options| options.iter().find(|option| option["category"] == "model"))
        .ok_or("native model control unavailable")?;
    let config_id = option["id"]
        .as_str()
        .ok_or("native model control identity")?;
    let model = option["currentValue"]
        .as_str()
        .filter(|model| !model.is_empty() && model.len() <= 128)
        .ok_or("native model identity unavailable")?
        .to_owned();
    // Preserve and explicitly pin the adapter's current configured selection.
    // No fallback, alternate provider, subscription or global config change.
    let confirmation = client
        .session_set_config_option(&session.session_id, config_id, &model)
        .await
        .map_err(|_| "exact native model selection")?;
    if !confirmation["configOptions"]
        .as_array()
        .is_some_and(|options| {
            options
                .iter()
                .any(|option| option["id"] == config_id && option["currentValue"] == model)
        })
    {
        return Err("native model was not acknowledged".into());
    }
    // The adapter itself reads the owner's initial permission mode even when
    // query settingSources is empty. Bind this disposable session to Manual;
    // never inherit an app-wide bypass tier or rely on denied approval alone.
    managed_claude_advertised_mode(&session.raw, "default")
        .map_err(|_| "private Manual mode unavailable")?;
    let mode = client
        .session_set_config_option(&session.session_id, "mode", "default")
        .await
        .map_err(|_| "private Manual mode")?;
    acknowledged_mode_options(&mode, "default").ok_or("private mode not acknowledged")?;

    let now = chrono::Utc::now();
    let now_ms = u64::try_from(now.timestamp_millis()).map_err(|_| "clock")?;
    let now = CanonicalTimestamp::parse(now.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
        .map_err(|_| "canonical clock")?;
    let mut request = initiative_pursuit_tests::request();
    request.admitted_at = now;
    request.deadline_unix_ms = SafeU53::new(now_ms + 120_000).map_err(|_| "deadline")?;
    request.semantic_thread.body = "A private curiosity: what makes a tiny tabletop garden feel inviting rather than like another chore? This is synthetic test material, not a real owner's task.".into();
    request.thread.canonical_revision_ref = request
        .semantic_thread
        .revision_ref()
        .map_err(|_| "canonical synthetic thread")?;
    request.binding_ref = Sha256Ref::parse(format!("sha256:{}", canonical_sha256(
        &serde_json::json!({"command": "explicit-installed-claude-acp", "model": model, "persona": &persona})
    ).map_err(|_| "synthetic binding")?)).map_err(|_| "synthetic binding encoding")?;
    request.max_result_bytes = SafeU53::new(24_576).map_err(|_| "result bound")?;
    let prompt = build_initiative_pursuit_prompt(&request, now_ms, Some(&persona))
        .map_err(|_| "bounded authored-work prompt")?;
    client.begin_final_message_capture();
    let stop = client
        .session_prompt_with_idle_timeout(
            &session.session_id,
            &prompt,
            Duration::from_secs(60),
            Duration::from_secs(120),
        )
        .await
        .map_err(|_| "native private prompt")?;
    if !matches!(stop, StopReason::EndTurn) {
        return Err("native turn did not complete".into());
    }
    let draft = client
        .take_final_message_draft(true)
        .ok_or("no final native output")?
        .map_err(|_| "bounded native final")?;
    let result = serde_json::from_str::<luca_protocol::InitiativePursuitResultV1>(&draft)
        .map_err(|_| "strict native result shape")?;
    result
        .validate_against_at(
            &request,
            u64::try_from(chrono::Utc::now().timestamp_millis()).map_err(|_| "completion clock")?,
        )
        .map_err(|_| "native result correlation")?;
    // Creation, inquiry, decline, defer and no-change are all legitimate. Do
    // not repeat the model to force a gift or claim it completed external work.
    Ok(model)
}
