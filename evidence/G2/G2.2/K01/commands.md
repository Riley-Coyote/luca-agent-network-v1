# K01 command evidence

Date: 2026-08-05

```text
. ./bin/activate-hermit

cargo test -p luca-continuity
PASS — 7 passed

cargo clippy -p luca-continuity --all-targets -- -D warnings
PASS

RUSTDOCFLAGS='-D warnings' cargo doc -p luca-continuity --no-deps
PASS

cargo check -p luca-continuity --locked
PASS

cargo tree -p luca-continuity --depth 1
PASS — only luca-protocol is a direct dependency

cargo fmt --all -- --check
PASS

git diff --check
PASS

python3 scripts/luca/validate_g2_control.py
PASS
```

Static source and dependency scans found no Tauri, keyring, SQLite, network,
ACP, scheduling, NIP-AE, Python, or Supabase dependency in the crate.
