# F19 Protected Owner Recovery Amendment — 2026-07-27

Status: approved G1 contract correction

## Product boundary

F19 ships a real protected owner-identity backup and recovery path. It is not a
resident backup, coordinator transfer, or general healthy-identity replacement
flow.

- Export is available only while the current owner identity is healthy,
  desktop-held, and not supplied by shared/environment configuration.
- Import confirmation is recovery-only: the app must be in `identity_lost` or
  `keyring_locked` state. A healthy identity cannot be replaced through this
  path.
- Preview decrypts and validates but performs zero filesystem, Keychain,
  AppState, relay, or profile writes.
- Confirmation re-reads the exact ciphertext, re-decrypts it, binds to the
  preview ciphertext digest and confirmed public key, then persists directly
  to Keychain. It never calls the legacy fallback-capable
  `persist_imported_identity` path.
- The Keychain value is read back and parsed, and the exact public key must be
  reproduced before AppState changes.
- A prior Keychain value is restored if any post-write verification fails.
- Shared/environment-owned identity configurations are denied.

## File and cryptographic format

- extension: `.luca-owner.age`
- maintained Rust `age` v1 binary passphrase format; no custom cryptography
- inner schema: canonical `OwnerIdentityBundleV1` from `luca-protocol`
- passphrase: 12..1024 UTF-8 bytes
- maximum ciphertext: 1 MiB
- maximum decrypted canonical payload: 256 KiB
- passphrase recipient (`scrypt`) required; non-scrypt files reject
- maximum accepted age scrypt work factor: 20
- restricted temporary file in the destination directory, finalized and
  synced before atomic rename
- successful export is read back, decrypted, manifest-validated, and checked
  against the current owner public key before reporting success

Secret plaintext uses zeroizing buffers. Errors, logs, screenshots, evidence,
and public return types contain public metadata only.

## Desktop/API/UI requirements

Add three protected commands and corresponding typed frontend calls:

- export protected owner backup;
- zero-write preview;
- confirmed recovery import.

The existing settings identity-copy surface becomes protected backup; Luca
settings must not call or expose `get_nsec`. The locked/lost startup surface
accepts a protected owner backup and passphrase, shows a public-only preview,
requires explicit confirmation, then relaunches after verified Keychain
recovery.

Initial first-run import of an owner-provided nsec remains a separate legacy
onboarding input and is not described as protected backup/recovery. The
read/export command `get_nsec` is removed from Luca's Tauri invoke allowlist.

## Narrow ownership correction

F19 additionally owns:

- `desktop/src-tauri/src/commands/identity.rs`
- the F19 command-registration lines in `desktop/src-tauri/src/lib.rs`
- `desktop/src-tauri/src/app_state.rs`
- `desktop/src-tauri/src/secret_store.rs`
- `desktop/src/shared/api/tauriIdentity.ts`
- the protected-recovery routing lines in
  `desktop/src/features/onboarding/hooks.ts` and
  `desktop/src/features/onboarding/machineOnboarding.ts`
- `desktop/src/features/onboarding/ui/BackupStep.tsx`
- `desktop/src/features/onboarding/ui/KeyringLockedScreen.tsx`
- `desktop/src/features/settings/ui/ProfileSettingsCard.tsx`

Changes are limited to the protected owner recovery flow, disabling Luca's
plaintext export surface, verified Keychain persistence/rollback, and the
minimum product UI. No resident restore, new cryptography, unrelated identity
migration, or broad settings redesign is authorized.

## Required proof

- export/readback/preview/confirm round-trip reproduces one synthetic pubkey;
- wrong passphrase, tampered ciphertext, non-scrypt recipient, excessive work
  factor, duplicate/noncanonical JSON, manifest mismatch, secret/pubkey
  mismatch, oversize ciphertext and oversize plaintext reject;
- preview causes zero writes;
- missing/mismatched confirmation causes zero writes;
- healthy replacement and shared/environment identity reject;
- Keychain failure/readback mismatch/parse mismatch restores the prior value;
- concurrent imports serialize under `identity_mutation`;
- a unique macOS Keychain integration fixture cleans up after itself;
- frontend has no `get_nsec` call and Luca's invoke allowlist does not expose
  it;
- secret/artifact scan finds no nsec, passphrase, decrypted body, or local
  source path.
