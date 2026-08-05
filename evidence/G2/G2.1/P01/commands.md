# P01 command evidence

Date: 2026-08-05

```text
. ./bin/activate-hermit

cargo test -p luca-protocol
PASS — 24 passed, 2 ignored

cargo clippy -p luca-protocol --all-targets -- -D warnings
PASS

cargo doc -p luca-protocol --no-deps
PASS

git diff --check
PASS after receipt hygiene repair
```

The fixture test compiles the checked Draft 2020-12 schema, validates the
complete document, deserializes and round-trips every named V1 interface, and
independently recomputes each canonical RFC 8785 SHA-256 hash.
