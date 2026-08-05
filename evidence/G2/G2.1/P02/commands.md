# P02 command evidence

Date: 2026-08-04

```text
cargo fmt --check -p buzz-acp
PASS

cargo test -p buzz-acp --lib room_
7 passed

cargo test -p buzz-acp --lib
598 passed

cargo test -p buzz-acp --test luca_f10
2 passed

cargo clippy -p buzz-acp --lib --tests --no-deps -- -D warnings
PASS

git diff --check
PASS
```

The initial all-local-dependency clippy command encountered a pre-existing
`luca-diagnostics` lint under the current toolchain. The scoped `--no-deps`
command proves the owned `buzz-acp` target clean without modifying that unrelated
crate.
