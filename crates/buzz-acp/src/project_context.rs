//! Bounded, machine-local Project context handed off by Luca Desktop.
//!
//! The file contains no signing material and is never published to the relay.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
struct ProjectContextHandoff {
    version: u8,
    chats: HashMap<String, ProjectChatContext>,
}

#[derive(Clone, Debug, Deserialize)]
pub(crate) struct ProjectChatContext {
    pub project_id: String,
    pub project_name: String,
    pub context_revision: u64,
    pub instructions: Option<String>,
    pub working_folder: Option<String>,
    pub folder_missing: bool,
}

impl ProjectChatContext {
    pub(crate) fn fingerprint(&self) -> String {
        format!(
            "{}:{}:{}:{}",
            self.project_id,
            self.context_revision,
            self.working_folder.as_deref().unwrap_or(""),
            self.folder_missing
        )
    }

    pub(crate) fn prompt_section(&self) -> String {
        let mut section = format!("[Project — {}]", self.project_name);
        if let Some(instructions) = self.instructions.as_deref() {
            section.push('\n');
            section.extend(instructions.chars().take(12_000));
        }
        if self.folder_missing {
            section.push_str("\nThe Project working folder is disconnected. Continue without filesystem access and tell the user to reconnect it if needed.");
        }
        section
    }

    pub(crate) fn usable_working_folder(&self) -> Option<&str> {
        self.working_folder
            .as_deref()
            .filter(|path| Path::new(path).is_dir())
    }
}

pub(crate) fn load_chat_context(
    handoff_path: Option<&PathBuf>,
    channel_id: Uuid,
) -> Option<ProjectChatContext> {
    let bytes = std::fs::read(handoff_path?).ok()?;
    let handoff: ProjectContextHandoff = serde_json::from_slice(&bytes).ok()?;
    if handoff.version != 1 {
        return None;
    }
    handoff.chats.get(&channel_id.to_string()).cloned()
}
