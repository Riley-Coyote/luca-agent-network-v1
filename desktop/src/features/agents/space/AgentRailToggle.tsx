import { useCurrentAgentRailVisibility } from "@/features/sidebar/lib/useAgentRailVisibility";
import type { RailResident } from "@/features/sidebar/lib/agentRailVisibility";
import { Switch } from "@/shared/ui/switch";
import { MindRow } from "./MindPageKit";

/** Visibility is independent of running state and leaves every conversation intact. */
export function AgentRailToggle({ agent }: { agent: RailResident }) {
  const rail = useCurrentAgentRailVisibility();
  const primary = agent.pubkey.toLowerCase() === rail.primary;
  return (
    <MindRow
      label="Show in Chats"
      help={
        primary
          ? "Your companion always stays in Chats."
          : "Keep this agent in the chat rail. Their work and conversations stay here either way."
      }
      control={
        <Switch
          aria-label="Show in Chats"
          checked={rail.isVisible(agent)}
          disabled={!rail.key || primary}
          onCheckedChange={(visible) => rail.setVisible(agent.pubkey, visible)}
          data-testid="agent-show-in-chats"
        />
      }
    />
  );
}
