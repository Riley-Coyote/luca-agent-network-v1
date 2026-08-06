# H17 native runtime and security receipt

Status: PASS

## Candidate

- Branch: `agent/v1.1-resident-notebook`
- Product baseline: `36472636af120cb3213dcae84b3ff5827a7c8e93`
- Installed bundle: `Luca Agent Network Dev.app`
- Bundle identifier: `com.luca.agent-network.dev`
- Resident bindings: real Hermes `default` and real OpenClaw `main`

## Native memory-note proof

- Each resident completed same-runtime private metabolism after an accepted,
  finalized signed DM response.
- Each resident committed source-backed memory notes in its own encrypted
  namespace.
- After resident restart, each fresh runtime used the injected Luca continuity
  reference and correctly matched its predeclared canary and unresolved task.
- Both replies explicitly distinguished Luca context injection from native
  transcript/session restoration.

## Mixed-room isolation proof

- Both residents replied once to the same signed room turn with correct
  authorship and inline placement.
- Two metabolism jobs were created for the exact room and independently bound
  to the two resident public keys.
- Hermes returned `no_change`; OpenClaw committed one change to only its own
  namespace. No non-dispatched or third-resident mutation appeared.

## Real living-journal proof

- One manual request per resident crossed the installed app's normal Tauri
  command and exact managed private-cognition boundary.
- Hermes completed in one attempt.
- OpenClaw's first private attempt produced no partial commit; the one bounded
  automatic retry completed.
- The encrypted store contains exactly one journal record for each tested
  resident.
- The body-free job database contains only identity, binding, state, attempt,
  error-code, and timestamp metadata.
- No journal message was published to chat or the relay.

## Repairs validated during the gate

- Legacy managed outboxes are canonicality-checked as their original raw JSON,
  preserving old installed state while still rejecting non-canonical input.
- An owner-pinned handoff remains authoritative without blocking independent
  valid memory-note mutations.
- Automatic and manual private cognition use a 180-second absolute deadline to
  accommodate observed native provider cold starts while retaining bounded
  retry, cancellation, preemption, and no-late-commit guarantees.

## Focused verification

- `cargo test --manifest-path desktop/src-tauri/Cargo.toml resident_notebook --lib`
- `cargo test --manifest-path desktop/src-tauri/Cargo.toml continuity_jobs --lib`
- desktop clippy with warnings denied
- repository formatting and diff checks
- protocol, continuity, ACP, renderer typecheck/build, compatibility, and full
  desktop results recorded in `RUN_LOG.md`
- installed bundle identifier and Developer ID signature verified
- SQLite integrity checks passed for encrypted continuity and body-free journal
  job stores
- private prompt fragments absent from continuity files and application log
- private journal prompt/job canaries absent from stored relay events

## Boundary

H17 proves the backend and installed native runtime paths. Claude's production
Notebook/Living Journal UI is intentionally H18. The final installed visual and
interaction release gate remains H19.
