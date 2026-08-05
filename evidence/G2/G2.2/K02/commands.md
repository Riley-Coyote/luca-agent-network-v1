# K02 command evidence

Source commit: `fb5d7b08`

```text
. ./bin/activate-hermit
cargo test --manifest-path desktop/src-tauri/Cargo.toml continuity_key --lib
```

Result: PASS, 14 passed, 0 failed. The only warnings are the two intentionally
unwired K02 production entry points that K03D will consume.

```text
cargo metadata --manifest-path desktop/src-tauri/Cargo.toml --locked --no-deps --format-version 1
rustfmt --edition 2021 --check desktop/src-tauri/src/luca/continuity_key_custody.rs desktop/src-tauri/src/luca/continuity_key_derivation.rs
git diff --check
```

Result: PASS.

Static regression tests and source inspection confirm:

- no filesystem or environment key fallback;
- no process-global `SecretStore::shared` cache;
- no scope-key or chained namespace derivation;
- exact canonical 32-byte key encoding and constant-time read-back comparison;
- redacted master and derived-key formatters;
- fixed owner/resident HKDF vectors.

The production OS keychain was not mutated by K02 verification. Installed-app
custody and fail-soft chat behavior remain an explicit G2.6 obligation.
