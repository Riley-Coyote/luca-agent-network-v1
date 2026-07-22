# Demo Vision and Acceptance

## Main uninterrupted demo

The main recording uses a clean seeded profile and no hidden shell/database
intervention.

1. **Home.** Luca opens to a calm personal agent home with three distinct
   residents. No conductor or organization setup is present.
2. **Direct continuity.** The owner opens one resident, asks about a live
   unfinished concern, and receives a response grounded in its Capsule. The UI
   shows the exact Capsule heads used without exposing bodies.
3. **Universal brain.** The owner asks a question whose answer depends on a
   seeded local note. The resident cites a safe source label. A paired denied or
   removed-source run does not reveal the fact.
4. **Resident room.** The owner opens a room with three residents. They answer as
   themselves and one addresses another directly. Activity shows signed actors
   and a bounded root causal chain.
5. **Checkpoint.** After a meaningful turn, the response is already committed;
   continuity changes from updating to current only after a verified
   digest/threads commit.
6. **Restart.** The app quits and reopens into a fresh provider session. The
   resident recognizes the relationship and unfinished thread without relying
   on the old model context window.
7. **Degradation.** The Continuity Service is stopped. A direct message and a
   room response still succeed, visibly without brain context.

Keep Thinking does not appear anywhere in the V1 build, recording or launch
copy. The M0 Orphan-Job Gate failed.

## Separate resident backup/restore proof

1. Export one resident using **Back up this resident identity** and a protected
   passphrase; show the source-key-copy disclosure.
2. Start a genuinely clean destination with no source
   brain, transcript cache, resident process or provider context.
3. Restore the same owner identity, preview the resident bundle, then confirm.
4. Verify the exact resident public key, exact original Capsule event IDs and
   managed writer-epoch transfer receipt. Show that the old key copy still
   exists and the old app session can no longer make managed V1 commits.
5. Start a fresh runtime. The resident retains identity, relationship, digest
   and unfinished threads. A negative canary query whose answer existed only in
   the excluded source brain/archive is unanswered; pass comes from captured
   source IDs and environment manifests, not the resident's narration.
6. Repeat with a tampered bundle and an interrupted restore saga; verify no
   active partial resident.

## Core product proofs

| ID | Pass condition | Required evidence |
|---|---|---|
| P1 | Three persistent residents can be messaged directly; streaming, cancel, reconnect, replay and restart preserve one chronology; retained threads, attachments/media and search work in the installed app | recording, signed IDs, native E2E, surface smokes, duplicate-final checks |
| P2 | Fresh runtime loads verified six-segment Capsule; fast heads refresh next turn | before/after runtime IDs, manifests, contract tests |
| P3 | Capsule/memory text cannot expand authority; tampered content/import rejects | adversarial suite, independent security review |
| P4 | Qualified turn produces one managed-coordinator committed or no-change checkpoint; response never depends on it; health follows the latest qualifying input | receipt/event diff, fault/concurrency/crash tests, liveness counters |
| P5 | Clean same-owner environment restores exact resident identity and exact signed current events without brain/cache, using an honest journaled saga and active-writer transfer | two-environment recording, bundle manifests, tamper/interruption rejection |
| P6 | Seeded brain fact changes answer only when allowed; turn preparation writes nothing | paired run, access matrix, outbound capture, DB/logical diffs |
| P7 | Three residents communicate directly within inherited root limits and per-responder access | signed room trace, recursion/cancel tests, access traces |

## Cross-cutting gates

- S1: normal response and cancellation succeed through every enumerated
  Continuity Service, Mnemos and Capsule failure: absent/slow service, locked or
  missing brain, relay partition, poisoned clock, missing pointer/target,
  decrypt/signature/schema/oversize failure and corrupted cache. Each produces
  the exact typed degraded/stale state and no protected artifact leak.
- S2: secrets and protected bodies are absent from default artifacts.
- S3: privacy, relay, encryption, egress and ownership copy is exact.
- S4: ingestion and checkpoint pipelines expose liveness and degraded-zero-commit.
- S5: main demo and backup/restore proof run without substitution.
- S6: every public claim maps to passed evidence.

## Evidence bundle requirements

Each gate stores source/build IDs, topology, safe commands/logs, test reports,
redacted traces, screenshots/recordings, performance measurements, known limits
and independent reviewer sign-off. Code inspection alone never satisfies a
product proof. G8 additionally stores the signed-bundle manifest and proves that
the exact SHA-256 of the installed app used for the main demo, backup/restore
demo, clean-install matrix and security sweep is identical to D02's verified
candidate. Signature/entitlement inspection exposes only public certificate
identity; signing credentials and private material are never evidence.

## Delivery tiers

- **Integrated proof:** P1-P7 and S1-S6 pass.
- **Design-partner candidate:** plus clean install, recovery, accessibility,
  native-window, measured budgets, backup instructions and no unresolved P0/P1.
- **Public V1:** plus at least one non-author seven-day use of the same build and
  final claim/security audit. Launch copy says the identity/Capsule are
  continuous while the model/runtime is replaceable, approved remote providers
  receive Capsule plaintext, and ordinary rooms are relay-readable.
