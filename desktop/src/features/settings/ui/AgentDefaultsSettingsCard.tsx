import { AgentDefaultsEditor } from "@/features/agents/ui/AgentDefaultsEditor";
import { SectionHeader } from "@/shared/ui/PageHeader";

export function AgentDefaultsSettingsCard() {
  return (
    <section
      className="min-w-0 space-y-4"
      data-testid="settings-global-agent-config"
    >
      <SectionHeader
        title="Resident defaults"
        description="Provider, model, effort, and environment settings inherited by Luca-created residents. Resident-specific settings always take priority."
      />
      <AgentDefaultsEditor />
    </section>
  );
}
