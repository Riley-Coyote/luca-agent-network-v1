import * as React from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";

import { ResidentIdentityMark } from "@/features/channels/ui/ResidentIdentityMark";
import { CANONICAL_LUCA_PERSONA_ID } from "@/features/luca/canonicalLucaResident";
import { usePublishFieldAnchor } from "@/features/onboarding/polyphonicOnboardingGeometry";
import {
  ChatRow,
  type ChatRowProps,
  RAIL_CONTROL_CLASS,
  RAIL_ROW_CLASS,
  RAIL_SECTION_CLASS,
  RailSectionHeader,
  UNREAD_DOT_CLASS,
} from "@/features/sidebar/ui/ChatList";
import {
  chatsWithAgent,
  sortChats,
  type ChatListItem,
} from "@/features/sidebar/lib/chatListModel";
import { readExpandedAgents } from "@/features/sidebar/lib/agentRailState";
import type { RoomProject } from "@/features/channels/lib/roomProjects";
import { cn } from "@/shared/lib/cn";

/** Residents and their inline sessions; the primary companion stays a direct destination. */
export type AgentRailAgent = {
  name: string;
  avatarUrl?: string | null;
  personaId?: string | null;
  pubkey: string;
  /**
   * A resident Luca has just created and is still bringing up. The row appears
   * the moment the record exists, so it has to say what is true: here, but not
   * awake yet.
   */
  waking?: boolean;
  /** Set when bringing the resident up did not finish. */
  lastError?: string | null;
};

export type AgentRailActivity = {
  /** Newest message in any chat with this resident, as a rail label. */
  recent: string;
  unread: boolean;
};

/**
 * A resident's mark in the rail. Luca's is also where the onboarding mark
 * lands: when the setup card becomes the application, the mark that was at
 * the heart of the field travels here and settles onto this one, which is the
 * same mark. The rail publishes where it is; the onboarding layer does the
 * travelling, and only while a first run is in flight.
 */
function AgentRailMark({ agent }: { agent: AgentRailAgent }) {
  const markRef = React.useRef<HTMLSpanElement>(null);
  usePublishFieldAnchor(
    markRef,
    "app",
    agent.personaId === CANONICAL_LUCA_PERSONA_ID,
  );
  return (
    <span
      className="flex size-5 shrink-0 items-center justify-center text-ink-muted group-data-[open=true]:text-foreground"
      ref={markRef}
    >
      <ResidentIdentityMark
        accessibleName={agent.name}
        avatarUrl={agent.avatarUrl}
        decorative
        personaId={agent.personaId}
        presentation="glyph"
        publicKey={agent.pubkey}
        size={20}
      />
    </span>
  );
}

export const AgentRail = React.memo(function AgentRail({
  activityByPubkey,
  agents,
  onCreateAgent,
  onOpenAgent,
  onNewSession,
  primaryPubkey,
  items,
  storageKey,
  projectByChannelId,
  ...rowProps
}: Omit<ChatRowProps, "item" | "testId" | "tag"> & {
  activityByPubkey: ReadonlyMap<string, AgentRailActivity>;
  agents: readonly AgentRailAgent[];
  onCreateAgent: () => void;
  onOpenAgent: (pubkey: string) => void;
  onNewSession?: (pubkey: string) => void;
  primaryPubkey: string | null;
  items: readonly ChatListItem[];
  storageKey: string;
  projectByChannelId: ReadonlyMap<string, RoomProject>;
}) {
  const [expanded, setExpanded] = React.useState(() =>
    readExpandedAgents(localStorage, storageKey),
  );
  const primary = agents.find(
    (agent) => agent.pubkey.toLowerCase() === primaryPubkey,
  );
  function setOpen(pubkey: string, open: boolean) {
    setExpanded((current) => {
      const next = { ...current, [pubkey]: open };
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* Keep usable in memory. */
      }
      return next;
    });
  }
  function agentRow(agent: AgentRailAgent, isPrimary: boolean) {
    const key = agent.pubkey.toLowerCase();
    const sessions = sortChats(chatsWithAgent(items, key));
    const active = sessions.some(
      (item) =>
        item.channel.id === rowProps.selectedChannelId &&
        (!isPrimary ||
          (item.channel.channelType === "dm" &&
            item.participants.length === 1)),
    );
    const open = expanded[key] ?? false;
    const activity = activityByPubkey.get(key);
    const unread = Boolean(activity?.unread);
    const working = sessions.some((item) =>
      rowProps.workingByChannelId?.has(item.channel.id),
    );
    const status = agent.waking
      ? "Waking…"
      : agent.lastError
        ? "Needs attention"
        : working
          ? "working…"
          : null;
    const direct = sessions.some(
      (item) =>
        item.channel.channelType === "dm" &&
        item.participants.length === 1 &&
        item.participants[0].toLowerCase() === key,
    );
    const listId = `agent-sessions-${key}`;
    return (
      <div
        key={key}
        data-agent-pubkey={key}
        data-testid={isPrimary ? "primary-companion" : undefined}
      >
        <button
          aria-label={[agent.name, unread ? "unread" : null, status]
            .filter(Boolean)
            .join(", ")}
          aria-expanded={isPrimary ? undefined : open}
          aria-controls={isPrimary ? undefined : listId}
          aria-current={isPrimary && active ? "page" : undefined}
          className={RAIL_ROW_CLASS}
          data-active={isPrimary && active ? "true" : undefined}
          data-open={!isPrimary && active ? "true" : undefined}
          data-sidebar="menu-button"
          data-testid={`agent-rail-${agent.name.toLowerCase()}`}
          onClick={() => (isPrimary ? onOpenAgent(key) : setOpen(key, !open))}
          onKeyDown={(event) => {
            if (isPrimary) return;
            if (event.key === "ArrowRight") {
              event.preventDefault();
              if (!open) setOpen(key, true);
              else
                document
                  .getElementById(listId)
                  ?.querySelector<HTMLButtonElement>("button")
                  ?.focus();
            } else if (event.key === "ArrowLeft") {
              event.preventDefault();
              setOpen(key, false);
            }
          }}
          title={agent.name}
          type="button"
        >
          <AgentRailMark agent={agent} />
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm",
              unread && "text-sidebar-foreground",
            )}
          >
            {agent.name}
          </span>
          {unread ? (
            <span aria-hidden className={UNREAD_DOT_CLASS} />
          ) : status ? (
            <span
              className="max-w-20 truncate text-2xs text-ink-faint"
              title={status}
            >
              {status}
            </span>
          ) : null}
          {!isPrimary &&
            (open ? (
              <ChevronDown
                aria-hidden
                className="size-3.5 shrink-0 text-ink-faint"
              />
            ) : (
              <ChevronRight
                aria-hidden
                className="size-3.5 shrink-0 text-ink-faint"
              />
            ))}
        </button>
        {!isPrimary && open && (
          <fieldset
            id={listId}
            aria-label={`Sessions with ${agent.name}`}
            className="ml-5 min-w-0 border-l border-border/40 pl-1"
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "Escape") return;
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.previousElementSibling instanceof
                HTMLElement &&
                event.currentTarget.previousElementSibling.focus();
              setOpen(key, false);
            }}
          >
            {sessions.map((item) => (
              <ChatRow
                key={item.channel.id}
                item={item}
                testId={`agent-session-${item.channel.id}`}
                tag={projectByChannelId.get(item.channel.id)?.label}
                {...rowProps}
              />
            ))}
            {!direct && (
              <button
                className={cn(
                  RAIL_CONTROL_CLASS,
                  "min-h-8 w-full justify-start gap-2 px-2 text-xs",
                )}
                type="button"
                onClick={() => onOpenAgent(key)}
              >
                Chat with {agent.name}
              </button>
            )}
            {onNewSession && (
              <button
                className={cn(
                  RAIL_CONTROL_CLASS,
                  "min-h-8 w-full justify-start gap-2 px-2 text-xs",
                )}
                type="button"
                onClick={() => onNewSession(key)}
              >
                <Plus aria-hidden className="size-3" />
                New session
              </button>
            )}
          </fieldset>
        )}
      </div>
    );
  }
  return (
    <div className={RAIL_SECTION_CLASS} data-testid="chat-direct-messages">
      {primary && <div className="mb-2">{agentRow(primary, true)}</div>}
      <RailSectionHeader
        title="Agents"
        action={
          <button
            aria-label="New agent"
            className={cn(RAIL_CONTROL_CLASS, "-mr-1 size-6")}
            data-testid="create-direct-message"
            onClick={onCreateAgent}
            title="New agent"
            type="button"
          >
            <Plus className="size-3.5" />
          </button>
        }
      />
      {agents
        .filter((agent) => agent.pubkey.toLowerCase() !== primaryPubkey)
        .map((agent) => agentRow(agent, false))}
    </div>
  );
});
