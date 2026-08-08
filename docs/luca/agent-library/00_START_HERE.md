# Agent Library and unified resident profile

Status: implemented and installed-app verified

Branch at specification time: `agent/v1.1-notebook-drawer`

## Read order

1. `AGENT_LIBRARY_SPEC.md`
2. `FIXTURE_CONTRACT.md`
3. `IMPLEMENTATION_CHECKLIST.md`
4. `../v1.1-v1.3/NOTEBOOK_INTERFACE_SPEC.md` for Notebook authority
5. `INSTALLED_VERIFICATION.md` for the packaged-app and live runtime result

## Product decision

Luca's Agents destination is a personal resident library, not an upstream
community administration page.

- The Agents page uses a compact roster and a full resident workspace.
- Selecting a resident on the Agents page does not open a narrow drawer.
- The chat drawer remains contextual and intentionally shows only a compact
  projection of the same resident data.
- A single frontend view-model layer determines what is known, unavailable, or
  inapplicable. Entry point never changes the truth of the resident.
- Managed/imported residents are the primary product objects. Relay-only agents
  are explicitly labeled external and never receive invented runtime,
  continuity, or Notebook data.
- Goose, Buzz Agent, community directory, and organization-first management are
  removed from Luca's user-visible product path.

## Authority and precedence

This package supersedes the information architecture and presentation decisions
in `../CONVERSATION_DRAWER_CHECKLIST.md`. That checklist remains historical
evidence for the working Conversation/resident switcher, URL state, and drawer
mechanics; those mechanics should be reused.

This package does not replace:

- signed messaging, runtime, identity, permission, or cancellation authority;
- the V1.1 Notebook backend contract;
- native Hermes/OpenClaw read-only import rules;
- the broader functional-beta and continuity roadmaps.

## Non-goals

- No messaging, relay, encryption, storage, protocol, or Tauri redesign.
- No new memory capability.
- No conductor.
- No full-page analytics dashboard.
- No deletion of an internal runtime adapter without a separate dependency
  audit. This slice removes unsupported runtimes from the visible Luca product.
