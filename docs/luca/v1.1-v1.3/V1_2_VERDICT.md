# Luca V1.2 release verdict

Date: 2026-08-08

Verdict: **NOT YET RELEASED — NATIVE DEMO BLOCKED**

Candidate branch: `codex/unified-brain-v1-2`

Product checkpoint: `d633e92`

Evidence checkpoint: `9f69b6c`

## What is complete

- B21-B26 implement the bounded V1.2 source contract, zero-write preview,
  atomic encrypted import, explicit resident grants, grant-first retrieval,
  body-free receipts, and the narrow Brain Setup product surface.
- Focused protocol, Rust, Tauri, renderer, Playwright, clippy, production-build,
  privacy, rollback, cancellation, stale-binding, and continuity-absent
  messaging checks pass.
- Provider capture proves only authorized selected chunks reach the outgoing
  context packet. Denied, revoked, stale, locked, unavailable, and invalid
  Owner Brain layers produce no provider wire.
- The product candidate was rebuilt into the stable installed dev bundle,
  Developer-ID signed, relaunched, and verified running under
  `com.luca.agent-network.dev`.
- Selected native Hermes and OpenClaw configuration, identity, memory, and
  schedule hashes were unchanged by the rebuild and relaunch.

## Why this is not a PASS

The Mac locked before the installed Brain flow could import a disposable
corpus and run the real Hermes/OpenClaw authorization matrix. Therefore:

- A211 is not yet proven for a granted Hermes resident, a granted OpenClaw
  resident, and a denied resident against a corpus-only fact;
- A402 is not yet proven in the rebuilt installed app;
- the post-demo portions of A403 and A404 remain open;
- `just ci` has not been run, because A405 requires that single expensive gate
  after visual and native approval.

No source-only result is being substituted for those installed claims.

## Resume checklist

1. Unlock the Mac and inspect the installed Brain Setup surface.
2. Import one disposable Markdown/text corpus and verify its source hash is
   unchanged.
3. Grant the corpus independently to real Hermes `default` and OpenClaw `main`;
   obtain separate corpus-only answers and body-free receipts.
4. Verify a resident without a grant cannot surface the fact.
5. Revoke one grant and make another stale through a trusted binding/egress
   change; verify the next provider capture excludes the source.
6. Relaunch and confirm the encrypted catalog remains consistent and ordinary
   messaging still works.
7. Recompute the native no-write snapshot.
8. Run `just ci` exactly once, record the result, and promote only if every
   remaining acceptance item passes.

## Current installed artifact

- Bundle ID: `com.luca.agent-network.dev`
- Signature: Developer ID Application, strict deep verification passed
- Executable SHA-256:
  `7b426cfc7f1be53c016cd08df7def057f7ed399339588d5da479d8554a1b3ede`
