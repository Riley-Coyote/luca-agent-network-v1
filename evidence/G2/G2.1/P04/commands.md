# P04 command evidence

Date: 2026-08-05

```text
. ./bin/activate-hermit

cargo test -p buzz-acp --test luca_f10
PASS — 2 passed

cargo test -p buzz-acp permission --lib
PASS — 12 passed

cargo test -p luca-protocol managed_permission
PASS — 2 passed

cargo test --manifest-path desktop/src-tauri/Cargo.toml managed_permission --lib
PASS — 1 passed

cargo test --manifest-path desktop/src-tauri/Cargo.toml luca_f10 --lib
PASS — 1 passed

cargo metadata --manifest-path desktop/src-tauri/Cargo.toml --locked --no-deps --format-version 1
PASS

python3 -m json.tool tests/luca-conformance/f10/continuity_absent.json
PASS

git diff --check
PASS
```

The desktop package's independent lockfile required the expected one-line
`base64 0.22.1` synchronization after P01 added canonical base64 validation to
`luca-protocol`.

The repository-wide format check was not used for this repair because the
pre-existing production portion of `managed_permission.rs` is intentionally
not rustfmt-formatted. The repair appends only a formatted `#[cfg(test)]` module;
production lines are byte-unchanged.
