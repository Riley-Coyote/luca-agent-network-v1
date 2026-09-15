//! Residents Luca created from a conversation and is still bringing up.
//!
//! When the owner agrees in chat, the resident's record is saved first and its
//! process, relay profile and channel attachment follow after the creating call
//! has already returned. Nothing in the saved record separates "starting right
//! now" from "deliberately stopped", so the rail would otherwise show a brand
//! new resident as idle. This in-process set carries that one fact, keyed by
//! the definition the resident was created from — known before the resident
//! has a public key, so the very first saved record can already say "Waking…".
//!
//! It is deliberately process-local and unpersisted: a restart means nothing is
//! being brought up any more.

use std::{
    collections::HashSet,
    sync::{Mutex, OnceLock},
};

fn waking_definitions() -> &'static Mutex<HashSet<String>> {
    static WAKING: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    WAKING.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Mark one definition's resident as being brought up.
pub(crate) fn mark_waking(persona_id: &str) {
    if let Ok(mut waking) = waking_definitions().lock() {
        waking.insert(persona_id.to_owned());
    }
}

/// Clear the mark once bring-up settles — started, or failed with the reason
/// written to the record. Never left set on an error path.
pub(crate) fn clear_waking(persona_id: &str) {
    if let Ok(mut waking) = waking_definitions().lock() {
        waking.remove(persona_id);
    }
}

/// Whether this record's definition is still being brought up.
pub fn definition_is_waking(persona_id: Option<&str>) -> bool {
    let Some(persona_id) = persona_id else {
        return false;
    };
    waking_definitions()
        .lock()
        .is_ok_and(|waking| waking.contains(persona_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_marked_definition_reads_as_waking() {
        let definition = "definition-waking-test";
        assert!(!definition_is_waking(Some(definition)));
        mark_waking(definition);
        assert!(definition_is_waking(Some(definition)));
        assert!(!definition_is_waking(None));
        assert!(!definition_is_waking(Some("definition-other-test")));
        clear_waking(definition);
        assert!(!definition_is_waking(Some(definition)));
    }
}
