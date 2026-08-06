# Reproducible V1B checks

Activate the checked-in Hermit environment before Rust, Node, or repository
commands.

```sh
python3 scripts/luca/validate_v1b_control.py
just ci
cargo test --manifest-path desktop/src-tauri/Cargo.toml owner_forget_physically_purges_every_encrypted_handoff_revision --lib
cargo test --manifest-path desktop/src-tauri/Cargo.toml handoffs_are_resident_isolated_and_owner_corrections_pin_authority --lib
cargo test --manifest-path desktop/src-tauri/Cargo.toml timeout_pending_restore_and_locked_key_fail_before_plaintext --lib
cargo test --manifest-path desktop/src-tauri/Cargo.toml resident_creation_reuses_native_runtime_identity_and_rejects_duplicates --lib
cargo test --manifest-path desktop/src-tauri/Cargo.toml owner_can_retry_latest_failed_job_exactly_once --lib
cargo test -p buzz-acp continuity_prompt_timestamp_is_protocol_canonical --lib
cargo test --manifest-path desktop/src-tauri/Cargo.toml managed_message_outbox --lib
cargo test --manifest-path desktop/src-tauri/Cargo.toml managed_message_publisher --lib
cargo check --manifest-path desktop/src-tauri/Cargo.toml --lib
scripts/rebuild-luca-dev-app.sh
```

Real resident-authored handoff behavior, fresh-runtime recall, mixed-runtime
attribution, owner controls, and native failure handling require the installed
application. Browser-only mocks are not authoritative for those checks.
