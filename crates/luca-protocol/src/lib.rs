//! Shared, bounded Luca V1 wire contracts.
//!
//! This crate deliberately contains no key custody, signing capability,
//! routing, continuity, room, or persistence behavior. It gives the M1
//! authority components one strict representation for canonical JSON,
//! identifiers, managed final publication, owner recovery, diagnostics, and
//! body-safe continuity. Continuity contracts reject semantic invalidity while
//! deserializing and contain no storage or key-custody behavior.

#![forbid(unsafe_code)]

mod brain;
mod canonical;
mod connected_brain;
mod continuity;
mod diagnostic;
mod frame;
mod ids;
mod managed_permission;
mod message_publish;
mod notebook;
mod owner_identity;
mod relay_auth;

pub use brain::*;
pub use canonical::{
    canonical_sha256, canonicalize, parse_and_canonicalize_strict, parse_strict_json,
    CanonicalError,
};
pub use connected_brain::*;
pub use continuity::*;
pub use diagnostic::{SafeDiagnosticV1, SAFE_DIAGNOSTIC_PROTOCOL};
pub use frame::{
    decode_length_prefixed_frame, decode_length_prefixed_result_frame,
    encode_length_prefixed_frame, encode_length_prefixed_result_frame, BrokerOperationV1,
    FrameError, OperationV1, SigningFrameV1, SigningResultFrameV1, BROKER_FRAME_MAX_BYTES,
    SIGNING_FRAME_PROTOCOL,
};
pub use ids::{
    BundleId, CanonicalTimestamp, Hex64, OpaqueId, ProtocolValueError, SafeU53, Sha256Ref,
    JSON_SAFE_INTEGER_MAX,
};
pub use managed_permission::{
    ManagedPermissionDecisionV1, ManagedPermissionDispositionV1, ManagedPermissionError,
    ManagedPermissionOptionV1, ManagedPermissionRequestV1, MANAGED_PERMISSION_PROTOCOL,
    MANAGED_PERMISSION_TIMEOUT_SECS,
};
pub use message_publish::{
    derive_message_publish_idempotency_key, ManagedMessagePublishRequestV1,
    ManagedMessagePublishResultV1, MessagePublishError, MAX_FINAL_DRAFT_BYTES, MAX_RESOLVED_P_TAGS,
    MESSAGE_PUBLISH_PROTOCOL,
};
pub use notebook::*;
pub use owner_identity::{
    OwnerIdentityBundleV1, OwnerIdentityError, SecretNsec, OWNER_IDENTITY_CANONICALIZATION,
    OWNER_IDENTITY_FORMAT, OWNER_IDENTITY_VERSION,
};
pub use relay_auth::{
    NipOaOwnerAttestationV1, RelayAuthError, RelayAuthPurposeV1, RelayAuthSignRequestV1,
    RelayAuthSignResultV1, RelayHttpMethodV1, MAX_NIP_OA_CONDITIONS_BYTES,
    MAX_RELAY_AUTH_CHALLENGE_BYTES, MAX_RELAY_AUTH_EVENT_BYTES, MAX_RELAY_AUTH_FRESHNESS_SECS,
    MAX_RELAY_AUTH_URL_BYTES, RELAY_AUTH_SIGN_PROTOCOL,
};
