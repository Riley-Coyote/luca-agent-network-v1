import {
  ArrowUpRight,
  FolderGit2,
  MessageCircle,
  Settings2,
} from "lucide-react";
import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import {
  useManagedAgentsQuery,
  usePersonasQuery,
} from "@/features/agents/hooks";
import { useResidentHarnessLookup } from "@/features/agents/ResidentHarnessContext";
import { useChannelMembersQuery } from "@/features/channels/hooks";
import { ResidentDrawer } from "@/features/channels/ui/ResidentDrawer";
import { ResidentIdentityMark } from "@/features/channels/ui/ResidentIdentityMark";
import { useRoomExchangeHistory } from "@/features/exchange/exchangeStore";
import { ExchangeHistory } from "@/features/exchange/ui/ExchangeHistory";
import { openVisitors } from "@/features/messages/lib/visitSpans";
import { useManagedPresentationActivity } from "@/features/messages/managedPresentationHooks";
import type { ChannelAgentSessionAgent } from "@/features/channels/ui/useChannelAgentSessions";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import {
  resolveIdentityDisplayName,
  resolveUserLabel,
} from "@/features/profile/lib/identity";
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
import { normalizePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";
import {
  type ConversationDrawerAgent,
  ConversationDrawerNavigation,
} from "@/shared/ui/ConversationDrawerNavigation";
import { HARNESS_LABELS } from "@/shared/ui/HarnessLogo";

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

/** The drawer's non-resident tab: the conversation itself. */
const CONVERSATION_VIEW = "conversation";

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
  // A direct conversation with one managed resident is about the resident,
  // not the room: the drawer opens on their card. Rooms open on the
  // conversation — but the resident's card is the same card either way, one
  // tab along, so the drawer never says two different things about an agent.
  const managedAgentsQuery = useManagedAgentsQuery();
  const personasQuery = usePersonasQuery();
  const { goAgent } = useAppNavigation();
  const managedActivity = useManagedPresentationActivity(channel.id);
  const drawerResident = React.useMemo(() => {
    if (channel.channelType !== "dm") return null;
    const me = currentPubkey ? normalizePubkey(currentPubkey) : null;
    const others = channel.participantPubkeys
      .map((pubkey) => normalizePubkey(pubkey))
      .filter((pubkey) => pubkey !== me);
    if (others.length !== 1) return null;
    const resident = (managedAgentsQuery.data ?? []).find(
      (candidate) => normalizePubkey(candidate.pubkey) === others[0],
    );
    if (!resident) return null;
    const persona =
      (personasQuery.data ?? []).find(
        (candidate) => candidate.id === resident.personaId,
      ) ?? null;
    return { agent: resident, persona };
  }, [
    channel.channelType,
    channel.participantPubkeys,
    currentPubkey,
    managedAgentsQuery.data,
    personasQuery.data,
  ]);
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
  const harnessLookup = useResidentHarnessLookup();
  const exchangeHistory = useRoomExchangeHistory(channel.id);
  const visitors = React.useMemo(() => openVisitors(messages), [messages]);

  // Which tab the drawer is on. `null` is the default for this conversation —
  // a resident's card in a 1:1, the conversation everywhere else.
  const [drawerView, setDrawerView] = React.useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset per room.
  React.useEffect(() => {
    setDrawerView(null);
  }, [channel.id]);
  const residentFor = React.useCallback(
    (pubkey: string) => {
      const agent = (managedAgentsQuery.data ?? []).find(
        (candidate) =>
          normalizePubkey(candidate.pubkey) === normalizePubkey(pubkey),
      );
      if (!agent) return null;
      const persona =
        (personasQuery.data ?? []).find(
          (candidate) => candidate.id === agent.personaId,
        ) ?? null;
      return { agent, persona };
    },
    [managedAgentsQuery.data, personasQuery.data],
  );
  const activeResident =
    drawerView === CONVERSATION_VIEW
      ? null
      : drawerView
        ? residentFor(drawerView)
        : drawerResident;
  const activeResidentReplying =
    activeResident !== null &&
    [...managedActivity.values()].some(
      (activity) =>
        normalizePubkey(activity.residentPubkey) ===
          normalizePubkey(activeResident.agent.pubkey) &&
        !["stopped", "failed", "needs_attention"].includes(activity.phase),
    );
  const drawerAgents = React.useMemo<ConversationDrawerAgent[]>(() => {
    const candidates =
      agentMembers.length > 0
        ? agentMembers.map((member) => ({
            harness: harnessLookup.get(normalizePubkey(member.pubkey)) ?? null,
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
            harness: harnessLookup.get(normalizePubkey(agent.pubkey)) ?? null,
            name: agent.name,
            pubkey: agent.pubkey,
            state: residentState(agent),
          }));

    // The resident of a 1:1 is the drawer's default tab, so they must appear
    // in the strip even when the DM has no member rows to derive them from.
    if (drawerResident) {
      candidates.push({
        harness:
          harnessLookup.get(normalizePubkey(drawerResident.agent.pubkey)) ??
          null,
        name: drawerResident.agent.name,
        pubkey: drawerResident.agent.pubkey,
        state: residentState(
          agentByPubkey.get(normalizePubkey(drawerResident.agent.pubkey)),
        ),
      });
    }

    return [
      ...new Map(
        candidates.map((agent) => [normalizePubkey(agent.pubkey), agent]),
      ).values(),
    ];
  }, [
    agentByPubkey,
    agentMembers,
    agents,
    currentPubkey,
    drawerResident,
    harnessLookup,
    profiles,
  ]);

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
          density="compact"
          surface={isSinglePanelView ? "transparent" : "default"}
        >
          <AuxiliaryPanelHeaderGroup>
            <AuxiliaryPanelHeaderTitleBlock
              title={
                activeResident ? activeResident.agent.name : "Conversation"
              }
            />
          </AuxiliaryPanelHeaderGroup>
          <AuxiliaryPanelHeaderActions />
        </AuxiliaryPanelHeader>
      }
    >
      <>
        {/* One strip for both views: the tabs are how you move between the
            conversation and a resident's card, in place, wherever you are. */}
        <div className={cn(layout !== "split" && isSinglePanelView && "pt-13")}>
          <ConversationDrawerNavigation
            activePubkey={activeResident?.agent.pubkey ?? null}
            agents={drawerAgents}
            onOpenAgent={(pubkey) => setDrawerView(pubkey)}
            onOpenConversation={() => setDrawerView(CONVERSATION_VIEW)}
          />
        </div>
        {activeResident ? (
          <AuxiliaryPanelBody className="overflow-y-auto px-4 pb-6">
            <ResidentDrawer
              agent={activeResident.agent}
              onOpenAgent={(section) =>
                goAgent(activeResident.agent.pubkey, { section })
              }
              persona={activeResident.persona}
              replying={activeResidentReplying}
            />
          </AuxiliaryPanelBody>
        ) : (
          <AuxiliaryPanelBody className="overflow-y-auto px-4 pb-6">
            <div className="space-y-6 pt-3">
              {/* Name only. The room's description already sits under the
                  title in the conversation header — repeating it here costs a
                  paragraph of space at the top of every drawer. */}
              <section className="space-y-1">
                <div className="flex items-center gap-2 text-2xs font-medium uppercase tracking-caps text-ink-faint">
                  <MessageCircle className="h-3.5 w-3.5" />
                  {channel.channelType === "dm" ? "Direct message" : "Room"}
                </div>
                <h2 className="truncate text-lg font-medium leading-6 tracking-[-0.02em] text-foreground">
                  {channel.name}
                </h2>
              </section>

              <section aria-labelledby="conversation-at-a-glance">
                <SectionLabel id="conversation-at-a-glance">
                  At a glance
                </SectionLabel>
                <div className="grid grid-cols-4 overflow-hidden rounded-2xl bg-plate">
                  <Metric label="Present" value={members.length} />
                  <Metric label="Agents" value={agentCount} />
                  <Metric label="Files" value={attachmentCount} />
                  <Metric label="Exchanges" value={exchangeHistory.length} />
                </div>
              </section>

              <section aria-labelledby="conversation-agents">
                <div className="flex items-center justify-between gap-3">
                  <SectionLabel id="conversation-agents">Agents</SectionLabel>
                  <SectionCount>
                    {agentMembers.length || agents.length}
                  </SectionCount>
                </div>
                <div className="overflow-hidden rounded-2xl bg-plate">
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
                    const agent = agentByPubkey.get(
                      normalizePubkey(member.pubkey),
                    );
                    const label = resolveUserLabel({
                      currentPubkey,
                      fallbackName: member.displayName ?? agent?.name,
                      profiles,
                      pubkey: member.pubkey,
                    });
                    const harness = harnessLookup.get(
                      normalizePubkey(member.pubkey),
                    );
                    const state = residentState(agent);
                    return (
                      <button
                        className="group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-plate-hover focus-visible:outline-hidden focus-visible:bg-plate-hover"
                        data-testid={`conversation-resident-${normalizePubkey(member.pubkey)}`}
                        key={normalizePubkey(member.pubkey)}
                        onClick={() => onOpenResident(member.pubkey)}
                        type="button"
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center">
                          <ResidentIdentityMark
                            accessibleName={label}
                            className={cn(
                              state === "unavailable" && "opacity-50",
                            )}
                            decorative
                            publicKey={member.pubkey}
                            size={22}
                          />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">
                            {label}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            {agent?.agentSource === "managed"
                              ? `${harness && harness !== "other" ? HARNESS_LABELS[harness] : "Resident"} · ${visitors.has(normalizePubkey(member.pubkey)) ? "Visiting" : "Notebook available"}`
                              : "External agent"}
                          </span>
                        </span>
                        <ArrowUpRight className="h-4 w-4 text-ink-faint transition-colors group-hover:text-foreground" />
                      </button>
                    );
                  })}
                  {!membersQuery.isLoading &&
                  agentMembers.length === 0 &&
                  agents.length === 0 ? (
                    <p className="px-3 py-3 text-sm text-muted-foreground">
                      No resident agents are currently attached to this
                      conversation.
                    </p>
                  ) : null}
                </div>
              </section>

              {people.length > 0 ? (
                <section aria-labelledby="conversation-people">
                  <SectionLabel id="conversation-people">People</SectionLabel>
                  <div className="overflow-hidden rounded-2xl bg-plate">
                    {people.map((member) => (
                      <div
                        className="flex items-center gap-3 px-3 py-2.5"
                        key={normalizePubkey(member.pubkey)}
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-plate-hover text-xs text-muted-foreground">
                          {resolveIdentityDisplayName({
                            displayName: member.displayName,
                            isAgent: member.isAgent || member.role === "bot",
                            pubkey: member.pubkey,
                          })
                            .slice(0, 1)
                            .toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm text-ink">
                          {resolveUserLabel({
                            currentPubkey,
                            fallbackName: member.displayName,
                            profiles,
                            pubkey: member.pubkey,
                          })}
                        </span>
                        <span className="text-xs capitalize text-ink-faint">
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
                <div className="rounded-2xl bg-plate px-3 py-3">
                  <div className="flex items-start gap-3">
                    <FolderGit2 className="mt-0.5 h-4 w-4 text-ink-faint" />
                    <div>
                      <p className="text-sm text-ink">
                        No shared workspace attached
                      </p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        A project, folder, or repository will appear here only
                        when the runtime exposes one.
                      </p>
                    </div>
                  </div>
                </div>
              </section>

              {/* Last: the record of what the residents said to each other
                  here. Who is in the room and what it is working on answer
                  the first question; this answers the one you go looking for. */}
              {exchangeHistory.length > 0 ? (
                <section aria-labelledby="conversation-between-agents">
                  <div className="flex items-center justify-between gap-3">
                    <SectionLabel id="conversation-between-agents">
                      Between agents
                    </SectionLabel>
                    <SectionCount>{exchangeHistory.length}</SectionCount>
                  </div>
                  <ExchangeHistory
                    channelId={channel.id}
                    currentPubkey={currentPubkey}
                    messages={messages}
                    profiles={profiles}
                  />
                </section>
              ) : null}

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
        )}
      </>
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
  // Section titles speak in the UI face at small size and low ink — hierarchy
  // by size and opacity, never by a second typeface.
  return (
    <h3
      className="mb-2 text-2xs font-medium uppercase tracking-caps text-ink-faint"
      id={id}
    >
      {children}
    </h3>
  );
}

function SectionCount({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-2 text-2xs tabular-nums text-ink-faint">
      {children}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-2.5 py-2.5">
      <span className="truncate text-2xs text-muted-foreground">{label}</span>
      <span className="text-base font-medium tabular-nums text-foreground">
        {value}
      </span>
    </div>
  );
}
