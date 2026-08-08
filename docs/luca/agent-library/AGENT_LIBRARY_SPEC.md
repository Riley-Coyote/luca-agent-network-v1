# Luca Agent Library and unified resident profile specification

Status: implementation authority

## 1. Outcome

The user should be able to answer three questions immediately:

1. Which agents are mine?
2. Which are available or need attention?
3. Where do I inspect and manage everything belonging to one agent?

The Agents destination becomes a calm list-detail workspace. The global Luca
rail remains unchanged; the primary application card contains a resident roster
and the selected resident's full workspace.

The chat drawer becomes a compact contextual preview. It must not duplicate the
complete resident workspace inside 344-420 pixels.

## 2. Resident classification

Every surfaced identity must resolve to one explicit class.

| Class | Meaning | Full workspace | Notebook | Runtime controls |
|---|---|---:|---:|---:|
| `managed_native` | Imported Hermes/OpenClaw resident with Luca identity | yes | yes | yes |
| `managed_luca` | Resident created in Luca using an offered runtime | yes | yes | yes |
| `persona_only` | Defined identity not instantiated as a resident | setup state | no | configure/start |
| `external_agent` | Relay participant not managed by this owner | limited | no | no |
| `person` | Human participant | no agent workspace | no | no |

Classification is data, not visual inference. Offline state never changes the
class. Missing runtime data never turns a managed resident into an external
agent.

## 3. Shared frontend view models

Build one projection layer and render it at two depths. Components may not
reconstruct ownership or capability rules independently.

```ts
type ResidentKind =
  | "managed_native"
  | "managed_luca"
  | "persona_only"
  | "external_agent";

type ResidentAvailability =
  | "ready"
  | "working"
  | "idle"
  | "degraded"
  | "offline"
  | "failed";

type FieldAvailability =
  | "available"
  | "loading"
  | "unavailable"
  | "not_applicable"
  | "unknown";

type ResidentSummaryViewModel = {
  residentId: string;
  pubkey: string | null;
  displayName: string;
  kind: ResidentKind;
  availability: ResidentAvailability;
  identitySpecimen: { publicKey: string; accessibleName: string } | null;
  nativeSource: "hermes" | "openclaw" | "codex" | "claude_code" | "other" | null;
  runtimeLabel: string | null;
  modelLabel: string | null;
  continuityEnabled: boolean | null;
  continuityUpdatedAt: string | null;
  activeConversationCount: number | null;
  needsAttention: boolean;
};

type ResidentWorkspaceViewModel = ResidentSummaryViewModel & {
  identity: FieldAvailability;
  runtime: FieldAvailability;
  notebook: FieldAvailability;
  workspace: FieldAvailability;
  conversations: FieldAvailability;
  permissions: FieldAvailability;
};

type ChatResidentPreviewViewModel = {
  resident: ResidentSummaryViewModel;
  presentInConversation: boolean;
  currentWorkLabel: string | null;
  workingDirectoryLabel: string | null;
  continuityWasUsed: boolean | null;
  unresolvedThreadCount: number | null;
  notebookUpdatedAt: string | null;
  canOpenFullWorkspace: boolean;
};
```

Names may adapt to existing conventions, but these authority distinctions must
remain explicit.

Rules:

- Missing data is never replaced with sample copy.
- `unknown` is not rendered as a negative claim.
- `not_applicable` hides a section; `unavailable` explains why it cannot load.
- The same resident ID always resolves to the same classification and base
  metadata from chat and Agents.
- Runtime/model labels derive from the real runtime catalog and binding, never a
  frontend harness lookup.

## 4. Agents destination

### Desktop composition

```text
global rail   agent roster (280-320px)     resident workspace (remaining)
───────────   ─────────────────────────    ───────────────────────────────
              Agents                       Luca                 READY
              Search                       Hermes · GPT-5
              All  Running  Attention

              [glyph] Luca                 Overview Notebook Settings
                      Hermes · Running

              [glyph] Mara                 selected resident content
                      OpenClaw · Idle

              [glyph] Sol
                      Codex · Offline

              + Add agent
```

- The roster is part of the primary application card, not another floating card.
- Roster width is fixed within the documented range; the workspace is flexible.
- Hairline separation replaces large gutters and nested card stacks.
- If no resident is selected, select the most recently active resident. If the
  library is empty, show one purposeful Add/import empty state.
- At narrow widths, the roster becomes a route-level list. Selecting a resident
  replaces it with the workspace and provides a normal Back action. It does not
  become the chat drawer.

### Roster row

Each 56-64px row contains:

- 28-32px stable identity specimen;
- readable name;
- one secondary line: native source/runtime plus operational state;
- one quiet recency or attention value when useful;
- real status communicated through text/shape as well as color.

Rows do not contain giant avatars, descriptions, capability chips, action
buttons, or configuration forms. Hover may reveal one overflow action. The
selected row uses a close tonal step, not a bright filled card.

### Header and filters

The roster header contains:

- `Agents`;
- search;
- compact filters: All, Running, Needs attention;
- one primary `Add agent` action.

Add/import opens a focused sheet containing:

- discovered Hermes profiles;
- discovered OpenClaw agents;
- Luca-created supported runtime choices;
- import/configuration status and retry.

Native discovery, setup explanations, and large error panels do not permanently
occupy the Agents page.

### Teams and external directory

- Agent teams/groups are secondary organization. They move behind a compact
  `Groups` entry or Add-to-conversation flow; giant team cards are removed.
- The upstream community Agent directory is not part of the personal Luca
  product and is hidden.
- Relay-only agents encountered in a conversation remain inspectable there as
  external participants, but they are not silently added to `Your agents`.

## 5. Full resident workspace

Selecting a managed resident on the Agents page renders the complete workspace
in the main plane. It never opens the right drawer.

### Header

Use a horizontal, compact identity header:

- 48-64px identity specimen;
- name and short fingerprint;
- native source, runtime/model, and readable operational state;
- primary action appropriate to state: Message, Start, Stop, or Retry;
- overflow for rare/destructive actions.

Avoid a centered profile hero, large empty portrait region, and a row of
unlabeled circular controls.

### Primary navigation

Only three top-level sections are exposed:

1. **Overview**
2. **Notebook**
3. **Settings**

There are no top-level Info, Runtime, Channels, Continuity, and Memories tabs.

### Overview

Overview is a scan-friendly ledger, not a dashboard of cards. It may show only
real, available information:

- current availability and active work;
- native source, runtime, model, and binding health;
- configured workspace/project or an honest unavailable state;
- recent conversations and rooms;
- continuity enabled state and last update;
- compact current handoff summary;
- link to related Activity.

Identity key, custody, and verification are accessible through a quiet disclosure
row. Raw configuration and logs do not dominate Overview.

### Notebook

Notebook uses the existing V1.1 backend and Notebook interface authority.

The hierarchy is flattened:

```text
Notebook Field
Current handoff
Continuity Notes | Journal Pages
```

- `Continuity` is no longer an outer tab.
- Handoff is a pinned operational section inside Notebook, not a peer product.
- Continuity Notes and Journal Pages remain distinct.
- The dendritic Notebook Field remains an intentional black display well; the
  surrounding workspace uses the standard raised surface.
- All disclosure, provenance, revision, correction, annotation, archive,
  forget, create, cancel, and retry behavior from the Notebook specification is
  preserved.

### Settings

Settings contains configuration rather than daily understanding:

- runtime binding and readiness details;
- model/default selection where the runtime supports it;
- start-on-launch and automatic restart behavior;
- response/audience settings;
- permission and tool capability disclosures;
- identity fingerprint, custody, export/recovery actions;
- archive/remove/forget actions with appropriate confirmation.

Settings must use the Rust runtime catalog as capability authority. Unsupported
fields do not render.

### External-agent workspace

An external agent gets a deliberately limited detail view:

- name, identity specimen, fingerprint, presence;
- current shared conversation(s);
- declared agent type/capabilities only when source-backed;
- `External agent` label explaining that Luca does not manage its runtime or
  private Notebook.

No disabled Notebook or runtime tabs. No implication that importing or adding to
a room grants memory access.

## 6. Chat drawer

The existing Conversation/resident switcher remains. The selected resident view
becomes a compact preview, not the full profile renderer.

```text
Conversation   Luca   Mara
──────────────────────────
[glyph] Luca                 READY
Hermes · GPT-5

IN THIS CONVERSATION
Present · continuity used
Working in /Project/Atlas

NOTEBOOK
2 unresolved threads
Updated 14 minutes ago

IDENTITY
285E…411AE · verified locally

Open full agent profile  →
```

Rules:

- No Info/Runtime/Channels/Continuity/Memories tab strip.
- No configuration forms, logs, revision ledger, or full Journal body.
- Show at most three concise sections: current conversation, Notebook preview,
  identity/runtime summary.
- Omit unavailable sections instead of filling the panel with placeholders.
- `Open full agent profile` navigates to the Agents destination and selected
  section; Back returns to the same conversation.
- Clicking a Notebook signal may open the full workspace directly to Notebook.
- External agents show the limited external explanation and shared-room facts.

## 7. Visible runtime policy

The supported Luca product path is Hermes, OpenClaw, Codex, and Claude Code as
implemented and verified by the active runtime contracts.

For Goose and Buzz Agent:

- remove from user-visible runtime pickers, setup, onboarding, profiles, help
  copy, empty states, and default fixtures;
- do not create new residents bound to either runtime through Luca UI;
- replace mock Luca data with a supported runtime fixture;
- retain an internal adapter only if dependency review shows it is still needed
  for upstream compatibility or tests;
- if retained internally, it must be unreachable in normal Luca builds and must
  not leak labels into the product.

This visible-product removal is separate from mass-renaming upstream crates or
protocol symbols.

## 8. Visual system

- The floor and global rail use the deepest near-black.
- The primary app card, roster, resident workspace, and chat drawer use the same
  charcoal surface family.
- Pure black is reserved for the floor/rail and intentional instrument wells
  such as the Notebook Field.
- Use narrow tonal steps, hairlines, and spacing before decoration.
- Instrument Sans carries readable UI; Fragment Mono carries fingerprints,
  timestamps, status metadata, and provenance; Doto is restricted to real
  instrument/state readouts.
- Stable identity specimens are the only custom identity glyph.
- Use semantic color only for live work, focus, warning, and fault.
- Avoid giant cards, centered hero logic, badge collections, decorative status
  color, large rounded pills, and empty regions without a task.

## 9. Navigation and state

- Selected resident and selected section are deep-linkable and participate in
  back/forward navigation.
- Preferred canonical shape: `/agents/:residentPubkey?section=overview`.
- An equivalent query-backed route is acceptable if it preserves canonical
  selection, refresh, Back, and forward behavior.
- Opening from chat records the origin conversation so Back returns there.
- Refreshing a resident route does not fall back to the drawer or lose the
  selected section.
- Invalid/deleted resident routes fall back to the roster with a calm notice.

## 10. Accessibility and responsive behavior

- Roster and tabs are fully keyboard navigable.
- Selection, availability, and attention remain understandable without color.
- Every icon-only control has an accessible name and tooltip.
- Focus is visible against all charcoal surfaces.
- At 1024px, preserve usable roster and workspace widths without horizontal
  overflow.
- At 390px, use list then detail navigation; do not squeeze a split pane.
- Reduced motion freezes identity/Notebook animation without hiding state.
- Text uses the existing rem-based scale and respects application zoom.

## 11. Completion criteria

The redesign is accepted when:

- the Agents page presents a compact resident roster with no giant agent/team
  cards or permanent native-discovery block;
- selecting a managed resident renders a full main-plane workspace;
- Overview, Notebook, and Settings contain the complete available information
  without nested tab bars;
- the chat drawer renders a compact projection from the same resident truth;
- a managed resident is consistent from chat and Agents;
- an external agent is explicitly limited and never receives invented data;
- no Goose, Buzz Agent, community directory, or organization-first language is
  visible in Luca's product path;
- demo fixtures are visibly and structurally distinguishable from native app
  evidence;
- messaging, Notebook commands, runtime authority, identity custody, and
  continuity behavior remain unchanged.
