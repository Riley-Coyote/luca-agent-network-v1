//! Strict extraction of managed-response routing from a signed owner event.

use luca_protocol::{Hex64, ManagedResponseSurfaceV1};
use nostr::{Event, EventId};

pub(super) struct EventRouting {
    pub(super) conversation_id: String,
    pub(super) thread_id: Option<String>,
    pub(super) root_event_id: Option<String>,
    pub(super) reply_event_id: Option<String>,
    pub(super) response_surface: ManagedResponseSurfaceV1,
    pub(super) trigger_p_tags: Vec<String>,
}

pub(super) fn routing_from_event(event: &Event) -> Result<EventRouting, String> {
    let mut conversations = Vec::new();
    let mut root = None;
    let mut reply = None;
    let mut recipients = Vec::new();
    let mut broadcast = false;
    for tag in event.tags.iter() {
        let values = tag.as_slice();
        match values.first().map(String::as_str) {
            Some("h") if values.len() == 2 => {
                uuid::Uuid::parse_str(&values[1])
                    .map_err(|_| "event contains invalid conversation tag".to_string())?;
                conversations.push(values[1].clone());
            }
            Some("h") => return Err("event contains malformed conversation tag".into()),
            Some("p") if values.len() >= 2 => {
                Hex64::parse(values[1].to_ascii_lowercase())
                    .map_err(|_| "event contains invalid p tag".to_string())?;
                recipients.push(values[1].to_ascii_lowercase());
            }
            Some("e") if values.len() >= 4 && values[3] == "root" => {
                EventId::from_hex(&values[1])
                    .map_err(|_| "event contains invalid root event ID".to_string())?;
                if root.replace(values[1].clone()).is_some() {
                    return Err("event contains ambiguous root tags".into());
                }
            }
            Some("e") if values.len() >= 4 && values[3] == "reply" => {
                EventId::from_hex(&values[1])
                    .map_err(|_| "event contains invalid reply event ID".to_string())?;
                if reply.replace(values[1].clone()).is_some() {
                    return Err("event contains ambiguous reply tags".into());
                }
            }
            Some("e") => return Err("event contains unmarked or malformed thread tag".into()),
            Some("broadcast") if values.len() == 2 && values[1] == "1" && !broadcast => {
                broadcast = true;
            }
            Some("broadcast") => return Err("event contains invalid broadcast marker".into()),
            _ => {}
        }
    }
    if conversations.len() != 1 {
        return Err("event must contain exactly one conversation tag".into());
    }
    recipients.sort();
    recipients.dedup();
    let had_thread_reference = root.is_some() || reply.is_some();
    let (final_root, final_reply) = match (root, reply) {
        (None, None) => (event.id.to_hex(), event.id.to_hex()),
        (None, Some(reply)) => (reply.clone(), reply),
        (Some(root), Some(reply)) => (root, reply),
        (Some(_), None) => return Err("event thread routing is incomplete".into()),
    };
    Ok(EventRouting {
        conversation_id: conversations.remove(0),
        thread_id: Some(format!("thread:{final_root}")),
        root_event_id: Some(final_root),
        reply_event_id: Some(final_reply),
        response_surface: if !had_thread_reference || broadcast {
            ManagedResponseSurfaceV1::Timeline
        } else {
            ManagedResponseSurfaceV1::Thread
        },
        trigger_p_tags: recipients,
    })
}
