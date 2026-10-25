import * as React from "react";
import { ChevronRight, Plus } from "lucide-react";

import "@/app/shell/shell-rail.css";
import {
  readLastProjectRoom,
  type RoomProject,
} from "@/features/channels/lib/roomProjects";
import {
  readExpandedAgents,
  readExpandedHomes,
} from "@/features/sidebar/lib/agentRailState";
import type { ChatListItem } from "@/features/sidebar/lib/chatListModel";
import {
  activeRailHome,
  buildRailHomes,
  type RailHome,
} from "@/features/sidebar/lib/railHomes";
import type { AgentRailAgent } from "@/features/sidebar/ui/AgentRail";
import { ChatRowContextMenu } from "@/features/sidebar/ui/ChatList";

/**
 * The shell's rail (docs/luca/rail-system/SPEC.md, "The rail, ironed out"):
 * Luca first; then every place you talk, each with its sessions nested under
 * its name. Shown only under the `shell-frame` preview feature; today's rail
 * (ChatList, AgentRail) is untouched without it.
 *
 * The rows carry the attributes the selection follows and nothing more: the
 * parent of whatever is open is `data-active` (today's pill and the shell's
 * marks both follow it), and the open session under it is `data-current`,
 * marked by light (shell-rail.css), never by a second pill.
 */

export type ShellRailProps = {
  items: readonly ChatListItem[];
  agents: readonly AgentRailAgent[];
  primaryPubkey: string | null;
  projects: readonly RoomProject[];
  projectByChannelId: ReadonlyMap<string, RoomProject>;
  selectedChannelId: string | null;
  selectedProjectId?: string | null;
  unreadChannelIds: ReadonlySet<string>;
  workingByChannelId?: ReadonlyMap<string, { agentCount: number }>;
  /** Where expansion is remembered, and where the agent rail kept it. */
  storageKey: string;
  agentStorageKey: string;
  onSelectChannel: (channelId: string) => void;
  onSelectProject: (projectId: string, preferredRoomId: string | null) => void;
  onOpenAgent: (pubkey: string) => void;
  /** The `+` on a home: a new session in it. */
  onAddToHome: (home: RailHome) => void;
  onCreateProject: () => void;
  onCreateAgent: () => void;
  onCreateFleet: () => void;
  onMarkChannelRead: (
    channelId: string,
    lastMessageAt: string | null | undefined,
  ) => void;
  onMarkChannelUnread: (channelId: string) => void;
};

const SECTIONS = [
  {
    kind: "project",
    title: "Projects",
    add: "New project",
    testId: "create-channel",
  },
  {
    kind: "agent",
    title: "Agents",
    add: "New agent",
    testId: "create-direct-message",
  },
  { kind: "fleet", title: "Fleets", add: "New fleet", testId: "create-fleet" },
] as const;

export function addLabel(home: RailHome) {
  return home.kind === "project"
    ? `New room in ${home.name}`
    : `New session with ${home.name}`;
}

/** Up and Down between visible rows; Right opens a home or steps into its
 *  first session; Left closes it or steps back out to it. */
function railKeys(event: React.KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"].includes(event.key))
    return;
  const rows = [
    ...event.currentTarget.querySelectorAll<HTMLElement>("[data-rail-focus]"),
  ];
  const index = rows.indexOf(document.activeElement as HTMLElement);
  if (index < 0) return;
  const focused = rows[index];
  const move = (to: number) => {
    event.preventDefault();
    rows[Math.max(0, Math.min(rows.length - 1, to))]?.focus();
  };
  const chevron = () =>
    focused
      .closest("[data-home-group]")
      ?.querySelector<HTMLElement>("[data-chevron]");
  if (event.key === "ArrowDown") move(index + 1);
  else if (event.key === "ArrowUp") move(index - 1);
  else if (event.key === "ArrowRight") {
    if (focused.dataset.railFocus !== "home") return;
    const toggle = chevron();
    if (!toggle) return;
    event.preventDefault();
    if (toggle.getAttribute("aria-expanded") === "false") toggle.click();
    else move(index + 1);
  } else if (event.key === "ArrowLeft") {
    if (focused.dataset.railFocus === "session") {
      event.preventDefault();
      focused
        .closest("[data-home-group]")
        ?.querySelector<HTMLElement>('[data-rail-focus="home"]')
        ?.focus();
      return;
    }
    const toggle = chevron();
    if (toggle?.getAttribute("aria-expanded") === "true") {
      event.preventDefault();
      toggle.click();
    }
  }
}

export function ShellRail({
  items,
  agents,
  primaryPubkey,
  projects,
  projectByChannelId,
  selectedChannelId,
  selectedProjectId = null,
  unreadChannelIds,
  workingByChannelId,
  storageKey,
  agentStorageKey,
  onSelectChannel,
  onSelectProject,
  onOpenAgent,
  onAddToHome,
  onCreateProject,
  onCreateAgent,
  onCreateFleet,
  onMarkChannelRead,
  onMarkChannelUnread,
}: ShellRailProps) {
  const homes = React.useMemo(
    () =>
      buildRailHomes({
        items,
        agents,
        primaryPubkey,
        projects,
        projectByChannelId,
      }),
    [agents, items, primaryPubkey, projectByChannelId, projects],
  );
  const active = activeRailHome(homes, selectedChannelId, selectedProjectId);

  const [expanded, setExpanded] = React.useState<Record<string, boolean>>(
    () => {
      const stored = readExpandedHomes(localStorage, storageKey);
      // Agents the agent rail had open stay open under the shell.
      const legacy = readExpandedAgents(localStorage, agentStorageKey);
      const carried = Object.fromEntries(
        Object.entries(legacy).map(([pubkey, open]) => [
          `agent:${pubkey}`,
          open,
        ]),
      );
      return { ...carried, ...stored };
    },
  );
  const setOpen = React.useCallback(
    (homeId: string, open: boolean) => {
      setExpanded((current) => {
        if (current[homeId] === open) return current;
        const next = { ...current, [homeId]: open };
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          /* Keep usable in memory. */
        }
        return next;
      });
    },
    [storageKey],
  );

  const agentsByPubkey = React.useMemo(
    () => new Map(agents.map((agent) => [agent.pubkey.toLowerCase(), agent])),
    [agents],
  );

  const openHome = (home: RailHome) => {
    if (home.sessions.length > 0) setOpen(home.id, true);
    if (home.kind === "project" && home.project) {
      const remembered = readLastProjectRoom(home.project.id);
      const preferred = home.sessions.some(
        (item) => item.channel.id === remembered,
      )
        ? remembered
        : (home.sessions[0]?.channel.id ?? null);
      onSelectProject(home.project.id, preferred);
      return;
    }
    const resident =
      home.pubkey && (home.kind === "luca" || home.kind === "agent")
        ? agentsByPubkey.get(home.pubkey)
        : undefined;
    if (resident) {
      // The relay's owner/participant key is the durable get-or-create map,
      // so this opens the one thread even before it exists.
      onOpenAgent(resident.pubkey.toLowerCase());
      return;
    }
    const target = home.main ?? home.sessions[0];
    if (target) onSelectChannel(target.channel.id);
  };

  const row = (home: RailHome) => (
    <HomeRow
      active={active?.id === home.id}
      agent={home.pubkey ? agentsByPubkey.get(home.pubkey) : undefined}
      expanded={expanded[home.id] ?? false}
      home={home}
      key={home.id}
      onAdd={(target) => {
        // The new session shows under its home the moment it exists.
        setOpen(target.id, true);
        onAddToHome(target);
      }}
      onOpen={openHome}
      onSession={onSelectChannel}
      onToggle={(open) => setOpen(home.id, open)}
      selectedChannelId={selectedChannelId}
      unreadChannelIds={unreadChannelIds}
      workingByChannelId={workingByChannelId}
    />
  );
  const sectionHomes = {
    project: homes.projects,
    agent: homes.agents,
    fleet: homes.fleets,
  };
  const create = {
    project: onCreateProject,
    agent: onCreateAgent,
    fleet: onCreateFleet,
  };

  return (
    <ChatRowContextMenu
      items={items}
      onMarkChannelRead={onMarkChannelRead}
      onMarkChannelUnread={onMarkChannelUnread}
      unreadChannelIds={unreadChannelIds}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: arrow keys move between the rail's rows, as the agent rail's always have (AgentRail.tsx). */}
      <div
        className="luca-shell-rail"
        data-shell-rail=""
        data-testid="chat-list"
        onKeyDown={railKeys}
      >
        {homes.luca ? row(homes.luca) : null}
        {SECTIONS.map((section) => (
          <section
            aria-label={section.title}
            className="luca-rail-section"
            data-testid={`rail-section-${section.kind}`}
            key={section.kind}
          >
            <div className="luca-rail-section-head type-eyebrow">
              <span>{section.title}</span>
              <button
                aria-label={section.add}
                className="luca-rail-add"
                data-testid={section.testId}
                onClick={create[section.kind]}
                title={section.add}
                type="button"
              >
                <Plus aria-hidden />
              </button>
            </div>
            {sectionHomes[section.kind].map(row)}
          </section>
        ))}
      </div>
    </ChatRowContextMenu>
  );
}

function WorkingLabel({ count }: { count: number }) {
  return (
    <span className="luca-rail-working text-2xs">
      {count > 1 ? `${count} working` : "working"}
    </span>
  );
}

function UnreadDot() {
  return (
    <span
      aria-hidden
      className="luca-rail-dot luca-signal-dot motion-enter-signal"
    />
  );
}

function HomeRow({
  active,
  agent,
  expanded,
  home,
  onAdd,
  onOpen,
  onSession,
  onToggle,
  selectedChannelId,
  unreadChannelIds,
  workingByChannelId,
}: {
  active: boolean;
  agent: AgentRailAgent | undefined;
  expanded: boolean;
  home: RailHome;
  onAdd: (home: RailHome) => void;
  onOpen: (home: RailHome) => void;
  onSession: (channelId: string) => void;
  onToggle: (open: boolean) => void;
  selectedChannelId: string | null;
  unreadChannelIds: ReadonlySet<string>;
  workingByChannelId?: ReadonlyMap<string, { agentCount: number }>;
}) {
  const chats = home.main ? [home.main, ...home.sessions] : home.sessions;
  const unread = chats.some(
    (item) =>
      item.channel.id !== selectedChannelId &&
      unreadChannelIds.has(item.channel.id),
  );
  const working = chats.reduce(
    (count, item) =>
      count + (workingByChannelId?.get(item.channel.id)?.agentCount ?? 0),
    0,
  );
  const status = agent?.waking
    ? "Waking"
    : agent?.lastError
      ? "Needs attention"
      : null;
  const nested = home.sessions.length > 0;
  const mainOpen =
    active &&
    (home.main
      ? home.main.channel.id === selectedChannelId
      : !home.sessions.some((item) => item.channel.id === selectedChannelId));
  // A resident still arriving has no record to start a session with yet.
  const canAdd = !agent?.pubkey.includes(":");
  const signal = unread ? (
    <UnreadDot />
  ) : status ? (
    <span className="luca-rail-working text-2xs">{status}</span>
  ) : working > 0 ? (
    <WorkingLabel count={working} />
  ) : null;
  const sessionsId = `rail-sessions-${home.id}`;

  return (
    <div className="luca-rail-home" data-home-group={home.id}>
      <div
        className="luca-rail-row"
        data-active={active ? "true" : undefined}
        data-channel-id={home.main?.channel.id}
        data-home={home.id}
        data-home-kind={home.kind}
        data-sidebar="menu-button"
        data-testid={`rail-home-${home.id}`}
      >
        <button
          aria-current={mainOpen ? "page" : undefined}
          aria-label={[
            home.name,
            unread ? "unread" : null,
            status ?? (working > 0 ? "working" : null),
          ]
            .filter(Boolean)
            .join(", ")}
          className="luca-rail-row-hit"
          data-rail-focus="home"
          onClick={() => onOpen(home)}
          title={home.name}
          type="button"
        />
        <span aria-hidden className="luca-rail-row-name text-sm">
          {home.name}
        </span>
        {nested ? (
          <button
            aria-controls={expanded ? sessionsId : undefined}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Hide" : "Show"} ${home.name}'s sessions`}
            className="luca-rail-chevron"
            data-chevron=""
            onClick={() => onToggle(!expanded)}
            tabIndex={-1}
            type="button"
          >
            <ChevronRight aria-hidden />
          </button>
        ) : null}
        <span className="luca-rail-row-end">
          {signal ? <span className="luca-rail-signal">{signal}</span> : null}
          {canAdd ? (
            <button
              aria-label={addLabel(home)}
              className="luca-rail-add luca-rail-row-add"
              onClick={() => onAdd(home)}
              title={addLabel(home)}
              type="button"
            >
              <Plus aria-hidden />
            </button>
          ) : null}
        </span>
      </div>
      {nested && expanded ? (
        <fieldset
          aria-label={`${home.name}'s sessions`}
          className="luca-rail-sessions"
          id={sessionsId}
        >
          {home.sessions.map((item) => {
            const current = item.channel.id === selectedChannelId;
            const isUnread = !current && unreadChannelIds.has(item.channel.id);
            const busy = workingByChannelId?.get(item.channel.id)?.agentCount;
            return (
              <button
                aria-current={current ? "page" : undefined}
                aria-label={[item.label, isUnread ? "unread" : null]
                  .filter(Boolean)
                  .join(", ")}
                className="luca-rail-session"
                data-channel-id={item.channel.id}
                data-current={current ? "true" : undefined}
                data-rail-focus="session"
                data-testid={`rail-session-${item.channel.id}`}
                key={item.channel.id}
                onClick={() => onSession(item.channel.id)}
                title={item.label}
                type="button"
              >
                <span className="luca-rail-session-title">{item.label}</span>
                {isUnread ? (
                  <UnreadDot />
                ) : busy ? (
                  <WorkingLabel count={busy} />
                ) : null}
              </button>
            );
          })}
        </fieldset>
      ) : null}
    </div>
  );
}
