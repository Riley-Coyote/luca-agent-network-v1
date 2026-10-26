import {
  isPolyphonicOnboardingComplete,
  POLYPHONIC_REOPEN_ONBOARDING_EVENT,
} from "@/features/onboarding/hooks";
import { Button } from "@/shared/ui/button";
import { useSettingsAppName } from "./SettingsSectionHeader";

export function FinishPolyphonicSetupRow({ pubkey }: { pubkey?: string }) {
  const appName = useSettingsAppName();
  if (!pubkey || isPolyphonicOnboardingComplete(pubkey)) return null;
  return (
    <div
      className="mb-3 flex items-center justify-between gap-4 rounded-xl border border-border/70 bg-background/70 px-4 py-3"
      data-settings-box=""
    >
      <div>
        <p className="text-sm font-medium">{`Finish setting up ${appName}`}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Review your agents and Brain connections when you are ready.
        </p>
      </div>
      <Button
        className="shrink-0"
        onClick={() =>
          window.dispatchEvent(new Event(POLYPHONIC_REOPEN_ONBOARDING_EVENT))
        }
        size="sm"
        type="button"
        variant="outline"
      >
        Finish setup
      </Button>
    </div>
  );
}
