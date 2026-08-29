# Polyphonic Continuity Assay V1 fixtures

This folder is the versioned synthetic input for
`docs/luca/POLYPHONIC_CONTINUITY_ASSAY.md`.

- `golden-life.json` contains synthetic private-life material only. It contains
  no owner data, credentials, local paths, or installed resident history.
- `manifest.json` freezes nine core scenarios, four extension scenarios,
  selected evidence, prompts, prohibited readings, conditions, and hard gates.
- `run-record.schema.json` defines the body-free evidence record allowed in a
  repository or public evidence bundle.

The manifest's `existing-narrow-spine-fixture-v1` policy is the initial
selection baseline. It is not a claim that `ContinuityWakePacketV1` already
exists in production.

## Commands

Activate the repository toolchain first:

```bash
. ./bin/activate-hermit
```

Validate the frozen panel:

```bash
cargo run -p luca-continuity --bin luca-continuity-assay -- \
  validate \
  crates/luca-continuity/assay/v1/manifest.json \
  crates/luca-continuity/assay/v1/golden-life.json
```

Prepare the complete core development panel in a new private directory:

```bash
cargo run -p luca-continuity --bin luca-continuity-assay -- \
  prepare-panel \
  crates/luca-continuity/assay/v1/manifest.json \
  crates/luca-continuity/assay/v1/golden-life.json \
  /path/to/disposable-private-profile/prepared-panel
```

The panel command creates opaque randomized run IDs, all N/D/W core inputs,
and every C08 fault mode. The private index is the only condition mapping and
must not be shown to behavioral readers.

Create one private generation packet. The output must not already exist and is
created with mode `0600` on Unix:

```bash
cargo run -p luca-continuity --bin luca-continuity-assay -- \
  prepare \
  crates/luca-continuity/assay/v1/manifest.json \
  crates/luca-continuity/assay/v1/golden-life.json \
  C09 W opaque-run-id /path/to/disposable-private-profile/C09-W.json
```

`prepare` creates model input; it does not invoke a model. After a controlled
runner records the exact response in an `AssayPrivateRunV1`, `reader-packet`
creates a blinded packet without the experimental condition or compiler
material. `body-free-record` hashes private identities, process identifiers,
source event identifiers, and response content for durable evidence.

Private generation packets, responses, reader packets, owner notes, and
resident testimony do not belong in the repository. Use a disposable encrypted
assay profile. The CLI's `0600` mode is defense in depth, not encryption.
