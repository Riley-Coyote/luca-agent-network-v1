# K04 verification commands

Run from the G2 worktree after `source bin/activate-hermit`.

```text
cargo test -p luca-continuity --locked
cargo test -p luca-continuity --test retrieval_vectors --locked -- --nocapture
cargo test -p luca-continuity retrieval_fts --lib --locked -- --nocapture
cargo clippy -p luca-continuity --all-targets --no-deps --locked -- -D warnings
cargo fmt --all -- --check
git diff --check
```

Results:

- 53 `luca-continuity` tests passed, including 17 retrieval vectors.
- Focused FTS tests, strict Clippy, formatting, and diff checks passed.
- Source scans found no BM25/floating-point ranking, file-backed SQLite,
  persistence writes, network/provider/model calls, or reconsolidation paths.
- Runtime PRAGMA checks and the filesystem snapshot test found no retrieval
  database, WAL, SHM, or temporary artifact.
- Source commit: `4fae3ca9`.
