use super::*;
use RuntimeTaskStateV1::*;

const STATES: [RuntimeTaskStateV1; 8] = [
    Queued,
    Active,
    Stopping,
    AwaitingNative,
    Succeeded,
    Stopped,
    Failed,
    Interrupted,
];

#[test]
fn state_grid_fences_late_updates_and_preserves_same_state_refreshes() {
    const A: Result<bool, &str> = Ok(true);
    const I: Result<bool, &str> = Ok(false);
    const S: Result<bool, &str> = Err(STOP_WON);
    const T: Result<bool, &str> = Err(ALREADY_SETTLED);
    // Columns follow STATES. Terminal outcomes are immutable, but can refresh.
    let expected = [
        [A, A, A, A, A, A, A, A], // Queued
        [A, A, A, A, A, A, A, A], // Active
        [I, I, A, I, S, A, A, A], // Stopping
        [I, I, I, A, A, A, A, A], // AwaitingNative
        [I, I, I, I, A, I, I, I], // Succeeded
        [I, I, I, I, T, A, I, I], // Stopped
        [I, I, I, I, T, I, A, I], // Failed
        [I, I, I, I, T, I, I, A], // Interrupted
    ];
    for (row, current) in STATES.iter().enumerate() {
        for (column, next) in STATES.iter().enumerate() {
            assert_eq!(
                transition_allowed(Some(*current), *next, false),
                expected[row][column],
                "{current:?} -> {next:?}"
            );
        }
    }
    for next in STATES {
        assert_eq!(transition_allowed(None, next, false), Ok(true));
    }
}

#[test]
fn an_accepted_stop_wins_before_success_and_can_settle_without_success() {
    assert!(can_cancel(Active));
    assert_eq!(transition_allowed(Some(Active), Stopping, false), Ok(true));
    assert_eq!(
        transition_allowed(Some(Stopping), Succeeded, false),
        Err(STOP_WON)
    );
    for settled in [Stopped, Failed, Interrupted] {
        assert_eq!(transition_allowed(Some(Stopping), settled, false), Ok(true));
        assert!(!can_cancel(settled));
        for late in [Queued, Active, Stopping, AwaitingNative] {
            assert_eq!(transition_allowed(Some(settled), late, false), Ok(false));
        }
        assert_eq!(
            transition_allowed(Some(settled), Succeeded, false),
            Err(ALREADY_SETTLED)
        );
    }
}

#[test]
fn a_committed_success_wins_before_a_later_stop_or_failure() {
    assert_eq!(transition_allowed(Some(Active), Succeeded, false), Ok(true));
    assert!(!can_cancel(Succeeded));
    for late in [
        Queued,
        Active,
        Stopping,
        AwaitingNative,
        Stopped,
        Failed,
        Interrupted,
    ] {
        assert_eq!(transition_allowed(Some(Succeeded), late, false), Ok(false));
    }
    assert_eq!(
        transition_allowed(Some(Succeeded), Succeeded, false),
        Ok(true)
    );
}

#[test]
fn shutdown_rejects_every_new_success_but_keeps_committed_success_refreshable() {
    assert_eq!(
        transition_allowed(None, Succeeded, true),
        Err(SHUTTING_DOWN)
    );
    for current in STATES {
        let expected = match current {
            Succeeded => Ok(true),
            Stopping => Err(STOP_WON),
            _ => Err(SHUTTING_DOWN),
        };
        assert_eq!(
            transition_allowed(Some(current), Succeeded, true),
            expected,
            "shutdown: {current:?} -> Succeeded"
        );
        assert_eq!(
            transition_allowed(Some(current), current, true),
            Ok(true),
            "shutdown: refresh {current:?}"
        );
        for next in STATES.into_iter().filter(|next| *next != Succeeded) {
            assert_eq!(
                transition_allowed(Some(current), next, true),
                transition_allowed(Some(current), next, false),
                "shutdown must not grant another transition: {current:?} -> {next:?}"
            );
        }
    }
    for next in STATES.into_iter().filter(|next| *next != Succeeded) {
        assert_eq!(transition_allowed(None, next, true), Ok(true));
    }
}

#[test]
fn cancellation_is_limited_to_nonterminal_locally_controlled_states() {
    for state in STATES {
        assert_eq!(
            can_cancel(state),
            matches!(state, Queued | Active | Stopping)
        );
    }
    assert!(!can_cancel(AwaitingNative));
    for late in [Queued, Active, Stopping] {
        assert_eq!(
            transition_allowed(Some(AwaitingNative), late, false),
            Ok(false)
        );
    }
}
