# G2 build specification

## Product outcome

G2 adds dependable continuity, a governed owner brain, and bounded opt-in inner
life to the working G1 resident messaging system. A resident keeps the same
cryptographic identity across runtime sessions, receives authorized continuity
before responding, maintains an inspectable private notebook after durable
turns, and may perform tightly limited reflection while Luca is open.

This is still a direct conversation product. It does not add a conductor,
background agent society, emotional simulation, or autonomous tool use.

## Authority model

| Concern | Authority |
|---|---|
| Conversation chronology/authorship | Signed Buzz/Luca events |
| Resident identity | Resident public key |
| Resident continuity | Isolated encrypted resident namespace |
| Owner knowledge | Separate encrypted owner-brain namespace |
| Room participation | Canonical dispatch set, not memory authority |
| Portable state | Compact NIP-AE Capsule projection only |
| Final response publication | Existing desktop/outbox authority |
| Memory access | Explicit scope and persisted grant |

Continuity is an optional input to a turn, never a prerequisite for messaging.

## Package boundaries

### `luca-protocol`

Owns versioned, serializable contracts and language-neutral fixtures:

- `ContinuityNamespaceV1`
- `ContinuityScopeV1`
- `ContinuityRecordV1`
- `ContinuityContextRequestV1`
- `ContinuityContextResultV1`
- `ContinuityPacketV1`
- `ContinuityMutationV1`
- `ContinuityJobV1`
- `BrainGrantV1`
- `ImportDiscoveryReportV1`
- `ImportPlanV1`
- `ImportCommitReceiptV1`
- `CognitionScheduleV1`
- `ProactiveMessageCandidateV1`
- `PortableContinuityCapsuleV1`
- `LucaBackupManifestV1`

Context layers report exactly one of `ready`, `empty`, `denied`, `stale`,
`locked`, `unavailable`, `timeout`, or `invalid`. Diagnostics are body-free.

### `luca-continuity`

A pure Rust crate owns deterministic continuity behavior:

- namespace and scope enforcement;
- authenticated record envelopes;
- in-memory lexical and optional vector retrieval;
- bounded spreading activation;
- provenance and receipts;
- revisions, rollback, correction, archive, and forget semantics;
- import parsing/staging/deduplication primitives;
- cognition scheduling policy and proactive-candidate gates.

It does not embed Python, Supabase, Edge Functions, remote schedulers, desktop
key custody, Tauri commands, or provider credentials.

### Trusted desktop process

The desktop owns:

- OS keychain lifecycle and namespace-key derivation;
- encrypted SQLite persistence and rotation journal;
- in-memory index hydration after unlock;
- backup/restore and NIP-AE Capsule operations;
- runtime/model calls for resident-authored reflection;
- lifecycle scheduling, cancellations, grants, and Tauri commands;
- integration with the existing managed dispatch and durable final outbox.

### ACP/runtime seam

The ACP path receives one bounded, read-only continuity packet before a resident
turn. Model/runtime descendants receive no continuity keys or signing ability.
Post-turn jobs are created only after the exact signed final event is
relay-accepted and the local outbox is terminal.

## Storage and cryptography

1. Generate one 256-bit continuity master key with the OS keychain. There is no
   plaintext fallback.
2. Derive owner-brain and per-resident keys with HKDF-SHA256 and domain-separated
   info that binds owner key, namespace, schema, and key version.
3. Encrypt sensitive records with XChaCha20-Poly1305 and a unique random 192-bit
   nonce.
4. Canonical AAD binds owner key, resident key where applicable, record ID,
   record type, scope, schema version, and key version.
5. Persist ciphertext and minimized body-free metadata only. Titles, tags,
   memory bodies, journal text, context packets, and decrypted index terms do
   not enter SQLite, WAL/SHM, logs, crash reports, or evidence.
6. Hydrate a process-memory FTS5 database after unlock. Lexical seeds feed a
   bounded graph walk; optional vectors remain memory-only and remote embeddings
   are off by default.
7. Rotation uses an authenticated, crash-recoverable journal and never leaves a
   record ambiguous between key versions.
8. Backup is an age passphrase-protected Luca archive containing identity
   recovery material, encrypted continuity, manifests, mappings, integrity
   hashes, and the continuity master key wrapped inside the age envelope. The
   unwrapped key exists only in process memory. Preview and validation perform
   zero writes; after explicit confirmation, restore transactionally installs
   the key into the destination OS keychain before making restored ciphertext
   visible. A fresh-keychain restore must prove records decrypt successfully.

## Pre-turn continuity

For each responding resident:

1. Resolve owner, resident, binding, conversation, canonical dispatch set, and
   provider-egress policy.
2. Load bounded, correctly ordered signed DM or plain-room history.
3. Load the valid portable Capsule identity/current-state projection.
4. Load active handoff and hypomnema.
5. Retrieve resident-private engrams through local lexical search and bounded
   graph activation.
6. Retrieve only owner-brain/project/room sources allowed by current persisted
   grants for that exact resident and provider destination.
7. Assemble at most 48 KiB of structurally delimited untrusted reference
   material plus provenance and a body-free receipt.

Retrieval is read-only. A failed layer contributes a typed status and does not
block other layers or the conversation.

For the G2.1 plain-room parity slice, only ordinary `stream` rooms receive new
replay behavior. The replay block has a fixed 16 KiB rendered UTF-8 ceiling in
addition to the existing message-count limit, retains the newest complete
messages that fit, and never slices UTF-8. Existing DM/thread behavior and
forum/workflow semantics remain unchanged. The later complete continuity packet
still enforces its independent 48 KiB total ceiling.

## Durable post-turn metabolism

After final publication becomes durable, an idempotent job keyed by exact source
event may update resident-private:

- handoff and unresolved threads;
- commitments and preferences;
- hypomnema and journal;
- associative engrams and typed connections;
- high-evidence identity, relationship, or conviction notes.

Every change retains prior content, confidence, provenance, authorship,
timestamps, and a complete revision chain. Explicit owner corrections are
pinned authority. Sensitive profiling and psychometric inference are rejected.
Owner-shared knowledge becomes a non-blocking proposal and never auto-commits.

Automatic identity, relationship, and conviction changes require either an
explicit owner statement or at least two distinct signed source events from two
conversations separated by 24 hours. Without an explicit correction, each
category may auto-mutate at most once per resident per rolling seven days, and
a semantically equivalent topic fingerprint is suppressed for 30 days. These
limits are deterministic clock state, not model judgment.

Reflection carrying the resident's voice must run through that resident's
configured runtime and model. Deterministic maintenance is labeled system
maintenance and cannot impersonate the resident. Runtime substitution is
prohibited.

Observer continuity is permitted only for residents in the canonical dispatch
set for the owner turn. Residents never receive another resident's notebook.

## Universal brain and grants

The owner brain is its own namespace. Setup grants bind:

- owner;
- resident;
- source/scope;
- provider/runtime egress destination;
- grant version and timestamps.

Grants are visible, revocable, and independently receipted. Binding changes
mark affected egress grants stale and deny recall until reconfirmed. Unknown
egress is remote.

## Import system

Discovery adapters may report safe, credential-excluded sources from legacy
Luca, standalone Mnemos, Hermes, OpenClaw, Claude Code, Codex, and recognized
local project/knowledge folders. Manual imports support ChatGPT/Claude exports,
Luca/Mnemos/Polyphonic archives, Obsidian/Markdown, selected files, and
directories.

Local parsers cover Markdown, text, HTML, JSON/JSONL, YAML, CSV, PDF, DOCX, and
text-like project files. Unsupported/binary inputs remain visible in preview.
Provider credentials, pairing state, tokens, runtime secrets, and native
schedules are excluded.

Every import follows discover -> parse -> normalize -> hash -> deduplicate ->
preview -> atomic commit. A failed/cancelled transaction exposes no staged row.
Reimport is idempotent; changed sources show a diff. General knowledge defaults
to the owner brain; agent-native memory maps to a detected resident only with an
identity-backed mapping.

Historical chats live in Imported History and recall, not the live sidebar.
Owner-signed import manifests preserve original source, author labels,
timestamps, thread IDs, and archive hashes without fabricating agent signatures.
Model-assisted organization is explicit opt-in with provider-egress consent.

## Scheduled inner life

Inner life is per-resident, opt-in, and off by default. It runs only while Luca
is open, including sleep/resume. A relaunch may run at most one bounded catch-up
cycle. User conversation preempts scheduled work. Tools and permission requests
are denied by default.

Balanced defaults:

- idle at least 15 minutes;
- eligible every 4 hours;
- at most 3 model-assisted cycles per resident per day;
- at most 1 proactive DM per resident per rolling 24 hours;
- quiet hours 22:00–08:00 local time;
- duplicate topic fingerprint suppressed for 30 days;
- no catch-up storm.

Low and High may adjust cadence and outreach beneath hard daily ceilings.
Allowed outcomes are `no_change`, private journal/reflection, resident-private
mutation, owner-brain proposal, or proactive-message candidate. A candidate is
published as a normal signed resident DM only after novelty, usefulness,
privacy, repetition, quiet-hours, and rate-limit gates pass.

Disabling inner life cancels pending jobs and prevents future proactive messages
without deleting prior continuity.

## Product surfaces

Functional additions must preserve the conversation-first shell and remain
compatible with the separate design lane.

- Expanded right rail: identity/runtime, open threads, hypomnema, journal,
  reflections, revisions/rollback, sources/grants, schedule/budget, proactive
  history, and explicit layered disclosure.
- Brain Setup: discovery, import preview/commit, grants, proposals, Imported
  History search, backup, and restore.
- Activity: body-free job state only.
- Chat: compact provenance/continuity indicators, never a memory dashboard.

Private reflection is not shown in ordinary chat. The owner can intentionally
open it through an explicit disclosure control.

## Deferred

- concurrent multi-device writers;
- daemon operation after Luca fully exits;
- remote embeddings by default;
- automatic owner-brain writes;
- emotional drift, simulated mood, or dream narratives;
- tool-enabled autonomous research;
- background cross-agent conversations;
- automatic transcript flooding;
- conductor behavior.
