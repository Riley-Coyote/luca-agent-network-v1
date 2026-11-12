# Quiet delegation: qualification record

2026-11-12 · `claude/native-rail-glass` · implementation `158129a012de` · reviewed spec `7972030e8`.

**Not yet a qualified native candidate.** The last verified installed candidate was built from `62f145485`, not this implementation. No provider request, account switch, new grant, daily-app replacement, or publication was performed for this record. This is a checkpoint for the [Q0–Q4 acceptance criteria](DELEGATION_AND_LUCA_BRANCHES_BUILD_SPEC.md), not approval to ship.

## What is implemented

One host-attested owner message identifies a private delegation operation. A replay keeps the same ID; changing the request under that ID is refused. A later owner message with identical wording is new work. Persisted admission records contain a digest and routing state, not the prompt. Launch, Stop, forgetting access and fresh publication are ordered against the same authority; recovering an already-submitted return checks the exact event rather than sending it again.

The existing approval sheet offers a **separate, default-off** choice for an exact-model, writing-only Claude API ask. If selected, the executor receives the current owner message only, without project files, tools, past chat or MCP. Remembering future matching asks is another explicit choice. Changing the binding, owner, audience, account, policy or model does not inherit the old choice. The CLI budget request is $0.25 per ask, **not a guarantee of a maximum charge**. Actual reported cost and overage are distinct from an estimate. Native subscription Claude and Codex do not acquire a reusable account grant from a connection or a profile label; they retain the one-shot review.

The rail keeps active work, undelivered returns, fresh issues and the item the owner is interacting with. Delivered tasks remain in history. Opening a finished failure no longer labels it “Current work.” No branch UI, Work overlay or new executor is part of this change.

## Evidence so far

| Criteria | Evidence | Still required on the final native candidate |
| --- | --- | --- |
| C01 · poem | The old isolated app had an attributed four-line return. Its receipt times had minute precision and did not measure Send → visible. | Matched old/direct/new cold and warm observations, exact model/account/effort, event timings, review and model-call counts. No latency improvement claimed. |
| C02–C04 · scope, replay, routing | Filesystem admission fixtures cover concurrent replays, deny, changed payload, different owner event, revoked/regranted access and isolation. Account switching is fail-closed in the pinned API route. | Run latest protocol/runner suites and actual approved Claude and Codex routes. Confirm exact session, review reuse, denial, and an unavailable target without substitution. |
| C05, C11–C12 · interaction | 97 focused frontend checks passed; TypeScript passed. Six full-shell browser scenarios passed: real plan versus quiet short ask, settled rail, answer-only scratch, historical notices and keyboard details. Both themes and 390/1024/1280/1440 widths were exercised; the review sheet was also checked with 125% text and reduced motion. | Native chat under load, continued typing, actual provider plan, task links, focus, and visual inspection of the rebuilt bundle. Browser data and provider events were synthetic. |
| C06–C10 · Stop, delivery, isolation | An intermediate Tauri build passed 199 runtime-task tests. Its compiled binary also passed 43 publisher cases and five account/credential cases. Includes private-audience checks and durable Stop/recovery. Counts overlap; they are not a combined unique-test total. | Rerun on the exact commit. Exercise Stop and restart during a real longer task, pending return with no view open, and an actual account/audience change. No live private disclosure or provider retry was used as proof. |

The last native suite predates the final destination recheck, pre-dispatch native message validation and standard-library-dependency HMAC implementation. The final Rust dependency graphs resolve offline with both lockfiles; that is not a compile or runtime pass. Pixel-text and file-size checks exited successfully (the latter reports informational warnings).

**Measured selector cost:** one active task and 511 delivered tasks, five batches of 1,000 projections. Before: 512 displayed, 0.0130–0.0157 ms/projection. After: one displayed, 0.0260–0.0302 ms/projection, within the predeclared 0.050 ms budget. The filter costs a little CPU and avoids rendering 511 irrelevant rows. This is not an FPS measurement or an end-to-end delegation benchmark. Reproduce from `desktop/` with `node --import ./test-loader.mjs --experimental-strip-types scripts/bench-runtime-task-rail.mjs`.

Local browser captures (not tracked or distributed): `desktop/output/playwright/quiet-ask-*.png` and `desktop/output/playwright/quiet-delegation-shell-r2-20261112/`. The first failed shell run is retained separately: expanding a settled failure used to make the “Current work” heading reappear.

## Resume without risking the daily app

1. Confirm at least 20 GiB internal space using `bash scripts/with-internal-build-cache.sh --check`. Never lower the guard or create another Rust target.
2. In the shared cache, run the final focused tests for `luca-protocol`, `buzz-acp`, `buzz-dev-mcp` and the Tauri runtime-task, publisher and account suites. Include transport disconnect and no-tools/usage-evidence cases, not just the Tauri filter.
3. Build the isolated unsigned Rail Glass candidate from a clean tested revision, preserving its current profile and rollback. Record the bundle's revision. Use synthetic conversations and separately authorized provider/billing scopes for the native runs; never benchmark by forwarding an existing personal conversation.
4. Record the remaining C01–C12 outcomes, actual timings and limitations here before calling the candidate ready. Only then start the Mnemos tab, followed by the drawing and consult integrations.

**Family intake is not an app integration.** Consumer checks used the synthetic Mnemos read view (all seven sections), a temporary Polychat stand-in (one launch and exact result on replay, terminal busy without retry), and SHA-256 verification of the eight renderer assets and three licence texts at sketchbook commit `acc405e`. No private renderer code was copied, run or bundled. No real resident store was opened. Keep the in-app inbox authoritative and do not start the travel broker inside Polyphonic.
