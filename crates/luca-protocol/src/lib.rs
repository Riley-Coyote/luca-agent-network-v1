//! Shared, bounded Luca V1 wire contracts.
//!
//! This crate deliberately contains no key custody, signing capability,
//! routing, continuity, room, or persistence behavior. It gives the M1
//! authority components one strict representation for canonical JSON,
//! identifiers, managed final publication, owner recovery, diagnostics, and
//! body-safe continuity. Continuity contracts reject semantic invalidity while
//! deserializing and contain no storage or key-custody behavior.

#![forbid(unsafe_code)]

mod artifact;
mod brain;
mod canonical;
mod capability;
mod communications;
mod connected_brain;
mod continuity;
mod diagnostic;
mod exchange;
mod frame;
mod ids;
mod managed_audience;
mod managed_permission;
mod managed_presentation;
mod message_publish;
mod notebook;
mod owner_identity;
mod relay_auth;

pub use artifact::*;
pub use brain::*;
pub use canonical::{
    canonical_sha256, canonicalize, parse_and_canonicalize_strict, parse_strict_json,
    CanonicalError,
};
pub use capability::*;
pub use communications::*;
pub use connected_brain::*;
pub use continuity::*;
pub use diagnostic::{SafeDiagnosticV1, SAFE_DIAGNOSTIC_PROTOCOL};
pub use exchange::{
    derive_exchange_id, ExchangeError, ExchangePhase, ExchangeRecordV1, ExchangeStateV1,
    ExchangeTurnTag, EXCHANGE_BUCKET_CEILING, EXCHANGE_DEFAULT_BUCKET, EXCHANGE_DEFAULT_TTL_SECS,
    EXCHANGE_GO_INCREMENT, EXCHANGE_MAX_DEPTH, EXCHANGE_MAX_MEMBERS, EXCHANGE_MIN_MEMBERS,
    EXCHANGE_PROTOCOL, EXCHANGE_TAG,
};
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
pub use managed_audience::{ManagedAudienceIntentV1, MAX_MANAGED_AUDIENCE_RESIDENTS};
pub use managed_permission::{
    ManagedPermissionDecisionV1, ManagedPermissionDispositionV1, ManagedPermissionError,
    ManagedPermissionOptionV1, ManagedPermissionRequestV1, MANAGED_PERMISSION_PROTOCOL,
    MANAGED_PERMISSION_TIMEOUT_SECS,
};
pub use managed_presentation::{
    ManagedPresentationError, ManagedPresentationFailureV1, ManagedPresentationFrameV1,
    ManagedPresentationKindV1, ManagedPresentationPhaseV1, MANAGED_PRESENTATION_PROTOCOL,
    MAX_MANAGED_PRESENTATION_CHUNK_BYTES, MAX_MANAGED_PRESENTATION_FRAME_BYTES,
};
pub use message_publish::{
    derive_message_publish_idempotency_key, ManagedMessagePublishRequestV1,
    ManagedMessagePublishResultV1, ManagedResponseSurfaceV1, MessagePublishError,
    MANAGED_DISPATCH_RECEIPT_TAG, MAX_FINAL_DRAFT_BYTES, MAX_RESOLVED_P_TAGS,
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
