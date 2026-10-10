//! Exercise the real process entrypoint, including its environment scrubber.
#![cfg(unix)]

use std::{process::Stdio, time::Duration};

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

#[tokio::test]
async fn artifact_turn_gate_process_initializes_and_exposes_restricted_tools() {
    let mut child = tokio::process::Command::new(env!("CARGO_BIN_EXE_buzz-dev-mcp"))
        .env_clear()
        .env("LUCA_ARTIFACT_MODE", "1")
        .env("LUCA_ARTIFACT_TURN_GATE", "1")
        .env("LUCA_ARTIFACT_ENDPOINT", "/tmp/unused-artifact-test.sock")
        .env("LUCA_ARTIFACT_CAPABILITY", "b".repeat(64))
        .env("LUCA_ARTIFACT_CAPABILITY_GENERATION", "9")
        .env("LUCA_ARTIFACT_CONVERSATION_ID", "conversation-1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    let mut output = BufReader::new(child.stdout.take().unwrap());
    let initialize = json!({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": "2025-11-25", "capabilities": {},
            "clientInfo": {"name": "artifact-startup-test", "version": "1"}}
    });
    input
        .write_all(format!("{initialize}\n").as_bytes())
        .await
        .unwrap();
    let mut line = String::new();
    let read = tokio::time::timeout(Duration::from_secs(5), output.read_line(&mut line))
        .await
        .unwrap()
        .unwrap();
    assert!(
        read > 0,
        "artifact process exited before MCP initialization"
    );
    let response: Value = serde_json::from_str(&line).unwrap();
    assert_eq!(response["id"], 1);
    assert_eq!(response["result"]["serverInfo"]["name"], "luca-artifacts");

    let initialized = json!({"jsonrpc": "2.0", "method": "notifications/initialized"});
    let list = json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}});
    input
        .write_all(format!("{initialized}\n{list}\n").as_bytes())
        .await
        .unwrap();
    line.clear();
    tokio::time::timeout(Duration::from_secs(5), output.read_line(&mut line))
        .await
        .unwrap()
        .unwrap();
    let response: Value = serde_json::from_str(&line).unwrap();
    assert_eq!(response["id"], 2);
    let mut names = response["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| tool["name"].as_str().unwrap())
        .collect::<Vec<_>>();
    names.sort_unstable();
    assert_eq!(
        names,
        [
            "artifact_create",
            "artifact_list",
            "artifact_read",
            "artifact_update",
            "canvas_present",
            "preview_attach",
            "preview_detach",
            "quickchat_highlight",
            "resident_place_get",
            "resident_place_update"
        ]
    );
    child.kill().await.unwrap();
    child.wait().await.unwrap();
}
