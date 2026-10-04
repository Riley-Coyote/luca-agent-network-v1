//! Pure arbitration for receipt updates, not authority to dispatch native work.

use super::RuntimeTaskStateV1;

const STOP_WON: &str = "The stop request won before completion was committed.";
const SHUTTING_DOWN: &str = "Polyphonic is shutting down; completion was not committed.";
const ALREADY_SETTLED: &str = "The task already has a committed terminal outcome.";

/// Decide under the task-memory lock before persisting the next projection.
///
/// `Ok(false)` ignores late evidence without changing the durable outcome.
/// Rejected success is an error so the caller cannot treat a skipped commit as
/// authorization to bind a result or schedule a summary. Same-state refreshes
/// remain valid, including a previously committed success during shutdown.
pub(super) fn transition_allowed(
    current: Option<RuntimeTaskStateV1>,
    next: RuntimeTaskStateV1,
    shutting_down: bool,
) -> Result<bool, &'static str> {
    use RuntimeTaskStateV1::*;

    if current == Some(next) {
        return Ok(true);
    }
    if current == Some(Stopping) && next == Succeeded {
        return Err(STOP_WON);
    }
    if shutting_down && next == Succeeded {
        return Err(SHUTTING_DOWN);
    }
    if matches!(current, Some(Succeeded | Stopped | Failed | Interrupted)) {
        if next == Succeeded {
            return Err(ALREADY_SETTLED);
        }
        return Ok(false);
    }
    if matches!(current, Some(Stopping | AwaitingNative))
        && matches!(next, Queued | Active | Stopping | AwaitingNative)
    {
        return Ok(false);
    }
    Ok(true)
}

/// Native handoffs and terminal receipts never authorize a local stop request.
pub(super) fn can_cancel(state: RuntimeTaskStateV1) -> bool {
    matches!(
        state,
        RuntimeTaskStateV1::Queued | RuntimeTaskStateV1::Active | RuntimeTaskStateV1::Stopping
    )
}

#[cfg(test)]
#[path = "lifecycle_tests.rs"]
mod tests;
