import type * as React from "react";
import { MessageCircle, UserRound } from "lucide-react";

import type { AgentVisualState } from "@/shared/ui/AgentIdentitySpecimen";
import { cn } from "@/shared/lib/cn";

export type ConversationDrawerAgent = {
  name: string;
  pubkey: string;
  state?: AgentVisualState;
};

type ConversationDrawerNavigationProps = {
  activePubkey?: string | null;
  agents: ConversationDrawerAgent[];
  onOpenAgent?: (pubkey: string) => void;
  onOpenConversation: () => void;
};

export function ConversationDrawerNavigation({
  activePubkey = null,
  agents,
  onOpenAgent,
  onOpenConversation,
}: ConversationDrawerNavigationProps) {
  return (
    <nav
      aria-label="Drawer context"
      className="border-b border-border/60 px-3 py-2.5"
      data-testid="conversation-drawer-navigation"
    >
      <div
        className="flex min-w-0 gap-1 overflow-x-auto rounded-lg border border-border/65 bg-muted/20 p-1 scrollbar-none [&::-webkit-scrollbar]:hidden"
        role="tablist"
      >
        <DrawerContextTab
          active={!activePubkey}
          icon={<MessageCircle className="h-3.5 w-3.5" />}
          label="Conversation"
          onClick={onOpenConversation}
          testId="drawer-context-conversation"
        />
        {agents.map((agent) => {
          const active = activePubkey === agent.pubkey;
          return (
            <DrawerContextTab
              active={active}
              icon={<UserRound className="h-3.5 w-3.5" />}
              key={agent.pubkey}
              label={agent.name}
              onClick={
                onOpenAgent ? () => onOpenAgent(agent.pubkey) : undefined
              }
              testId={`drawer-context-agent-${agent.pubkey.toLowerCase()}`}
            />
          );
        })}
      </div>
    </nav>
  );
}

function DrawerContextTab({
  active,
  icon,
  label,
  onClick,
  testId,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  testId: string;
}) {
  return (
    <button
      aria-selected={active}
      className={cn(
        "flex h-8 shrink-0 items-center gap-2 rounded-md px-2.5 text-xs font-medium transition-colors duration-150 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
        active
          ? "bg-background text-foreground shadow-[inset_0_0_0_1px_hsl(var(--border)/0.7)]"
          : "text-muted-foreground hover:bg-background/55 hover:text-foreground",
      )}
      data-testid={testId}
      disabled={!active && !onClick}
      onClick={onClick}
      role="tab"
      type="button"
    >
      {icon}
      <span className="max-w-28 truncate">{label}</span>
    </button>
  );
}
