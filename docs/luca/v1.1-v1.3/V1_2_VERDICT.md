# Luca V1.2 release verdict

Date: 2026-08-08

Verdict: **PASS**

Candidate branch: `codex/unified-brain-v1-2`

Owner Brain split commit:
`e472ba81b59336c3e5fb475e58038041b3a3c531`

Exact product checkpoint:
`138d9036379a5108cd4ffe41b3dc2edfed935bff`

Evidence closure: the commit containing this verdict, titled
`Finalize V1.2 release evidence`; resolve its exact SHA with `git rev-parse HEAD`
on the accepted `luca/v1.1` branch.

## Release result

- B21-B27 pass. V1.2 delivers the bounded owner-source contract, zero-write
  preview, atomic encrypted import, explicit per-resident grants, grant-first
  bounded retrieval, body-free ephemeral receipts, and the narrow Brain Setup
  surface.
- `owner_brain_store` remains the internal facade. Its records, imports, grants,
  retrieval, and tests are now bounded modules; public and `pub(crate)` call
  sites, encrypted records, commands, renderer contracts, schemas, protocol,
  dependencies, migrations, and lockfiles are unchanged.
- All fourteen inherited desktop file-size failures were resolved through
  structural extraction. Every new module is below 1,000 lines, obsolete
  overrides were removed, retained ratchets were lowered, and no ceiling or
  exception was increased.

## Exact installed artifact

- Bundle ID: `com.luca.agent-network.dev`
- Product commit: `138d9036379a5108cd4ffe41b3dc2edfed935bff`
- Signature: Developer ID Application `Riley Ralmuto (WQUY4M5HYR)`; strict deep
  verification passed.
- Installed executable SHA-256:
  `80322f7a1ce4f99b1d998332e40b50a1439a79af229a28ef6714ec1037b60fb2`
- Disposable source SHA-256 before preview, after import, and after the native
  matrix:
  `86f3d22fb2853515f24768a4478b9d9b173c6652a59e2a799641383d2e842747`
- The native picker previewed the already-imported 283-byte source as
  `Unchanged`; import remained disabled, proving idempotency without rewriting
  the source.

## Native authorization and persistence

- Granted Hermes `default` and OpenClaw `main` each retrieved the corpus-only
  values `Cedar Meridian` and `4729-Aster`.
- The ungranted Luca resident could not retrieve either value. Revoking
  OpenClaw excluded the source on its next turn.
- OpenClaw's app-managed parallelism was changed from its original value of one
  to two through Luca's agent editor. After the resident restarted on the new
  binding, the grant became stale and the next turn received no Owner Brain
  source. Reconfirmation restored retrieval.
- Parallelism was restored from two to one, the resident was restarted, and the
  restored binding was reconfirmed. Hermes and OpenClaw both finished ready at
  their original app-managed parallelism of one.
- Relaunch preserved the source and active grants while clearing retrieval
  receipts, as required by their process-memory-only retention contract.
- Ordinary Hermes and OpenClaw DMs completed after relaunch. Both residents also
  replied in one mixed room under their separate stable Luca identities.

## Native no-write and privacy proof

The protected pre/post snapshots were byte-identical:

| Protected native state | SHA-256 |
|---|---|
| Hermes configuration | `5b03798c7625609e78a67bd813e9104d7a69b2e80c6ef69c42c08276d262b0bd` |
| Hermes identity/workspace (`SOUL.md`) | `7d27c3b11b9b94534631e73fbc026c7757d3dc72940a0869917b255b6f4abb87` |
| Hermes memory | `9008276907c30f27c0f2c8fccba0cd78a3f4b0a0b35ce3d57ad5281c49499919` |
| Hermes user memory | `38fd4e88276196610e7fe3d1743ccfca6acd49e8a3930f11b97f531fbeca9b31` |
| Hermes schedule | `82b0bfd423858c90fb1f36ad4a8ae237dc44bbaf72f5dd94bfa9fcaa28fd69c6` |
| OpenClaw configuration | `f5633fc4e495e5ef6a87e35966ab6d9875bd92d0458371f0074525f386f8e2b5` |
| OpenClaw model catalog | `e61eec4152f13a2111203dcd27739833ad901d40d752874376876e2b395ecf6b` |
| OpenClaw memory/workspace tree | `2003e19074a9ae3244ae3cd05a6efa4ee2bd4167390aaddff5f237aad11cfea9` |
| OpenClaw schedule tree | `872e2a2c7e90d13d07efbc4103a57f6abf846ee2ce268dbd9028392b1af3a1ee` |

No native configuration, credential, model, memory, workspace, or schedule was
changed. A scan of the encrypted continuity store found no plaintext source
path, filename, `Cedar Meridian`, or `4729-Aster` material.

## Verification

- Exact-file Rust formatting and `git diff --check`: pass.
- Strict Clippy for `luca-protocol` and desktop Tauri: pass.
- Brain protocol vectors: 5/5 pass.
- Owner Brain import, grant, retrieval, corruption, rollback, cancellation,
  staleness, and provider-capture coverage: pass.
- Full desktop Tauri suite: 1,770 passed, 13 ignored; three diagnostic tests
  also passed.
- Desktop Biome, file-size, pixel-text, pubkey-truncation, 3,420 unit tests,
  typecheck, and production build: pass.
- Playwright B26, F03, and F07 smoke projects: 8/8 pass.
- Workspace unit, web build, and mobile preflight: pass; mobile reports 525
  passed and one intentional skip.
- The single formal `just ci` run passed on the unchanged product checkpoint
  after native acceptance. No product source changed afterward.

V1.2 is released locally. V1.3 remains `NOT_STARTED`; this verdict does not
authorize its implementation or a remote push.
