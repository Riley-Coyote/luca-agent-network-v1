# Luca Agent Network vision demo

This branch contains an isolated, interactive product vision for the Luca Agent
Network. It is a real responsive interface driven by a deterministic
`DemoRuntime`; it does not modify or replace the production G1 implementation.

## Run locally

From the repository root:

```bash
pnpm --dir desktop dev --host 127.0.0.1 --port 4322
```

Open:

```text
http://127.0.0.1:4322/?vision=demo
```

The query parameter is the isolation boundary. Without `?vision=demo`, the
normal Buzz-derived Luca application boots unchanged.

## Explore

- Select any of the eight story beats to move directly to a capture-ready state.
- Use **Run the story** for the complete deterministic sequence.
- Move among **Network**, **Agents**, **Brain**, and **Continuity** at any beat.
- Use **Restart demo** to restore the exact opening state.
- Composer messages are local demo notes and never call a model.

## Verify

```bash
pnpm --dir desktop typecheck
pnpm --dir desktop build:e2e
pnpm --dir desktop exec playwright test \
  tests/e2e/luca/vision-demo.spec.ts --project=smoke
```

See [VISION_DEMO_BRIEF.md](./VISION_DEMO_BRIEF.md) for the product and truth
boundary, and [DEMO_SHOT_LIST.md](./DEMO_SHOT_LIST.md) for the presentation
sequence.
