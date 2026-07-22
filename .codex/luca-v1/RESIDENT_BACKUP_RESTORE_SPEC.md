# Cryptographic Resident Backup and Restore V1

## Honest product boundary

Buzz snapshots duplicate behavioral templates and intentionally mint new keys.
Luca backup/restore preserves the exact resident signing identity and current
Continuity Capsule. The source key remains valid; this is not irreversible
movement, hardware-backed non-exportability, revocation, or proof that no copy
exists.

V1 is deliberately narrower than disaster-portable federation: a resident
bundle restores only against the same managed coordinator environment that
issued and retains its commit receipts. Cross-environment receipt transfer is
deferred.

The product presents separate actions:

- **Duplicate agent template** - no secret key; creates a new identity.
- **Back up this resident identity** - protected secret material and exact
  signed Capsule events.
- **Restore a resident identity** - same owner, exact public key and verified
  events; may transfer the managed coordinator's active-writer epoch.

## Same-owner and active-writer boundary

NIP-AE Capsule encryption is scoped to the resident and owner keypair. V1
restore requires the same Luca owner identity, recovered separately. A
different owner is rejected.

The coordinator-issued installation credential is deliberately excluded from
the bundle. Successful writer transfer provisions a new destination credential
and revokes the source credential; the numeric epoch/tag is audit metadata, not
an authenticator.

The managed coordinator allows one active V1 writer epoch per resident. Restore
activation requires an owner-signed writer-transfer operation, which invalidates
the old app session's coordinator epoch. This prevents accidental concurrent V1
writes but cannot make a copied signing key cryptographically disappear; the UI
and launch copy say so explicitly.

## Protected bundle

File extension: `.luca-resident.age`  
Outer format: passphrase-protected age v1 file  
Inner format: RFC 8785 canonical JSON `luca.resident.bundle.v1`

The passphrase is user-supplied or generated as a high-entropy recovery phrase
and confirmed before export. Plaintext nsecs are never written to disk, logs,
clipboard history, telemetry or screenshots. Temporary plaintext uses
zeroizing buffers where the platform permits.

```ts
interface ResidentBundleV1 {
  format: "luca.resident.bundle";
  version: 1;
  canonicalization: "RFC8785";
  bundle_id: string;
  exported_at: string;
  owner_pubkey: string;
  resident_pubkey: string;
  resident_secret_nsec: string;
  coordinator: {
    coordinator_environment_id: string;
    exported_writer_epoch: number;
    commit_receipts: Array<{
      receipt_id: string;
      receipt_sha256: string;
      resulting_head_ids: string[];
    }>;
  };
  persona: {
    schema_version: string;
    display_name: string;
    runtime_provider: string;
    model_preference?: string;
    system_authority_policy: object;
    capsule_egress_policy: "local_only" | "approved_remote";
  };
  capsule_events: Array<{
    segment: "core" | "self" | "user" | "convictions" | "digest" | "threads" | "current_pointer";
    exact_event_json: string;
    event_id: string;
    content_sha256: string;
    ciphertext_sha256: string;
    event_json_sha256: string;
    managed_commit_receipt_id: string;
    managed_commit_receipt_sha256: string;
  }>;
  archive?: Array<{ exact_event_json: string; event_id: string }>;
  manifest_sha256: string;
}
```

`manifest_sha256` is SHA-256 over the RFC 8785 bytes of the entire manifest with
the `manifest_sha256` member omitted. Duplicate JSON member names, non-I-JSON
numbers/strings, unknown canonicalization versions and size overflow reject.
Every `event_id` must equal the Nostr ID derived from `exact_event_json`; there
is no resign fallback.

The secret exists only inside the encrypted payload. Export defaults to current
heads only; optional encrypted local history is explicit and size-bound. The
universal brain, transcript/cache, provider/tool credentials, source paths and
provider context are never included.

The bundle contains receipt identifiers and hashes, not coordinator authority.
During preview the destination must authenticate to the configured coordinator,
require an exact `coordinator_environment_id` match, fetch every retained
receipt by ID, verify its canonical bytes/hash and require that its recorded
head set contains the bundled exact event IDs. A receipt copied into the bundle
without a matching coordinator object is insufficient. Restore rejects if any
receipt is missing, pruned, from another environment or has a different hash.

## Export protocol

1. Reauthenticate the owner and disclose the difference from template export.
2. Read the resident secret only inside the desktop signing/key authority.
3. Record the coordinator environment ID; fetch and verify managed receipts,
   slow heads, current pointer and its exact
   digest/threads events plus owner/resident binding.
4. Build the manifest, compute exact event/ciphertext/content hashes, then the
   RFC 8785 manifest hash with its hash field omitted.
5. Stream-encrypt directly to a restricted temporary file with the maintained
   Rust `age` passphrase API, finalize, sync, then rename to the selected file.
6. Read back/decrypt in memory and re-verify manifest, exact event IDs and
   resident public key before reporting success.
7. Show bundle ID, owner/resident public keys, segments, exclusions and the
   warning that the source copy remains usable.

## Restore saga

Preview is always zero-write. Confirmation starts a durable, recoverable saga:

1. Parse the age header, request passphrase without persistence, decrypt under
   strict limits, and validate schema/canonicalization/manifest hash.
2. Derive the resident public key from the contained secret and require exact
   equality; require current owner public key equality.
3. Verify every exact event's ID/signature/kind/tags/owner binding/address,
   decrypted schema, hashes and managed receipt reference.
4. Show identity, current continuity, exact exclusions and conflicts with no
   writes.
5. On confirmation, create and fsync an app-owned import journal. Stage an
   inactive persona record.
6. Write the key to the OS keychain, read it back through the broker and derive
   the expected public key. On failure, compensate and keep the persona inactive.
7. Commit the app database persona/config transaction, still inactive.
8. Require the destination's configured coordinator environment ID to equal the
   bundle value. Fetch and authenticate each retained commit receipt by ID and
   hash, then submit the exact original signed Capsule events to that managed
   relay. If it cannot accept/fetch and verify the exact IDs, restore fails; Luca
   never silently re-signs them.
9. Obtain an owner-authorized coordinator writer-epoch transfer, persist its
   receipt, verify every current head, then activate the resident. The transfer
   increments the active installation epoch, atomically revokes the source
   credential and provisions a new destination credential used by both Capsule
   commits and managed resident-message admission.
10. Launch a fresh runtime and prove the same resident public key and current
    continuity. Mark the journal complete.

Recovery examines the journal and either resumes the next idempotent step or
performs explicit compensating cleanup. Luca never describes the keychain,
SQLite and relay operations as one atomic transaction.

## Clean-environment proof

The destination has a clean app profile, the same owner restored separately,
and no source Mnemos database, transcript cache, resident process or provider
context. Pass requires:

- exact resident public key;
- exact original current Capsule event IDs and valid managed receipts;
- correct identity/relationship/digest/threads behavior;
- source installation still demonstrably capable of signing, alongside the
  disclosed fact that its stale installation epoch now prevents managed
  Capsule commits and managed resident messages;
- honest loss of detailed archive knowledge;
- tampered secret/event/binding/manifest/passphrase/conflict/partial-saga
  fixtures rejecting without an active partial resident.
- wrong/missing/pruned/mismatched coordinator environment or receipt fixtures
  rejecting during zero-write preview;
- a stale source installation failing both a managed Capsule write and a
  managed room reply after writer transfer.
- a copied resident key forging the destination epoch/tag still failing without
  the destination installation credential.

## Dependency rule

Use the maintained Rust `age` passphrase API and binary age format. Pinning,
license inventory, memory-handling tests and platform review are build tasks. Do
not implement custom cryptography.
