import * as React from "react";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  exportProtectedOwnerIdentity,
  isValidOwnerBackupPassphrase,
  ownerBackupPassphraseByteLength,
} from "@/shared/api/tauriIdentity";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

export function ProtectedOwnerBackupRow() {
  const [isOpen, setIsOpen] = React.useState(false);
  const [passphrase, setPassphrase] = React.useState("");
  const [confirmation, setConfirmation] = React.useState("");
  const [isExporting, setIsExporting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const canExport =
    isValidOwnerBackupPassphrase(passphrase) &&
    passphrase === confirmation &&
    !isExporting;
  const passphraseBytes = ownerBackupPassphraseByteLength(passphrase);

  async function handleExport() {
    setIsExporting(true);
    setError(null);
    try {
      const result = await exportProtectedOwnerIdentity(passphrase);
      toast.success(`Protected backup saved as ${result.fileName}`);
      setPassphrase("");
      setConfirmation("");
      setIsOpen(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Protected backup could not be created.",
      );
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="px-4 py-3" data-testid="profile-protected-backup-row">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">Protected owner backup</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Encrypted file for identity recovery
          </p>
        </div>
        <button
          aria-expanded={isOpen}
          aria-label={
            isOpen ? "Cancel protected backup" : "Create protected backup"
          }
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          data-testid="profile-protected-backup-toggle"
          onClick={() => {
            setIsOpen((open) => !open);
            setError(null);
          }}
          type="button"
        >
          <ShieldCheck className="h-4 w-4 shrink-0" />{" "}
          {isOpen ? "Cancel" : "Back up"}
        </button>
      </div>
      {isOpen ? (
        <div className="mt-4 space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
          <p className="text-xs leading-5 text-muted-foreground">
            Choose a unique passphrase. Luca never displays or copies the
            private key.
          </p>
          <Input
            aria-label="Backup passphrase"
            autoComplete="new-password"
            onChange={(event) => setPassphrase(event.target.value)}
            placeholder="Passphrase (12–1024 UTF-8 bytes)"
            type="password"
            value={passphrase}
          />
          <Input
            aria-label="Confirm backup passphrase"
            autoComplete="new-password"
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder="Confirm passphrase"
            type="password"
            value={confirmation}
          />
          {confirmation && passphrase !== confirmation ? (
            <p className="text-xs text-destructive">
              Passphrases do not match.
            </p>
          ) : null}
          {passphrase && !isValidOwnerBackupPassphrase(passphrase) ? (
            <p className="text-xs text-destructive">
              Passphrase is {passphraseBytes} UTF-8 bytes; use 12–1024.
            </p>
          ) : null}
          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button
            className="h-8"
            data-testid="profile-protected-backup-export"
            disabled={!canExport}
            onClick={() => void handleExport()}
            size="sm"
            type="button"
          >
            {isExporting ? "Creating…" : "Choose location and back up"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
