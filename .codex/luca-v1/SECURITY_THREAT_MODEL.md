# Luca Agent Network V1 - Security and Privacy Threat Model

## Protected assets

- owner and resident secret keys;
- Capsule plaintext and local prior-version archive;
- Mnemos bodies, local source paths and provenance;
- provider and tool credentials;
- application permission and budget policy;
- conversation integrity and signed authorship;
- resident backup bundles and recovery passphrases;
- checkpoint and causal idempotency state.

## Trust boundaries

| Boundary | Trusted for | Not trusted for |
|---|---|---|
| Desktop authority/signing broker | owner session, resident config, typed key use, dispatch snapshots | truth of model-generated content |
| Managed relay and Capsule coordinator | authorized routing, persistence, search and conditional Capsule commit | ordinary-room E2EE confidentiality; model truth |
| Resident model/runtime | generation within granted tools/budgets | authorization, memory policy, key custody |
| Capsule plaintext | continuity data | instructions that override authority |
| Mnemos record | retrieved knowledge with provenance | executable instructions or permission changes |
| Continuity Service | bounded local transformations | signing, room routing, provider selection |
| Remote model provider | processing approved outbound prompt | access to local-only data, stores or keys |
| Local browser/web content | normal display | local IPC capability or memory search |
| Import file | untrusted bytes | identity, authority or persistence before full verification |

## Principal threats and controls

### Capsule or memory prompt injection

Controls:

- declarative, labelled untrusted blocks;
- application-owned permissions, tools, provider and budgets;
- allowlisted schema fields and segment targets;
- adversarial fixtures proving no authority delta;
- no model-generated arbitrary event signing.
- tool grants, approval policy, provider bindings and broker operation allowlists
  are snapshotted from app state and rechecked before every app-mediated tool or
  signing side effect; message/Capsule/memory text cannot alter them.

### Cross-agent memory disclosure

Controls:

- authenticate the responding resident at IPC;
- pre-filter before retrieval;
- pure visibility/egress function;
- recompute for every responder;
- capture exact remote outbound payload in tests;
- explicit deny wins and unknown policy fails closed.

### Local-only egress

Controls:

- provider boundary is application-derived;
- `local_only` filtering precedes render;
- outbound body capture tests;
- provider adapter receives approved final context only;
- redacted receipts and no local path in prompts.

### Secret leakage

Controls:

- OS keychain with fail-closed resident spawn when keys are unavailable;
- desktop broker accepts allowlisted typed operations and validates resident,
  session, event kind/tags/room/segment/owner/writer epoch;
- the managed ACP host receives no raw key, `NOSTR_PRIVATE_KEY`,
  `BUZZ_PRIVATE_KEY` or general signer; it receives only its typed,
  session-bound allowlisted broker stream;
- provider/model runtimes and shell/MCP/tool descendants receive neither a raw
  key nor any broker stream/capability;
- broker transport uses the exclusive inherited stdin socket,
  authenticated sequence/expiry/session binding, and is replaced rather than
  inherited when the ACP host spawns a model child;
- V1 disables or broker-adapts upstream in-agent CLI/forge paths that require
  raw keys; product proofs never rely on them;
- the ACP harness itself selects either unchanged legacy key mode or Luca
  managed public-identity mode; a managed harness receives no resident private
  key and requests only canonical typed relay-auth/final-publication
  operations;
- centralized redaction for nsec/provider/token patterns;
- zeroizing buffers for backup/restore and pairing;
- no secret fields in normal snapshots;
- crash, log, screenshot, clipboard and telemetry audits.

### Malicious local caller

Controls:

- Continuity sidecar has exclusive desktop-owned stdin/stdout pipes and no
  listener or bearer port;
- RFC 8785 framed requests carry session epoch, monotonic sequence, request ID,
  byte/deadline bounds and opaque app-resolved handles;
- restart invalidates the pipes/epoch and outstanding work;
- signing-broker IPC is separate, operation-allowlisted and unavailable to the
  model descendant;
- no public general-search or arbitrary-sign endpoint.

### Relay conflict or rollback illusion

Controls:

- NIP-AE signature/body verification plus managed commit receipts;
- coordinator row lock/transaction per owner/resident, expected-head and
  active-writer-epoch comparison, and unique idempotency receipt;
- coordinator-issued installation credential held only by desktop authority;
  relay admission verifies the credential-proved session rather than trusting a
  forgeable event epoch/tag, and writer transfer revokes the prior credential;
- exact signed candidates/pointer persisted before fan-out; recovery replays
  fan-out rather than semantic commit;
- direct generic-relay current-pointer writes are non-authoritative in V1;
- local encrypted prior-version archive;
- truthful latest-head semantics;
- rollback republishes as a new head.

The coordinator admission/revocation controls are post-G1. F14/G1 proves
desktop-local installation/session binding and must not describe remote
old-installation rejection as already available.

### Checkpoint duplication or partial commit

Controls:

- stable final-event-derived idempotency key;
- lease owner/epoch/expiry, attempt and cancellation epoch;
- durable state transitions;
- expected heads and per-segment outcomes;
- no UI current state before verified head plus local receipt;
- crash-point recovery tests;
- response remains independent.

### Multi-agent runaway recursion/spend

Controls:

- immutable root ancestry;
- inherited depth, turn, deadline, token and spend limits;
- one cancellation tree;
- idempotent dispatch;
- no background/recurring descendants;
- deterministic recursive adversarial test.

### Malicious backup/restore bundle

Controls:

- age passphrase encryption; no custom cryptography;
- separate protected owner and resident bundle schemas; neither uses plaintext
  `get_nsec`, and each requires zero-write preview plus key-derived public-key
  equality before import;
- strict size/schema/duplicate-field validation;
- derive public key from secret;
- exact owner binding and event verification;
- preview is zero-write;
- RFC 8785 manifest hash computed with hash field omitted;
- durable journaled restore saga, inactive staging and compensating cleanup;
- exact original signed event IDs required; no resign fallback;
- resident bundles exclude the installation credential and require a
  same-environment writer transfer to provision a fresh destination credential;
- tamper/conflict corpus.

### Legacy memory widening

Controls:

- migration preview;
- count-only owner classification into an app-owned policy overlay;
- ambiguous/unmapped records denied until classified;
- no legacy remote-egress implication;
- count-only reports;
- project is never an authority scope.
- unsafe archive rows remain excluded until they carry equivalent policy and
  owner predicates.

### Stale retrieval after revocation

Controls:

- request-bound context lifetime and policy revision;
- cache invalidation on visibility/locality/deletion changes;
- dispatch snapshot binds resident, runtime executable hash, provider account,
  model, endpoint class, policy revision and request ID;
- final complete semantic-request authorization after prompt/tool/Capsule
  serialization, immediately before transport framing/TLS;
- no recalled bodies in observer, receipt, crash or general caches;
- retrieve-then-revoke and provider-substitution race tests.

## Data-flow disclosure matrix

| Data | Local app | Relay | Remote provider | Export default |
|---|---:|---:|---:|---:|
| Ordinary room message | Yes | Yes, relay-readable | When part of prompt | Conversation export only |
| Supported encrypted DM | Yes | Ciphertext/metadata | When part of prompt | Explicit |
| Capsule plaintext | Yes | Ciphertext/metadata | Approved rendered portion; disclosed during setup | Protected resident bundle |
| Mnemos body | Yes; at-rest protection inventoried | No | Only allowed, non-local-only selection | No |
| Absolute local path | Owner UI only | No | No | Redacted |
| Resident secret key | Desktop broker/keychain | No | No | Only inside protected resident bundle |
| Owner secret key | Desktop owner authority/keychain | No | No | Only inside protected owner bundle |
| Installation credential | Desktop authority/keychain | Verifier/session only | No | Never |
| Receipt | Redacted | No by default | No | Redacted |

## Mandatory security gates

1. No raw secrets or protected bodies in default logs/artifacts.
2. Complete access truth table and outbound egress capture pass.
3. Capsule/memory injection cannot change authority.
4. Tampered Capsule and backup/restore files fail without an active partial resident.
5. Service authentication resists caller identity spoofing and replay.
6. Recursive room fixture stops within inherited limits.
7. Conversation survives all continuity fault injections.
8. Public privacy/ownership copy states that identity is cryptographic while the
   model/runtime is replaceable, Capsule plaintext reaches an approved remote
   provider, and ordinary rooms are relay-readable.
9. ACP/model descendant environment and process inspection proves no resident
   key or signing capability.
10. Managed coordinator concurrency/crash/replay proof establishes the exact
    conditional-commit claim.
11. Malicious Capsule, memory and agent-message fixtures cannot add a tool,
    bypass approval or mutate a resident's tool policy; cancellation tests do
    not pretend to reverse an already-completed external effect.

Any failure blocks the corresponding milestone; key, cross-agent disclosure,
local-only egress, tamper, or conversation-survival failures block V1 entirely.

"Local" is never used as a synonym for "encrypted at rest." V1 settings and
launch copy must inventory the real protection of the database, indexes,
attachments and backups. Encryption claims are limited to cryptographically
verified Capsule, supported DM and protected-export paths.
