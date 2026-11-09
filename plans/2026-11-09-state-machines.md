# Desktop state-machine map and hardening

Date: 2026-11-09. Checkout: `.claude-worktrees/luca-beta14-polish`, branch `claude/native-rail-glass`. Audit base: `fb22b4f20`. Local only; no permission, protocol, persisted-data or approved-design migration.

## Decision

Make **asynchronous ownership and legal transitions explicit at boundaries**, not every boolean into a framework. Keep existing native authorities. Keep independent axes independent: an agent can be running while permission is pending; a task can succeed before its result is delivered; a window can close while work continues.

- **UX:** no stale busy/error/status leaking between tasks or conversations; the same controls retain their familiar behavior.
- **DX:** small typed lifecycles with explicit owners, guarded transitions and executable regression cases; no new state-machine dependency or duplicate authority.
- **AX:** navigation and dismissal never cancel work; execution, publication and delivery remain distinct; cancellation remains tied to exact native receipts. Unknown is not success, failure, permission or a safe retry.

There is no honest static proof of “all implicit state machines” or “nothing can break.” The inventory below searches the complete selected source tree; the reviewed map identifies ownership and invariants. This pass fixes reproduced defects and hardens one transient lifecycle. It does not claim every candidate has been exhaustively exercised.

## Reproduce the inventory

From the repository root:

```sh
node desktop/scripts/state-machine-inventory.mjs
node desktop/scripts/state-machine-inventory.mjs --json
```

The JSON lists every matched **file, line, owning function, state slot, named state union, reducer, external-store subscription and lifecycle ref**, plus native enum/flag signals. Initializer bodies, user data and credentials are not copied. It follows no symlinks and reads no external-drive workspaces.

After the first hardening changes: 2,409 source files scanned; 622 files with signals; 1,513 React state slots, 87 named state unions, 12 reducer calls, 68 external-store calls, 86 lifecycle refs, 91 Rust lifecycle enums and 31 Rust lifecycle-flag matches. These overlap and are **not machine or defect counts**. All TypeScript files parsed without syntax diagnostics. Counts change as source changes.

Scope: `desktop/src`, `desktop/src-tauri/src`, `crates`. Excludes separate design labs, the website, dependencies, symlinks, `testing`/`tests`/`__tests__` directories and named test files. Rust matching is lexical and can include inline tests/comments. Hook aliases, ordinary mutable fields, SQL, timers/closures, platform APIs and dependency internals require manual tracing. A file under `src` can also be an unused/preview-only module; a match alone does not prove it ships. The scanner is deliberately an index, not a lint rule or permission checker.

## Reviewed critical lifecycles

“Reviewed” means source-traced here; it does not mean every transition was newly tested in a real provider session. Preserve the existing authorities unless a separate reproducible defect justifies a change.

| Flow and owner | States / independent axes | Invariant and decision |
| --- | --- | --- |
| Native runtime task: `desktop/src-tauri/src/luca/runtime_tasks/lifecycle.rs` | Execution includes queued, active, stopping, native handoff and terminal states. | `transition_allowed` runs under the task lock. Stop/shutdown must win over late success; terminal execution cannot regress to active. Keep this native authority. |
| Managed invocation: `desktop/src-tauri/src/luca/managed_dispatch_store.rs` | Pending → Active → Published / Failed / Cancelled / Rejected / Interrupted. | Resident, owner, conversation, receipt and epoch bind the invocation. Publication is relay acceptance, not a frontend guess. Preserve exact cancellation and restart reconciliation. |
| Final publication: `desktop/src-tauri/src/luca/managed_message_outbox.rs` | Frozen event, submit/probe outcomes, durable outbox state. | Frozen canonical signed event and idempotency identity survive retries. Ambiguous submission is not permission to publish a different event. Do not replace with UI request flags. |
| Result return: `desktop/src-tauri/src/luca/runtime_task_delivery.rs` | AwaitingResult → PendingSynthesis → Synthesizing → Prepared → Submitted → Published; Retryable / Rejected / Cancelled / Blocked. | Execution success does not mean the user received a result. Frozen approval facts, claims/leases and outbox recovery remain authoritative. No “task done” flag shared with delivery. |
| Inbox reply/wake: `desktop/src-tauri/src/luca/agent_inbox_send_store.rs` | Encrypted reply intent plus NotRequested / Requested / Ready / Failed wake checkpoint. | Persist the exact signed intent before dispatch. Wake readiness is separate from message acceptance and recipient reply. Scope checkpoints to owner/community and exact intent. |
| Inbox action recovery: `desktop/src-tauri/src/luca/agent_inbox_action_recovery.rs`, `agent_inbox_child_dispatch.rs` | New / Pending / Accepted action; request/child binding; recipient reply observed separately. | Canonical signatures, audience, anchor, original fingerprint and lineage prove reuse. A recipient reply is not proof that its task succeeded. Keep uncertainty explicit; do not create a duplicate task/transcript on retry. |
| Permissions: `desktop/src-tauri/src/luca/managed_permission.rs` | AllowOnce / AlwaysAllow / Deny are decisions; Approved / Rejected / Cancelled / Expired / SessionReplaced / ApplicationClosed are resolution outcomes. | A dismissed/customized/expired review is not approval. Preserve session/owner scope; never derive authority from selected defaults or a UI “enabled” flag. |
| Awareness reply lease: `desktop/src-tauri/src/luca/companion_awareness/reply_lease.rs` | Reserved/current/expired/cancelled lifetime, plus separate current source/grant authority. | A lease is not a new grant. Cancellation is permanent; expiry is the original admitted deadline, not a fresh duration on resume. Keep the atomic revocation and membership/clock checks. |
| Initiative: `desktop/src-tauri/src/luca/companion_initiative/types.rs`, `coordinator.rs` | Reserved, Planning, Ready, Dispatching, Working, Interrupted, Reconciled, Succeeded; return reservation/delivery and defer/decline/retire/cancel/failure. | Concurrency, time budgets, private work, source permission, quiet hours and public return consent are independent. Do not collapse them into “proactive on.” No changes to those grants or schedules in this pass. |
| Streaming projection: `desktop/src/features/messages/managedPresentationStore.ts`, `managedPresentationTypes.ts` | Seeded waking → native thinking/working/writing/finalizing; signed-final reconciliation; stopped/failed/needs-attention. | UI projection is not execution authority. Preserve sequence/epoch checks, canonical final reconciliation, stable timeline identity and terminal tombstones. Do not rewrite its already-guarded transitions. |
| Stop presentation: `desktop/src/features/channels/ui/useResidentStopControl.ts`, `residentStopState.ts` | Absent → Stopping → Stopped / NeedsAttention → Absent; explicit clear also invalidates a request. | **Hardened here.** One model per conversation incarnation and one token per Stop. Duplicate admission is synchronous; stale settle/expiry cannot overwrite a newer request. Exact native cancellation still finishes after navigation. |
| Task receipts: `desktop/src/features/capabilities/ui/RuntimeTaskResultReceipts.tsx` | Result: collapsed/loading/ready/failed. Action: idle/pending/failed. Receipt identity is conversation + task. | **Fixed here.** Key the lifecycle to the exact task. Old retry/native-open promises cannot lock or clear the next receipt's controls. Completed command receipts still update their exact task cache even after the UI leaves. |
| Conversation and task composition: `desktop/src/features/exchange/ui/CorrespondenceWindow.tsx` | Selected task/attempt, reply vs new message, recipient, continuation, pending send/Stop, retained draft intent. | Existing view identity guards error/draft writes and persisted idempotent intents. Keep task context and pair correspondence distinct. Busy ownership on rapid in-place selection remains a follow-up candidate, not a newly verified failure here. |
| Mini chat: `desktop/src/features/quickchat/useQuickChat.ts` | Workspace/owner scope; primary room vs other resident rooms; open, send, capture epoch and independent drafts. | Existing alive/scope/capture-generation guards prevent cross-resident writes. It shares the hardened Stop hook. Do not let minimize/close or changing the active page alter execution or lose saved drafts. |
| Conversational setup: `desktop/src/features/luca/CompanionSetupDialog.tsx` | Loading/review/action, resident/request generation, reviewed source/history/notes/background choices. | Preserve current generation guards and native consent authority. Setup choices and recommended defaults must never silently enable observation, retained notes, sharing or background work. |
| First-run transaction: `desktop/src/features/onboarding/polyphonicOnboardingState.ts` | Versioned owner-scoped chapter plus independent saved/reviewed/confirmed choices. | Chapter selection is not completed setup or consent. Preserve version migrations and re-read discoveries instead of trusting stale imports. Do not replace multiple consent axes with a single “ready” state. |
| Timeline loading: `desktop/src/features/messages/lib/timelineLoadingState.ts` | Cold loading / cached or streamed placeholder / settled latch. | A cache entry alone does not prove history settled. Existing monotonic channel latch prevents skeleton/empty-state bounce. Preserve it. |
| Relay recovery: `desktop/src/shared/api/relayReconnectController.ts` | Fast preconnect → optional configured escalation → bounded wait/backstop; cancellation token. | Existing attempt tokens, timer/subscription cleanup and single in-flight admission are sound ownership patterns. Do not make all app readiness depend on this one transport state. |
| Panel presence: `desktop/src/shared/layout/PanelPresence.tsx` | Absent → entering → present → exiting, retained child plus focus/RAF/timer lifecycle. | Existing interruptible retention and reduced-motion/focus handling must stay separate from whether a task executes. No spring, glass or geometry changes here. |

## Rest of the source-wide map

These are **inventory-backed families**, not claims of an exhaustive behavioral audit. Use the JSON's exact file/line/owner entries to continue inside each group. A high slot count prioritizes inspection, not automatic refactoring. Cross-cutting implicit machines often span several groups.

| Area | Candidate families and ownership decisions |
| --- | --- |
| `features/agents` (289 slots) | Create/edit/inherit/save, dirty-leave confirmation, registry selection, runtime binding, model/effort controls, installation/authentication/API credential readiness, import discovery/review, native-place loading, pending reconnect. Separate identity from runtime; keep catalog/native capability truth authoritative. Save requests need agent/form-revision ownership. Credential unavailability must fail closed, not silently switch billing. |
| `features/onboarding` (148) | Current first-run chapters, runtime setup/install, loading/preparing/opening, discovery, first meeting and historical community setup. Distinguish current shell from legacy feature-flag paths before editing. Preserve resumability and consent. |
| `features/messages` (120) | Optimistic send/ack/failure/retry, held sends and exact interrupt receipts, streaming/final merge, draft restore/persist, attachments/upload/removal, editor/IME/focus, activity timers and receipts, reactions and media. Keep local draft, relay acceptance and resident execution separate. |
| `features/profile` (114) | Profile/avatar/camera/crop/export/save, resident notebook/note correction/forget, companion settings, preview-only companion simulations. Capture/lookup/save needs owner + resident + request identity. Never treat a preview's grants as native facts. |
| `features/channels` (95) | Main conversation selection, thread/topic/history, read/unread, context/inspector/task panes, member management, Stop status and room-stack fitting. One transcript; opening a task in primary vs secondary position must not duplicate execution. |
| `features/settings` (91) | Preferences, runtime connections, MCP/provider credential selection, appearance, local archive and local-only capabilities. Keep saved preference distinct from unavailable/denied OS or provider capability. |
| `features/projects` (78) | Project browse/create/edit/archive/delete, working-folder resolution, Git inspection/worktrees and context. Explicit target before work starts; “not yet resolved” cannot silently select a different project. |
| `shared/ui` (76) | Video play/pause/seek/fullscreen/controls/visibility, image editing, dialogs/menus/tooltips, dropdowns, tabs, resizable affordances. Some flags are genuinely independent; source/asset changes need cancellation ownership. UI presence is never task lifetime. |
| `features/sidebar` (55) | Active destination, agent expansion, pinned/hidden/revealed rows, drag/reorder, search/menu focus. Keep navigation, disclosure, persistent owner preference and unread/activity projections separate. |
| `features/luca` (46) | Setup review, app-control indicator, local bridge/awareness requests and system notices. Authority remains native; UI acknowledgment is not permission. |
| `features/huddle` (37), native `huddle/` | Join/connect/reconnect/leave, mic/permission/audio device, speaking/transcription/playout. Network, capture and playback are parallel machines, not one call-connected boolean. Device/room changes must invalidate prior callbacks. |
| `features/communities` (37), `community-members` (12) | Community identity/connect/create/switch, membership, role changes and invitations. Key caches and ongoing operations to the community/owner incarnation, not only a display name. |
| `features/capabilities` (28) | Tool/setup/runtime proposals, exact approval response, task actions/results, runtime selection and pending errors. Frontend flags describe the review, not the native decision. |
| `features/home` (23), `dashboard` (9), `harness-dashboard` (14), `runtime-sessions` (9) | Aggregate now/status, selected session catalogue, discover/refresh/resume/start/send, usage availability and draft actions. Historical catalogue presence does not establish a live session or billing balance. Revalidate target/control capability at action time. |
| `features/artifacts` (22), `panes` (7) | Open/select/load/preview/close, resource lifetime, panel presence, rendering errors. Closing a view does not delete its artifact or task. |
| `features/quickchat` (19), `exchange` (16), `conversation-workspace` (3) | Shared primary conversation, resident selection, room drafts, task/attempt correspondence, inline/panel/detached hosting. View identity and execution identity remain distinct; the inbox is canonical, not a second transcript. |
| `features/search` (13), `local-archive` (12) | Query/debounce/fetch/page/select, import/export/index progress and unavailable data. Late results belong to exact query + scope; refreshing is not the same as empty. |
| `features/workflows` (13), `reminders` (8), `pulse` (7) | Trigger/configure/run/pause/cancel, schedule and delivery. Persisted execution/schedule is independent of which page is open. No new automation or broader permissions here. |
| `features/mesh-compute` (12) | Registration/availability/job/connection/liveness. Preserve independent node and job states; do not infer availability from a previously seen node. |
| `shared/theme` (10), app/shell/popout/navigation | Saved preference/system mode, glass availability/activation/reduced transparency, route/history, native main/popout/mini windows, startup/recovery, panel resizing. Keep native fallback/activation facts separate from chosen theme. No visual redesign in this audit. |
| Smaller modules | Forum (6 slots), notifications (5), thinking (5), provenance (3), moderation (3), agent-memory (3), custom-emoji (3), user-status (3), presence (2). Inventory identifies per-owner slots. Unread, read, failed, hidden and disconnected are distinct meanings; do not introduce a generic global “busy.” |
| Native and shared crates | Identity/recovery, ACP host/session pools, managed control, runtime tasks/dispatch/outbox/delivery, inbox scopes/attempts, awareness sampling/leases, initiative scheduling/returns, encrypted continuity/index jobs, relay protocol/exchange limits, media/huddle, background workers and shutdown flags. The scanner links enums/flags; protocol transitions, SQL guards, locks and persisted invariants require targeted source/test review before any migration. Mnemos/Ghost/new harness work stays out of scope. |

## Implemented transition contracts

### Stop control

- `begin(keys)` admits unique residents not already stopping, synchronously before awaiting native inspection.
- `settle(request, outcomes)` accepts only that request's still-pending entries and legal terminal outcomes.
- `clear(key)` removes presentation and invalidates late settlement for that request.
- `retireReplaced(workKeys)` releases only superseded presentation when a different native turn appears. The new work remains stoppable while the old exact native cancellation finishes.
- `expire(request, key)` removes only the same settled request, never a new same-phase request.
- A new conversation incarnation has a fresh model. Old native work completes against its original receipt, but cannot update the new view or emit an unrelated toast.
- Scope cleanup clears only its own timers. No request abort, silent cancellation, wake change or new approval was added.

### Result receipt

- Result states cannot simultaneously be collapsed, loading, ready and failed.
- Summary/native-open action state belongs to the keyed task child; same-tick repeat admission is guarded.
- Leaving/dismissing the child invalidates raw-result UI writes; result payload still requires matching task ID and succeeded state.
- A late summary command may update only the query cache for its original conversation and verified task ID. It cannot alter the new receipt's pending state or error.
- Dismissal remains a local, bounded saved receipt preference. It does not Stop/retry/modify the task.

## Evidence and remaining work

Reproduced on the audit-base production code: held summary retry and held native-open action made the next receipt busy/unusable. Both fail-before cases pass after keyed lifecycles; late raw-result and mismatched-payload checks still pass.

The three conversation-navigation/replacement Stop browser cases passed before this pass too. They are preserved regression checks, **not evidence of a reproduced navigation defect**. The new pure model separately tests duplicate admission, clear/late-settle, illegal outcomes, independent conversation incarnations, old same-phase expiry racing a new request and replacement work staying independently stoppable.

The wider browser run found six obsolete activity/composer-mark expectations. An equivalent build using the original audit-base production files reproduces exactly the same six test failures, including the same expected mark counts versus zero. The current approved default hides composer characters. These tests were not weakened or silently rewritten, and this pass does not call that broader suite fully green.

Focused commands and local candidate evidence are recorded in Riley's isolated candidate proof folder, `2026-11-03-first-meeting/proof/state-machines-2026-11-09/VERIFICATION.md`. Do not claim provider execution, permission/restart migrations or arbitrary app-wide visual changes from mock/browser checks alone.

Implementation gates: 199 focused unit tests passed; 55 browser checks passed across runtime task cards, Stop navigation/replacement, queued sends and mini chat. Typecheck/e2e build, changed-file Biome, text-size and diff checks passed. The file-size check reports its existing informational warnings. Both-theme rendered notices were inspected; no approved visual styling was changed. The six wider-suite baseline failures above remain explicitly separate.

Next priorities, only with a scoped reproducer: in-place correspondence send/Stop busy ownership; agent-edit save vs form/agent switches; media capture/source replacement; interruption/restart fault injection at each persisted dispatch/outbox/delivery boundary. Already-authoritative native state machines are not a refactor backlog by default.
