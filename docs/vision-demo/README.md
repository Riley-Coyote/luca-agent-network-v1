# Mnemos premium vision demo

This branch contains an isolated, production-intent visual direction for
Mnemos. It uses the Buzz-derived provider foundation, a deterministic data
adapter, and the existing `DemoRuntime`; it does not modify or replace the
production G1 implementation.

## Current gate

Phase 1 is ready for visual review: the normal application bootstrap, the
Buzz-derived rail-and-card shell, Mnemos materials and typography, deterministic
agent identity specimens, the Network opening state, memory recall, inspector,
composer, and responsive foundation. Agents, Brain, and Continuity deliberately
remain approval-gate placeholders until the shell direction is accepted.

## Run locally

From the repository root:

```bash
VITE_ENABLE_VISION_DEMO=1 pnpm --dir desktop dev --host 127.0.0.1 --port 4322
```

Open:

```text
http://127.0.0.1:4322/?vision=demo
```

The build flag and query parameter are both required. Without
`VITE_ENABLE_VISION_DEMO=1`, `?vision=demo` is inert and the normal
Buzz-derived application boots unchanged.

## Explore

- Select any of the eight story beats to move directly to a capture-ready state.
- Use **Run the story** for the complete deterministic sequence.
- Inspect the opening state and **02 · Memory opens** before approving the
  shell direction.
- Agents, Brain, and Continuity expose the next-phase boundary without
  pretending those surfaces are already complete.
- Use **Restart demo** to restore the exact opening state.
- Composer messages are local demo notes and never call a model.

## Verify

```bash
pnpm --dir desktop typecheck
pnpm --dir desktop test:e2e:vision
```

See [VISION_DEMO_BRIEF.md](./VISION_DEMO_BRIEF.md) for the product and truth
boundary, and [DEMO_SHOT_LIST.md](./DEMO_SHOT_LIST.md) for the presentation
sequence.
