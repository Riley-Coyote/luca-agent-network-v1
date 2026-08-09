//! Luca-owned desktop authority components layered onto the Buzz application.

// These accepted G2 kernel modules intentionally retain dormant export,
// rotation, and relay APIs for the deferred long-range roadmap. Keep their
// dead-code allowance local instead of weakening the desktop crate lint gate.
pub(crate) mod connected_brain;
#[allow(dead_code)]
pub(crate) mod continuity_backup;
#[allow(dead_code)]
pub(crate) mod continuity_capsule;
#[allow(dead_code)]
pub(crate) mod continuity_capsule_relay;
pub(crate) mod continuity_context;
pub(crate) mod continuity_jobs;
#[allow(dead_code)]
pub(crate) mod continuity_key_custody;
pub(crate) mod continuity_key_derivation;
#[allow(dead_code)]
pub(crate) mod continuity_revision_authority;
#[allow(dead_code)]
pub(crate) mod continuity_rotation;
#[allow(dead_code)]
pub(crate) mod continuity_runtime;
#[allow(dead_code)]
pub(crate) mod continuity_store;
pub(crate) mod journal_jobs;
pub(crate) mod local_broker_session;
pub(crate) mod managed_cognition;
pub(crate) mod managed_continuity;
pub(crate) mod managed_dispatch_store;
pub(crate) mod managed_message_outbox;
pub(crate) mod managed_message_publisher;
pub(crate) mod managed_permission;
pub(crate) mod owner_brain;
pub(crate) mod owner_brain_store;
pub(crate) mod owner_identity_recovery;
#[cfg(test)]
mod reliability_f10;
#[cfg(unix)]
pub(crate) mod repository_bridge;
pub(crate) mod resident_notebook;
pub(crate) mod resident_registry;
pub(crate) mod signing_broker;
pub(crate) mod signing_transport;
