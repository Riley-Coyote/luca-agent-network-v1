import { EllipsisVertical, Settings2, Users } from "lucide-react";
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useHuddle } from "@/features/huddle";
import { HuddleIndicator } from "@/features/huddle/components/HuddleIndicator";
import { buildHuddleChannelName } from "@/features/huddle/lib/huddleChannelName";
import {
  useAvailableAcpRuntimes,
  useManagedAgentsQuery,
  useRelayAgentsQuery,
} from "@/features/agents/hooks";
import { requestOpenCreateAgent } from "@/features/agents/openCreateAgentEvent";
import { useChannelMembersQuery } from "@/features/channels/hooks";
import { usePrepareDmSendChannel } from "@/features/channels/ui/usePrepareDmSendChannel";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { canStartHuddleInChannel } from "@/features/channels/lib/huddleAvailability";
import type { Channel } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { AddChannelBotDialog } from "./AddChannelBotDialog";

type ChannelMembersBarProps = {
  channel: Channel;
  currentPubkey?: string;
  isAddBotOpen?: boolean;
  onAddBotOpenChange?: (open: boolean) => void;
  onManageChannel: () => void;
  onToggleMembers: () => void;
  variant?: "inline" | "compact";
};

export function ChannelMembersBar({
  channel,
  currentPubkey,
  isAddBotOpen: isAddBotOpenProp,
  onAddBotOpenChange,
  onManageChannel,
  onToggleMembers,
  variant = "inline",
}: ChannelMembersBarProps) {
  const [uncontrolledAddBotOpen, setUncontrolledAddBotOpen] =
    React.useState(false);
  const isAddBotOpen = isAddBotOpenProp ?? uncontrolledAddBotOpen;
  const setIsAddBotOpen = React.useCallback(
    (open: boolean) => {
      onAddBotOpenChange?.(open);
      if (isAddBotOpenProp === undefined) {
        setUncontrolledAddBotOpen(open);
      }
    },
    [isAddBotOpenProp, onAddBotOpenChange],
  );
  const { startHuddle, isStarting: isStartingHuddle } = useHuddle();
  const { goChannel } = useAppNavigation();
  const queryClient = useQueryClient();
  const membersQuery = useChannelMembersQuery(channel.id);
  const providersQuery = useAvailableAcpRuntimes();
  const managedAgentsQuery = useManagedAgentsQuery();
  const relayAgentsQuery = useRelayAgentsQuery();
  const prepareDmSendChannel = usePrepareDmSendChannel(channel, currentPubkey);
  const members = membersQuery.data ?? [];
  const memberCount = membersQuery.data?.length ?? channel.memberCount;
  const providers = React.useMemo(
    () =>
      [...(providersQuery.data ?? [])].sort((left, right) => {
        const leftPriority = left.id === "goose" ? 0 : 1;
        const rightPriority = right.id === "goose" ? 0 : 1;
        if (leftPriority !== rightPriority) {
          return leftPriority - rightPriority;
        }

        return left.label.localeCompare(right.label);
      }),
    [providersQuery.data],
  );
  const normalizedCurrentPubkey = currentPubkey
    ? normalizePubkey(currentPubkey)
    : null;
  const selfMember =
    members.find(
      (member) => normalizePubkey(member.pubkey) === normalizedCurrentPubkey,
    ) ?? null;
  const canStartHuddle = canStartHuddleInChannel({
    channel,
    currentPubkey,
    selfMember,
  });
  const previousChannelIdRef = React.useRef(channel.id);

  React.useEffect(() => {
    if (previousChannelIdRef.current === channel.id) {
      return;
    }

    previousChannelIdRef.current = channel.id;
    setIsAddBotOpen(false);
  }, [channel.id, setIsAddBotOpen]);

  const dialogErrorMessage =
    providersQuery.error instanceof Error
      ? providersQuery.error.message
      : managedAgentsQuery.error instanceof Error
        ? managedAgentsQuery.error.message
        : relayAgentsQuery.error instanceof Error
          ? relayAgentsQuery.error.message
          : null;

  const huddleIndicator = (
    <HuddleIndicator
      channelId={channel.id}
      onStart={async () => {
        try {
          await startHuddle(
            channel.id,
            [],
            buildHuddleChannelName({
              channel,
              currentPubkey,
              members,
            }),
          );
          // Refetch channels so the new ephemeral channel appears in the sidebar immediately
          // (default poll interval is 60s — too slow for huddle UX).
          void queryClient.invalidateQueries({ queryKey: ["channels"] });
        } catch (e) {
          console.error("Failed to start huddle:", e);
        }
      }}
      renderMode={variant === "compact" ? "menu-item" : "button"}
      startDisabled={!canStartHuddle || isStartingHuddle}
    />
  );

  const controls =
    variant === "compact" ? (
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="Conversation actions"
            data-testid="channel-actions-menu-trigger"
            size="icon"
            type="button"
            variant="outline"
          >
            <EllipsisVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48" forceMount>
          <DropdownMenuItem
            data-testid="channel-members-trigger"
            onSelect={onToggleMembers}
          >
            <Users />
            <span>People</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {memberCount}
            </span>
          </DropdownMenuItem>
          {huddleIndicator}
          <DropdownMenuItem
            data-testid="channel-management-trigger"
            onSelect={onManageChannel}
          >
            <Settings2 />
            <span>Conversation settings</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : (
      <div className="flex items-center gap-[6px]">
        <Tooltip disableHoverableContent>
          <TooltipTrigger asChild>
            <Button
              aria-label={`View people in this chat (${memberCount})`}
              className="h-8 px-2.5"
              data-testid="channel-members-trigger"
              onClick={onToggleMembers}
              type="button"
              variant="outline"
            >
              <Users />
              <span className="min-w-[1ch] text-sm font-medium tabular-nums">
                {memberCount}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>People in this chat</TooltipContent>
        </Tooltip>

        {huddleIndicator}

        <Tooltip disableHoverableContent>
          <TooltipTrigger asChild>
            <Button
              aria-label="Conversation settings"
              data-testid="channel-management-trigger"
              onClick={onManageChannel}
              size="icon"
              type="button"
              variant="outline"
            >
              <Settings2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Conversation settings</TooltipContent>
        </Tooltip>
      </div>
    );

  return (
    <React.Fragment>
      {controls}

      <AddChannelBotDialog
        channelId={channel.id}
        conversationMode={channel.channelType === "dm" ? "dm" : "channel"}
        onGroupDmReady={async (pubkeys) => {
          const groupDmId = await prepareDmSendChannel(pubkeys);
          if (groupDmId && groupDmId !== channel.id) {
            await goChannel(groupDmId);
          }
        }}
        onCreateAgent={() => {
          requestOpenCreateAgent(
            channel.channelType === "dm"
              ? {}
              : {
                  channelId: channel.id,
                  channelName: channel.name,
                },
          );
        }}
        onOpenChange={setIsAddBotOpen}
        open={isAddBotOpen}
        providers={providers}
        providersErrorMessage={dialogErrorMessage}
        providersLoading={providersQuery.isLoading}
      />
    </React.Fragment>
  );
}
