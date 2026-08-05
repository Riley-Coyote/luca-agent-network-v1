//! Pure, deterministic continuity namespace and scope enforcement.
//!
//! This crate does not perform key custody, persistence, network access, or
//! encrypted-envelope work. It only establishes the exact authority boundary that later
//! storage and retrieval components must preserve.

#![forbid(unsafe_code)]

mod error;
mod fixtures;
mod namespace;
mod scope;

pub use error::ContinuityError;
pub use fixtures::{synthetic_fixture_index, FixtureIndex, SyntheticFixture};
pub use namespace::NamespaceKey;
pub use scope::NamespaceScope;
