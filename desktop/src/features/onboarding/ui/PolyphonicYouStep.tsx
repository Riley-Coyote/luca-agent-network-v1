import * as React from "react";
import { useUpdateProfileMutation } from "@/features/profile/hooks";
import {
  clearPendingPolyphonicProfile,
  savePendingPolyphonicProfile,
} from "../polyphonicProfileSync";
import { PolyphonicStepHeading } from "./PolyphonicSetupFrame";

export type PolyphonicYouStepHandle = {
  /**
   * The answer, at once. Writing a name is not something the owner should
   * wait on a round trip for: this validates, hands the name back in the same
   * tick so the next page can be on screen in the next frame, and saves in
   * the background — falling back to this Mac, which is what the hint under
   * the field already promises, if the write cannot be made.
   */
  commit: () => { displayName: string } | null;
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
    onDisplayNameChange: (value: string) => void;
    pubkey: string;
  }
>(function PolyphonicYouStep(
  { displayName, onDisplayNameChange, pubkey },
  ref,
) {
  const updateProfile = useUpdateProfileMutation();

  const commit = React.useCallback(() => {
    const name = displayName.trim();
    if (!name) throw new Error("Enter the name you want Luca to use.");
    // Written to this Mac first, always: the name survives a failed write, a
    // quit, or a relaunch, and `useAppOnboardingState` retries it once on the
    // next launch. The relay write then happens behind the next page.
    savePendingPolyphonicProfile({ version: 1, pubkey, displayName: name });
    void updateProfile
      .mutateAsync({ displayName: name })
      .then(() => clearPendingPolyphonicProfile(pubkey))
      .catch(() => {
        // The local draft stands. Nothing is lost and there is nothing here
        // for the owner to do about it.
      });
    return { displayName: name };
  }, [displayName, pubkey, updateProfile]);

  React.useImperativeHandle(ref, () => ({ commit }), [commit]);

  return (
    <div
      className="min-h-0 overflow-y-auto overscroll-contain"
      data-prototype-scroll-owner="true"
    >
      <PolyphonicStepHeading
        description="Luca lives here and helps you set up the rest as you go. This is the one thing it needs first."
        stage="welcome"
        title="What should Luca call you?"
      />
      <div className="mt-7">
        {/* The heading already asked the question; a "Your name" label above
            the field would only ask it again in smaller type. */}
        <label className="grid" htmlFor="polyphonic-owner-name">
          <span className="sr-only">Your name</span>
          {/* Focus is this border coming up where it already is. No ring
              beside the field, no glow behind it. */}
          <input
            autoComplete="name"
            className="h-11 w-full rounded-[10px] border border-[var(--prototype-hairline)] bg-[var(--prototype-field)] px-3.5 text-sm text-[var(--prototype-ink)] shadow-[inset_0_1px_1px_var(--prototype-shadow)] outline-none transition-colors duration-150 placeholder:text-[var(--prototype-muted)] focus-visible:border-[color-mix(in_srgb,var(--prototype-ink)_50%,transparent)] focus-visible:outline-none"
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
    </div>
  );
});
