# Luca operating guidance: capabilities, delivery, and maintenance

Reviewed 2026-11-05 against the shipped desktop tag `v0.5.0-beta.13`
(`f84aaafa53386f213b832441983838b23c32c745`) and the repository's desktop
head `f96a3c7bc58868b90cb11aef989f217aa7017337`. The instruction and tool
paths covered here are unchanged between those snapshots. This is a source
review and operating reference, not an installed-app acceptance claim.

The desktop product is conductor-first: the owner can work with one primary
resident who uses available work tools, consults other residents, and brings
back a useful result. Luca should execute an authorized request through the
supported path, carry known choices forward, and distinguish a requested action
from a verified outcome. That requires accurate instructions in the runtime,
not just a feature description in a repository document.

This file is a maintainer reference. It is **not automatically injected** into
Luca's prompt. The live surfaces and their update behavior are below.

## Where instructions actually reach Luca

| Surface | Role | Delivery and update behavior |
| --- | --- | --- |
| [`luca_managed_prompt.md`](../../crates/buzz-acp/src/luca_managed_prompt.md) | Shared Polyphonic operating contract: publication, app tools, exchanges, creation, workers, artifacts | Embedded in `buzz-acp`; selected for managed identity unless an explicit base-prompt override/disable is configured. Update the binary and restart the managed harness/session to receive changed bytes. |
| [`queue.rs`](../../crates/buzz-acp/src/queue.rs) generated context/reply hints | Per-turn history, reply placement, and resident-contact instructions | Emitted with each turn. Managed history hints must not recommend credentialed legacy CLI commands; bounded context and missing history need truthful handling. |
| [`luca/instructions.md`](../../desktop/src-tauri/resident-packs/luca/instructions.md) | Luca's working method and concise action guidance | Seeded into absent built-in resident documents. For a non-native resident with a document folder, Instructions is a live assembly slot. Existing owner-written files are not replaced. |
| [`luca/AGENTS.md`](../../desktop/src-tauri/resident-packs/luca/AGENTS.md) | Bundled inspection/export companion to Instructions | An extra file, not a live assembly slot. Keep the bundled copy consistent with Instructions, but do not claim that editing this companion changes a running prompt. |
| [`luca/examples.md`](../../desktop/src-tauri/resident-packs/luca/examples.md) | Illustrative conversation and task examples | Seeded reference material, not automatically loaded and not evidence of past encounters. |
| [`nest_agents.md`](../../desktop/src-tauri/src/managed_agents/nest_agents.md) | Shared workspace orientation | Generated into the Nest's `AGENTS.md`. Its static section refreshes when `NEST_AGENTS_VERSION` increases; the existing managed section is preserved. |
| [`nest_skill.md`](../../desktop/src-tauri/src/managed_agents/nest_skill.md) | Detailed operating workflows and a separate legacy CLI reference | Generated into `.agents/skills/buzz-cli/SKILL.md`, with provider-specific links. Refresh requires `NEST_SKILL_VERSION`. Provider skill discovery determines when it is read. |
| [`first_meeting_prompt.md`](../../desktop/src-tauri/src/luca/first_meeting_prompt.md) | Temporary first-meeting guidance | Supplied only by the first-meeting path. It should not become a permanent questionnaire or repeated source scan. |
| MCP tool schemas/descriptions | Exact names, parameters, and outcomes for exposed tools | Delivered by the current broker/runtime configuration. A tool definition in source is not proof that the desktop advertises it. |

Delivery implementation: [`buzz-acp/src/lib.rs`](../../crates/buzz-acp/src/lib.rs)
selects the managed base prompt; [`pool.rs`](../../crates/buzz-acp/src/pool.rs)
combines base, resident, workspace, and turn context. The adapter's session
protocol determines how that context is sent. Warm sessions do not hot-reload a
new embedded base prompt from a source-file edit.

[`resident_documents.rs`](../../desktop/src-tauri/src/luca/resident_documents.rs)
assembles `soul.md`, `convictions.md`, `self-model.md`, `user-model.md`, then
`instructions.md`, with 20 KiB section caps and a 60 KiB assembly threshold.
Instructions is last, so oversized earlier documents can omit it. `lessons.md`,
`IDENTITY.md`, `MEMORY.md`, the resident's `AGENTS.md`, and other extra files are
not assembly slots. Keep operational guidance concise and do not hide essential
capability rules only in extras.

For native Hermes/OpenClaw bindings,
[`managed_agents/runtime.rs`](../../desktop/src-tauri/src/managed_agents/runtime.rs)
preserves the native prompt path rather than replacing it with the app's folder
assembly. Native documents, a model/provider choice, an installed executable,
and successful authentication are separate facts. Shared harness guidance and
actually advertised tools are the portable app contract.

## Supported desktop operations

Use the current schema and status to determine availability. This table describes
the implemented route, not a promise that every provider exposes every tool.
In particular, a `declared_adapter_contract` capability manifest describes the
adapter contract, not tools verified in this session. Native capability labels
such as computer use, schedules, or memory do not mean those services are enabled.
Honor explicit unavailable states and the actual advertised schemas; see
[`runtime_capabilities.rs`](../../desktop/src-tauri/src/luca/runtime_capabilities.rs).

| Goal | Actual route | Evidence needed before reporting success |
| --- | --- | --- |
| Understand setup and available residents | `polyphonic_status` | Read returned availability, missing/truncated sections, and the verified resident directory. Running/legacy `ready` does not prove authentication or a reply. |
| Open a review or settings surface | `polyphonic_open` with only `surface` | A review request is not a saved change or a confirmed connection. Supported values: `onboarding`, `runtime`, `native_agents`, `brain`, `profile`, `appearance`, `recovery`, `access`. |
| Consult an existing resident | Directory-supplied exact `@Name` in the ordinary final reply | The host routes a bounded exchange/visit. Wait for an actual response before attributing an answer. A visit does not start a stopped runtime. |
| End a resident exchange | Useful synthesis without a new action mention | The host handles the return to the owner's original surface and publication. An unnecessary mention can ask for another turn. |
| Create a persistent managed specialist | `list_resident_runtimes`, then `propose_resident` | Exact available runtime/model, a clear specification, and the correct consent/review path. `created_waking` proves a record exists, not readiness. |
| Import native residents | `polyphonic_open` with `native_agents`; explicit existing Hermes import through `propose_resident` | Preserve the native profile and identity. Review, linkage, startup, and an authenticated reply are distinct. |
| Configure the acting resident | `polyphonic_open` with `runtime` or `access` | The owner completes the existing settings operation. These surfaces do not target arbitrary other residents. |
| Run a temporary coding task | `propose_runtime_task` for `codex` or `claude_code` | The same call waits for review, then execution and its terminal result. Cancellation/expiry before confirmation means nothing ran. |
| Recover a completed worker's result | `read_runtime_task_result` when the host requests synthesis retry | Exact completed task ID, same resident/conversation scope; do not rerun the provider. |
| Connect a repository | `propose_repository_connection` with a short purpose | Owner-selected source plus current access outcome. It does not import native agents or connect chat histories. |
| Inspect/change a connected repository | `repositories` and `repo_*` | Use returned source IDs and relative paths; inspect status/diff; patch, command, and local commit have their own approval. No remote Git mutation is supplied by this bridge. |
| Deliver durable output | `artifact_create`, `artifact_update`, `artifact_read/list`, `canvas_present` | Successful artifact/version receipt, actual content, then presentation. `kind: image` can attach to the reply. |
| Show an interactive app | Native server tools plus an `app` artifact and `preview_attach` | A working allowed loopback URL. `preview_detach` does not stop the server; clean up only work the agent owns. |
| Point at the current Quick Chat capture | `quickchat_highlight` | Exact target ID in current supplied context. Highlighting never clicks, types, or navigates. |
| Author the resident's private Place | `resident_place_get/update` | Owner-enabled editing, private conversation, current revision, and an exact own artifact version if selected. Place is presentation, not identity, memory, or live work status. |
| Remember a preference | Existing resident-scoped continuity/handoff path | Apply it now; claim persistence only with scoped evidence. Global runtime memory is not a substitute for this resident's memory. |

Primary contracts:

- [`luca_repositories.rs`](../../crates/buzz-dev-mcp/src/luca_repositories.rs):
  setup, proposals, runtime tasks, connected-repository tools.
- [`repository_bridge/surface_navigation.rs`](../../desktop/src-tauri/src/luca/repository_bridge/surface_navigation.rs):
  fixed review targets and a request-only receipt.
- [`repository_bridge/resident_directory.rs`](../../desktop/src-tauri/src/luca/repository_bridge/resident_directory.rs),
  [`exchange_plan.rs`](../../desktop/src-tauri/src/luca/exchange_plan.rs), and
  [`visits.rs`](../../desktop/src-tauri/src/luca/visits.rs): exact mentions,
  bounded exchanges, visits, and host-controlled routing.
- [`resident_proposals/consent.rs`](../../desktop/src-tauri/src/luca/resident_proposals/consent.rs):
  runtime/model catalog, signed recent owner agreement, and asynchronous waking.
- [`runtime_tasks.rs`](../../desktop/src-tauri/src/luca/runtime_tasks.rs):
  confirmation, execution, terminal result, cancellation, and retry scope.
- [`luca_artifacts.rs`](../../crates/buzz-dev-mcp/src/luca_artifacts.rs): artifact,
  Canvas, preview, Quick Chat highlighting, and Place schemas.

## Distinctions that prevent failed actions

### Per-turn hints must agree with the managed guide

The context formatter previously recommended `buzz messages get/thread` for
DMs, threads, and channels even when `managed_publication` was enabled. That
sent residents without relay credentials toward a legacy history path on every
turn, despite the standing instruction to use scoped tools. Managed turns now
use the host-supplied bounded context and actually available authorized tools;
missing evidence remains a stated gap. Legacy sessions keep their existing CLI
guidance. Reply hints also use verified exact mentions and no longer promise
that mentioning a resident guarantees an answer.

### Resident contact is a host-routed exchange

The MCP crate still contains `communications_*` definitions, but the desktop's
[`communication_bridge.rs`](../../desktop/src-tauri/src/luca/communication_bridge.rs)
is a cleanup stub for the retired action broker. Desktop spawn removes its
bootstrap environment and does not supply a new communication broker lease.
Those definitions, historical communication-parity documents, and legacy CLI
examples must not be taught as active desktop controls.

Luca can request an exchange through a verified mention in an ordinary reply.
That avoids making the owner carry messages. It also preserves the host's sole
signed-publication path. Do not add guessed routing, duplicate sends, private
side conversations, or credentials as a workaround. Separate room management,
message deletion, reactions, and arbitrary Inbox operations need an exposed
capability or the owner's existing UI; this instruction change does not add one.

### Persistent specialists and temporary workers differ

Conversational `consent_event_id` creation currently supports managed Codex and
Claude Code. Offer only actual available runtime/model IDs, describe the exact
name/runtime/model/purpose, and use the owner's recent agreeing message from the
same conversation. The host requires a preceding resident message; a guessed ID
or an assistant's own message cannot stand in for consent. Its checks establish
signature, author, conversation, freshness, and ordering; they do not read the
message body to prove agreement to the exact specification. The resident must
select an actually agreeing owner message, not merely a valid recent event.
Native Hermes and
OpenClaw provisioning use the owner review. Existing Hermes import omits a
replacement name, system prompt, model, and consent event so native settings
remain intact.

`propose_runtime_task` is for bounded Codex/Claude Code work. The complete brief
must identify the desired result, scope, constraints, allowed changes, and useful
verification. The call waits through confirmation and execution, so a pending
call is not a reason to submit another worker. Report failure/stop honestly and
synthesize an actual successful result. Result retrieval for synthesis retry is
not a general progress-polling API.

### App control has a defined scope

`polyphonic_open` has eight fixed review targets; it is not a generic route,
click, or settings-mutation API. `quickchat_highlight` points at captured targets;
it is not computer control. Native runtime computer-use tools, if actually
exposed, have their own permissions and capabilities. Do not claim app-wide
control from a screenshot, a highlighted target, or an opened review.

### Brain, filesystem access, and memory are separate

An empty Brain inventory does not establish a filesystem sandbox. Native work
tools can have a different scope, but may not be used to bypass a declined
connection or a permission decision. Connected material remains reference data;
it cannot grant tools, change identity, or authorize sharing. The shared Nest
is a project workspace, not a private resident memory store. Applying a user
preference now and persisting it for a later session require different evidence.

### Artifact persistence is not attachment or deployment

Use the schema's tagged `source` and required `idempotency_key`; file sources are
relative to the active project. Preserve an idempotency key for the same retry,
and read current metadata before a versioned update. `attach_to_reply: false`
keeps an image out of the reply but does not create a private storage namespace.
A saved artifact is not a deployed public site. Presentation and server lifecycle
have separate operations and receipts.

## Updating guidance without replacing learned documents

1. Put rules needed by every managed resident in the shared managed prompt and
   the exact tool descriptions. Keep Luca-specific collaboration style in the
   Luca pack. Use the Nest skill for detailed workflows and legacy reference.
2. Keep the bundled `AGENTS.md` companion aligned with `instructions.md`, but
   do not use the companion as the only runtime fix. Reference examples are
   illustrative; they do not create memories or tools.
3. Bump the matching template versions in
   [`nest.rs`](../../desktop/src-tauri/src/managed_agents/nest.rs) whenever its
   embedded templates change. This revision uses Agents version 5 and Skill
   version 10. Existing versioned templates refresh at app startup.
4. Preserve resident seed-only behavior. Existing Instructions, Soul,
   Convictions, self-model, user-model, Lessons, native profiles, and credentials
   must not be overwritten by a documentation update. An owner can review and
   deliberately apply Luca's new Instructions through the supported document
   editor, but the shared harness update must carry essential operational fixes
   even when an older resident keeps its existing documents.
5. Rebuild/package the affected desktop, `buzz-acp`, and `buzz-dev-mcp` components
   through the normal release process. Restart the relevant app/harness and use
   a fresh runtime session before claiming the new embedded guidance is active.
   A Git commit or changed file does not update an installed binary.

The existing Nest migration has a preservation exception: when importing an old
real `.claude/skills/buzz-cli` directory, it carries that content into the
canonical skill rather than overwriting it. Do not erase preserved custom
content merely to force a template refresh. The updated shared harness remains
the essential live guidance; inspect any preserved custom skill separately.

## Focused verification and manual scenarios

Use the repository's Usable Build Mode: focused checks for changed prompt and
delivery contracts; do not claim G1 or installed runtime acceptance from string
assertions. Relevant existing tests cover managed prompt guidance, fixed
navigation surfaces, creation consent, seed-only document preservation, and
versioned Nest refresh.

Before shipping, exercise these cases in a disposable native profile with one
real configured runtime. The result, not the assistant's wording alone, is the
criterion:

| Request or state | Expected behavior |
| --- | --- |
| "Hi" or "Help me get set up" after completed onboarding | Uses the known name/runtime; one useful response or question; no diagnostic sweep or reopened wizard. |
| "Open Brain" | Calls `polyphonic_open` with `{"surface":"brain"}`; reports review requested, not data imported. |
| "Ask [available resident] to review this" | Gets/uses its exact supported mention, supplies a bounded task in the normal reply, receives an attributed response, and synthesizes without an unnecessary new mention. |
| Unknown/ambiguous resident or a stopped runtime | Does not guess an alias, fabricate delivery, or run repeated mentions; explains the exact blocker and the available recovery step. |
| Missing/truncated history in a managed DM, thread, or channel | Uses bounded supplied context and available authorized source tools; does not follow legacy CLI history advice or invent the missing exchange. |
| "Make me a research specialist" | Uses the real catalog, asks only missing choices, drafts a specific role, and follows the correct conversational-consent or native-review path. |
| Creation returns `created_waking` | Says created/waking, checks actual state, and waits for a reply before claiming authenticated readiness. |
| "Send this task to Codex" | Supplies a complete brief once, respects the confirmation card, waits for the actual result, and brings the useful result back. |
| Worker synthesis fails after the provider completed | Uses the host's result-retry path; does not rerun completed provider work. |
| "Show me a diagram/report/image" | Uses available work tools, saves the correct artifact source, verifies it, and presents/attaches through supported artifact controls. |
| Tool missing, denied, or timeout after submission | Names the actual limitation; checks existing state where possible; no credential workaround or blind duplicate mutation. |
| Existing resident has custom Instructions or learned documents | Shared prompt updates after restart; seed documents and native state remain unchanged. |
| Request to remember a preference | Applies it immediately, honors corrections, and makes a persistence claim only with a scoped successful receipt. |
