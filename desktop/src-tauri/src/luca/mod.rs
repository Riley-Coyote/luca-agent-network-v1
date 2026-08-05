//! Luca-owned desktop authority components layered onto the Buzz application.

pub(crate) mod continuity_backup;
pub(crate) mod continuity_key_custody;
pub(crate) mod continuity_key_derivation;
pub(crate) mod continuity_revision_authority;
pub(crate) mod continuity_rotation;
pub(crate) mod continuity_runtime;
pub(crate) mod continuity_store;
pub(crate) mod local_broker_session;
pub(crate) mod managed_dispatch_store;
pub(crate) mod managed_message_outbox;
pub(crate) mod managed_message_publisher;
pub(crate) mod managed_permission;
pub(crate) mod owner_identity_recovery;
#[cfg(test)]
mod reliability_f10;
pub(crate) mod resident_registry;
pub(crate) mod signing_broker;
pub(crate) mod signing_transport;
