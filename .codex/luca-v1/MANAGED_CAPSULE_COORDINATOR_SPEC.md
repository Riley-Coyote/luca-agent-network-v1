# Managed Capsule Commit Coordinator V1

## Claim boundary

This service is why Luca V1 can claim conditional, idempotent Capsule commits.
NIP-AE events remain standard signed/encrypted portable artifacts, but generic
Nostr replaceable-event publication is not CAS and is not authoritative for a
Luca V1 head without a coordinator receipt.

## Request and result

```ts
interface CapsuleCommitRequestV1 {
  protocol: "luca.capsule.commit.v1";
  community_id: string;
  owner_pubkey: string;
  resident_pubkey: string;
  writer_epoch: number;
  installation_session_id: string;
  idempotency_key: string;
  operation: "slow_segment" | "fast_pair" | "restore_exact_events";
  expected: { slow_head_event_id?: string | null; current_pointer_event_id?: string | null };
  signed_events: string[]; // exact canonical Nostr event JSON
  commit_manifest: CapsuleCommitManifestV1;
}

interface CapsuleCommitManifestV1 {
  schema: "luca.capsule.commit-manifest.v1";
  coordinator_environment_id: string;
  operation: "slow_segment" | "fast_pair" | "restore_exact_events";
  owner_pubkey: string;
  resident_pubkey: string;
  active_installation_id: string;
  writer_epoch: number;
  idempotency_key: string;
  expected_head_ids: string[];
  ordered_events: Array<{
    role: "slow" | "digest" | "threads" | "current_pointer";
    event_id: string;
    event_json_sha256: string;
    outer_kind: number;
    outer_d_tag: string;
    outer_p_tag: string;
    encrypted_body_sha256: string;
    semantic_slug_sha256: string;
  }>;
  pointer_relationship_sha256?: string;
  request_sha256: string;
  attestation_key_id: string;
  attestation_signature: string;
}

type CapsuleCommitResultV1 =
  | { state: "committed" | "replayed"; receipt_id: string; event_ids: string[]; resulting_head_ids: string[] }
  | { state: "conflict"; current_head_ids: string[]; current_writer_epoch: number }
  | { state: "denied" | "invalid" | "unavailable"; code: string };

interface CapsuleCommitReceiptV1 {
  schema: "luca.capsule.commit-receipt.v1";
  canonicalization: "RFC8785";
  receipt_id: string;
  coordinator_environment_id: string;
  coordinator_signing_key_id: string;
  community_id: string;
  owner_pubkey: string;
  resident_pubkey: string;
  operation: "slow_segment" | "fast_pair" | "restore_exact_events";
  request_sha256: string;
  idempotency_key: string;
  installation_session_id: string;
  writer_epoch: number;
  event_ids: string[];
  resulting_head_ids: string[];
  committed_at: string;
  receipt_signature: string;
}

interface WriterTransferRequestV1 {
  schema: "luca.writer-transfer.v1";
  coordinator_environment_id: string;
  community_id: string;
  owner_pubkey: string;
  resident_pubkey: string;
  prior_writer_epoch: number;
  prior_installation_session_id: string;
  destination_installation_id: string;
  destination_attestation_pubkey: string;
  nonce: string;
  expires_at: string;
  owner_signature: string;
}

interface WriterTransferReceiptV1 {
  schema: "luca.writer-transfer-receipt.v1";
  canonicalization: "RFC8785";
  receipt_id: string;
  coordinator_environment_id: string;
  coordinator_signing_key_id: string;
  community_id: string;
  owner_pubkey: string;
  resident_pubkey: string;
  prior_writer_epoch: number;
  new_writer_epoch: number;
  revoked_installation_session_id: string;
  active_installation_session_id: string;
  destination_installation_id: string;
  destination_attestation_key_id: string;
  request_sha256: string;
  nonce: string;
  committed_at: string;
  receipt_signature: string;
}
```

Receipt signatures are Ed25519 over RFC 8785 bytes with the signature field
omitted and a versioned domain prefix. The managed environment publishes and
pins coordinator verification keys by ID; clients reject unknown keys or keys
invalid for the receipt's issuance interval. Commit results are only summaries;
the canonical signed receipt is fetched and verified before a head is trusted.

Authentication binds the owner session/community and TLS client/application
identity. Authorization additionally verifies every Nostr signature and the
owner/resident relationship; request text alone grants nothing.

`installation_session_id` is not an authenticator by itself. The destination
desktop generates an Ed25519 installation-attestation key in the OS keychain.
Activation/transfer registers its public key under a coordinator-issued session
ID. Each managed connection proves the private key with a server nonce and TLS
channel binding, then receives short-lived connection authorization scoped to
that resident/session/epoch. The private key and authorization never enter
events/tags, backups, ACP/model processes, logs or evidence artifacts. Revoking
the old registered key/session is part of the same coordinator transaction that
advances the epoch.

## Transaction

For the row keyed by `(community_id, owner_pubkey, resident_pubkey)`:

1. Parse with duplicate-key rejection and strict byte/event-count limits.
2. Verify manifest attestation, request hash, event IDs/signatures, public
   kinds/tags, exact event hashes/order/roles and owner/resident/environment
   binding. The coordinator never decrypts or independently validates encrypted
   semantic bodies.
3. Begin a Postgres transaction and lock the resident commit row (or equivalent
   advisory key plus row lock).
4. If `(resident, idempotency_key)` exists, require the exact request hash and
   return the immutable original receipt; a different request is denied.
5. Verify the authenticated installation session is the active server-side
   session for the request epoch; then compare writer epoch and expected current
   head(s). Mismatch returns conflict without persistence.
6. Persist exact signed event JSON, new head mapping and immutable receipt in the
   transaction. Fast-pair candidates and pointer are one commit; slow writes are
   one event/head.
7. Commit, then enqueue/fan out the already-persisted events. Fan-out failure
   does not repeat semantic commit; recovery resumes delivery from receipt.

The request hash uses RFC 8785 bytes and SHA-256 with the request-signature/
transport wrapper omitted as specified by the shared vectors. Receipt IDs and
hash domains are versioned.

Before attesting, the desktop broker decrypts/validates every semantic body and
cross-checks exact slug/d-tag derivation, checkpoint/token, pointer targets,
owner/resident and segment roles. `semantic_slug_sha256` and
`pointer_relationship_sha256` are domain-separated commitments, not plaintext.
The coordinator's guarantee is conditional/idempotent storage of this broker-
attested set—not truth of encrypted prose. On read, the client decrypts and
repeats semantic validation; a mismatch is `invalid` and never renderable even
if a storage receipt exists.

`attestation_signature` is the active installation-attestation key's Ed25519
signature over RFC 8785 bytes of the manifest with that field omitted, plus a
versioned domain prefix. The manifest carries the registered attestation key ID
in the shared schema vectors. The coordinator verifies it against the active
session before entering the transaction; a resident signature alone is
insufficient.

## Writer epoch and restore

The first owner-authorized resident activation creates epoch 1 plus a registered
installation-attestation session. The epoch is audit state; the attested
managed connection is the admission control for both Capsule commits and
managed-resident messages. Events may carry an installation ID/epoch tag for
diagnostics, but a copied signing key can forge that tag and it is never treated
as authentication. A destination
restore submits an owner-signed transfer naming resident, prior epoch,
destination installation ID, expiry and nonce. The coordinator transaction
increments the epoch, revokes the old attestation session, registers the new
attestation public key and returns an immutable transfer receipt. Old-session
Capsule commits conflict and old-session agent messages are rejected. This
coordinates Luca V1 clients; it does not revoke a copied Nostr key or prevent
generic signatures elsewhere from existing outside the managed Luca admission
path. A source installation that also controls the owner identity can request a
later owner-authorized transfer; V1 does not claim theft resistance against the
owner or an already-compromised owner key.

## Reader rule

The Luca client renders only heads reachable from an authenticated coordinator
receipt for its configured managed environment. V1 backup/restore is supported
only inside that same `coordinator_environment_id`; the destination fetches and
authenticates the retained receipt objects by ID. Cross-environment receipt
migration or coordinator-disaster portability is a known V1 limitation. A
direct generic-relay event at
the same address may be displayed in a diagnostic conflict view but cannot
silently replace current continuity. Protected backup contains exact signed
events and receipt IDs; destination restore must fetch/accept those exact event
IDs before activation.

Commit and transfer receipts remain fetchable by ID for as long as any active
head or supported resident backup references them. Export performs an online
retention preflight and refuses to produce a bundle whose required receipts are
not retained. Operator deletion makes restore visibly unavailable; clients
never accept a receipt body copied only from the bundle.

## Operations and failure proofs

- two clients race from one expected head: one commit, one conflict;
- identical retry before/after response loss returns one receipt;
- same idempotency key with different bytes denies;
- crash before DB commit, after DB commit/before response, and during fan-out;
- Postgres primary restart, network partition, stale replica and clock skew;
- unauthorized owner/community/resident/writer epoch and generic direct write;
- forged current epoch/tag using a copied resident key but no active
  installation credential rejects;
- exact fast slug/token/checkpoint/pointer cross-binding and reused unchanged
  segment proven in broker/client conformance vectors; coordinator proves exact
  manifest/event commitments without plaintext;
- old-installation agent reply and Capsule commit reject after writer transfer;
- TLS/auth secret handling, rate/size limits, safe logs and shared scanner;
- backup plus restore drill for Postgres, event blobs and media dependencies;
- health/monitoring distinguishes commit storage, fan-out and client reachability;
- managed environment outage leaves conversation/cached continuity visibly
  degraded and never fabricates a successful receipt.
