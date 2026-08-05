# Continuity implementation handoff

Status: source audit complete; implementation not started by this audit.

## Read order

1. `README.md`
2. `DECISION_LEDGER.md`
3. `SOURCE_MANIFEST.md`
4. `ADOPT_ADAPT_REJECT.md`
5. `CONTINUITY_V1_BOUNDARY.md`
6. `RISKS_AND_OPEN_QUESTIONS.md`
7. The four `LANE_*.md` reports when working in that source area

The older `.codex/luca-v1` contracts remain valuable security/authority design
inputs, but their full 113-task roadmap is not automatically the next execution
plan. It predates this source reconciliation and includes a major managed
multi-device coordinator decision that Riley has not yet reconfirmed.

## Verified source coordinates

| Source | Revision | Use |
|---|---|---|
| Luca Agent Network | `6da9d059422cad9a692bb4660048240e829ca92a` | Integration target at audit start |
| Standalone Mnemos | `73d691cc1b4f503d715306570fb5cc7b13e42ac0` | Primary continuity-kernel implementation reference |
| Polyphonic embedded Mnemos | `1381cea28f7ebb5b826b4c699971f635bd45fb05` | Historical engine plus experimental cognition ideas |
| Polyphonic app local authority | `7054188d5a4c78de2cbae83da51afafe6ad0eb65` | Active application continuity behavior |
| Polyphonic app captured remote ref | `1c6b1b3a5bb5d56d90f67410009841a483b1d411` | Newer durable candidate-review bridge |
| Legacy Luca v2 | `561909550a62705e28c7eeb33c309023bd16d1eb` | Historical import/brain/product integration |
| Prior Capsule design | local non-git snapshot in `luca-terminal-v3` | Historical product/security intent |

Never modify Mnemos, Polyphonic, legacy Luca, or live memory databases while
implementing. Port reviewed code into the Luca repository under Luca-owned
contracts and fixtures.

## Existing Luca seams to preserve

- `desktop/src-tauri/src/luca/resident_registry.rs` — stable managed resident
  identity and public projection.
- `desktop/src-tauri/src/managed_agents/native_runtime.rs` — semantic Hermes and
  OpenClaw identity separated from runtime fingerprint.
- `desktop/src-tauri/src/luca/signing_broker.rs` — typed key authority; extend,
  never generalize.
- `desktop/src-tauri/src/luca/managed_message_publisher.rs` and
  `managed_dispatch_store.rs` — durable final-event/outbox finality and restart.
- `crates/buzz-acp/src/luca_final_publisher.rs` — one canonical agent final.
- `crates/buzz-acp/src/pool.rs`, `queue.rs` — narrow pre-turn prompt and signed-
  history seams.
- `crates/luca-protocol/`, `schemas/luca/`, `tests/luca-conformance/` — shared
  types and language-neutral vectors.
- `desktop/src-tauri/src/luca/reliability_f10.rs` — continuity-independent
  conversation regression.

## Recommended implementation packages

### Package A — protocol and fake boundary

- Freeze resident/scope/context/job/receipt types and language-neutral vectors.
- Add one private framed desktop child interface with epoch, sequence, byte, and
  deadline limits.
- Implement a fake provider for every ready/empty/denied/stale/unavailable/
  timeout/invalid state.
- Add no product memory logic yet; prove F10 and group messaging remain intact.

### Package B — encrypted resident continuity

- Choose the encryption/key-recovery design first.
- Port the smallest standalone Mnemos kernel needed for exact scope, handoff,
  hypomnema revision, provenance, correction/forget, and bounded FTS/graph recall.
- Bind the namespace to owner and resident public keys.
- Add migration preview only; do not ingest live legacy stores implicitly.

### Package C — pre-turn packet and group parity

- Add bounded plain-room history replay.
- Create exactly one typed context call per responder.
- Load authorized handoff/hypomnema/engram layers as untrusted reference blocks.
- Prove zero mutation and final outbound egress authorization.

### Package D — managed portable Capsule

- Add allowlisted desktop encrypt/decrypt/sign operations over Buzz NIP-AE.
- Never pass keys to ACP/model descendants.
- Project only compact continuity state, preserve local versions, and expose
  exact invalid/stale/unavailable status.
- Implement the approved single-writer or managed-coordinator conflict model;
  do not blur the claim.

### Package E — durable post-turn continuity

- Schedule only after durable final publication.
- Add idempotent primary/observer jobs with exact source event IDs and `no_change`.
- Route resident-authored reflection through the resident runtime; label system
  proposals separately.
- Commit fast continuity under the approved policy; queue slow/shared candidates
  for review.

### Package F — narrow owner brain and notebook

- Add existing-profile or one-corpus setup, explicit scopes, authorized read-only
  recall, provenance, and receipts.
- Add resident notebook, candidate review, correction/forget, health, and job
  history.
- Add deterministic maintenance only after A-E pass installed-app proofs.

## Verification economy

- Keep source/reference repositories read-only.
- Use synthetic residents, synthetic brains, generated keys, and malicious
  fixtures—never live journals or databases.
- Run focused tests per package and one full repository/native gate after the
  integrated visual/behavioral flow is approved.
- Independently review key custody, access/egress, storage encryption, and
  checkpoint races.
- Stop after one evidence-based repair if the same environment failure repeats;
  record it instead of looping.

## Known passing evidence from the audit

- Buzz core engram tests: 34 passed.
- Buzz ACP engram-fetch tests: 5 passed.
- Luca F10 continuity-absent publication/cancellation: passed.
- Luca semantic native identity refresh: passed.
- Standalone Mnemos: 407 passed, one local installed-version metadata mismatch.
- Polyphonic embedded Mnemos: 74 passed.

These are source-level confidence inputs, not proof that the integrated
continuity milestone exists.

## First implementation decision meeting

Before opening a build branch, decide only:

1. single-installation versus managed multi-device Capsule authority;
2. encryption/key-recovery mechanism for local continuity;
3. owner visibility and write gates for resident hypomnema;
4. resident-runtime versus system-proposal authorship for reflection;
5. first owner-brain scopes and remote-egress default.

Everything else in the first implementation wave can follow deterministically
from the audit record.
