# Conversation-first drawer checklist

Status: implemented and focused verification complete
Branch: `agent/v1.1-notebook-drawer`
Scope: frontend-only navigation and presentation

## Product contract

- The right drawer has two understandable contexts: **Conversation** and **Resident**.
- The participant control opens Conversation context, not a separate members modal.
- Conversation context shows only real available data: room identity, participants,
  current agent activity, message/attachment counts, and management actions.
- Selecting a resident from the conversation or its timeline opens that resident in
  the same drawer, with a persistent Conversation / resident context switcher.
- A locally managed resident opens on **Continuity → Notebook** from chat.
- External or unresolved identities receive an honest limited profile; Luca does not
  fabricate runtime or Notebook access.
- The Agents page continues to open the same resident profile without a conversation
  back action.
- Raw identifiers, channel membership, and runtime controls remain available but do
  not dominate the default drawer view.

## Implementation

- [x] Add a docked Conversation context panel using the existing auxiliary-panel shell.
- [x] Move the channel participant trigger to that panel while retaining explicit
      access to member management.
- [x] Add stable Conversation → Resident → Conversation navigation with the active
      context always visible.
- [x] Permit channel-origin profile opens to request the Continuity tab.
- [x] Default managed resident opens from chat to Notebook; fall back to Info when
      the selected identity has no managed continuity namespace.
- [x] Keep profile resolution keyed to the canonical resident public key.
- [x] Preserve resize, overlay, close, URL profile state, and responsive behavior.

## Verification

- [x] Participant control opens Conversation context beside the timeline.
- [x] Clicking a managed resident opens its Notebook in one step.
- [x] The Conversation context tab returns to the same room overview.
- [x] Clicking an unmanaged participant opens a truthful limited profile.
- [x] Opening a resident from Agents still exposes the complete profile.
- [x] Conversation remains visible and usable while the drawer is open.
- [x] Keyboard focus, narrow overlay behavior, and close controls work.
- [x] Focused tests, typecheck, production build, and browser inspection pass.

## Evidence

- `pnpm typecheck`
- `pnpm build`
- `pnpm build:e2e`
- `playwright test tests/e2e/navigation.spec.ts --project=smoke --grep "conversation details"`
- Browser inspection of Conversation → limited agent Profile → Conversation
- Browser inspection of Conversation → managed Luca Profile → Continuity → Notebook
- Visual confirmation that the conversation and inspector share the raised charcoal
  surface while the floor and rail retain the darkest tone

## Deferred

- Persisted working-directory/project bindings not already exposed by the runtime.
- New backend session-summary, artifact, or context APIs.
- Broad profile-tab redesign outside the conversation navigation path.
- Full native installed-app verification.
