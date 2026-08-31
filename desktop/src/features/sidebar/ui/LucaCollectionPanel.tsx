import { Bot, FolderKanban, MessageCirclePlus, Settings2 } from "lucide-react";

import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { useCreateChatMutation } from "@/features/channels/hooks";
import { useLucaProjectsQuery } from "@/features/luca-projects/hooks";
import { resolveChannelDisplayLabel } from "@/features/sidebar/lib/channelLabels";
import type { LucaCollectionSelection } from "@/features/sidebar/ui/LucaSidebarCollections";
import type { Channel } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { AgentIdentitySpecimen } from "@/shared/ui/AgentIdentitySpecimen";
import { Button } from "@/shared/ui/button";

type LucaCollectionPanelProps = {
  channels: Channel[];
  currentPubkey?: string;
  selection: Exclude<LucaCollectionSelection, null>;
  selectedChannelId: string | null;
  onManageAgent: () => void;
  onManageProject: () => void;
  onNewProjectChat: (projectId: string) => void;
  onOpenChat: (chatId: string) => void;
  onChatCreated: (chatId: string) => void;
};

function activityTime(channel: Channel) {
  return channel.lastMessageAt ? Date.parse(channel.lastMessageAt) : 0;
}

function chatLabel(channel: Channel, currentPubkey?: string) {
  return (
    resolveChannelDisplayLabel(channel, currentPubkey, undefined) ||
    "Untitled chat"
  );
}

export function LucaCollectionPanel({
  channels,
  currentPubkey,
  selection,
  selectedChannelId,
  onManageAgent,
  onManageProject,
  onNewProjectChat,
  onOpenChat,
  onChatCreated,
}: LucaCollectionPanelProps) {
  const agentsQuery = useManagedAgentsQuery();
  const projectsQuery = useLucaProjectsQuery();
  const createChat = useCreateChatMutation();
  const agent =
    selection.type === "agent"
      ? agentsQuery.data?.find(
          (candidate) =>
            candidate.pubkey.toLowerCase() === selection.id.toLowerCase(),
        )
      : undefined;
  const project =
    selection.type === "project"
      ? projectsQuery.data?.find((candidate) => candidate.id === selection.id)
      : undefined;
  const collectionChats = channels
    .filter((channel) => {
      if (channel.archivedAt) return false;
      if (selection.type === "project") {
        return channel.projectId === selection.id;
      }
      return channel.memberPubkeys.some(
        (pubkey) => pubkey.toLowerCase() === selection.id.toLowerCase(),
      );
    })
    .sort((a, b) => activityTime(b) - activityTime(a));

  const title = agent?.name ?? project?.name ?? "Not found";
  const subtitle =
    selection.type === "agent"
      ? agent?.status === "running"
        ? "Available"
        : "Offline"
      : project?.workingFolderState === "missing"
        ? "Reconnect folder"
        : project?.workingFolderState === "connected"
          ? "Folder connected"
          : "No folder connected";

  const handleNewChat = async () => {
    if (selection.type === "project") {
      onNewProjectChat(selection.id);
      return;
    }
    const result = await createChat.mutateAsync({
      participantPubkeys: [selection.id],
    });
    onChatCreated(result.chat.id);
  };

  return (
    <aside
      className="flex w-72 shrink-0 flex-col border-r border-border/55 bg-sidebar/72 max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:w-full max-md:bg-sidebar max-md:pt-8"
      data-testid="luca-collection-panel"
    >
      <header className="flex min-h-20 items-center gap-3 border-b border-border/55 px-4 py-3">
        {agent ? (
          <AgentIdentitySpecimen
            accessibleName={agent.name}
            publicKey={agent.pubkey}
            size={32}
            state={agent.status === "running" ? "present" : "unavailable"}
          />
        ) : project ? (
          <span className="flex size-8 items-center justify-center rounded-md bg-sidebar-accent">
            <FolderKanban className="size-4" />
          </span>
        ) : (
          <Bot className="size-5" />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          <p
            className={cn(
              "truncate text-xs text-muted-foreground",
              project?.workingFolderState === "missing" && "text-amber-500",
            )}
          >
            {subtitle}
          </p>
        </div>
        <Button
          aria-label={`Manage ${title}`}
          onClick={selection.type === "agent" ? onManageAgent : onManageProject}
          size="icon"
          title={`Manage ${title}`}
          variant="ghost"
        >
          <Settings2 className="size-4" />
        </Button>
      </header>
      <div className="p-3">
        <Button
          className="w-full justify-start"
          disabled={createChat.isPending}
          onClick={() => void handleNewChat()}
          size="sm"
          variant="secondary"
        >
          <MessageCirclePlus className="size-4" />
          {createChat.isPending ? "Creating…" : "New chat"}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <p className="mb-1 px-2 text-xs font-medium text-muted-foreground">
          Chats
        </p>
        {collectionChats.map((channel) => (
          <button
            className={cn(
              "flex min-h-10 w-full items-center rounded-md px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent",
              selectedChannelId === channel.id &&
                "bg-sidebar-accent text-sidebar-accent-foreground",
            )}
            data-testid={`collection-chat-${channel.id}`}
            key={channel.id}
            onClick={() => onOpenChat(channel.id)}
            type="button"
          >
            <span className="min-w-0 flex-1 truncate">
              {chatLabel(channel, currentPubkey)}
            </span>
            {selection.type === "agent" && channel.projectId ? (
              <span className="ml-2 max-w-20 truncate rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">
                {projectsQuery.data?.find(
                  (candidate) => candidate.id === channel.projectId,
                )?.name ?? "Project"}
              </span>
            ) : null}
          </button>
        ))}
        {collectionChats.length === 0 ? (
          <p className="px-2 py-5 text-sm text-muted-foreground">
            No chats here yet.
          </p>
        ) : null}
      </div>
    </aside>
  );
}
