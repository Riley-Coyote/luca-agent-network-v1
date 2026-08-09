import {
  Activity,
  ArrowUpRight,
  FolderGit2,
  MessageCircle,
  Paperclip,
  Settings2,
  Users,
} from "lucide-react";
import * as React from "react";

import { useChannelMembersQuery } from "@/features/channels/hooks";
import type { ChannelAgentSessionAgent } from "@/features/channels/ui/useChannelAgentSessions";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import type { TimelineMessage } from "@/features/messages/types";
import type { Channel, ChannelMember } from "@/shared/api/types";
import {
  AuxiliaryPanel,
  AuxiliaryPanelBody,
  AuxiliaryPanelHeader,
  AuxiliaryPanelHeaderActions,
  AuxiliaryPanelHeaderGroup,
  AuxiliaryPanelHeaderTitleBlock,
} from "@/shared/layout/AuxiliaryPanel";
import { normalizePubkey, truncatePubkey } from "@/shared/lib/pubkey";
import { AgentIdentitySpecimen } from "@/shared/ui/AgentIdentitySpecimen";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";
import { channelChrome } from "@/shared/layout/chromeLayout";
import {
  type ConversationDrawerAgent,
  ConversationDrawerNavigation,
} from "@/shared/ui/ConversationDrawerNavigation";

type ConversationContextPanelProps = {
  agents: ChannelAgentSessionAgent[];
  canResetWidth?: boolean;
  channel: Channel;
  currentPubkey?: string;
  isSinglePanelView?: boolean;
  layout?: "standalone" | "split";
  messages: TimelineMessage[];
  onClose: () => void;
  onManageParticipants: () => void;
  onOpenResident: (pubkey: string) => void;
  onResetWidth?: () => void;
  onResizeStart?: React.PointerEventHandler<HTMLButtonElement>;
  profiles?: UserProfileLookup;
  transparentChrome?: boolean;
  widthPx: number;
};

function isAgentMember(member: ChannelMember) {
  return member.isAgent || member.role === "bot";
}

function countAttachments(messages: TimelineMessage[]) {
  return messages.reduce(
    (count, message) =>
      count + (message.tags?.filter((tag) => tag[0] === "imeta").length ?? 0),
    0,
  );
}

function residentState(agent: ChannelAgentSessionAgent | undefined) {
  if (!agent) return "idle" as const;
  if (agent.status === "running" || agent.status === "deployed") {
    return "present" as const;
  }
  return "unavailable" as const;
}

export function ConversationContextPanel({
  agents,
  canResetWidth,
  channel,
  currentPubkey,
  isSinglePanelView = false,
  layout = "standalone",
  messages,
  onClose,
  onManageParticipants,
  onOpenResident,
  onResetWidth,
  onResizeStart,
  profiles,
  transparentChrome = false,
  widthPx,
}: ConversationContextPanelProps) {
  const membersQuery = useChannelMembersQuery(channel.id);
  const members = membersQuery.data ?? [];
  const agentByPubkey = React.useMemo(
    () =>
      new Map(
        agents.map((agent) => [normalizePubkey(agent.pubkey), agent] as const),
      ),
    [agents],
  );
  const agentMembers = members.filter(isAgentMember);
  const people = members.filter((member) => !isAgentMember(member));
  const agentCount = agentMembers.length || agents.length;
  const attachmentCount = countAttachments(messages);
  const channelSummary =
    channel.purpose?.trim() ||
    channel.topic?.trim() ||
    channel.description?.trim() ||
    (channel.channelType === "dm"
      ? "A private conversation."
      : "A shared conversation with people and resident agents.");
  const drawerAgents = React.useMemo<ConversationDrawerAgent[]>(() => {
    const candidates =
      agentMembers.length > 0
        ? agentMembers.map((member) => ({
            name: resolveUserLabel({
              currentPubkey,
              fallbackName: member.displayName,
              profiles,
              pubkey: member.pubkey,
            }),
            pubkey: member.pubkey,
            state: residentState(
              agentByPubkey.get(normalizePubkey(member.pubkey)),
            ),
          }))
        : agents.map((agent) => ({
            name: agent.name,
            pubkey: agent.pubkey,
            state: residentState(agent),
          }));

    return [
      ...new Map(
        candidates.map((agent) => [normalizePubkey(agent.pubkey), agent]),
      ).values(),
    ];
  }, [agentByPubkey, agentMembers, agents, currentPubkey, profiles]);

  return (
    <AuxiliaryPanel
      canResetWidth={canResetWidth}
      isSinglePanelView={isSinglePanelView}
      layout={layout}
      onClose={onClose}
      onResetWidth={onResetWidth}
      onResizeStart={onResizeStart}
      resizeHandleAriaLabel="Resize conversation panel"
      resizeHandleTestId="conversation-context-resize-handle"
      testId="conversation-context-panel"
      transparentChrome={transparentChrome}
      widthPx={widthPx}
      header={
        <AuxiliaryPanelHeader
          bordered
          density="compact"
          surface={isSinglePanelView ? "transparent" : "default"}
        >
          <AuxiliaryPanelHeaderGroup>
            <AuxiliaryPanelHeaderTitleBlock title="Conversation" />
          </AuxiliaryPanelHeaderGroup>
          <AuxiliaryPanelHeaderActions />
        </AuxiliaryPanelHeader>
      }
    >
      <div
        className={cn(
          layout === "split" && channelChrome.contentPadding,
          layout !== "split" && isSinglePanelView && "pt-13",
        )}
      >
        <ConversationDrawerNavigation
          agents={drawerAgents}
          onOpenAgent={onOpenResident}
          onOpenConversation={() => undefined}
        />
      </div>
      <AuxiliaryPanelBody className="overflow-y-auto px-4 pb-6">
        <div className="space-y-7 pt-5">
          <section className="space-y-2 border-b border-border/55 pb-5">
            <div className="flex items-center gap-2 text-2xs uppercase tracking-[0.14em] text-muted-foreground">
              <MessageCircle className="h-3.5 w-3.5" />
              {channel.channelType === "dm" ? "Direct message" : "Room"}
            </div>
            <h2 className="text-xl font-medium tracking-[-0.025em] text-foreground">
              {channel.name}
            </h2>
            <p className="max-w-[34rem] text-sm leading-6 text-muted-foreground">
              {channelSummary}
            </p>
          </section>

          <section aria-labelledby="conversation-at-a-glance">
            <SectionLabel id="conversation-at-a-glance">
              At a glance
            </SectionLabel>
            <div className="grid grid-cols-3 divide-x divide-border/55 border-y border-border/55">
              <Metric icon={Users} label="Present" value={members.length} />
              <Metric icon={Activity} label="Agents" value={agentCount} />
              <Metric icon={Paperclip} label="Files" value={attachmentCount} />
            </div>
          </section>

          <section aria-labelledby="conversation-agents">
            <div className="flex items-center justify-between gap-3">
              <SectionLabel id="conversation-agents">Agents</SectionLabel>
              <span className="font-mono text-2xs tracking-[0.12em] text-muted-foreground/70">
                {agentMembers.length || agents.length}
              </span>
            </div>
            <div className="divide-y divide-border/50 border-y border-border/50">
              {(agentMembers.length > 0
                ? agentMembers
                : agents.map<ChannelMember>((agent) => ({
                    displayName: agent.name,
                    isAgent: true,
                    joinedAt: "",
                    pubkey: agent.pubkey,
                    role: "bot",
                  }))
              ).map((member) => {
                const agent = agentByPubkey.get(normalizePubkey(member.pubkey));
                const label = resolveUserLabel({
                  currentPubkey,
                  fallbackName: member.displayName ?? agent?.name,
                  profiles,
                  pubkey: member.pubkey,
                });
                return (
                  <button
                    className="group flex w-full items-center gap-3 px-1 py-3 text-left transition-colors duration-150 hover:bg-muted/25 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                    data-testid={`conversation-resident-${normalizePubkey(member.pubkey)}`}
                    key={normalizePubkey(member.pubkey)}
                    onClick={() => onOpenResident(member.pubkey)}
                    type="button"
                  >
                    <AgentIdentitySpecimen
                      accessibleName={label}
                      publicKey={member.pubkey}
                      size={32}
                      state={residentState(agent)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {label}
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-2xs uppercase tracking-[0.1em] text-muted-foreground">
                        {agent?.agentSource === "managed"
                          ? "Resident · Notebook available"
                          : `Agent · ${truncatePubkey(member.pubkey)}`}
                      </span>
                    </span>
                    <ArrowUpRight className="h-4 w-4 text-muted-foreground/45 transition-colors group-hover:text-foreground" />
                  </button>
                );
              })}
              {!membersQuery.isLoading &&
              agentMembers.length === 0 &&
              agents.length === 0 ? (
                <p className="px-1 py-4 text-sm text-muted-foreground">
                  No resident agents are currently attached to this
                  conversation.
                </p>
              ) : null}
            </div>
          </section>

          {people.length > 0 ? (
            <section aria-labelledby="conversation-people">
              <SectionLabel id="conversation-people">People</SectionLabel>
              <div className="divide-y divide-border/45 border-y border-border/45">
                {people.map((member) => (
                  <div
                    className="flex items-center gap-3 px-1 py-2.5"
                    key={normalizePubkey(member.pubkey)}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/20 text-xs text-muted-foreground">
                      {(member.displayName ?? truncatePubkey(member.pubkey))
                        .slice(0, 1)
                        .toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground/90">
                      {resolveUserLabel({
                        currentPubkey,
                        fallbackName: member.displayName,
                        profiles,
                        pubkey: member.pubkey,
                      })}
                    </span>
                    <span className="font-mono text-2xs uppercase tracking-[0.1em] text-muted-foreground/60">
                      {member.role}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section aria-labelledby="conversation-working-context">
            <SectionLabel id="conversation-working-context">
              Working context
            </SectionLabel>
            <div className="border-y border-border/50 py-3">
              <div className="flex items-start gap-3">
                <FolderGit2 className="mt-0.5 h-4 w-4 text-muted-foreground/55" />
                <div>
                  <p className="text-sm text-foreground/90">
                    No shared workspace attached
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    A project, folder, or repository will appear here only when
                    the runtime exposes one.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <Button
            className="w-full justify-start gap-2"
            data-testid="conversation-manage-participants"
            onClick={onManageParticipants}
            variant="ghost"
          >
            <Settings2 className="h-4 w-4" />
            Manage participants
          </Button>
        </div>
      </AuxiliaryPanelBody>
    </AuxiliaryPanel>
  );
}

function SectionLabel({
  children,
  id,
}: {
  children: React.ReactNode;
  id: string;
}) {
  return (
    <h3
      className="mb-2.5 font-mono text-2xs uppercase tracking-[0.14em] text-muted-foreground"
      id={id}
    >
      {children}
    </h3>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-2.5 py-3 first:pl-0 last:pr-0">
      <div className="flex items-center gap-1.5 text-muted-foreground/65">
        <Icon className="h-3.5 w-3.5" />
        <span className="truncate font-mono text-3xs uppercase tracking-[0.12em]">
          {label}
        </span>
      </div>
      <span className={cn("text-lg font-medium tabular-nums text-foreground")}>
        {value}
      </span>
    </div>
  );
}
