# K03 command evidence

Source commit: `36adf62c`

```text
. ./bin/activate-hermit
cargo test -p luca-continuity --locked
cargo clippy -p luca-continuity --all-targets --locked -- -D warnings
cargo doc -p luca-continuity --no-deps --locked
cargo metadata --locked --no-deps --format-version 1
python3 scripts/luca/validate_g2_control.py
git diff --check
```

Result: PASS. Twenty tests passed: thirteen authenticated-record/repository
tests and seven exact namespace/scope isolation tests.

The adversarial matrix covers:

- wrong namespace key and ordinary wrong key;
- ciphertext bit flip and valid-length corrupt-record isolation;
- public AAD-digest tamper;
- valid full metadata substitutions after recomputing the public digest;
- nonce bit flip;
- truncated tag, exact maximum ciphertext, one-byte-over plaintext, and
  valid-base64 oversized ciphertext;
- nonce reuse within one namespace/key-version domain;
- exact replay and same-ID different-record conflict;
- bounded serialized ingestion before JSON parsing;
- exact namespace/scope read isolation.

Dependency/API scans found no SQLite, keychain, Tauri, runtime, filesystem,
networking, or unsafe behavior in the pure K03 implementation.
