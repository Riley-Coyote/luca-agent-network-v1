# Luca Agent Network V1 — Implementation Handoff

## The product

Ship a personal network where one owner can talk directly with persistent AI
residents, residents can address one another in guarded rooms, each resident
retains cryptographically signed identity continuity across fresh runtime
sessions, and every resident can receive policy-governed context from the
owner's universal Mnemos brain.

There is no conductor. Luca is one resident, not a privileged router. Buzz owns
conversation chronology and realtime rooms; the Continuity Capsule owns each
resident's compact identity/current continuity; Mnemos owns the universal
brain. The only autonomous cognition in V1 is one bounded post-turn checkpoint
that may update the resident's digest and threads after the response is already
committed.

## Authority to build

M0 is read-only source archaeology and feasibility evidence. G0 is the explicit
implementation boundary. No product implementation occurred while this kit was
prepared. Begin F01 only when all of these are true:

1. `G0_VERDICT.md` says PASS.
2. `python3 scripts/validate_planning_kit.py` passes.
3. The exact G0 evidence receipt validates with the command recorded in
   `M0_G0_EVIDENCE_INDEX.md`.
4. Work starts in a separate fork/worktree pinned to Buzz commit
   `7e34bee62cacaa9d8a96c14d5892a471b59a1983`.
5. The original Luca v2, Mnemos and Polyphonic sources remain read-only.

Use `BUILD_START_PROMPT_HIGH.md` as the build-session launch prompt. Keep the
persistent lead at Sol-high; `GATE_REVIEW_PROMPT_ULTRA.md` is used only for the
seven remaining evidence-fed gate verdicts. The graph
contains 113 dependency-ordered task capsules, eight explicit gates, exact file
ownership, machine-checked evidence receipts and bounded model routing.

## Read in this order

1. `PRODUCT_AND_SCOPE_LOCK.md`
2. `DEMO_AND_ACCEPTANCE.md`
3. `ARCHITECTURE_IMPLEMENTATION_SPEC.md`
4. `SECURITY_THREAT_MODEL.md`
5. `DECISION_DELTAS_FINAL.md`
6. subsystem contracts (`SIGNING_BROKER_SPEC.md` through
   `RESIDENT_BACKUP_RESTORE_SPEC.md`)
7. `TARGET_CODE_MAP.md`
8. `TASK_GRAPH.yaml` and `TASK_CAPSULE_CATALOG.yaml`
9. `PROOF_TRACE_MATRIX.yaml`, `EVIDENCE_SCHEMAS.md` and
   `SWARM_AND_RECURSIVE_VERIFICATION.md`
10. `M0_G0_EVIDENCE_INDEX.md` and `G0_VERDICT.md`

## Non-negotiable stop conditions

Stop the build and repair the contract if any implementation would:

- add a conductor or hidden privileged Luca route;
- expose an owner/resident secret or installation-attestation key to ACP,
  model, shell or tool descendants;
- make conversation success depend on Capsule, Mnemos or checkpoint success;
- let memory/Capsule/model text change tools, permissions, provider or budgets;
- publish a second canonical final for one resident turn;
- mutate Mnemos on the turn-retrieval path;
- treat ordinary rooms as end-to-end encrypted;
- treat generic Nostr replacement events as a conditional Capsule commit;
- claim cross-environment resident restore in V1;
- restore Keep Thinking or the full Polyphonic inner-life engine to V1 scope.

## Known V1 limits

- Full Polyphonic inner life, ambient cognition and recurrence are Release 2.
- Resident restore requires the same managed coordinator environment and its
  retained signed receipts.
- Managed installation transfer prevents stale Luca sessions from managed
  commits/replies; it does not revoke copied Nostr keys or defeat a compromised
  owner key.
- Approved remote providers receive the authorized rendered Capsule/brain
  portion. Ordinary rooms are relay-readable.
- One untouched Buzz video-review smoke has a named upstream timeline-contract
  failure; M1 must fix it or exclude that retained sub-surface before claiming
  it.
- The embedded/local relay, mobile, shared whiteboard and multi-user
  collaboration are later releases.
