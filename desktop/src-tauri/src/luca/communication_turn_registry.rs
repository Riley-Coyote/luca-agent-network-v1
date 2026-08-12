//! Process-local authority for ordinary managed-agent communication turns.
//!
//! A broker bootstrap capability proves which resident process owns a local
//! socket. It does not, by itself, prove that the model is currently handling
//! an owner-authorized conversation turn. This registry is populated only by
//! authenticated presentation frames after the durable dispatch store accepts
//! `turn_started`, and is cleared by the corresponding terminal frame or
//! runtime lifecycle teardown.

use std::{
    collections::HashMap,
    sync::{Mutex, MutexGuard, OnceLock},
};

use luca_protocol::{
    Hex64, ManagedPresentationFrameV1, ManagedPresentationKindV1, OpaqueId, SafeU53,
};

const MAX_ACTIVE_TURNS: usize = 256;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ActiveCommunicationTurn {
    pub(crate) resident_pubkey: Hex64,
    pub(crate) conversation_id: OpaqueId,
    pub(crate) turn_id: OpaqueId,
    pub(crate) dispatch_receipt_id: OpaqueId,
    pub(crate) session_epoch: SafeU53,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CommunicationTurnAuthorizationError {
    Unavailable,
    Unknown,
    Conflict,
}

type TurnKey = (String, u64, String, String, String);

fn registry() -> &'static Mutex<HashMap<TurnKey, ActiveCommunicationTurn>> {
    static REGISTRY: OnceLock<Mutex<HashMap<TurnKey, ActiveCommunicationTurn>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

/// A poisoned authority mutex is never recovered with its old contents. A
/// panic while holding this lock makes every outstanding lease suspect, so
/// clear them before allowing the process to continue. This fails closed
/// without turning one panic into a process-lifetime authorization outage.
fn lock_registry() -> MutexGuard<'static, HashMap<TurnKey, ActiveCommunicationTurn>> {
    match registry().lock() {
        Ok(turns) => turns,
        Err(poisoned) => {
            let mut turns = poisoned.into_inner();
            turns.clear();
            registry().clear_poison();
            turns
        }
    }
}

fn key(frame: &ManagedPresentationFrameV1) -> TurnKey {
    (
        frame.resident_pubkey.as_str().to_ascii_lowercase(),
        frame.session_epoch.get(),
        frame.conversation_id.as_str().to_owned(),
        frame.turn_id.as_str().to_owned(),
        frame.dispatch_receipt_id.as_str().to_ascii_lowercase(),
    )
}

/// Reserve or revoke process-local authority after the presentation sequence
/// gate accepts the exact frame. A `turn_started` reservation is deliberately
/// created before durable dispatch binding so registry capacity/conflicts can
/// fail without mutating durable state. It is unusable on its own: every broker
/// action also requires the matching durable Active dispatch, and callers must
/// revoke the reservation if that binding or its final recheck fails.
pub(crate) fn observe_accepted_frame(
    frame: &ManagedPresentationFrameV1,
) -> Result<(), CommunicationTurnAuthorizationError> {
    let mut turns = lock_registry();
    match frame.kind {
        ManagedPresentationKindV1::TurnStarted => {
            let frame_key = key(frame);
            if turns.contains_key(&frame_key) {
                return Err(CommunicationTurnAuthorizationError::Conflict);
            }
            if turns.len() >= MAX_ACTIVE_TURNS {
                return Err(CommunicationTurnAuthorizationError::Unavailable);
            }
            turns.insert(
                frame_key,
                ActiveCommunicationTurn {
                    resident_pubkey: frame.resident_pubkey.clone(),
                    conversation_id: frame.conversation_id.clone(),
                    turn_id: frame.turn_id.clone(),
                    dispatch_receipt_id: frame.dispatch_receipt_id.clone(),
                    session_epoch: frame.session_epoch,
                },
            );
        }
        ManagedPresentationKindV1::Completed
        | ManagedPresentationKindV1::Cancelled
        | ManagedPresentationKindV1::Failed => {
            turns.remove(&key(frame));
        }
        ManagedPresentationKindV1::Phase | ManagedPresentationKindV1::PublicChunk => {}
    }
    Ok(())
}

/// Resolve the one exact active turn for a resident session and conversation.
/// Multiple matches fail closed rather than guessing which model turn owns an
/// action.
pub(crate) fn authorize(
    resident_pubkey: &str,
    session_epoch: u64,
    conversation_id: &str,
    turn_id: &str,
    dispatch_receipt_id: &str,
) -> Result<ActiveCommunicationTurn, CommunicationTurnAuthorizationError> {
    lock_registry()
        .get(&(
            resident_pubkey.to_ascii_lowercase(),
            session_epoch,
            conversation_id.to_owned(),
            turn_id.to_owned(),
            dispatch_receipt_id.to_ascii_lowercase(),
        ))
        .cloned()
        .ok_or(CommunicationTurnAuthorizationError::Unknown)
}

/// Revoke one exact turn before cancellation acknowledgement or replacement
/// runtime exposure. The dispatch receipt is part of the key so a duplicate
/// turn label can never revoke a different owner-authorized dispatch.
pub(crate) fn revoke_exact(
    resident_pubkey: &str,
    session_epoch: u64,
    conversation_id: &str,
    turn_id: &str,
    dispatch_receipt_id: &str,
) -> bool {
    lock_registry()
        .remove(&(
            resident_pubkey.to_ascii_lowercase(),
            session_epoch,
            conversation_id.to_owned(),
            turn_id.to_owned(),
            dispatch_receipt_id.to_ascii_lowercase(),
        ))
        .is_some()
}

/// Revoke the exact durable dispatch when cancellation is requested before
/// the caller necessarily knows the harness turn label.
pub(crate) fn revoke_dispatch(
    resident_pubkey: &str,
    session_epoch: u64,
    conversation_id: &str,
    dispatch_receipt_id: &str,
) -> usize {
    let mut turns = lock_registry();
    let before = turns.len();
    turns.retain(|_, turn| {
        !turn.resident_pubkey.as_str().eq_ignore_ascii_case(resident_pubkey)
            || turn.session_epoch.get() != session_epoch
            || turn.conversation_id.as_str() != conversation_id
            || !turn
                .dispatch_receipt_id
                .as_str()
                .eq_ignore_ascii_case(dispatch_receipt_id)
    });
    before.saturating_sub(turns.len())
}

/// Clear every process-memory authority for one runtime session. This is a
/// lifecycle backstop for process exits that cannot emit a terminal frame.
pub(crate) fn clear_session(
    resident_pubkey: &str,
    session_epoch: u64,
) -> Result<usize, CommunicationTurnAuthorizationError> {
    let mut turns = lock_registry();
    let before = turns.len();
    turns.retain(|_, turn| {
        !turn.resident_pubkey.as_str().eq_ignore_ascii_case(resident_pubkey)
            || turn.session_epoch.get() != session_epoch
    });
    Ok(before.saturating_sub(turns.len()))
}

/// Revoke every epoch for a resident before its broker/process owner is
/// removed or replaced. This is the final lifecycle backstop when the exact
/// session epoch is no longer available at teardown.
pub(crate) fn clear_resident(resident_pubkey: &str) -> usize {
    let mut turns = lock_registry();
    let before = turns.len();
    turns.retain(|_, turn| {
        !turn.resident_pubkey.as_str().eq_ignore_ascii_case(resident_pubkey)
    });
    before.saturating_sub(turns.len())
}

#[cfg(test)]
pub(crate) fn clear_all_for_test() {
    lock_registry().clear();
}

#[cfg(test)]
mod tests {
    use super::*;
    use luca_protocol::{ManagedPresentationKindV1, MANAGED_PRESENTATION_PROTOCOL};

    fn frame(
        resident: &str,
        conversation: &str,
        turn: &str,
        kind: ManagedPresentationKindV1,
    ) -> ManagedPresentationFrameV1 {
        ManagedPresentationFrameV1 {
            protocol: MANAGED_PRESENTATION_PROTOCOL.into(),
            kind,
            resident_pubkey: Hex64::parse(resident.to_owned()).unwrap(),
            conversation_id: OpaqueId::parse(conversation.to_owned()).unwrap(),
            turn_id: OpaqueId::parse(turn.to_owned()).unwrap(),
            dispatch_receipt_id: OpaqueId::parse(format!("dispatch-{turn}")).unwrap(),
            session_epoch: SafeU53::new(7).unwrap(),
            sequence: SafeU53::new(1).unwrap(),
            phase: None,
            public_chunk: None,
            failure: None,
        }
    }

    #[test]
    fn authority_exists_only_between_accepted_start_and_terminal_frames() {
        clear_all_for_test();
        let resident = "11".repeat(32);
        let start = frame(
            &resident,
            "conversation-1",
            "turn-1",
            ManagedPresentationKindV1::TurnStarted,
        );
        assert_eq!(
            authorize(&resident, 7, "conversation-1", "turn-1", "dispatch-turn-1"),
            Err(CommunicationTurnAuthorizationError::Unknown)
        );
        observe_accepted_frame(&start).unwrap();
        let active = authorize(
            &resident,
            7,
            "conversation-1",
            "turn-1",
            "dispatch-turn-1",
        )
        .unwrap();
        assert_eq!(active.turn_id.as_str(), "turn-1");

        let mut terminal = start;
        terminal.kind = ManagedPresentationKindV1::Completed;
        observe_accepted_frame(&terminal).unwrap();
        assert_eq!(
            authorize(&resident, 7, "conversation-1", "turn-1", "dispatch-turn-1"),
            Err(CommunicationTurnAuthorizationError::Unknown)
        );
    }

    #[test]
    fn concurrent_turns_require_their_exact_dispatch_and_session_clear_revokes_all() {
        clear_all_for_test();
        let resident = "22".repeat(32);
        observe_accepted_frame(&frame(
            &resident,
            "conversation-2",
            "turn-a",
            ManagedPresentationKindV1::TurnStarted,
        ))
        .unwrap();
        observe_accepted_frame(&frame(
            &resident,
            "conversation-2",
            "turn-b",
            ManagedPresentationKindV1::TurnStarted,
        ))
        .unwrap();
        assert!(authorize(
            &resident,
            7,
            "conversation-2",
            "turn-a",
            "dispatch-turn-a"
        )
        .is_ok());
        assert!(authorize(
            &resident,
            7,
            "conversation-2",
            "turn-b",
            "dispatch-turn-b"
        )
        .is_ok());
        assert_eq!(
            authorize(
                &resident,
                7,
                "conversation-2",
                "turn-a",
                "dispatch-turn-b"
            ),
            Err(CommunicationTurnAuthorizationError::Unknown)
        );
        assert_eq!(clear_session(&resident, 7).unwrap(), 2);
        assert_eq!(
            authorize(
                &resident,
                7,
                "conversation-2",
                "turn-a",
                "dispatch-turn-a"
            ),
            Err(CommunicationTurnAuthorizationError::Unknown)
        );
    }

    #[test]
    fn duplicate_start_conflicts_and_exact_terminal_cannot_revoke_a_sibling() {
        clear_all_for_test();
        let resident = "33".repeat(32);
        let start_a = frame(
            &resident,
            "conversation-3",
            "turn-a",
            ManagedPresentationKindV1::TurnStarted,
        );
        let start_b = frame(
            &resident,
            "conversation-3",
            "turn-b",
            ManagedPresentationKindV1::TurnStarted,
        );
        observe_accepted_frame(&start_a).unwrap();
        assert_eq!(
            observe_accepted_frame(&start_a),
            Err(CommunicationTurnAuthorizationError::Conflict)
        );
        observe_accepted_frame(&start_b).unwrap();

        let mut terminal_a = start_a;
        terminal_a.kind = ManagedPresentationKindV1::Cancelled;
        observe_accepted_frame(&terminal_a).unwrap();
        assert!(authorize(
            &resident,
            7,
            "conversation-3",
            "turn-b",
            "dispatch-turn-b"
        )
        .is_ok());
    }
}
