# Codex Kickoff — Luca Static Artifacts

You are implementing one bounded task from the Luca Static Artifacts packet.

## Read first

1. repository and applicable nested `AGENTS.md` instructions;
2. `HANDOFF.md`;
3. `docs/luca/G1_CHECKLIST.md`;
4. this packet in README order;
5. the selected task in `TASK_GRAPH.yaml`;
6. every current source file and adjacent contract named by that task.

## First action

Report:

- active branch and commit;
- relevant dirty/untracked work that must be preserved;
- whether current G1 has passed or Riley recorded a priority override;
- selected task and satisfied dependencies;
- exact owned paths, forbidden paths, tests, outputs, and stop conditions;
- any conflict between packet assumptions and verified source reality.

For `A00`, this report is the work. Do not implement production code.

## Implementation discipline

- Work exactly one task and one bounded commit at a time.
- Preserve Buzz messaging, signed chronology, attachments/media, search, and
  managed runtime authority.
- Artifact success and conversation success remain independent.
- Use synthetic fixtures until a gate explicitly requires a real resident.
- Store artifact bytes and source bindings locally; never upload implicitly.
- Never expose local paths or artifact bodies in observer/relay/evidence data.
- Reuse current Tauri/Rust/React conventions instead of copying the legacy
  Electron implementation.
- Use the existing Markdown, code, pane, navigation, SQLite, test, and reset
  patterns where they satisfy the contract.
- Do not add live application execution, build commands, preview network, sync,
  sharing, or boards.
- Run focused tests first. `just ci` is an integrator/gate command only.
- Follow the active usable-build failure budget unless Riley re-enables full
  milestone verification.

## Mandatory stops

Stop and report if implementation would:

- require a conductor or new message-routing authority;
- pass keys/signing/permission capability into model or tool descendants;
- put a path or artifact body on the relay;
- execute generated content in the app origin or with Tauri IPC;
- broaden the resident working root;
- make messaging depend on artifact availability;
- require lockfile/migration/shared-schema edits not owned by the task;
- overlap unrelated work without an explicit serialized handoff;
- weaken sandbox, path, MIME, idempotency, or version checks to pass a demo.

## Task report

1. User-visible or infrastructure outcome.
2. Files changed and why.
3. Focused tests and negative/security tests.
4. Real-app visual/native verification when applicable.
5. Evidence location and artifact scan result.
6. Known limits and deferred live-Canvas work.
7. Next graph task now unblocked—or the exact blocking contract conflict.

## Initial assignment

Select `A00`. Reconcile this planning packet against the current repository and
return a `GA0` verdict. Do not implement artifact storage or UI in that task.
