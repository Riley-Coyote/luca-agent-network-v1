# Agent Library implementation checklist

Status: ready for implementation after Riley approval

Scope: frontend-first restructuring and visible-product cleanup

## A. Safety and checkpoint

- [ ] Preserve the current Notebook/drawer work and unrelated user changes.
- [ ] Record branch, base commit, dirty paths, and preview command.
- [ ] Confirm no backend, protocol, encryption, relay, or Notebook command change
      is required for the first implementation slice.
- [ ] Treat `AGENT_LIBRARY_SPEC.md` and `FIXTURE_CONTRACT.md` as presentation
      authority.

## B. Shared resident projection

- [ ] Add a pure frontend resident classifier and summary/workspace/preview view
      models.
- [ ] Derive ownership, managed state, runtime capability, and Notebook access
      from existing query results and runtime catalog authority.
- [ ] Add deterministic tests for all resident classes and availability states.
- [ ] Prove the same resident resolves identically from Agents and chat.
- [ ] Represent unknown, unavailable, and not-applicable separately.

Likely source areas:

- `desktop/src/features/agents/`
- `desktop/src/features/profile/`
- `desktop/src/features/luca/residents/`
- `desktop/src/shared/context/ProfilePanelContext.tsx`

## C. Luca-specific fixtures and runtime visibility

- [ ] Add the quiet development-only mock-data marker.
- [ ] Replace the broad design fixture with Luca, Mara, Sol, Alice, and Riley.
- [ ] Remove Goose/Buzz Agent from the default mock catalog and managed Luca seed.
- [ ] Prevent generic fixture fallback from labeling an unknown resident Goose.
- [ ] Suppress unsupported-command noise in the default mock preview; retain named
      failure fixtures for tests.
- [ ] Hide Goose/Buzz Agent from normal Luca runtime pickers, onboarding, setup,
      profiles, help copy, and empty states.
- [ ] Audit internal adapter dependencies before deleting Rust or upstream test
      support.

## D. Agents page shell

- [ ] Replace the stacked management page with roster + workspace composition.
- [ ] Move discovery/import into an Add agent sheet.
- [ ] Replace agent/persona cards with compact roster rows.
- [ ] Remove permanent large New agent, team, and resident cards.
- [ ] Move groups/teams to a secondary compact management entry.
- [ ] Hide the community Agent directory from the Luca product.
- [ ] Add purposeful empty, loading, degraded, and error states.
- [ ] Preserve keyboard navigation and scroll position.

Primary files likely to be reconstructed rather than deleted:

- `desktop/src/features/agents/ui/AgentsView.tsx`
- `desktop/src/features/agents/ui/UnifiedAgentsSection.tsx`
- `desktop/src/features/luca/residents/ResidentSetup.tsx`
- `desktop/src/features/agents/ui/NativeResidentImportSection.tsx`
- `desktop/src/features/agents/ui/TeamsSection.tsx`
- `desktop/src/features/agents/ui/RelayDirectorySection.tsx`

## E. Full resident workspace

- [ ] Add compact horizontal resident header.
- [ ] Implement Overview, Notebook, and Settings navigation.
- [ ] Move runtime, conversation membership, continuity status, and current
      handoff into the documented locations.
- [ ] Render Notebook Field, handoff, notes, pages, jobs, detail, revision, and
      lifecycle controls through existing commands.
- [ ] Remove the nested Continuity > Handoff/Notebook hierarchy.
- [ ] Render external agents through the limited external workspace.
- [ ] Deep-link resident and selected section; preserve refresh and Back.

## F. Compact chat drawer

- [ ] Reuse the Conversation/resident switcher and auxiliary panel shell.
- [ ] Replace the full profile tab system in chat with the compact resident
      preview.
- [ ] Show current-conversation facts, Notebook preview, and identity/runtime
      summary only when available.
- [ ] Add Open full agent profile and Open Notebook navigation.
- [ ] Keep external agents truthful and visibly limited.
- [ ] Preserve panel resizing, overlay behavior, close, URL state, and the
      selected conversation.

## G. Visual gate

- [ ] Floor/rail remain the deepest tone; app card, roster, workspace, and drawer
      share the raised charcoal family.
- [ ] Notebook Field is the only pure-black content well.
- [ ] No giant cards, centered profile hero, decorative badges, or unexplained
      empty canvas.
- [ ] Roster rows scan cleanly at 100%, 125%, and application zoom.
- [ ] Identity specimens remain stable and legible at every required size.
- [ ] All interactive states work in grayscale.
- [ ] Inspect 1440x900, 1280x800, 1024x768, and 390x844.
- [ ] Check hover, focus, active, loading, empty, degraded, offline, and fault.
- [ ] Check reduced motion, overflow, keyboard flow, and console errors.

## H. Functional regression gate

- [ ] Selecting a resident from chat and Agents resolves the same identity.
- [ ] Managed Hermes and OpenClaw residents expose full workspace data.
- [ ] External Alice exposes no private runtime or Notebook controls.
- [ ] Add/import retains semantic identity and read-only native configuration.
- [ ] Start, stop, restart, message, permission, and cancellation controls retain
      existing authority.
- [ ] Notebook create/read/correct/annotate/revise/archive/forget/cancel/retry
      operations still use existing Tauri commands.
- [ ] Conversation navigation, search, attachments, unread state, inline replies,
      and composer behavior remain unchanged.

## I. Focused verification

- [ ] View-model unit tests.
- [ ] Agents list/detail navigation tests.
- [ ] Chat preview -> full workspace -> Back test.
- [ ] Managed vs external capability tests.
- [ ] Fixture-contract tests, including zero visible Goose/Buzz labels.
- [ ] Notebook focused tests.
- [ ] Frontend formatting/lint and typecheck.
- [ ] Production and E2E builds.
- [ ] Focused Playwright screenshots and interactions.
- [ ] Native development-app smoke after visual approval.
- [ ] One installed-app gate after integration, not during every styling pass.

## Recommended delivery slices

1. **Truth foundation:** view models, fixture contract, visible Goose removal.
2. **Representative layout:** roster plus one complete managed resident Overview.
3. **Workspace:** Notebook and Settings, external-agent limited state.
4. **Chat projection:** compact drawer and cross-route navigation.
5. **Polish and gate:** responsive states, visual approval, focused verification,
   native smoke.

Pause for visual approval after slice 2. Do not propagate an unapproved shell
through every state.
