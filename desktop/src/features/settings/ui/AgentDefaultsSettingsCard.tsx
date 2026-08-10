import { AgentDefaultsEditor } from "@/features/agents/ui/AgentDefaultsEditor";
import { SectionHeader } from "@/shared/ui/PageHeader";
import { OperatorForgeSettingsCard } from "./OperatorForgeSettingsCard";

export function AgentDefaultsSettingsCard() {
  return (
    <div className="space-y-8">
      <OperatorForgeSettingsCard />
      <section
        className="min-w-0 space-y-4"
        data-testid="settings-global-agent-config"
      >
        <SectionHeader
          title="Advanced managed defaults"
          description="Model, effort, environment, and compatibility settings for managed ACP runtimes. Explicit agent settings always take priority."
        />
        <AgentDefaultsEditor />
      </section>
    </div>
  );
}
