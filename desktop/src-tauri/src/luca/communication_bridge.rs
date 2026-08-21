//! Compatibility cleanup for the retired communication-action broker.

/// Stop the retired per-resident communication broker.
///
/// New managed sessions do not create this broker, so shutdown is a no-op.
pub(crate) fn stop_communication_broker(_resident_pubkey: &str) -> Result<(), String> {
    Ok(())
}
