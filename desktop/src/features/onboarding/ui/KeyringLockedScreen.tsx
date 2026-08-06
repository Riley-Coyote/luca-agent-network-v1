import * as React from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import { FileKey2, ShieldCheck } from "lucide-react";
import {
  confirmProtectedOwnerIdentityRecovery,
  isValidOwnerBackupPassphrase,
  ownerBackupPassphraseByteLength,
  previewProtectedOwnerIdentity,
  type OwnerRecoveryPreview,
} from "@/shared/api/tauriIdentity";
import { useSystemColorScheme } from "@/shared/theme/useSystemColorScheme";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { StartupWindowDragRegion } from "@/shared/ui/StartupWindowDragRegion";

export function KeyringLockedScreen() {
  const systemColorScheme = useSystemColorScheme();
  const [showRecovery, setShowRecovery] = React.useState(false);
  const [passphrase, setPassphrase] = React.useState("");
  const [preview, setPreview] = React.useState<OwnerRecoveryPreview | null>(
    null,
  );
  const [confirmed, setConfirmed] = React.useState(false);
  const [isPreviewing, setIsPreviewing] = React.useState(false);
  const [isRecovering, setIsRecovering] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const passphraseBytes = ownerBackupPassphraseByteLength(passphrase);

  function resetPreview() {
    setPreview(null);
    setConfirmed(false);
    setError(null);
  }

  async function handlePreview() {
    if (!isValidOwnerBackupPassphrase(passphrase)) return;
    setIsPreviewing(true);
    setError(null);
    try {
      setPreview(await previewProtectedOwnerIdentity(passphrase));
      setConfirmed(false);
    } catch (previewError) {
      setPreview(null);
      setError(
        previewError instanceof Error
          ? previewError.message
          : "The protected backup could not be verified.",
      );
    } finally {
      setIsPreviewing(false);
    }
  }

  async function handleRecover() {
    if (!preview || !confirmed) return;
    setIsRecovering(true);
    setError(null);
    try {
      await confirmProtectedOwnerIdentityRecovery(
        preview.sourcePath,
        passphrase,
        preview.ciphertextSha256,
        preview.ownerPubkey,
      );
      await relaunch();
    } catch (recoveryError) {
      setError(
        recoveryError instanceof Error
          ? recoveryError.message
          : "The owner identity could not be recovered.",
      );
      setIsRecovering(false);
    }
  }

  return (
    <div
      className="buzz-onboarding-neutral-theme buzz-startup-shell flex items-center justify-center bg-background px-4 py-8 text-foreground"
      data-system-color-scheme={systemColorScheme}
      data-testid="keyring-locked"
    >
      <StartupWindowDragRegion />
      <div className="relative flex w-full max-w-[500px] flex-col items-center text-center">
        <h1 className="text-3xl font-semibold tracking-tight">
          Recover your owner identity
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          If your system keyring is locked, unlock it and relaunch Luca. If the
          identity is unavailable, recover it from a protected Luca backup.
        </p>

        {showRecovery ? (
          <div
            className="mt-7 w-full rounded-xl border border-border/70 bg-muted/20 p-5 text-left"
            data-testid="protected-owner-recovery"
          >
            <div className="flex items-start gap-3">
              <FileKey2 className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div>
                <h2 className="text-sm font-medium">
                  Recover from protected backup
                </h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Preview validates the file without changing Luca or the system
                  keychain. Recovery happens only after your explicit
                  confirmation.
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <Input
                aria-label="Backup passphrase"
                autoComplete="current-password"
                data-testid="owner-recovery-passphrase"
                disabled={isPreviewing || isRecovering}
                onChange={(event) => {
                  setPassphrase(event.target.value);
                  resetPreview();
                }}
                placeholder="Backup passphrase"
                type="password"
                value={passphrase}
              />
              {passphrase && !isValidOwnerBackupPassphrase(passphrase) ? (
                <p className="text-xs text-destructive">
                  Passphrase is {passphraseBytes} UTF-8 bytes; use 12–1024.
                </p>
              ) : null}
              {!preview ? (
                <Button
                  className="w-full"
                  data-testid="preview-owner-recovery"
                  disabled={
                    !isValidOwnerBackupPassphrase(passphrase) || isPreviewing
                  }
                  onClick={() => void handlePreview()}
                  type="button"
                >
                  {isPreviewing ? "Verifying…" : "Choose and preview backup"}
                </Button>
              ) : (
                <div
                  className="space-y-3 rounded-lg border border-border/70 bg-background/70 p-4"
                  data-testid="owner-recovery-preview"
                >
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <ShieldCheck className="h-4 w-4" />
                    Valid protected backup
                  </div>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">Owner</dt>
                    <dd
                      className="truncate font-mono"
                      title={preview.ownerPubkey}
                    >
                      {truncatePubkey(preview.ownerPubkey)}
                    </dd>
                    <dt className="text-muted-foreground">Created</dt>
                    <dd>{preview.exportedAt}</dd>
                    <dt className="text-muted-foreground">Bundle</dt>
                    <dd className="truncate font-mono" title={preview.bundleId}>
                      {preview.bundleId}
                    </dd>
                  </dl>
                  <label className="flex cursor-pointer items-start gap-2 text-xs leading-5">
                    <input
                      checked={confirmed}
                      className="mt-1"
                      data-testid="confirm-owner-pubkey"
                      onChange={(event) => setConfirmed(event.target.checked)}
                      type="checkbox"
                    />
                    <span>
                      Replace this install&apos;s inaccessible identity with the
                      owner shown above and relaunch Luca.
                    </span>
                  </label>
                  <Button
                    className="w-full"
                    data-testid="confirm-owner-recovery"
                    disabled={!confirmed || isRecovering}
                    onClick={() => void handleRecover()}
                    type="button"
                  >
                    {isRecovering ? "Recovering…" : "Recover and relaunch"}
                  </Button>
                </div>
              )}
              {error ? (
                <p className="text-xs text-destructive" role="alert">
                  {error}
                </p>
              ) : null}
              <Button
                className="w-full"
                disabled={isPreviewing || isRecovering}
                onClick={() => {
                  setShowRecovery(false);
                  setPassphrase("");
                  resetPreview();
                }}
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-8 flex w-full max-w-[300px] flex-col gap-3">
            <Button
              className="h-10 w-full"
              data-testid="relaunch-app"
              onClick={() => {
                void relaunch();
              }}
              type="button"
            >
              Relaunch Luca
            </Button>
            <Button
              className="h-10 w-full"
              data-testid="recover-protected-owner-backup"
              onClick={() => setShowRecovery(true)}
              type="button"
              variant="secondary"
            >
              Recover from protected backup
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
