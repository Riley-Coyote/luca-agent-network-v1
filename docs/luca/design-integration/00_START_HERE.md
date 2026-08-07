# Luca V1.1 design integration

This package controls the selective integration of the committed Luca design work into the functional V1.1 resident-notebook line.

## Source coordinates

- Functional authority: `agent/v1.1-resident-notebook` at `3fe580a45e24babd2612325d6fddfa6b074ff7a2`
- Design authority: `agent/runtime-reliability` at `cc54ebff5c75dd15b88dc3b1c63d5c56a9d5f8f6`
- Design archive: `/Users/rileycoyote/Documents/Luca-Design-Artifacts`
- Common ancestor: `4781dca6a74a1dd42fe1ea6e799a8b1700865bb6`

The design branch and V1.1 branch are divergent. Never merge the design branch wholesale. Port accepted frontend changes onto a clean branch from V1.1.

## Authority order

1. V1.1 notebook/runtime behavior and accepted tests.
2. The current user request.
3. `IMPLEMENTATION_MAP.md` in this directory.
4. Source files and explanatory pages in the design archive.
5. Design screenshots as visual evidence, not code authority.

## Non-negotiable boundaries

- Preserve every V1.1 backend, protocol, encrypted-store, runtime, notebook, and continuity change.
- Preserve the conversation-first product model. Do not restore an inbox intermediary or mandatory thread drawer.
- Treat key-derived identity as stable and operational animation as transient state.
- Keep the UI themeable. The initial Luca default is cool, near-black monochrome with the rail deepest and the conversation card one tonal step lighter.
- Do not introduce project persistence, reply-addressing protocol changes, notebook backend changes, or new runtime semantics during this visual integration.
- Do not copy inline artifact-page styling into production. Rebuild accepted patterns with existing React, Tailwind, token, and test conventions.

## Required checks before completion

- Focused identity, activity, message, rail, and notebook tests.
- Frontend typecheck and production build.
- Browser inspection of real representative DM, group, reply, collapsed-rail, theme, and notebook states.
- Native app smoke test after visual approval.

