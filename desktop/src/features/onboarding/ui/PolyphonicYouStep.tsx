import * as React from "react";
import { Check, ChevronDown, LoaderCircle, ShieldCheck } from "lucide-react";

import { useUpdateProfileMutation } from "@/features/profile/hooks";
import {
  exportProtectedOwnerIdentity,
  isValidOwnerBackupPassphrase,
  ownerBackupPassphraseByteLength,
} from "@/shared/api/tauriIdentity";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { AgentIdentitySpecimen } from "@/shared/ui/AgentIdentitySpecimen";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  clearPendingPolyphonicProfile,
  savePendingPolyphonicProfile,
} from "../polyphonicProfileSync";
import {
  PolyphonicNotice,
  PolyphonicStepHeading,
} from "./PolyphonicSetupFrame";

export type PolyphonicYouStepHandle = {
  commit: () => Promise<{ displayName: string; needsAttention: boolean }>;
};

export const PolyphonicYouStep = React.forwardRef<
  PolyphonicYouStepHandle,
  {
    displayName: string;
    onBusyChange: (busy: boolean) => void;
    onDisplayNameChange: (value: string) => void;
    pubkey: string;
  }
>(function PolyphonicYouStep(
  { displayName, onBusyChange, onDisplayNameChange, pubkey },
  ref,
) {
  const updateProfile = useUpdateProfileMutation();
  const [syncNotice, setSyncNotice] = React.useState<string | null>(null);
  const [backupOpen, setBackupOpen] = React.useState(false);
  const [passphrase, setPassphrase] = React.useState("");
  const [confirmation, setConfirmation] = React.useState("");
  const [backupStatus, setBackupStatus] = React.useState<string | null>(null);
  const [backupError, setBackupError] = React.useState<string | null>(null);
  const [isExporting, setIsExporting] = React.useState(false);

  const commit = React.useCallback(async () => {
    const name = displayName.trim();
    if (!name) throw new Error("Enter the name you want Luca to use.");
    onBusyChange(true);
    setSyncNotice(null);
    try {
      await updateProfile.mutateAsync({ displayName: name });
      clearPendingPolyphonicProfile(pubkey);
      return { displayName: name, needsAttention: false };
    } catch {
      savePendingPolyphonicProfile({
        version: 1,
        pubkey,
        displayName: name,
      });
      setSyncNotice(
        "Your name is saved on this Mac. Luca will try to sync it once on the next launch.",
      );
      return { displayName: name, needsAttention: true };
    } finally {
      onBusyChange(false);
    }
  }, [displayName, onBusyChange, pubkey, updateProfile]);

  React.useImperativeHandle(ref, () => ({ commit }), [commit]);

  const passphraseBytes = ownerBackupPassphraseByteLength(passphrase);
  const canExport =
    isValidOwnerBackupPassphrase(passphrase) &&
    passphrase === confirmation &&
    !isExporting;

  async function exportBackup() {
    setIsExporting(true);
    setBackupError(null);
    try {
      const result = await exportProtectedOwnerIdentity(passphrase);
      setBackupStatus(`Protected backup saved as ${result.fileName}`);
      setPassphrase("");
      setConfirmation("");
    } catch (cause) {
      setBackupError(
        cause instanceof Error
          ? cause.message
          : "The protected backup could not be created.",
      );
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <>
      <PolyphonicStepHeading
        description="This is how you appear to your agents. Your private owner key stays secured by macOS."
        stage="you"
        title="Make it yours"
      />
      <div className="mt-7 flex items-center gap-4">
        <AgentIdentitySpecimen
          accessibleName="Your owner identity"
          publicKey={pubkey}
          size={44}
        />
        <label
          className="min-w-0 flex-1 text-xs text-white/46"
          htmlFor="polyphonic-owner-name"
        >
          Display name
          <Input
            autoComplete="name"
            autoFocus
            className="mt-1.5 h-10 border-transparent bg-black/20 text-sm text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.045)] placeholder:text-white/28 hover:bg-black/25 focus-visible:border-white/10 focus-visible:ring-white/35"
            data-testid="polyphonic-owner-name"
            id="polyphonic-owner-name"
            maxLength={80}
            onChange={(event) => onDisplayNameChange(event.target.value)}
            placeholder="Your name"
            value={displayName}
          />
        </label>
      </div>
      <p className="ml-[3.75rem] mt-2.5 font-mono text-2xs leading-4 text-white/30">
        Identity mark derived from your public key · {truncatePubkey(pubkey)}
      </p>

      <div className="mt-6 rounded-xl bg-white/[0.025] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.035)]">
        <button
          aria-expanded={backupOpen}
          className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3.5 text-left text-sm text-white/68 transition-colors hover:bg-white/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/40"
          onClick={() => setBackupOpen((current) => !current)}
          type="button"
        >
          <ShieldCheck className="h-4 w-4 text-white/48" />
          <span className="flex-1">Create a protected recovery backup</span>
          <span className="text-xs text-white/32">Optional</span>
          <ChevronDown
            className={`h-4 w-4 transition-transform ${backupOpen ? "rotate-180" : ""}`}
          />
        </button>
        {backupOpen ? (
          <div className="mx-2 mb-2 space-y-3 rounded-lg bg-black/15 px-3.5 pb-4 pt-3">
            <p className="text-xs leading-5 text-white/48">
              Choose a unique passphrase and keep it separately from the saved
              file.
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
            {passphrase && !isValidOwnerBackupPassphrase(passphrase) ? (
              <p className="text-xs text-destructive" role="alert">
                Passphrase is {passphraseBytes} UTF-8 bytes; use 12–1024.
              </p>
            ) : null}
            {confirmation && passphrase !== confirmation ? (
              <p className="text-xs text-destructive" role="alert">
                Passphrases do not match.
              </p>
            ) : null}
            <Button
              className="h-9"
              disabled={!canExport}
              onClick={() => void exportBackup()}
              type="button"
              variant="outline"
            >
              {isExporting ? <LoaderCircle className="animate-spin" /> : null}
              Save encrypted backup…
            </Button>
            {backupStatus ? (
              <p
                className="flex items-center gap-2 text-xs text-white/62"
                role="status"
              >
                <Check className="h-3.5 w-3.5" /> {backupStatus}
              </p>
            ) : null}
            {backupError ? (
              <PolyphonicNotice kind="error">{backupError}</PolyphonicNotice>
            ) : null}
          </div>
        ) : null}
      </div>
      {syncNotice ? <PolyphonicNotice>{syncNotice}</PolyphonicNotice> : null}
    </>
  );
});
