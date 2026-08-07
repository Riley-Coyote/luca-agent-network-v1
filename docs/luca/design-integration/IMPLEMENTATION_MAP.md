# Selective implementation map

## Decision summary

The V1.1 branch is the functional source of truth. The design branch is 21 unique commits beyond the common ancestor and predates the continuity/notebook work. A whole-branch merge would delete accepted V1.1 files and is prohibited.

The design archive confirms four accepted product ideas:

1. A stable key-derived dot-matrix identity with runtime-backed operational states.
2. A direct conversation surface with quote-replies and no required thread drawer.
3. A single Rooms rail, optionally grouped by project, with compact identity stacks and recency ordering.
4. A deep tonal shell in which the rail is the floor and the conversation is a slightly raised card.

The archive's earlier inbox intermediary, fixed warm color choice, and unresolved backend proposals are not accepted implementation requirements.

## Commit disposition

| Commit | Area | Disposition | Notes |
|---|---|---|---|
| `3f88995b` | top chrome | reconstruct | Preserve native controls and V1.1 shell behavior; apply only the reduced geometry. |
| `657e4189` | active sidebar | port concept | Re-express through theme tokens so it works for every theme. |
| `b20afd78` | dot engine | port | Production identity-state foundation. |
| `57ffb97f` | dot lab | reference only | Keep lab/source archive out of the product bundle unless required for tests. |
| `1a8f427e` | dot docs | retain as history | Documentation only. |
| `b444ec07` | lab fixes | reference only | Affects experimental scenes. |
| `e7e7159a` | sandpile/DLA engine | port production pieces | Port `DotSigil`, engine, physics, and shipped states; omit unnecessary public lab pages. |
| `af785b7f` | reply addressing | defer | Presentation is useful; protocol/routing rule remains unresolved and is outside this slice. |
| `76626821` | live identity | reconstruct | Reconcile with V1.1 `AgentIdentitySpecimen` changes and tests; do not delete current tests. |
| `6e1ab1f2` | activity phases | port | Preserve current runtime store semantics and add real phase derivation/pending rows. |
| `2412cf87` | quote reply | port and reconcile | Keep V1.1 continuity indicators and current channel behavior. |
| `031aca0c` | palette/icon rail | reconstruct | Remove legacy theme-only gating; use general semantic tokens. |
| `ea10ac67` | card lip | port concept | Equal inset around the primary card. |
| `580f39e2` | scale/window controls | reconstruct | Keep current Tauri identity and native behavior; apply only layout/style refinements. |
| `5ed1b0db` | traffic-light reservation | port concept | Platform-aware spacing only. |
| `da62f0ad` | design log | retain as history | Documentation only. |
| `efc1e8f2` | one Rooms list | port | Preserve current unread/search/channel data. |
| `fc427719` | room header/intro | port and reconcile | Preserve current DM/group/runtime and V1.1 continuity behavior. |
| `42d006bb` | presence in header | port and reconcile | State must derive from real runtime signals. |
| `86093688` | project grouping | port frontend projection only | Backend project ownership remains deferred; provide graceful ungrouped fallback. |
| `cc54ebff` | labels/project spec | port labels; retain spec | No new persistence model in this slice. |

## File ownership and conflict map

### High-conflict files — reconstruct manually

These files changed on both branches or participate in V1.1 behavior:

- `desktop/src/features/channels/ui/ChannelPane.tsx`
- `desktop/src/features/channels/ui/ChannelScreenHeader.tsx`
- `desktop/src/features/channels/ui/ConversationAgentActivityStrip.tsx`
- `desktop/src/features/channels/useChannelPaneHandlers.ts`
- `desktop/src/features/chat/ui/ChatHeader.tsx`
- `desktop/src/features/messages/ui/MessageRow.tsx`
- `desktop/src/features/sidebar/ui/SidebarSection.tsx`
- `desktop/src/shared/ui/AgentIdentitySpecimen.tsx`
- `desktop/src/shared/styles/globals/agent-identity.css`
- `desktop/src/shared/styles/globals/conversation-shell.css`
- `desktop/src/shared/styles/globals/theme.css`
- `desktop/src-tauri/tauri.conf.json`

Do not accept deletions or replacement versions of these files. Apply minimal hunks against current V1.1.

### Low-conflict additions — port with review

- `desktop/src/shared/ui/dot-display/DotSigil.tsx`
- `desktop/src/shared/ui/dot-display/engine.ts`
- `desktop/src/shared/ui/dot-display/physics.ts`
- `desktop/src/features/agents/lib/activityPhase.ts`
- `desktop/src/features/messages/ui/PendingReplyRow.tsx`
- `desktop/src/features/messages/lib/jumpToMessage.ts`
- `desktop/src/features/messages/ui/CollapsibleMessageBody.tsx`
- `desktop/src/features/messages/ui/FocusedThreadBar.tsx`
- `desktop/src/features/messages/ui/QuotedParent.tsx`
- `desktop/src/features/messages/ui/ConversationIntro.tsx`
- `desktop/src/features/channels/lib/conversationMarks.ts`
- `desktop/src/features/channels/lib/roomProjects.ts`
- `desktop/src/features/sidebar/ui/ChatList.tsx`

Each addition still requires an import/build/test audit against current dependencies.

### Explicit exclusions

- `desktop/public/_dot-gallery.html`
- `desktop/public/_dot-lab.html`
- `desktop/src/shared/ui/dot-display/scenes-lab.ts`
- Any backend project persistence or automatic reply-addressing rule.
- Any palette assumption tied to the design archive's sample colors.

## Theme contract

The initial default palette must be expressed as semantic variables, not component literals:

- `--luca-floor`: deepest cool near-black, used by the rail and outer frame.
- `--luca-surface`: one tonal step lighter, used by the conversation card.
- `--luca-surface-raised`: controls, composer, inspector, and selected rows.
- `--luca-border`: narrow cool-gray hairline.
- `--luca-text`, `--luca-text-muted`, `--luca-text-faint`: readable neutral hierarchy.
- `--luca-focus`: accessible focus treatment, permitted to be blue where necessary.
- `--luca-danger`: genuine fault/required attention only.

Every accepted shell component must consume semantic variables or existing theme primitives. No feature is allowed to activate only under the legacy `buzz` theme. Other existing theme choices remain selectable.

## Delivery slices

1. **Identity foundation** — engine, physics, canonical specimen, real activity phases, reduced motion, tests.
2. **Conversation flow** — quote-reply, focused exchange, collapsible long bodies, pending activity, room header/intro.
3. **Shell and rail** — reduced chrome, equal card inset, one Rooms list, compact marks, graceful project grouping, collapsed rail.
4. **Theme integration** — semantic default palette and full removal of legacy theme-only shell gating.
5. **Notebook surface** — implement the frozen V1.1 notebook view models and commands as Continuity Notes and Journal Pages without backend changes.
6. **Verification** — focused tests, typecheck/build, browser states, then native smoke.

