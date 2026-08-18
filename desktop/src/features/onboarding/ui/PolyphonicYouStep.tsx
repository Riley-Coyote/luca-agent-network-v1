import * as React from "react";
import { useUpdateProfileMutation } from "@/features/profile/hooks";
import { useTheme } from "@/shared/theme/ThemeProvider";
import {
  clearPendingPolyphonicProfile,
  savePendingPolyphonicProfile,
} from "../polyphonicProfileSync";
import {
  PolyphonicNotice,
  PolyphonicStepHeading,
} from "./PolyphonicSetupFrame";
import { PolyphonicPresentationAppearanceControl } from "./PolyphonicOnboardingPresentation";

export type PolyphonicYouStepHandle = {
  commit: () => Promise<{ displayName: string; needsAttention: boolean }>;
};

type Appearance = "system" | "light" | "dark";

export const PolyphonicYouStep = React.forwardRef<
  PolyphonicYouStepHandle,
  {
    /** Show surface swatches on the appearance control (see the control). */
    appearanceSwatches?: boolean;
    displayName: string;
    onBusyChange: (busy: boolean) => void;
    onDisplayNameChange: (value: string) => void;
    pubkey: string;
  }
>(function PolyphonicYouStep(
  {
    appearanceSwatches = false,
    displayName,
    onBusyChange,
    onDisplayNameChange,
    pubkey,
  },
  ref,
) {
  const updateProfile = useUpdateProfileMutation();
  const theme = useTheme();
  const [syncNotice, setSyncNotice] = React.useState<string | null>(null);
  const appearance: Appearance = theme.followSystem
    ? "system"
    : theme.themeName === "buzz-dark"
      ? "dark"
      : "light";

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

  function chooseAppearance(next: Appearance) {
    if (next === "system") {
      theme.setTheme("buzz");
      theme.setFollowSystem(true);
      return;
    }
    theme.setFollowSystem(false);
    theme.setTheme(next === "dark" ? "buzz-dark" : "buzz");
  }

  return (
    <div
      className="h-full overflow-y-auto overscroll-contain"
      data-prototype-scroll-owner="true"
    >
      <PolyphonicStepHeading
        description="Polyphonic is one calm place to talk with the AI agents already on your Mac. Luca lives here, and helps you set up the rest as you go."
        stage="welcome"
        title="Bring your agents together."
      />
      <div className="mt-7 grid gap-5">
        <label className="grid gap-2" htmlFor="polyphonic-owner-name">
          <span className="text-xs font-medium text-[var(--prototype-muted-strong)]">
            What should Luca call you?
          </span>
          <input
            autoComplete="name"
            className="min-h-10 rounded-[9px] border border-[var(--prototype-hairline)] bg-[var(--prototype-field)] px-3 py-2 text-sm text-[var(--prototype-ink)] shadow-[inset_0_1px_1px_var(--prototype-shadow)] outline-none placeholder:text-[var(--prototype-muted)] focus-visible:border-[color-mix(in_srgb,var(--prototype-ink)_35%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--prototype-focus)]"
            data-testid="polyphonic-owner-name"
            id="polyphonic-owner-name"
            maxLength={80}
            onChange={(event) => onDisplayNameChange(event.target.value)}
            placeholder="Your name"
            value={displayName}
          />
        </label>
        <PolyphonicPresentationAppearanceControl
          appearance={appearance}
          onChange={chooseAppearance}
          swatches={appearanceSwatches}
        />
      </div>
      {syncNotice ? <PolyphonicNotice>{syncNotice}</PolyphonicNotice> : null}
    </div>
  );
});
