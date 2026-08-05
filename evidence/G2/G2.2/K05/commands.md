# K05 verification commands

Run from the G2 worktree after `source bin/activate-hermit`.

```text
cargo test -p luca-continuity --locked
cargo clippy -p luca-continuity --all-targets --locked -- -D warnings
cargo fmt --manifest-path crates/luca-continuity/Cargo.toml --all -- --check
git diff --check
```

Results:

- 13 library tests passed.
- 15 revision lifecycle tests passed.
- 7 exact-scope tests passed.
- Clippy, formatting, and diff checks passed.
- Source commit: `21e5a7f9`.
