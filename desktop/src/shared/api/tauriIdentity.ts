import { invokeTauri } from "@/shared/api/tauri";
import type { Identity } from "@/shared/api/types";

type RawIdentity = {
  pubkey: string;
  display_name: string;
  lost?: boolean;
  locked?: boolean;
  reset_failed?: boolean;
};

function fromRawIdentity(raw: RawIdentity): Identity {
  return {
    pubkey: raw.pubkey,
    displayName: raw.display_name,
    lost: raw.lost === true,
    locked: raw.locked === true,
    resetFailed: raw.reset_failed === true,
  };
}

export async function getIdentity(): Promise<Identity> {
  return fromRawIdentity(await invokeTauri<RawIdentity>("get_identity"));
}

export type OwnerBackupResult = {
  bundleId: string;
  exportedAt: string;
  ownerPubkey: string;
  ciphertextSha256: string;
  fileName: string;
};

export type OwnerRecoveryPreview = {
  bundleId: string;
  exportedAt: string;
  ownerPubkey: string;
  ciphertextSha256: string;
  sourcePath: string;
};

export type OwnerRecoveryResult = {
  ownerPubkey: string;
  recovered: boolean;
};

export async function exportProtectedOwnerIdentity(
  passphrase: string,
  destinationPath?: string,
): Promise<OwnerBackupResult> {
  return invokeTauri<OwnerBackupResult>("export_protected_owner_identity", {
    destinationPath,
    passphrase,
  });
}

export async function previewProtectedOwnerIdentity(
  passphrase: string,
  sourcePath?: string,
): Promise<OwnerRecoveryPreview> {
  return invokeTauri<OwnerRecoveryPreview>("preview_protected_owner_identity", {
    sourcePath,
    passphrase,
  });
}

export async function confirmProtectedOwnerIdentityRecovery(
  sourcePath: string,
  passphrase: string,
  expectedCiphertextSha256: string,
  confirmedOwnerPubkey: string,
): Promise<OwnerRecoveryResult> {
  return invokeTauri<OwnerRecoveryResult>(
    "confirm_protected_owner_identity_recovery",
    {
      sourcePath,
      passphrase,
      expectedCiphertextSha256,
      confirmedOwnerPubkey,
    },
  );
}

export async function importIdentity(nsec: string): Promise<Identity> {
  return fromRawIdentity(
    await invokeTauri<RawIdentity>("import_identity", { nsec }),
  );
}

export async function persistCurrentIdentity(): Promise<Identity> {
  return fromRawIdentity(
    await invokeTauri<RawIdentity>("persist_current_identity"),
  );
}

/**
 * Wipe all local Buzz state (keychain, App Support, WebKit, nest, OAuth cache,
 * CLI symlinks) and relaunch into first-run onboarding.
 *
 * The app restarts after this call completes. Callers should keep the pending
 * state until the process exits and only handle errors (e.g. display a toast).
 */
export async function signOut(): Promise<void> {
  await invokeTauri("sign_out");
}
