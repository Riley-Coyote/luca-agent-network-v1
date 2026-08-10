import { usePreventSleepContext } from "@/features/agents/usePreventSleep";
import { Switch } from "@/shared/ui/switch";
import { SettingsOptionGroup, SettingsOptionRow } from "./SettingsOptionGroup";
import {
  setPersistentAgentAudienceEnabled,
  usePersistentAgentAudience,
} from "@/features/messages/lib/persistentAgentAudience";
import { SettingsSectionHeader } from "./SettingsSectionHeader";

export function PreventSleepSettingsCard() {
  const { enabled, setEnabled, hasRunningAgents, expired, clearExpired } =
    usePreventSleepContext();
  const persistentAudience = usePersistentAgentAudience(null);

  return (
    <section className="min-w-0" data-testid="settings-agents">
      <SettingsSectionHeader
        title="Residents"
        description="Control how your residents participate in conversations and run on this Mac."
      />

      <SettingsOptionGroup>
        <SettingsOptionRow>
          <div className="min-w-0">
            <label
              className="text-sm font-medium"
              htmlFor="persistent-agent-audience-switch"
            >
              Keep addressed residents active
            </label>
            <p className="text-sm font-normal text-muted-foreground">
              Keep residents you address selected for future messages in the
              same room or thread. Remove them from the composer at any time.
            </p>
          </div>
          <Switch
            checked={persistentAudience.enabled}
            data-testid="persistent-agent-audience-toggle"
            id="persistent-agent-audience-switch"
            onCheckedChange={setPersistentAgentAudienceEnabled}
          />
        </SettingsOptionRow>

        <SettingsOptionRow>
          <div className="min-w-0">
            <label
              className="text-sm font-medium"
              htmlFor="prevent-sleep-switch"
            >
              Keep awake while residents are active
            </label>
            <p className="text-sm font-normal text-muted-foreground">
              Prevents your Mac from sleeping while local residents are running.
              Automatically releases when all residents stop or after 1 hour
              without resident activity.
            </p>
          </div>
          <Switch
            checked={enabled}
            data-testid="prevent-sleep-toggle"
            id="prevent-sleep-switch"
            onCheckedChange={(checked) => {
              if (expired) {
                clearExpired();
              }
              setEnabled(checked);
            }}
          />
        </SettingsOptionRow>
      </SettingsOptionGroup>

      {enabled && !hasRunningAgents && (
        <p className="mt-3 text-sm text-muted-foreground">
          Waiting for residents to start
        </p>
      )}

      {expired && (
        <p className="mt-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-700 dark:text-yellow-400">
          Sleep prevention expired after 1 hour without resident activity. It
          will resume on the next resident activity, or toggle off and on to
          re-enable now.
        </p>
      )}
    </section>
  );
}
