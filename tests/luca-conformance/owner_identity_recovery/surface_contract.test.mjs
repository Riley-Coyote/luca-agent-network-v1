import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../../../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("owner recovery exposes only the three protected commands", async () => {
  const invokeAllowlist = await source("desktop/src-tauri/src/lib.rs");
  const frontend = await source("desktop/src/shared/api/tauriIdentity.ts");

  for (const command of [
    "export_protected_owner_identity",
    "preview_protected_owner_identity",
    "confirm_protected_owner_identity_recovery",
  ]) {
    assert.match(invokeAllowlist, new RegExp(`\\b${command}\\b`));
    assert.match(frontend, new RegExp(`\"${command}\"`));
  }
  assert.doesNotMatch(invokeAllowlist, /\bget_nsec\b/);
  assert.doesNotMatch(frontend, /\bgetNsec\b|\"get_nsec\"/);
});

test("preview authority has no state or Keychain parameter", async () => {
  const authority = await source(
    "desktop/src-tauri/src/luca/owner_identity_recovery.rs",
  );
  const preview = authority.slice(
    authority.indexOf("pub(crate) fn preview_protected_owner_backup"),
    authority.indexOf("trait RecoveryKeyStore"),
  );

  assert.match(preview, /read_bounded_ciphertext/);
  assert.match(preview, /decrypt_and_validate/);
  assert.doesNotMatch(preview, /AppState|SecretStore|RecoveryKeyStore|\.store\(/);
});

test("confirmed recovery is recovery-only and serialized", async () => {
  const authority = await source(
    "desktop/src-tauri/src/luca/owner_identity_recovery.rs",
  );
  const confirmation = authority.slice(
    authority.indexOf("pub(crate) fn confirm_protected_owner_recovery"),
  );

  assert.match(confirmation, /identity_mutation/);
  assert.match(confirmation, /identity_lost/);
  assert.match(confirmation, /keyring_locked/);
  assert.match(confirmation, /persist_verified_keychain/);
  assert.doesNotMatch(confirmation, /persist_imported_identity/);
});

test("lost and locked identities route to protected recovery", async () => {
  for (const path of [
    "desktop/src/features/onboarding/hooks.ts",
    "desktop/src/features/onboarding/machineOnboarding.ts",
  ]) {
    const routing = await source(path);
    assert.match(routing, /\(identityLocked \|\| identityLost\)/);
    assert.match(routing, /keyring-locked/);
  }
});

test("frontend passphrase gate measures UTF-8 bytes", async () => {
  const frontend = await source("desktop/src/shared/api/tauriIdentity.ts");
  assert.match(frontend, /new TextEncoder\(\)\.encode\(passphrase\)\.byteLength/);
  assert.match(frontend, /OWNER_BACKUP_PASSPHRASE_MIN_BYTES = 12/);
  assert.match(frontend, /OWNER_BACKUP_PASSPHRASE_MAX_BYTES = 1024/);
});
