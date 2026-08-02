//! Luca-owned desktop authority components layered onto the Buzz application.

pub(crate) mod local_broker_session;
pub(crate) mod managed_dispatch_store;
pub(crate) mod managed_message_outbox;
pub(crate) mod managed_message_publisher;
#[cfg(test)]
mod reliability_f10;
pub(crate) mod resident_registry;
pub(crate) mod signing_broker;
pub(crate) mod signing_transport;
