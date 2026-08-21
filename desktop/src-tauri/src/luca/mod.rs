//! Luca-owned desktop authority components layered onto the Buzz application.

pub(crate) mod artifacts;

// These accepted G2 kernel modules intentionally retain dormant export,
// rotation, and relay APIs for the deferred long-range roadmap. Keep their
// dead-code allowance local instead of weakening the desktop crate lint gate.
#[cfg(unix)]
pub(crate) mod artifact_backend;
#[cfg(unix)]
pub(crate) mod artifact_bridge;
#[cfg(unix)]
pub(crate) mod communication_bridge;
pub(crate) mod communication_turn_registry;
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
pub(crate) mod exchange;
pub(crate) mod exchange_plan;
pub(crate) mod exchange_relay;
pub(crate) mod exchange_store;
pub(crate) mod journal_jobs;
pub(crate) mod local_broker_session;
pub(crate) mod managed_cognition;
pub(crate) mod managed_continuity;
mod managed_dispatch_routing;
pub(crate) mod managed_dispatch_store;
#[cfg(unix)]
pub(crate) mod managed_mcp;
mod managed_message_event;
pub(crate) mod managed_message_outbox;
mod managed_message_outbox_io;
pub(crate) mod managed_message_publisher;
pub(crate) mod managed_permission;
pub(crate) mod managed_presentation;
pub(crate) mod mcp_registry;
pub(crate) mod native_provisioning;
pub(crate) mod operator_forge;
pub(crate) mod owner_brain;
pub(crate) mod owner_brain_store;
pub(crate) mod owner_identity_recovery;
#[cfg(test)]
mod reliability_f10;
#[cfg(unix)]
pub(crate) mod repository_bridge;
pub(crate) mod resident_documents;
pub(crate) mod resident_notebook;
pub(crate) mod resident_registry;
pub(crate) mod signing_broker;
pub(crate) mod signing_transport;
pub(crate) mod visits;
