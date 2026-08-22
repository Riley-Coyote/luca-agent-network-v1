# Runtime-backed resident conversation context

Status: implemented feature contract for the `luca/v1.1` continuation lane

Base: `8d8aa5bd424e6621edf918cbfdb3a9c26ebb1cb6`

## Product outcome

Polyphonic remains the visible and canonical conversation. A resident keeps
the same public identity, resident-home documents, runtime, and resident-wide
model while each conversation can carry its own device-local work context.
Native provider session identifiers and external Codex or Claude conversations
are not shown.

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

## Deferred

External native-session browsing/resume, terminal emulation, provider settings
editing, MCP/skill/plugin installation or toggles, cross-device path relinking,
and unverified third-party runtime multi-root support remain separate work.
