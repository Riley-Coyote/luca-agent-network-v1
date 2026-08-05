# K03D verification commands

Run from the G2 worktree after `source bin/activate-hermit`.

```text
cargo test --manifest-path desktop/src-tauri/Cargo.toml continuity_store --lib --locked
cargo fmt --manifest-path desktop/src-tauri/Cargo.toml --all -- --check
cargo metadata --manifest-path desktop/src-tauri/Cargo.toml --locked --no-deps
git diff --check
```

Results after Riley-authorized surgical repair:

- 14 focused store tests passed.
- Targeted formatting, locked metadata, and diff checks passed.
- G2 control validation passed.
- Independent final security review passed with no P0/P1/P2 findings.
- Product-source commit: `2ea59d8d`.
