# Runtime Parity Delta

Date: 2026-08-02
Recommendation: **approve with deltas**
Scope: reconciliation only; no implementation authorization inferred

## Executive verdict

The replacement handoff is technically serious and directionally correct. Its governing architecture matches the product: Luca owns messaging, signing, permissions, and UX; imported agents remain native; Hermes/OpenClaw are exact identity bindings behind a common ACP host; no runtime receives resident private keys.

Two corrections materially improve feasibility:

1. It treats host-owned response publication as unbuilt, but this branch already has a strong implementation with resident signing, managed final capture, durable dispatch/outbox recovery, and idempotent publication.
2. It makes the first usable milestone too broad. Permissions, attachments, durable multi-method ACP restoration, resource eviction, agent chains, and Mnemos continuity are all real work, but they should not block proving imported Hermes/OpenClaw agents can message correctly.

The plan should retain the full acceptance matrix as the parity destination while replacing the linear greenfield graph with staged usable slices.

## Settled architecture to keep

- Buzz remains the application, chat UI, event transport, and conversation-history foundation.
- Luca desktop is the only ordinary reply publisher and the only resident signing authority.
- A resident has one stable Luca identity and one explicit native runtime binding.
- Native profiles/agents are linked read-only, never migrated, copied, or silently replaced.
- Managed runtimes do not own a second relay listener or ordinary-message transport.
- Routing uses signed event IDs, conversation IDs, thread tags, and pubkeys—not display-name text.
- Runtime capabilities are observed and normalized; the UI never invents parity.
- Threads share their room conversation session unless a later explicit product decision changes that rule.
- Raw model reasoning remains private.

## Required deltas

### RP-001 — Reclassify G2 as extension, not construction

G2.1-G2.3 substantially exist locally. Preserve the current capture -> broker -> resident signing -> publication outbox path. New work is to audit its generic ACP event normalization and extend admission beyond the deliberately narrow owner-authored kind-9 slice. Do not replace it with upstream BYOH code or a new publisher.

### RP-002 — Narrowly port the upstream BYOH seam

Use upstream `95fdf978` for backend descriptor ideas: safe array args, bounded env, reserved-key filtering, typed resolution, readiness, and dangling-binding errors. Do not merge the commit wholesale. Reject its Buzz-visible gallery/assets and adapt the resolver to the local `KnownAcpRuntime` single-authority rule and Luca managed broker topology.

### RP-003 — Resolve the ACP protocol mismatch first

The handoff correctly targets ACP v1 for production, while the current client intentionally sends `protocolVersion: 2`. Introduce a small protocol/capability adapter rather than scattering runtime branches. The host must use only advertised methods and preserve the existing Claude/Codex behavior. ACP v2 remains experimental until separately proven.

### RP-004 — Add per-session OpenClaw routing metadata

Installed OpenClaw resolves its Gateway session from `session/new`/load/resume `_meta.sessionKey` or `_meta.sessionLabel`. Luca currently sends neither. A bridge-wide `openclaw acp --session` default would bind every Luca conversation handled by that bridge to one Gateway session. Add per-session metadata before claiming room isolation or multi-conversation parity. Keep one bridge per resident; do not multiply bridge processes per room unless source testing disproves metadata support.

### RP-005 — Separate native identity readiness from optional services

Hermes identity/profile detection, ACP compatibility, provider auth, and optional MCP health are separate readiness dimensions. A slow/failing configured Mnemos MCP must not present as a missing Hermes profile or logged-out runtime. OpenClaw must similarly distinguish CLI present, exact agent present, Gateway reachable, Gateway identity match, and credentials usable.

### RP-006 — Replace automatic permission approval before broad beta

The current ACP client automatically chooses `allow_once`. That contradicts the handoff and is unsafe for imported agents with shell/write tools. For the earliest tightly controlled messaging proof, use a deny-safe/no-dangerous-tool configuration. Before a broader beta, route native permission options to one Luca approval card and return the exact selected option ID.

### RP-007 — Stage durable sessions after the first live message slice

Current sessions are in-memory and already support conversation separation, invalidation, cancellation, and turn rotation. Use that to prove messaging. Then add the durable generation/CAS binding store, load/resume/rehydration, replay suppression, LRU/TTL, and close/recycle policy. Do not let the full restore state machine delay the first correct reply.

### RP-008 — Generalize managed routing deliberately

The current managed final publisher admits only valid owner-authored kind-9 triggers and ignores trigger p-tags except for the owner. That is a valuable safety baseline, but it does not yet satisfy DMs, multiple mentioned residents, agent-authored continuations, or bounded agent chains. Extend one signed source class at a time, retaining dedupe, self-trigger rejection, causal depth, exact thread placement, and one-response ownership.

### RP-009 — Treat attachments as a broker gap, not a chat gap

Buzz already uploads, tags, renders, and sends media. The ACP prompt builder currently sends text blocks only. Reuse the working composer/media system and later add a bounded conversion broker for image/resource/text inputs and ingested outputs. Do not rebuild attachment UI. Unsupported types must fail visibly.

### RP-010 — Keep continuity interfaces, remove them from the first runtime critical path

Continuity capsules and Mnemos provenance remain core product differentiators, but full CT-01 through CT-05 should follow native messaging proof. The first slice should preserve resident key identity and native profile identity across restart and reserve the turn-envelope seam. It should not require memory conflict resolution, consolidation, or background cognition to prove Hermes/OpenClaw messaging.

### RP-011 — Preserve existing activity infrastructure

There is already an observer frame, active-turn store, working signal, and shared activity UI. Normalize Hermes/OpenClaw ACP events into that vocabulary. Do not create a parallel runtime workbench or expose raw provider reasoning.

### RP-012 — Make external runtime remediation user-owned

The OpenClaw Gateway is currently unavailable and the installed CLI/service versions differ. Luca may diagnose this precisely, but must not update, start, restart, or rewrite external native systems during discovery/import. Live OpenClaw proof will require a later explicit user-run or user-authorized remediation step.

## Revised delivery path

### Gate A — Generic native binding seam

- Compatible runtime descriptor and serialized exact binding.
- Child-env sanitizer remains authoritative.
- Hermes profiles and OpenClaw agents enumerate read-only.
- Missing/renamed identity yields a precise degraded state; never falls back to default.
- ACP protocol/capability snapshot is runtime-specific and truthful.

### Gate B — First usable native messaging

For one Hermes profile and one OpenClaw agent:

- import/link the exact native identity;
- preserve the resident's Luca key;
- send one DM and receive exactly one host-published reply;
- send one room mention and receive one correctly placed reply;
- show working/complete/failure through the existing activity surface;
- prove no resident private key reaches the child;
- restart the ACP child and produce a coherent follow-up from bounded Luca transcript rehydration.

This is the next meaningful product gate. It corresponds to S-02 through S-05 plus the relevant identity and security checks, not the entire parity matrix.

### Gate C — Safe interaction parity

- user-mediated permissions;
- cancellation/queue cleanup;
- attachment input/output broker;
- richer capability-conditional activity;
- durable session binding, replay suppression, and ambiguous recovery states.

### Gate D — Multi-agent and continuity parity

- multi-mention and agent-to-agent routing with causal bounds;
- bounded warm sessions and eviction;
- continuity capsule/Mnemos provenance and conflict visibility;
- full cross-runtime matrix and manual usable-build proof.

## Task-graph rewrite

| Original group | Revised treatment |
|---|---|
| G1 generic foundation | Keep, but combine G1.1-G1.3 around one typed descriptor; add ACP protocol/session metadata to G1.4 |
| G2 host publication | Replace with audit + generic extension of the existing implementation |
| G3 Hermes/OpenClaw | Move immediately after descriptor freeze; this is the product-critical lane |
| G4 durable sessions | Split: minimal transcript rehydration for Gate B; durable load/resume/CAS/LRU for Gate C |
| G5 routing | Split: DM + one room mention in Gate B; multi-mention, agent chains, and broader continuation in Gate D |
| G6 interaction parity | Keep for Gate C; reuse current activity and media surfaces |
| G7 proof | Run focused evidence per gate; defer the full production gauntlet until the user re-enables it |

## Decisions that do not require Riley

- Preserve the current host publisher.
- Narrow-port upstream backend resolver ideas only.
- Add per-session OpenClaw `_meta` rather than one bridge per room.
- Use existing Buzz message/media/activity UI.
- Keep exact native identity and no-fallback behavior.
- Stage the work around a first usable messaging gate.

## Inputs needed later, not now

- OpenClaw Gateway must be made reachable and version-coherent before its live Gate B proof. This requires explicit user action/authorization; discovery work can proceed without it.
- Riley should visually approve the final import wording and degraded-state language once functional surfaces exist.

## Final recommendation

Adopt the handoff as the long-form parity contract, with the deltas above as the implementation authority. The shortest safe path is not to rebuild Buzz messaging or re-create the publisher. It is to connect exact Hermes/OpenClaw identities to the managed ACP seam already present, add the missing protocol/session metadata, and prove ordinary host-published messaging before expanding into the deeper parity layers.
