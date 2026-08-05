# K03D verification commands

Run from the G2 worktree after `source bin/activate-hermit`.

```text
cargo test --manifest-path desktop/src-tauri/Cargo.toml continuity_store --lib --locked
cargo fmt --manifest-path desktop/src-tauri/Cargo.toml --all -- --check
cargo metadata --manifest-path desktop/src-tauri/Cargo.toml --locked --no-deps
git diff --check
```

Results at stop:

- 11 focused store tests passed.
- Targeted formatting, locked metadata, and diff checks passed.
- Independent security review remained BLOCKED on fail-soft allocation safety.
- No product-source commit was created for K03D.
