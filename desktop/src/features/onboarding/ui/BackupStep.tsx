import * as React from "react";
import { CheckCircle2, Info, LockKeyhole } from "lucide-react";
import {
  exportProtectedOwnerIdentity,
  isValidOwnerBackupPassphrase,
  ownerBackupPassphraseByteLength,
} from "@/shared/api/tauriIdentity";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { ONBOARDING_PRIMARY_CTA_CLASS } from "./OnboardingChrome";
import { OnboardingFooter } from "./OnboardingFooter";
import {
  type OnboardingTransitionDirection,
  OnboardingSlideTransition,
} from "./OnboardingSlideTransition";
type BackupStepProps = {
  direction: OnboardingTransitionDirection;
  onBack: () => void;
  onNext: () => void;
};

/**
 * Owner identity disclosure. The private key remains in the OS keychain;
 * setup never reads, displays, or copies plaintext key material.
 */
export function BackupStep({ direction, onBack, onNext }: BackupStepProps) {
  const [passphrase, setPassphrase] = React.useState("");
  const [confirmation, setConfirmation] = React.useState("");
  const [isExporting, setIsExporting] = React.useState(false);
  const [exportedFile, setExportedFile] = React.useState<string | null>(null);
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
      setExportedFile(result.fileName);
      setPassphrase("");
      setConfirmation("");
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : "Protected backup could not be created.",
      );
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <OnboardingSlideTransition
      className="flex min-h-0 w-full flex-col items-center"
      data-testid="onboarding-page-backup"
      direction={direction}
      transitionKey={`backup-${direction}`}
    >
      <div className="flex w-full max-w-[500px] shrink-0 flex-col text-center">
        <h1 className="text-title font-normal text-foreground">
          Your owner identity is secured
        </h1>
        <p className="mt-5 text-sm leading-6 text-foreground/80">
          Luca created a cryptographic identity for you. Its private signing key
          stays in your system keychain and is never shown or copied during
          setup.
        </p>
      </div>

      <div className="flex w-full max-w-[1040px] flex-1 flex-col justify-center py-10">
        <div
          className="mx-auto w-full max-w-[500px] rounded-xl border border-border/70 bg-muted/30 px-6 py-5 text-left"
          data-testid="onboarding-recovery-disclosure"
        >
          <div className="flex items-start gap-3">
            <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-foreground/70" />
            <div>
              <h2 className="text-sm font-medium text-foreground">
                Create a protected recovery file
              </h2>
              <p className="mt-2 text-sm leading-6 text-foreground/75">
                Luca encrypts your owner identity with a passphrase you choose.
                Store the file and passphrase separately; neither can recover
                your identity alone.
              </p>
              {exportedFile ? (
                <p
                  className="mt-4 flex items-center gap-2 text-xs text-foreground/80"
                  data-testid="onboarding-protected-export-success"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Protected backup saved as {exportedFile}
                </p>
              ) : (
                <div className="mt-4 space-y-3">
                  <Input
                    aria-label="Backup passphrase"
                    autoComplete="new-password"
                    data-testid="onboarding-backup-passphrase"
                    onChange={(event) => setPassphrase(event.target.value)}
                    placeholder="Passphrase (12–1024 UTF-8 bytes)"
                    type="password"
                    value={passphrase}
                  />
                  <Input
                    aria-label="Confirm backup passphrase"
                    autoComplete="new-password"
                    data-testid="onboarding-backup-passphrase-confirmation"
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
                    className="h-8 px-3 text-xs"
                    data-testid="onboarding-protected-export"
                    disabled={!canExport}
                    onClick={() => void handleExport()}
                    type="button"
                    variant="outline"
                  >
                    {isExporting ? "Creating…" : "Choose location and back up"}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
        <p className="mx-auto mt-6 flex max-w-[440px] items-start justify-center gap-1.5 text-center text-xs leading-5 text-[var(--buzz-onboarding-backup-ink)]">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Never share a private key. Anyone with one can act as its owner.
          </span>
        </p>
      </div>

      <OnboardingFooter>
        <Button
          className={ONBOARDING_PRIMARY_CTA_CLASS}
          data-testid="onboarding-next"
          onClick={onNext}
          type="button"
        >
          Next
        </Button>

        <Button
          className="h-9 rounded-full bg-foreground/10 px-6 hover:bg-foreground/15"
          data-testid="onboarding-back"
          onClick={onBack}
          type="button"
          variant="ghost"
        >
          Back
        </Button>
      </OnboardingFooter>
    </OnboardingSlideTransition>
  );
}
