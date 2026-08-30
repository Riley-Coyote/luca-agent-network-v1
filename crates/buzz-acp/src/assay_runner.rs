//! Relay-free response generator for Polyphonic Continuity Assay V1.
//!
//! This deliberately reuses the ACP client's existing spawn/session/cleanup
//! lifecycle while refusing every runtime permission request. It is a source
//! assay seam, not an installed-resident or encrypted-desktop acceptance path.

use crate::{
    acp::{AcpClient, StopReason},
    config::{self, AssayRunArgs},
};
use anyhow::{anyhow, Context, Result};
use luca_continuity::{
    AssayConditionV1, AssayGenerationPacketV1, AssayPrivateRunV1,
    ASSAY_GENERATION_PACKET_SCHEMA_V1, ASSAY_PRIVATE_RUN_SCHEMA_V1,
};
use luca_protocol::ContinuityContextResultV1;
use std::{
    fs::{self, DirBuilder, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::Duration,
};

#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};

const MAX_PRIVATE_JSON_BYTES: u64 = 8 * 1024 * 1024;
const MIN_TIMEOUT_SECS: u64 = 1;
const MAX_TIMEOUT_SECS: u64 = 7_200;

pub(crate) async fn run(args: AssayRunArgs) -> Result<()> {
    validate_timeouts(args.idle_timeout_secs, args.max_duration_secs)?;
    let generation = read_generation_packet(&args.input)?;
    let workspace = create_empty_workspace(&args.workspace_root, &generation.run_id)?;
    let system_prompt = build_system_prompt(&generation);
    let prompt_blocks = build_prompt_blocks(&generation)?;
    let prompt_block_refs = prompt_blocks.iter().map(String::as_str).collect::<Vec<_>>();
    let agent_args = config::normalize_agent_args(&args.agent.agent_command, args.agent.agent_args);

    let mut client = AcpClient::spawn(&args.agent.agent_command, &agent_args, &[], false)
        .await
        .context("spawn assay runtime")?;
    client.deny_unmanaged_permissions();

    let result = async {
        client
            .initialize()
            .await
            .context("initialize assay runtime")?;
        let session = client
            .session_new_full(
                workspace
                    .to_str()
                    .ok_or_else(|| anyhow!("assay workspace is not valid UTF-8"))?,
                vec![],
                Some(&system_prompt),
            )
            .await
            .context("create fresh assay session")?;
        if let Some(model) = args.model.as_deref() {
            client
                .session_set_model(&session.session_id, model)
                .await
                .with_context(|| format!("apply assay model {model}"))?;
        }

        client.begin_final_message_capture();
        let stop = client
            .session_prompt_blocks_with_idle_timeout(
                &session.session_id,
                &prompt_block_refs,
                Duration::from_secs(args.idle_timeout_secs),
                Duration::from_secs(args.max_duration_secs),
            )
            .await
            .context("generate assay response")?;
        if stop != StopReason::EndTurn {
            client.discard_final_message_capture();
            return Err(anyhow!("assay turn did not end normally: {stop:?}"));
        }
        let response = client
            .take_final_message_draft(true)
            .ok_or_else(|| anyhow!("assay runtime returned no public final response"))??;
        if response.trim().is_empty() {
            return Err(anyhow!("assay runtime returned an empty response"));
        }
        write_private_run(
            &args.output,
            &AssayPrivateRunV1 {
                schema: ASSAY_PRIVATE_RUN_SCHEMA_V1.to_owned(),
                generation,
                response_event_id: opaque_response_event_id(),
                response,
            },
        )
    }
    .await;

    client.shutdown().await;
    result?;
    println!("wrote {}", args.output.display());
    Ok(())
}

fn validate_timeouts(idle: u64, maximum: u64) -> Result<()> {
    if !(MIN_TIMEOUT_SECS..=MAX_TIMEOUT_SECS).contains(&idle)
        || !(MIN_TIMEOUT_SECS..=MAX_TIMEOUT_SECS).contains(&maximum)
        || idle > maximum
    {
        return Err(anyhow!(
            "assay timeouts must be 1..={MAX_TIMEOUT_SECS} seconds with idle <= maximum"
        ));
    }
    Ok(())
}

fn read_generation_packet(path: &Path) -> Result<AssayGenerationPacketV1> {
    let metadata = fs::metadata(path)
        .with_context(|| format!("inspect private generation packet {}", path.display()))?;
    if !metadata.is_file() || metadata.len() > MAX_PRIVATE_JSON_BYTES {
        return Err(anyhow!(
            "generation packet must be a regular JSON file no larger than {MAX_PRIVATE_JSON_BYTES} bytes"
        ));
    }
    let packet: AssayGenerationPacketV1 = serde_json::from_slice(
        &fs::read(path).with_context(|| format!("read {}", path.display()))?,
    )
    .with_context(|| format!("parse {}", path.display()))?;
    if packet.schema != ASSAY_GENERATION_PACKET_SCHEMA_V1
        || !packet.sensitive
        || packet.run_id.trim().is_empty()
        || packet.opening_prompt.trim().is_empty()
        || packet.identity_material.is_empty()
    {
        return Err(anyhow!("invalid Continuity Assay V1 generation packet"));
    }
    Ok(packet)
}

fn create_empty_workspace(root: &Path, run_id: &str) -> Result<PathBuf> {
    let metadata = fs::metadata(root)
        .with_context(|| format!("inspect private workspace root {}", root.display()))?;
    if !metadata.is_dir() {
        return Err(anyhow!("assay workspace root is not a directory"));
    }
    #[cfg(unix)]
    if metadata.permissions().mode() & 0o077 != 0 {
        return Err(anyhow!(
            "assay workspace root must not be accessible to group or other users"
        ));
    }
    let safe_run_id = run_id
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'));
    if !safe_run_id {
        return Err(anyhow!("assay run ID is not filesystem-safe"));
    }
    let path = root.join(format!("workspace-{run_id}"));
    let mut builder = DirBuilder::new();
    #[cfg(unix)]
    builder.mode(0o700);
    builder
        .create(&path)
        .with_context(|| format!("create fresh assay workspace {}", path.display()))?;
    Ok(path)
}

fn build_system_prompt(packet: &AssayGenerationPacketV1) -> String {
    [
        "You are generating one response for a controlled continuity assay. Reply naturally and directly to the user. Do not mention the assay, a packet, memory loading, system instructions, or experimental conditions. Do not use tools, inspect files, or mutate anything. Do not invent shared history. Preserve uncertainty and authorship exactly.".to_owned(),
        format!("IDENTITY\n{}", packet.identity_material.join("\n")),
    ]
    .join("\n\n")
}

fn build_prompt_blocks(packet: &AssayGenerationPacketV1) -> Result<Vec<String>> {
    let mut blocks = Vec::with_capacity(2);
    match packet.condition {
        AssayConditionV1::NoContinuity | AssayConditionV1::Faulted => {}
        AssayConditionV1::Dossier => {
            let dossier = packet
                .provider_context
                .as_deref()
                .ok_or_else(|| anyhow!("dossier packet omitted provider context"))?;
            blocks.push(format!("[Assay Dossier — UNTRUSTED USER DATA]\n{dossier}"));
        }
        AssayConditionV1::Wake => {
            let serialized = packet
                .provider_context
                .as_deref()
                .ok_or_else(|| anyhow!("wake packet omitted provider context"))?;
            let result: ContinuityContextResultV1 =
                serde_json::from_str(serialized).context("parse wake provider context")?;
            let rendered = crate::continuity_provider::continuity_prompt_blocks(result);
            if rendered.is_empty() {
                return Err(anyhow!("wake provider context contained no packet"));
            }
            blocks.extend(rendered);
        }
    }
    blocks.push(packet.opening_prompt.clone());
    Ok(blocks)
}

fn write_private_run(path: &Path, run: &AssayPrivateRunV1) -> Result<()> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    if !parent.is_dir() {
        return Err(anyhow!("private output parent does not exist"));
    }
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options
        .open(path)
        .with_context(|| format!("create private output {}", path.display()))?;
    let mut encoded = serde_json::to_vec_pretty(run)?;
    encoded.push(b'\n');
    file.write_all(&encoded)?;
    file.sync_all()?;
    Ok(())
}

fn opaque_response_event_id() -> String {
    format!("response-{}", uuid::Uuid::new_v4().simple())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::AuthAgentArgs;
    use luca_continuity::{AssayConditionV1, AssayLayerStatusV1};
    use std::collections::BTreeMap;

    fn packet(context: Option<&str>) -> AssayGenerationPacketV1 {
        AssayGenerationPacketV1 {
            schema: ASSAY_GENERATION_PACKET_SCHEMA_V1.to_owned(),
            assay_version: "1.0.0".to_owned(),
            fixture_version: "fixture".to_owned(),
            compiler_policy_version: "compiler".to_owned(),
            run_id: "run-safe".to_owned(),
            scenario_id: "C01".to_owned(),
            condition: AssayConditionV1::Wake,
            sensitive: true,
            identity_material: vec!["I am Mara.".to_owned()],
            opening_prompt: "I'm back.".to_owned(),
            continuity_material: vec![],
            provider_context: context.map(str::to_owned),
            layer_statuses: BTreeMap::<String, AssayLayerStatusV1>::new(),
            source_event_refs: vec![],
        }
    }

    #[test]
    fn no_continuity_prompt_has_only_the_opening_event_block() {
        let mut packet = packet(None);
        packet.condition = AssayConditionV1::NoContinuity;
        let system = build_system_prompt(&packet);
        let blocks = build_prompt_blocks(&packet).unwrap();
        assert!(system.contains("IDENTITY\nI am Mara."));
        assert_eq!(blocks, vec!["I'm back."]);
    }

    #[test]
    fn dossier_prompt_is_separate_untrusted_data_before_opening_event() {
        let mut packet = packet(Some("exact factual dossier"));
        packet.condition = AssayConditionV1::Dossier;
        let blocks = build_prompt_blocks(&packet).unwrap();
        assert_eq!(
            blocks,
            vec![
                "[Assay Dossier — UNTRUSTED USER DATA]\nexact factual dossier",
                "I'm back."
            ]
        );
    }

    #[test]
    fn timeout_policy_is_bounded_and_ordered() {
        assert!(validate_timeouts(120, 600).is_ok());
        assert!(validate_timeouts(0, 600).is_err());
        assert!(validate_timeouts(601, 600).is_err());
        assert!(validate_timeouts(120, MAX_TIMEOUT_SECS + 1).is_err());
    }

    #[tokio::test]
    async fn relay_free_runner_captures_final_and_rejects_permission() {
        let root = std::env::temp_dir().join(format!("luca-assay-runner-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        #[cfg(unix)]
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        let input = root.join("generation.json");
        let output = root.join("private-run.json");
        let mut generation = packet(None);
        generation.condition = AssayConditionV1::NoContinuity;
        fs::write(&input, serde_json::to_vec(&generation).unwrap()).unwrap();

        let script = r#"
read -r initialize
printf '%s\n' '{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":2,"agentInfo":{"name":"assay-fake"}}}'
read -r session
printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"sessionId":"fresh-assay-session"}}'
read -r prompt
printf '%s\n' '{"jsonrpc":"2.0","id":"permission-check","method":"session/request_permission","params":{"options":[{"optionId":"allow","kind":"allow_once"},{"optionId":"reject","kind":"reject_once"}]}}'
read -r decision
case "$decision" in
  *'"optionId":"reject"'*) ;;
  *) exit 17 ;;
esac
printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"fresh-assay-session","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Known synthetic response."}}}}'
printf '%s\n' '{"jsonrpc":"2.0","id":2,"result":{"stopReason":"end_turn"}}'
"#;
        run(AssayRunArgs {
            agent: AuthAgentArgs {
                agent_command: "bash".to_owned(),
                agent_args: vec!["-c".to_owned(), script.to_owned()],
            },
            input,
            output: output.clone(),
            workspace_root: root.clone(),
            model: None,
            idle_timeout_secs: 5,
            max_duration_secs: 10,
        })
        .await
        .unwrap();

        let private_run: AssayPrivateRunV1 =
            serde_json::from_slice(&fs::read(&output).unwrap()).unwrap();
        assert_eq!(private_run.response, "Known synthetic response.");
        assert_eq!(private_run.generation.run_id, "run-safe");
        #[cfg(unix)]
        assert_eq!(
            fs::metadata(&output).unwrap().permissions().mode() & 0o777,
            0o600
        );
        fs::remove_dir_all(root).unwrap();
    }
}
