# Runtime-backed resident conversation context

Status: implemented feature contract for the `luca/v1.1` continuation lane

Base: `8d8aa5bd424e6621edf918cbfdb3a9c26ebb1cb6`

## Product outcome

Polyphonic remains the visible and canonical conversation. A resident keeps
the same public identity, resident-home documents, runtime, and resident-wide
model while each conversation can carry its own device-local work context.
Installed Codex and Claude Code sessions may now be browsed through a bounded,
sanitized, read-only index. Native provider session identifiers and local paths
are never shown.

Existing conversations require no setup. Project rooms inherit their project's
context. Loose rooms use **Add context** in the existing composer plus menu.
Attached context is summarized by one single-line chip; all detail stays in one
drawer.

## Frozen contracts

`ConversationContextV1` is native-owned and scoped to the current owner,
relay, and room. It stores opaque connected-source IDs, inheritance state, and
monotonic revisions. One project supplies an optional primary source and
additional source IDs. One room inherits those defaults, may explicitly select
no primary, may replace the primary, and may add room-only sources.

`ConversationContextViewV1` is the renderer-safe projection. It exposes only
source IDs, labels, roles, project/room origin, availability, readiness,
revision, and a read-only capability summary. It contains no paths.

An exact, immutable, path-free context snapshot is frozen before each managed
owner dispatch is staged. The snapshot binds its revision and selected opaque
source IDs to a canonical digest. Paths are resolved only inside the trusted
desktop-to-harness inherited channel for that authorized dispatch.

## Authority boundaries

Capability ownership follows
[RUNTIME_FIRST_CAPABILITY_CONTRACT.md](RUNTIME_FIRST_CAPABILITY_CONTRACT.md).
Conversation context supplies working material; it neither creates a capability
nor changes which provider owns it.

- Absolute paths remain in the existing native connected-source binding store.
- No path enters relay events, room/project metadata, renderer persistence,
  message bodies, context receipts, or logs.
- Project membership does not grant Brain access. Existing per-resident source
  grants remain authoritative.
- Selecting a native directory does not change the runtime's own approvals,
  sandbox, credentials, MCP configuration, skills, plugins, hooks, or
  subagents.
- Context selection changes neither the resident's signing identity nor the
  authority of the signed owner event.
- No new encryption, permission, or confirmation system is introduced.
- Selecting a runtime or native session does not imply inheritance of every
  feature from the vendor's separate desktop or web application. The exact
  embedded adapter/session remains the capability boundary.

## Turn flow

1. The desktop resolves project inheritance plus the room override.
2. It validates the primary directory and freezes the exact source set before
   the owner event is published.
3. The managed dispatch stores only the snapshot reference and revision; the
   immutable source set remains in the device-local native snapshot registry.
4. Before `session/new`, the ACP harness requests that exact context through
   the inherited local channel.
5. The primary directory becomes `cwd`. Additional repository roots are sent
   as `additionalDirectories` only when the initialized adapter advertises
   support.
6. Unsupported additional roots stay available to granted Brain retrieval and
   are reported honestly as runtime managed instead of silently claimed as
   direct access.
7. Every replacement provider session receives resident-home documents before
   the next user prompt.

The existing exact-turn communication/artifact MCP lifecycle remains stricter:
those capabilities rotate a provider session when required so one turn cannot
inherit another turn's authority. Context-driven session reuse never weakens
that boundary.

## Brain behavior

The pre-turn retrieval request carries selected opaque source IDs. Selected
sources rank ahead of equally or even more strongly scored background sources;
remaining bounded slots may still use clearly relevant granted sources.
Resident documents, notebook, Capsule, handoff, and signed conversation history
remain independent of room context. Receipts contain selected/background counts
and references, never source bodies or paths.

## Conversation behavior

- No context: no chip and no interruption to sending.
- Context attached: one chip showing the primary label and `+N`.
- Missing primary: sending is blocked before publish, the draft is preserved,
  and **Relink** / **Continue without it** appear inline.
- Context mutation: disabled only while a managed resident is actively turning
  in that room, guarded by optimistic revision checks, and applied on the next
  send.
- Context change: the visible room remains and a quiet local divider records
  the new working folder. No relay message or native session ID is emitted.
- Runtime/model: read-only in conversation details and editable as
  resident-wide settings with resident identity kept visually primary.
- MCPs/skills/plugins: collapsed, read-only observed status using **Available**,
  **Runtime managed**, and **Needs attention**.

## Native session catalogue and context

An installed Codex or Claude Code runtime may contribute a read-only session
rail. Lightweight native file metadata supplies the newest-first catalogue;
catalogue visibility no longer depends on whether the bounded Brain search
index happened to retain entries from that session. Polyphonic projects a
sanitized title, timestamp, source runtime, and short visible excerpt. The
renderer receives no native session ID, local path, hidden system prompt,
SDK-managed context envelope, or raw runtime metadata.

Choosing **Start with this context** lazily reads and sanitizes a bounded visible
prefix from the authoritative local session, then stages it for a new
Polyphonic conversation. It does not reopen, resume, mutate, or synchronize the
native session. A community or runtime change invalidates any in-flight or
staged selection so context cannot cross owner or conversation boundaries.

The Brain search index remains separately bounded. Runtime-session indexing
starts with the newest files and caps entries per conversation so one enormous
transcript cannot crowd every other recent session out of search.

## Brain refresh semantics (verified September 21, 2026)

The August 30 catalogue fix (`29c0b8e31`) separated session browsing from the
bounded search index: metadata supplies the catalogue and selected context is
read lazily. It did not make search indexing a changed-files-only operation.

Implemented at `17e802a68` (after the installed beta.13): manual source refresh
and background refresh now reuse unchanged file entries from the encrypted
owner/source index. File identity, size, modification and change timestamps
invalidate markers on macOS/Unix; other platforms also hash the bounded
indexable prefix. New or changed files are re-extracted under the existing
limits; deleted, newly ignored and newly internal sessions drop out. Directory
metadata enumeration still runs, and changed transcripts reread a bounded
prefix rather than using an append-only cursor.

Markers are private encrypted manifest metadata, not a plaintext transcript
cache. They survive restarts; old manifests get one cold refresh to establish
them. Initial connection and explicit reconnection still build a fresh index.
Marker storage is bounded to 512 KiB; overflow or partially retained files fall
back to extraction rather than being mistaken for complete cached files.

Identical active encrypted index pages are retained; changed pages receive new
lineage IDs. Previously forgotten pages are never reused. A source-scoped
authority check rejects in-flight refreshes across disconnect, Forget or rebind.
Deleting the last indexed file publishes an empty index and purges old pages.
Unchanged index/markers/counts skip persistence altogether. Existing watcher
noise filtering, debouncing, excerpt hash verification and grant checks remain.
Startup still reattaches valid source watchers without reindexing them.

Verification: 50 focused native `connected_` tests pass, including a 200-session
corpus that re-extracts exactly one changed file, encrypted reload, legacy
migration, metadata-only edits, empty sources, page reuse and disconnect races.
The installed beta.13 must be rebuilt before this behavior is live.

## Original context-handoff deferrals

These describe the external-session context handoff's scope, not the whole
app's current capability inventory. Restoration of Polyphonic's own native
sessions subsequently landed; see [native session restoration](NATIVE_SESSION_RESUME_CANDIDATE.md).

Native-session resume or bidirectional synchronization, terminal emulation,
provider settings editing, MCP/skill/plugin installation or toggles,
cross-device path relinking, and unverified third-party runtime multi-root
support remain separate work.
