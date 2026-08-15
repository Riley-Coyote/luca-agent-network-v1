import * as React from "react";
import { Monitor, Moon, Sun } from "lucide-react";

import { useUpdateProfileMutation } from "@/features/profile/hooks";
import { cn } from "@/shared/lib/cn";
import { useTheme } from "@/shared/theme/ThemeProvider";
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

type Appearance = "system" | "light" | "dark";

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
    <>
      <PolyphonicStepHeading
        description="Luca gives you one calm place to talk with the AI agents already on your Mac—and helps you set up the rest as you go."
        stage="welcome"
        title="Bring your agents together."
      />
      <div className="mt-8 space-y-6">
        <label
          className="block text-sm text-foreground/70"
          htmlFor="polyphonic-owner-name"
        >
          What should Luca call you?
          <Input
            autoComplete="name"
            autoFocus
            className="mt-2 h-11"
            data-testid="polyphonic-owner-name"
            id="polyphonic-owner-name"
            maxLength={80}
            onChange={(event) => onDisplayNameChange(event.target.value)}
            placeholder="Your name"
            value={displayName}
          />
        </label>
        <fieldset>
          <legend className="mb-2 text-sm text-foreground/70">
            Appearance
          </legend>
          <div className="inline-flex rounded-lg bg-foreground/[0.055] p-1">
            {(
              [
                ["system", Monitor, "System"],
                ["light", Sun, "Light"],
                ["dark", Moon, "Dark"],
              ] as const
            ).map(([value, Icon, label]) => (
              <button
                aria-pressed={appearance === value}
                className={cn(
                  "flex h-9 items-center gap-2 rounded-md px-3 text-sm text-foreground/55 transition-colors",
                  appearance === value &&
                    "bg-background text-foreground shadow-sm ring-1 ring-foreground/10",
                )}
                key={value}
                onClick={() => chooseAppearance(value)}
                type="button"
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>
        </fieldset>
      </div>
      {syncNotice ? <PolyphonicNotice>{syncNotice}</PolyphonicNotice> : null}
    </>
  );
});
