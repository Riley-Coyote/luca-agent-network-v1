import * as React from "react";
import { BookOpen, ChevronRight, FolderCog, Plus } from "lucide-react";

import "@/app/shell/shell-rail.css";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import {
  readLastProjectRoom,
  type RoomProject,
} from "@/features/channels/lib/roomProjects";
import {
  readExpandedAgents,
  readExpandedHomes,
} from "@/features/sidebar/lib/agentRailState";
import {
  type ChatListItem,
  relativeTime,
} from "@/features/sidebar/lib/chatListModel";
import {
  activeRailHome,
  buildRailHomes,
  type RailHome,
  shownSessions,
} from "@/features/sidebar/lib/railHomes";
import type { AgentRailAgent } from "@/features/sidebar/ui/AgentRail";
import { buildProjectNavigatorViewModel } from "@/features/projects/lib/projectNavigator";
import { ProjectDetailsDialog } from "@/features/projects/ui/ProjectRoomWorkspace";
import { usePublishFieldAnchor } from "@/features/onboarding/polyphonicOnboardingGeometry";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveIdentityDisplayName } from "@/features/profile/lib/identity";
import { useProjectRoomsPlacement } from "@/features/sidebar/lib/projectRoomsPlacement";
import { ChatRowContextMenu } from "@/features/sidebar/ui/ChatList";
import {
  ContextMenuIconSlot,
  deferMenuAction,
} from "@/features/sidebar/ui/sidebarMenuHelpers";
import { ContextMenuItem } from "@/shared/ui/context-menu";

/**
 * The Chats rail (docs/luca/rail-system/SPEC.md, amended 2026-10-25): its own
 * heading with the + for a new conversation; Luca first; then Projects,
 * Agents, People and Rooms, each home with its latest conversations nested
 * under its name, and Rooms ending on Browse rooms… and Archived. Shown only
 * under the `shell-frame` preview feature; today's rail (ChatList, AgentRail)
 * is untouched without it.
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
  /** The heading's `+`: New conversation (⌘N). */
  onNewConversation: () => void;
  onCreateProject: () => void;
  /** Rooms' `+`: the create-room dialog. */
  onCreateRoom: () => void;
  /** Rooms' last two rows: the room browser on All, and on Archived. */
  onBrowseRooms: () => void;
  onBrowseArchived: () => void;
  onMarkChannelRead: (
    channelId: string,
    lastMessageAt: string | null | undefined,
  ) => void;
  onMarkChannelUnread: (channelId: string) => void;
};

type Section = {
  kind: "project" | "agent" | "person" | "room";
  title: string;
  add?: { label: string; testId: string };
};

/** Projects and Agents always show; People and Rooms once there is one. */
const SECTIONS: readonly Section[] = [
  {
    kind: "project",
    title: "Projects",
    add: { label: "New project", testId: "create-channel" },
  },
  { kind: "agent", title: "Agents" },
  { kind: "person", title: "People" },
  {
    kind: "room",
    title: "Rooms",
    add: { label: "New room", testId: "create-room" },
  },
];

export function addLabel(home: RailHome) {
  return home.kind === "project"
    ? `New room in ${home.name}`
    : `New session with ${home.membersName || home.name}`;
}

/** Up and Down between visible rows; Right opens a home or steps into its
 *  first session; Left closes it or steps back out to it. The menu key (or
 *  Shift+F10) opens the focused row's menu, as a right-click would: a
 *  project's details live there, so the keyboard must reach them too. */
function railKeys(event: React.KeyboardEvent<HTMLDivElement>) {
  if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
    const target = document.activeElement;
    if (
      !(target instanceof HTMLElement) ||
      !target.matches("[data-rail-focus]") ||
      !event.currentTarget.contains(target)
    )
      return;
    event.preventDefault();
    const box = target.getBoundingClientRect();
    target.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: box.left + 14,
        clientY: box.bottom,
      }),
    );
    return;
  }
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
  // The home's own button says whether it is open; the chevron (a mouse
  // target, hidden from the keyboard and screen readers) does the toggling.
  const chevron = () =>
    focused
      .closest("[data-home-group]")
      ?.querySelector<HTMLElement>("[data-chevron]");
  const homeButton = () =>
    focused
      .closest("[data-home-group]")
      ?.querySelector<HTMLElement>('[data-rail-focus="home"]');
  if (event.key === "ArrowDown") move(index + 1);
  else if (event.key === "ArrowUp") move(index - 1);
  else if (event.key === "ArrowRight") {
    if (focused.dataset.railFocus !== "home") return;
    const toggle = chevron();
    if (!toggle) return;
    event.preventDefault();
    if (focused.getAttribute("aria-expanded") === "false") toggle.click();
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
    if (homeButton()?.getAttribute("aria-expanded") === "true") {
      event.preventDefault();
      chevron()?.click();
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
  onNewConversation,
  onCreateProject,
  onCreateRoom,
  onBrowseRooms,
  onBrowseArchived,
  onMarkChannelRead,
  onMarkChannelUnread,
}: ShellRailProps) {
  // Everyone in the rail's chats who is not one of this Mac's agents, from
  // their profiles: their names, so a group is named by its members and never
  // by a chat, and whether they are an agent (Agents) or a person (People).
  const strangers = React.useMemo(() => {
    const known = new Set(agents.map((agent) => agent.pubkey.toLowerCase()));
    return [
      ...new Set(
        items.flatMap((item) =>
          item.participants.map((pubkey) => pubkey.toLowerCase()),
        ),
      ),
    ].filter((pubkey) => !known.has(pubkey));
  }, [agents, items]);
  const profiles = useUsersBatchQuery(strangers).data?.profiles;
  const { names, agentPubkeys } = React.useMemo(() => {
    const byKey = new Map<string, string>();
    const agentKeys = new Set<string>();
    for (const pubkey of strangers) {
      const profile = profiles?.[pubkey];
      if (!profile) continue;
      if (profile.isAgent) agentKeys.add(pubkey);
      const name = resolveIdentityDisplayName({
        displayName: profile.displayName,
        name: profile.name,
        nip05Handle: profile.nip05Handle,
        pubkey,
      });
      // "Person" is the resolver's own stand-in, not a name.
      if (name !== "Person") byKey.set(pubkey, name);
    }
    return { names: byKey, agentPubkeys: agentKeys };
  }, [profiles, strangers]);
  const homes = React.useMemo(
    () =>
      buildRailHomes({
        items,
        agents,
        agentPubkeys,
        primaryPubkey,
        projects,
        projectByChannelId,
        names,
      }),
    [
      agentPubkeys,
      agents,
      items,
      names,
      primaryPubkey,
      projectByChannelId,
      projects,
    ],
  );
  // "In a column": a project's rooms sit in the room column beside the
  // conversation, so the project's row nests nothing (as today's rail).
  const roomsInColumn = useProjectRoomsPlacement() === "column";
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

  // A project's details (its name, its grouping) and its sources: in the
  // room column's footer when rooms sit in a column, and on the project
  // row's menu here, so they keep a home when the rooms nest in the rail.
  const { goBrain } = useAppNavigation();
  const [details, setDetails] = React.useState<{
    projectId: string;
    open: boolean;
  } | null>(null);
  const detailsProjectId = details?.projectId ?? null;
  const detailsProject = detailsProjectId
    ? (projects.find((project) => project.id === detailsProjectId) ?? null)
    : null;
  const detailsViewModel = React.useMemo(
    () =>
      detailsProject
        ? buildProjectNavigatorViewModel({
            channels: items.map((item) => item.channel),
            project: detailsProject,
            projectByChannelId,
          })
        : null,
    [detailsProject, items, projectByChannelId],
  );
  const projectMenuItems = (projectId: string) => (
    <>
      <ContextMenuItem
        data-testid="rail-project-details"
        onSelect={() =>
          deferMenuAction(() => setDetails({ projectId, open: true }))
        }
      >
        <ContextMenuIconSlot>
          <FolderCog className="h-4 w-4" />
        </ContextMenuIconSlot>
        Project details…
      </ContextMenuItem>
      <ContextMenuItem
        data-testid="rail-project-sources"
        onSelect={() => deferMenuAction(() => void goBrain())}
      >
        <ContextMenuIconSlot>
          <BookOpen className="h-4 w-4" />
        </ContextMenuIconSlot>
        Sources in Brain
      </ContextMenuItem>
    </>
  );

  const agentsByPubkey = React.useMemo(
    () => new Map(agents.map((agent) => [agent.pubkey.toLowerCase(), agent])),
    [agents],
  );

  const flat = (home: RailHome) => roomsInColumn && home.kind === "project";
  // The + only where there is a session to start: a new room in a project, a
  // new session with one of this Mac's agents (never one still arriving), or
  // with every member of a room when they all are. A person has their one
  // conversation; the heading's + starts anything else.
  const managed = (pubkey: string) => {
    const agent = agentsByPubkey.get(pubkey);
    return Boolean(agent && !agent.pubkey.includes(":"));
  };
  const canAdd = (home: RailHome) =>
    home.kind === "project" ||
    ((home.kind === "luca" || home.kind === "agent") &&
      Boolean(home.pubkey && managed(home.pubkey))) ||
    (home.kind === "room" &&
      home.members.length > 0 &&
      home.members.every(managed));
  const openHome = (home: RailHome) => {
    if (home.sessions.length > 0 && !flat(home)) setOpen(home.id, true);
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
      canAdd={canAdd(home)}
      // Homes start open, so the rail never reads empty; the chevron closes
      // one, and each home remembers it.
      expanded={expanded[home.id] ?? true}
      flat={flat(home)}
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
    person: homes.people,
    room: homes.rooms,
  };
  const create = {
    project: onCreateProject,
    agent: undefined,
    person: undefined,
    room: onCreateRoom,
  };

  return (
    <>
      <ChatRowContextMenu
        items={items}
        onMarkChannelRead={onMarkChannelRead}
        onMarkChannelUnread={onMarkChannelUnread}
        projectMenuItems={projectMenuItems}
        unreadChannelIds={unreadChannelIds}
      >
        {/* biome-ignore lint/a11y/noStaticElementInteractions: arrow keys move between the rail's rows, as the agent rail's always have (AgentRail.tsx). */}
        <div
          className="luca-shell-rail"
          data-shell-rail=""
          data-testid="chat-list"
          onKeyDown={railKeys}
        >
          <div className="luca-rail-section-head luca-rail-head type-eyebrow">
            <span>Chats</span>
            <button
              aria-label="New conversation"
              aria-keyshortcuts="Meta+N"
              className="luca-rail-add"
              data-testid="rail-new-conversation"
              onClick={onNewConversation}
              title="New conversation  ⌘N"
              type="button"
            >
              <Plus aria-hidden />
            </button>
          </div>
          {homes.luca ? row(homes.luca) : null}
          {SECTIONS.map((section) => {
            const members = sectionHomes[section.kind];
            if (
              members.length === 0 &&
              (section.kind === "person" || section.kind === "room")
            )
              return null;
            const add = create[section.kind];
            return (
              <section
                aria-label={section.title}
                className="luca-rail-section"
                data-testid={`rail-section-${section.kind}`}
                key={section.kind}
              >
                <div className="luca-rail-section-head type-eyebrow">
                  <span>{section.title}</span>
                  {section.add && add ? (
                    <button
                      aria-label={section.add.label}
                      className="luca-rail-add"
                      data-testid={section.add.testId}
                      onClick={add}
                      title={section.add.label}
                      type="button"
                    >
                      <Plus aria-hidden />
                    </button>
                  ) : null}
                </div>
                {members.map(row)}
                {section.kind === "room" ? (
                  <>
                    <button
                      className="luca-rail-tail text-lip"
                      data-rail-focus="tail"
                      data-testid="rail-browse-rooms"
                      onClick={onBrowseRooms}
                      type="button"
                    >
                      Browse rooms…
                    </button>
                    <button
                      className="luca-rail-tail text-lip"
                      data-rail-focus="tail"
                      data-testid="rail-archived-rooms"
                      onClick={onBrowseArchived}
                      type="button"
                    >
                      Archived
                    </button>
                  </>
                ) : null}
              </section>
            );
          })}
        </div>
      </ChatRowContextMenu>
      {detailsViewModel ? (
        <ProjectDetailsDialog
          onOpenChange={(open) =>
            setDetails((current) => (current ? { ...current, open } : null))
          }
          open={details?.open ?? false}
          viewModel={detailsViewModel}
        />
      ) : null}
    </>
  );
}

/** A status the agent is in, not work in progress: no ellipsis. */
function StatusLabel({ children }: { children: string }) {
  return <span className="luca-rail-status text-2xs">{children}</span>;
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
  canAdd,
  expanded,
  flat,
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
  /** Whether the home has a session flow for its `+`. */
  canAdd: boolean;
  expanded: boolean;
  /** Nest nothing: a project whose rooms sit in a column. */
  flat: boolean;
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
  // Only work in progress trails off: "Waking…" and "working…" keep their
  // ellipsis; a status such as "Needs attention" has none.
  const waking = Boolean(agent?.waking);
  const status = waking
    ? "Waking"
    : agent?.lastError
      ? "Needs attention"
      : null;
  const nested = !flat && home.sessions.length > 0;
  const mainOpen =
    active &&
    (home.main
      ? home.main.channel.id === selectedChannelId
      : !home.sessions.some((item) => item.channel.id === selectedChannelId));
  // The study's order: a status or "working…" first, then the unread dot.
  const signal = waking ? (
    <span className="luca-rail-working text-2xs">Waking</span>
  ) : status ? (
    <StatusLabel>{status}</StatusLabel>
  ) : working > 0 ? (
    <WorkingLabel count={working} />
  ) : unread ? (
    <UnreadDot />
  ) : null;
  const sessionsId = `rail-sessions-${home.id}`;
  // The latest three show, and the open one wherever it falls; the rest wait
  // behind "N more", which shows them all for as long as the rail is up.
  const [all, setAll] = React.useState(false);
  const { shown, hidden } = shownSessions(
    home.sessions,
    selectedChannelId,
    all,
  );
  // "N more" leaves as it opens the rest: the focus moves on to the first of
  // them, so the keyboard never drops out of the rail.
  const sessionsRef = React.useRef<HTMLFieldSetElement>(null);
  const focusAfterMore = React.useRef<number | null>(null);
  React.useEffect(() => {
    const index = focusAfterMore.current;
    if (!all || index === null) return;
    focusAfterMore.current = null;
    sessionsRef.current
      ?.querySelectorAll<HTMLElement>('[data-rail-focus="session"]')
      [index]?.focus();
  }, [all]);
  // Onboarding's travelling mark lands on Luca's name: Luca's row has no
  // glyph under the shell, so its name is where the mark settles.
  const nameRef = React.useRef<HTMLSpanElement>(null);
  usePublishFieldAnchor(nameRef, "app", home.kind === "luca");

  return (
    <div className="luca-rail-home" data-home-group={home.id}>
      <div
        className="luca-rail-row"
        data-active={active ? "true" : undefined}
        data-channel-id={home.main?.channel.id}
        data-home={home.id}
        data-home-kind={home.kind}
        data-project-id={home.project?.id}
        data-sidebar="menu-button"
        data-testid={`rail-home-${home.id}`}
      >
        <button
          aria-controls={nested ? sessionsId : undefined}
          aria-current={mainOpen ? "page" : undefined}
          aria-expanded={nested ? expanded : undefined}
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
        <span
          aria-hidden
          className="luca-rail-row-name text-sm"
          data-onboarding-anchor={home.kind === "luca" ? "" : undefined}
          ref={nameRef}
        >
          {home.name}
        </span>
        {nested ? (
          // A mouse target only: the home's own button carries the state, and
          // Right and Left open and close it from the keyboard.
          <button
            aria-hidden
            className="luca-rail-chevron"
            data-expanded={expanded ? "true" : "false"}
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
      {nested ? (
        // Always present, so the home's aria-controls names something; its
        // sessions are drawn only while it is open, so nothing hidden is ever
        // counted as unread above or below (useUnreadOverflow).
        <fieldset
          aria-label={`${home.name}'s sessions`}
          className="luca-rail-sessions"
          hidden={!expanded}
          id={sessionsId}
          ref={sessionsRef}
        >
          {(expanded ? shown : []).map((item) => {
            const current = item.channel.id === selectedChannelId;
            const isUnread = !current && unreadChannelIds.has(item.channel.id);
            const busy = workingByChannelId?.get(item.channel.id)?.agentCount;
            const ago = relativeTime(item.channel.lastMessageAt);
            return (
              <button
                aria-current={current ? "page" : undefined}
                aria-label={[item.label, isUnread ? "unread" : null]
                  .filter(Boolean)
                  .join(", ")}
                className="luca-rail-session text-lip"
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
                {busy ? (
                  <WorkingLabel count={busy} />
                ) : isUnread ? (
                  <UnreadDot />
                ) : ago ? (
                  <span className="luca-rail-session-ago text-2xs">{ago}</span>
                ) : null}
              </button>
            );
          })}
          {expanded && hidden > 0 ? (
            <button
              aria-label={`Show ${hidden} more in ${home.name}`}
              className="luca-rail-session luca-rail-session-more text-xs"
              data-rail-focus="session"
              data-testid={`rail-more-${home.id}`}
              onClick={(event) => {
                if (event.currentTarget === document.activeElement)
                  focusAfterMore.current = shown.length;
                setAll(true);
              }}
              type="button"
            >
              {hidden} more
            </button>
          ) : null}
        </fieldset>
      ) : null}
    </div>
  );
}
