# Luca V1.2 release verdict

Date: 2026-08-08

Verdict: **NOT YET RELEASED — REPOSITORY GATE BLOCKED**

Candidate branch: `codex/unified-brain-v1-2`

Installed product checkpoint: `d633e92`

Post-install validation repair: `4ae6370`

## What passed

- B21-B26 implement the bounded V1.2 source contract, zero-write preview,
  atomic encrypted import, explicit resident grants, grant-first retrieval,
  body-free receipts, and the narrow Brain Setup product surface.
- A disposable Markdown source was selected through the installed native file
  picker, previewed before write, imported, indexed, and preserved byte for byte.
- Real Hermes `default` and OpenClaw `main` residents were granted the source
  independently. Both returned the corpus-only fact `Cedar Meridian` and
  `4729-Aster`; the ungranted Luca control resident could not surface it.
- Brain Setup displayed separate body-free ready and denied receipts during the
  live process. Their disappearance after relaunch is expected: the frozen
  contract retains the most recent 128 receipts in process memory only.
- Revoking Hermes required explicit confirmation, changed only that grant, and
  the next Hermes turn reported no `owner_brain` source content. OpenClaw's
  independent grant remained active.
- Relaunch preserved the encrypted source catalog and grant state: Hermes was
  revoked, OpenClaw active, and Luca absent. All three native residents returned
  ready and ordinary Hermes/OpenClaw mixed-room replies completed.
- Provider capture proves only authorized selected chunks reach the outgoing
  context packet. Denied, revoked, stale, locked, unavailable, and invalid
  Owner Brain layers produce no provider wire.
- Strict deep signature verification passes for the installed Developer-ID
  bundle `com.luca.agent-network.dev`. Its executable SHA-256 is
  `7b426cfc7f1be53c016cd08df7def057f7ed399339588d5da479d8554a1b3ede`.
- The disposable source SHA-256 remained
  `86f3d22fb2853515f24768a4478b9d9b173c6652a59e2a799641383d2e842747`.
- Selected Hermes and OpenClaw configuration, memory, model, and schedule
  hashes were byte-identical before and after the complete installed demo.
- Focused Brain protocol vectors pass 5/5 after strict Clippy requested one
  semantics-preserving boolean simplification in `OwnerBrainContextReceiptV1`.

## Why this is not a PASS

The final-state `just ci` confirmation passes workspace Rust formatting and
strict workspace Clippy, then stops at `desktop/scripts/check-file-sizes.mjs`.
The guard reports fifteen over-limit files:

- fourteen were already above their configured ceilings at the V1.1 baseline
  `34989f9` (some also received bounded V1.2 integration growth); and
- the new `desktop/src-tauri/src/luca/owner_brain_store.rs` is 2,697 lines
  against the 1,000-line default.

The new Brain store is V1.2-owned debt and must be split. The guard was not
weakened and no exception was added. Because the full repository gate is red,
A405 and B27 remain blocked even though A203, A209, A211, A212, and A401-A404
now have passing evidence.

The installed artifact was built from `d633e92`; the later `4ae6370` repair is
source-equivalent but has not been rebuilt into that artifact. The next signed
candidate must therefore be rebuilt after the store split before promotion.

## Resume checklist

1. Split `owner_brain_store.rs` into bounded modules without changing its
   authorization-before-decryption or atomic encrypted-write behavior.
2. Reconcile the fourteen inherited file-size guard failures separately from
   the V1.2-owned split; do not raise limits to hide either category.
3. Rerun the focused Brain, Tauri, provider-capture, and affected Playwright
   checks for the refactor.
4. Rebuild, sign, reinstall, and run the narrow installed Brain smoke against
   the exact final checkpoint.
5. Run the full repository gate on that new candidate and promote only if it is
   green.

## Current installed artifact

- Bundle ID: `com.luca.agent-network.dev`
- Signature: Developer ID Application, strict deep verification passed
- Executable SHA-256:
  `7b426cfc7f1be53c016cd08df7def057f7ed399339588d5da479d8554a1b3ede`
