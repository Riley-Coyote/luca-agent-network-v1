import * as React from "react";
import { useUpdateProfileMutation } from "@/features/profile/hooks";
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

/**
 * The first question, and the only one on this screen. Appearance is not asked
 * for here any more — it is a preference the owner can find later, and the
 * first thing Polyphonic says should be one thing, not two.
 * PolyphonicPresentationAppearanceControl still exists for the places that do
 * offer it.
 */
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
      savePendingPolyphonicProfile({ version: 1, pubkey, displayName: name });
      setSyncNotice(
        "Your name is saved on this Mac. Luca will sync it when the connection is available.",
      );
      return { displayName: name, needsAttention: true };
    } finally {
      onBusyChange(false);
    }
  }, [displayName, onBusyChange, pubkey, updateProfile]);

  React.useImperativeHandle(ref, () => ({ commit }), [commit]);

  return (
    <div
      className="h-full overflow-y-auto overscroll-contain"
      data-prototype-scroll-owner="true"
    >
      <PolyphonicStepHeading
        description="Luca lives here and helps you set up the rest as you go. This is the one thing it needs first."
        stage="welcome"
        title="What should Luca call you?"
      />
      <div className="mt-7 grid gap-5">
        <label className="grid gap-2" htmlFor="polyphonic-owner-name">
          <span className="text-xs font-medium text-[var(--prototype-muted-strong)]">
            Your name
          </span>
          <input
            autoComplete="name"
            className="min-h-10 max-w-[24rem] rounded-[9px] border border-[var(--prototype-hairline)] bg-[var(--prototype-field)] px-3 py-2 text-sm text-[var(--prototype-ink)] shadow-[inset_0_1px_1px_var(--prototype-shadow)] outline-none transition-colors duration-150 placeholder:text-[var(--prototype-muted)] focus-visible:border-[color-mix(in_srgb,var(--prototype-ink)_40%,transparent)] focus-visible:outline-none"
            data-testid="polyphonic-owner-name"
            id="polyphonic-owner-name"
            maxLength={80}
            onChange={(event) => onDisplayNameChange(event.target.value)}
            placeholder="Your name"
            value={displayName}
          />
        </label>
      </div>
      <p className="mt-3.5 text-[length:var(--prototype-support-size)] leading-[1.125rem] text-[var(--prototype-muted)]">
        Saved on this Mac. Nothing leaves it.
      </p>
      {syncNotice ? <PolyphonicNotice>{syncNotice}</PolyphonicNotice> : null}
    </div>
  );
});
