//! Conservative pure gate for the lightweight V1 resident handoff.
//!
//! This module does not read a transcript, call a model, or persist data. The
//! trusted desktop supplies only body-free signals derived from an exact
//! finalized resident event. `NoChange` is always a valid terminal result.

/// Body-free signals admitted by the cheap pre-cognition gate.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct HandoffSalienceSignals {
    pub explicit_carry_request: bool,
    pub unresolved_thread: bool,
    pub commitment: bool,
    pub explicit_preference: bool,
}

/// Whether an exact finalized resident turn merits bounded handoff cognition.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HandoffSalienceDecision {
    NoChange,
    DurableCandidate,
}

/// Skip obvious small talk while preserving the resident's right to return
/// `NoChange` after a candidate reaches its private cognition turn.
pub fn evaluate_handoff_salience(signals: HandoffSalienceSignals) -> HandoffSalienceDecision {
    if signals.explicit_carry_request
        || signals.unresolved_thread
        || signals.commitment
        || signals.explicit_preference
    {
        HandoffSalienceDecision::DurableCandidate
    } else {
        HandoffSalienceDecision::NoChange
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trivial_turns_skip_without_model_work() {
        assert_eq!(
            evaluate_handoff_salience(HandoffSalienceSignals::default()),
            HandoffSalienceDecision::NoChange
        );
    }

    #[test]
    fn any_explicit_working_state_admits_a_candidate() {
        for signals in [
            HandoffSalienceSignals {
                explicit_carry_request: true,
                ..Default::default()
            },
            HandoffSalienceSignals {
                unresolved_thread: true,
                ..Default::default()
            },
            HandoffSalienceSignals {
                commitment: true,
                ..Default::default()
            },
            HandoffSalienceSignals {
                explicit_preference: true,
                ..Default::default()
            },
        ] {
            assert_eq!(
                evaluate_handoff_salience(signals),
                HandoffSalienceDecision::DurableCandidate
            );
        }
    }
}
