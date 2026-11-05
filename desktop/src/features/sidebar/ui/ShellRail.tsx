import * as React from "react";
import { useQueries } from "@tanstack/react-query";
import { useRouter, useRouterState } from "@tanstack/react-router";
import {
  BookOpen,
  ChevronRight,
  EyeOff,
  Folder,
  FolderCog,
  Hand,
  Hash,
  Plus,
} from "lucide-react";

import "@/app/shell/shell-rail.css";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { appPathOf } from "@/app/shell/placeRails/appTask";
import { needsYouNote } from "@/app/shell/placeRails/needsYou";
import { HarnessFace } from "@/app/shell/placeRails/placeFaces";
import { useNeedsYou } from "@/app/shell/placeRails/useNeedsYou";
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
  activeAt,
  activeRailHome,
  buildRailHomes,
  type CreatedAtById,
  type RailHome,
  type RailSideRow,
  shownHomeEntries,
} from "@/features/sidebar/lib/railHomes";
import { useNewAppConversation } from "@/features/sidebar/lib/appConversation";
import { useProjectRoomsPlacement } from "@/features/sidebar/lib/projectRoomsPlacement";
import { useRailWork } from "@/features/sidebar/lib/useRailWork";
import {
  clearOpenSide,
  noteOpenSide,
  useOpenSideId,
} from "@/features/exchange/openSide";
import type { AgentRailAgent } from "@/features/sidebar/ui/AgentRail";
import { useCurrentAgentRailVisibility } from "@/features/sidebar/lib/useAgentRailVisibility";
import { buildProjectNavigatorViewModel } from "@/features/projects/lib/projectNavigator";
import { ProjectDetailsDialog } from "@/features/projects/ui/ProjectRoomWorkspace";
import { usePublishFieldAnchor } from "@/features/onboarding/polyphonicOnboardingGeometry";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveIdentityDisplayName } from "@/features/profile/lib/identity";
import { useRuntimeRailConnections } from "@/features/runtime-sessions/RuntimeRailSection";
import { runtimeRailFamilyFromRuntimeId } from "@/features/runtime-sessions/runtimeRailPreferences";
import { ChatRowContextMenu } from "@/features/sidebar/ui/ChatList";
import {
  ContextMenuIconSlot,
  deferMenuAction,
} from "@/features/sidebar/ui/sidebarMenuHelpers";
import { getChannelDetails } from "@/shared/api/tauri";
import { AgentMark } from "@/shared/ui/AgentMark";
import { AgentDendrite } from "@/shared/ui/dendrite/AgentDendrite";
import { ContextMenuItem } from "@/shared/ui/context-menu";

/**
 * The Chats rail (docs/luca/rail-system/SPEC.md, amended 2026-10-25;
 * BETA14_RELEASE.md WP-34): its own heading, whose + opens Luca's one chat;
 * Needs you while anything waits; Luca; then Projects (the loose rooms after
 * the projects, Browse rooms… and Archived closing it), Agents and Apps.
 * Only work hangs on the thread: an agent's sessions and the exchanges it is
 * asked into, an app's tasks, each under its face. A project's rooms sit
 * under it too, on no thread (Riley, 2026-10-27), unless Settings puts them
 * in a column. Luca and a room are one ongoing chat each and nest nothing.
 * Shown only under the `shell-frame` preview feature; today's rail
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
  /** The `+` on a project or an agent: a new session in it. */
  onAddToHome: (home: RailHome) => void;
  /** The heading's `+` while Luca isn't known yet: New conversation. */
  onNewConversation: () => void;
  onCreateProject: () => void;
  /** Projects' last two rows: the room browser on All, and on Archived. */
  onBrowseRooms: () => void;
  onBrowseArchived: () => void;
  onMarkChannelRead: (
    channelId: string,
    lastMessageAt: string | null | undefined,
  ) => void;
  onMarkChannelUnread: (channelId: string) => void;
  /** After a row opens one of Chats' own pages (Needs you, an app) or starts
   *  a conversation with an app: the narrow window's sheet closes. */
  onLeave?: () => void;
};

/** A home's `+`, where it has one (WP-34, Decided 5): a room in a project,
 *  a conversation of your own with an agent or an app. Luca is one chat,
 *  with nothing to add; a room is itself. */
export function addLabel(home: RailHome) {
  return home.kind === "project"
    ? `New room in ${home.name}`
    : `New conversation with ${home.name}`;
}

/** Only work hangs on the thread (WP-34, Decided 3): an agent's sessions,
 *  an app's tasks. */
const nestsWork = (home: RailHome) =>
  home.kind === "agent" || home.kind === "app";

/** An app's home id, by its family ("claude", "codex"). */
const appHomeId = (family: string) => `app:${family}`;

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

/** Room left above and below a row the rail scrolls to: below, enough to
 *  clear the rail's bottom fade. */
const REVEAL_TOP = 12;
const REVEAL_BOTTOM = 40;

/** The rail's own glide, frame by frame on the house ease (out-cubic), so
 *  the router's restore of the rail's position after a navigation can't
 *  swallow it the way it cancels the browser's smooth scroll. A wheel or a
 *  press on the rail stops it where it is. One per scroller. */
const GLIDE_MS = 320;
const glides = new WeakMap<HTMLElement, () => void>();

function glideTo(scroller: HTMLElement, top: number, still: boolean) {
  glides.get(scroller)?.();
  if (still) {
    scroller.scrollTop = top;
    return;
  }
  const from = scroller.scrollTop;
  const start = performance.now();
  let frame = 0;
  const stop = () => {
    cancelAnimationFrame(frame);
    glides.delete(scroller);
    scroller.removeEventListener("wheel", stop);
    scroller.removeEventListener("pointerdown", stop);
  };
  scroller.addEventListener("wheel", stop, { passive: true });
  scroller.addEventListener("pointerdown", stop);
  glides.set(scroller, stop);
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / GLIDE_MS);
    scroller.scrollTop = from + (top - from) * (1 - (1 - t) ** 3);
    if (t < 1) frame = requestAnimationFrame(step);
    else stop();
  };
  frame = requestAnimationFrame(step);
}

/** Scroll the rail just enough to show `row` (block "nearest"), instantly
 *  under Reduce Motion. */
function revealRow(row: HTMLElement) {
  const scroller = row.closest<HTMLElement>('[data-sidebar="content"]');
  if (!scroller) return;
  const view = scroller.getBoundingClientRect();
  const box = row.getBoundingClientRect();
  const delta =
    box.top < view.top + REVEAL_TOP
      ? box.top - (view.top + REVEAL_TOP)
      : box.bottom > view.bottom - REVEAL_BOTTOM
        ? box.bottom - (view.bottom - REVEAL_BOTTOM)
        : 0;
  if (delta === 0) return;
  const max = scroller.scrollHeight - scroller.clientHeight;
  const top = Math.max(0, Math.min(max, scroller.scrollTop + delta));
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  glideTo(scroller, top, still);
}

/** How long a click in the rail stands for the navigation it starts (an
 *  agent's thread may be made first), so that one is never scrolled to. */
const RAIL_CLICK_MS = 3000;
/** How soon after a reveal the router's restore may undo it. */
const REVEAL_AGAIN_MS = 1500;

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
  onBrowseRooms,
  onBrowseArchived,
  onMarkChannelRead,
  onMarkChannelUnread,
  onLeave,
}: ShellRailProps) {
  const railVisibility = useCurrentAgentRailVisibility();
  // Everyone in the rail's chats who is not one of this Mac's agents, from
  // their profiles: their names, so a group is named by its members and never
  // by a chat, and whether they are an agent (Agents) or a person.
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
  // A chat nothing has been said in yet is as recent as its making: its
  // creation time, from its details, fetched for those chats only.
  const quietIds = React.useMemo(
    () =>
      items
        .filter((item) => !item.channel.lastMessageAt)
        .map((item) => item.channel.id),
    [items],
  );
  const madeAt = useQueries({
    queries: quietIds.map((id) => ({
      queryKey: ["channels", id, "detail"],
      queryFn: () => getChannelDetails(id),
      staleTime: 30_000,
    })),
  });
  const madeAtKey = madeAt
    .map((query, index) => `${quietIds[index]}=${query.data?.createdAt ?? ""}`)
    .join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: madeAtKey is the content of madeAt, which is a new array every render.
  const createdAtById = React.useMemo<CreatedAtById>(() => {
    const byId = new Map<string, string>();
    madeAt.forEach((query, index) => {
      const at = query.data?.createdAt;
      if (at) byId.set(quietIds[index], at);
    });
    return byId;
  }, [madeAtKey]);
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
        createdAtById,
      }),
    [
      agentPubkeys,
      agents,
      createdAtById,
      items,
      names,
      primaryPubkey,
      projectByChannelId,
      projects,
    ],
  );

  // Apps (WP-34, Decided 1): the apps connected on this Mac, the ones the
  // Agents place listed under Connected, each its own home.
  const { runtimes } = useRuntimeRailConnections();
  const appHomes = React.useMemo(
    () =>
      runtimes.flatMap((runtime): RailHome[] => {
        const family = runtimeRailFamilyFromRuntimeId(runtime.runtimeId);
        if (!family) return [];
        return [
          {
            id: appHomeId(family),
            kind: "app",
            main: null,
            members: [],
            membersName: "",
            mostRecent: 0,
            name: runtime.label,
            project: null,
            pubkey: null,
            sessions: [],
          },
        ];
      }),
    [runtimes],
  );

  // The work under whoever does it (WP-34, Decided 3): the exchanges an
  // agent is asked into, the tasks an app runs.
  const work = useRailWork();
  const sideOf = React.useCallback(
    (home: RailHome): readonly RailSideRow[] => {
      if (home.kind === "agent" && home.pubkey)
        return work.byAgent.get(home.pubkey) ?? NO_SIDE_ROWS;
      if (home.kind === "app")
        return work.byApp.get(home.id.slice("app:".length)) ?? NO_SIDE_ROWS;
      return NO_SIDE_ROWS;
    },
    [work],
  );
  // A project's rooms sit under it, as they did before WP-34, on no thread:
  // the line is "for agents and their task sessions specifically" (Riley,
  // 2026-10-27). "In a column" (Settings → Appearance, "Project rooms"):
  // they sit in the room column beside the conversation, and the project's
  // row nests nothing.
  const roomsInColumn = useProjectRoomsPlacement() === "column";
  const nests = (home: RailHome) =>
    nestsWork(home) || (home.kind === "project" && !roomsInColumn);

  // What waits on you tops the rail while anything does, and while its page
  // is open, so the row you opened never leaves under you (WP-34,
  // Decided 2).
  const needs = useNeedsYou();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const needsOpen = pathname === "/needs-you";
  // An app's page, or one of its tasks (WP-35): the app's home holds the
  // glass, and the task's row under it is lit.
  const appPath = appPathOf(pathname);
  const openApp = appPath ? appHomeId(appPath.family) : null;

  // A side conversation open marks where it belongs (WP-18, Decided 1;
  // SPEC.md, "Selection"): the glass on the home doing the work, that row
  // lit, and never the room it happens in.
  const threadTarget = useRouterState({
    select: (state) => {
      const search = state.location.search as Record<string, unknown>;
      const target = search.thread ?? search.threadRootId ?? search.messageId;
      return typeof target === "string" && target.length > 0 ? target : null;
    },
  });
  const openRoomSideId = useOpenSideId(
    selectedChannelId,
    threadTarget,
    work.rows,
  );
  const openSideId = appPath?.taskId
    ? `task:${appPath.taskId}`
    : openRoomSideId;
  const sideHome = openSideId
    ? ([...homes.agents, ...appHomes].find((home) =>
        sideOf(home).some((row) => row.id === openSideId),
      ) ?? null)
    : null;
  const sideOpen = Boolean(sideHome);
  const active = needsOpen
    ? null
    : openApp
      ? (appHomes.find((home) => home.id === openApp) ?? null)
      : (sideHome ??
        activeRailHome(homes, selectedChannelId, selectedProjectId));

  // When what is open changes from outside the rail (Search, Back and
  // Forward, a link, where the app opens), the rail scrolls its row into
  // view, or its home's when the home is folded. A click in the rail never
  // scrolls it: you are already looking at the row.
  //
  // The router puts the rail back where it was after every navigation
  // (useSidebarScrollLock), which would stop the scroll half-way, so the
  // reveal runs a frame later, and once more after the router has rendered.
  const router = useRouter();
  const railRef = React.useRef<HTMLDivElement>(null);
  const railClickAt = React.useRef(Number.NEGATIVE_INFINITY);
  const revealedFor = React.useRef<string | null>(null);
  const revealedAt = React.useRef(Number.NEGATIVE_INFINITY);
  const revealing = React.useRef({
    target: null as string | null,
    channelId: selectedChannelId,
  });
  revealing.current = {
    target: needsOpen
      ? "needs-you"
      : appPath?.taskId
        ? `side:${openSideId}`
        : (openApp ??
          (sideOpen
            ? `side:${openSideId}`
            : (selectedChannelId ??
              (selectedProjectId ? `project:${selectedProjectId}` : null)))),
    channelId: sideOpen || needsOpen || openApp ? null : selectedChannelId,
  };
  const reveal = React.useCallback((afterRoute: boolean) => {
    const { target, channelId } = revealing.current;
    if (!target) {
      revealedFor.current = null;
      return;
    }
    const now = performance.now();
    // Done already, unless the router has just put the rail back.
    if (
      revealedFor.current === target &&
      !(afterRoute && now - revealedAt.current < REVEAL_AGAIN_MS)
    )
      return;
    if (now - railClickAt.current < RAIL_CLICK_MS) {
      // The click's own navigation: spent, so the next one from outside
      // the rail is revealed again.
      railClickAt.current = Number.NEGATIVE_INFINITY;
      revealedFor.current = target;
      return;
    }
    const rail = railRef.current;
    const row =
      (target.startsWith("side:")
        ? rail?.querySelector<HTMLElement>(
            `[data-side-id="${CSS.escape(target.slice(5))}"]`,
          )
        : null) ??
      (channelId
        ? rail?.querySelector<HTMLElement>(
            `[data-rail-focus="session"][data-channel-id="${CSS.escape(channelId)}"]`,
          )
        : null) ??
      rail?.querySelector<HTMLElement>('[data-home][data-active="true"]');
    // Not drawn yet (the list is still arriving): try again next render.
    if (!row) return;
    if (revealedFor.current !== target) revealedAt.current = now;
    revealedFor.current = target;
    revealRow(row);
  }, []);
  React.useEffect(() => {
    const frame = requestAnimationFrame(() => reveal(false));
    return () => cancelAnimationFrame(frame);
  });
  React.useEffect(
    () =>
      router.subscribe("onRendered", () => {
        requestAnimationFrame(() => reveal(true));
      }),
    [reveal, router],
  );

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
  // row's menu here, so the keyboard and the pointer reach them from the
  // rail whichever way the rooms are listed.
  const {
    goAgents,
    goApp,
    goAppTask,
    goBrain,
    goChannel,
    goNeedsYou,
    goSettings,
  } = useAppNavigation();
  const newAppConversation = useNewAppConversation();
  const openSide = (side: RailSideRow) => {
    if (side.correspondenceId && side.taskIds?.[0]) {
      void openTaskWindow(side.taskIds[0]);
      return;
    }
    const [kind, ...rest] = side.id.split(":");
    // A task opens as the work, live or finished, under its app (WP-35).
    if (kind === "task") {
      const family = [...work.byApp].find(([, rows]) =>
        rows.some((row) => row.id === side.id),
      )?.[0];
      if (family) {
        clearOpenSide();
        void goAppTask(family, rest.join(":"));
        onLeave?.();
        return;
      }
    }
    noteOpenSide({
      conversationId: side.conversationId,
      id: rest.join(":"),
      kind: kind === "task" ? "task" : "exchange",
    });
    if (side.messageId)
      void goChannel(side.conversationId, { messageId: side.messageId });
    else onSelectChannel(side.conversationId);
  };
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
        Sources
      </ContextMenuItem>
    </>
  );

  const agentsByPubkey = React.useMemo(
    () => new Map(agents.map((agent) => [agent.pubkey.toLowerCase(), agent])),
    [agents],
  );

  // The + only where there is a conversation to start (WP-34, Decided 5): a
  // new room in a project, a new conversation with one of this Mac's agents
  // (never one still arriving) or with an app. Luca is one chat; a room is
  // itself.
  const managed = (pubkey: string) => {
    const agent = agentsByPubkey.get(pubkey);
    return Boolean(agent && !agent.pubkey.includes(":"));
  };
  const canAdd = (home: RailHome) =>
    home.kind === "project" ||
    home.kind === "app" ||
    (home.kind === "agent" && Boolean(home.pubkey && managed(home.pubkey)));
  const openHome = (home: RailHome) => {
    clearOpenSide();
    if (home.kind === "app") {
      if (sideOf(home).length > 0) setOpen(home.id, true);
      void goApp(home.id.slice("app:".length));
      onLeave?.();
      return;
    }
    if (home.sessions.length > 0 && nests(home)) setOpen(home.id, true);
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
  const addTo = (home: RailHome) => {
    // The new session shows under its home the moment it exists.
    setOpen(home.id, true);
    if (home.kind === "app") {
      // The app's own way in: New conversation, found to the app (the app
      // page head's action is this same handler).
      void newAppConversation(home.id.slice("app:".length));
      onLeave?.();
      return;
    }
    onAddToHome(home);
  };

  const row = (home: RailHome) => (
    <HomeRow
      active={active?.id === home.id}
      agent={home.pubkey ? agentsByPubkey.get(home.pubkey) : undefined}
      canAdd={canAdd(home)}
      createdAtById={createdAtById}
      // Homes start open, so the rail never reads empty; the chevron closes
      // one, and each home remembers it.
      expanded={expanded[home.id] ?? true}
      home={home}
      key={home.id}
      nests={nests(home)}
      onAdd={addTo}
      onOpen={openHome}
      onSession={(channelId) => {
        clearOpenSide();
        onSelectChannel(channelId);
      }}
      onSide={openSide}
      openSideId={sideHome?.id === home.id ? openSideId : null}
      side={sideOf(home)}
      onToggle={(open) => setOpen(home.id, open)}
      selectedChannelId={selectedChannelId}
      unreadChannelIds={unreadChannelIds}
      workingByChannelId={workingByChannelId}
    />
  );
  const showNeeds = needs.count > 0 || needsOpen;

  return (
    <>
      <ChatRowContextMenu
        agentMenuItems={(pubkey) => (
          <ContextMenuItem
            onSelect={() =>
              deferMenuAction(() => railVisibility.setVisible(pubkey, false))
            }
          >
            <ContextMenuIconSlot>
              <EyeOff className="h-4 w-4" />
            </ContextMenuIconSlot>
            Remove from Chats
          </ContextMenuItem>
        )}
        items={items}
        onMarkChannelRead={onMarkChannelRead}
        onMarkChannelUnread={onMarkChannelUnread}
        projectMenuItems={projectMenuItems}
        unreadChannelIds={unreadChannelIds}
      >
        {/* The Chats place's own navigation, named as the other places' rails
            are; arrow keys move between its rows (railKeys). */}
        <nav
          aria-label="Chats"
          className="luca-shell-rail"
          data-shell-rail=""
          data-testid="chat-list"
          onClickCapture={(event) => {
            // A row of the rail opening something; folding a home (its
            // chevron, or Left and Right) opens nothing.
            if (
              event.target instanceof Element &&
              event.target.closest("[data-rail-focus], .luca-rail-row-add")
            )
              railClickAt.current = performance.now();
          }}
          onKeyDown={railKeys}
          ref={railRef}
        >
          <div className="luca-rail-section-head luca-rail-head type-eyebrow">
            <span>Chats</span>
            {/* Everything starts with Luca, one ongoing chat: the + opens
                it (WP-34, Decided 5). */}
            <button
              aria-label="Message Luca"
              className="luca-rail-add"
              data-testid="rail-message-luca"
              onClick={() =>
                homes.luca ? openHome(homes.luca) : onNewConversation()
              }
              title="Message Luca"
              type="button"
            >
              <Plus aria-hidden />
            </button>
          </div>
          {showNeeds ? (
            <NeedsYouRow
              active={needsOpen}
              count={needs.count}
              onOpen={() => {
                clearOpenSide();
                void goNeedsYou();
                onLeave?.();
              }}
            />
          ) : null}
          {homes.luca ? row(homes.luca) : null}
          <RailSection
            add={{
              label: "New project",
              onAdd: onCreateProject,
              testId: "create-channel",
            }}
            kind="project"
            title="Projects"
          >
            {homes.projects.map(row)}
            {/* Rooms in no project follow the projects, rows of their own
                (WP-34, Decided 1). */}
            {homes.rooms.map(row)}
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
          </RailSection>
          {homes.agents.length > 0 ? (
            <RailSection
              kind="agent"
              title="Agents"
              add={{
                label: "Browse agents",
                onAdd: () => {
                  void goAgents();
                  onLeave?.();
                },
                testId: "rail-browse-agents",
              }}
            >
              {homes.agents
                .filter((home) => {
                  const agent = agentsByPubkey.get(home.pubkey ?? "");
                  return railVisibility.isVisible(
                    agent ?? { pubkey: home.pubkey ?? "" },
                  );
                })
                .map(row)}
            </RailSection>
          ) : null}
          <RailSection
            add={{
              label: "Connect an app",
              onAdd: () => {
                // Which apps on this Mac show here: Settings → Appearance's
                // Apps list.
                void goSettings("appearance");
                onLeave?.();
              },
              testId: "rail-connect-app",
            }}
            kind="app"
            title="Apps"
          >
            {appHomes.map(row)}
          </RailSection>
        </nav>
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

const NO_SIDE_ROWS: RailSideRow[] = [];

/** A section of the rail: its name in sentence case (WP-34, Decided 8) and
 *  its `+`, where it has one, over its rows. */
function RailSection({
  add,
  children,
  kind,
  title,
}: {
  add?: { label: string; onAdd: () => void; testId: string };
  children: React.ReactNode;
  kind: "project" | "agent" | "app";
  title: string;
}) {
  return (
    <section
      aria-label={title}
      className="luca-rail-section"
      data-testid={`rail-section-${kind}`}
    >
      <div className="luca-rail-section-head type-eyebrow">
        <span>{title}</span>
        {add ? (
          <button
            aria-label={add.label}
            className="luca-rail-add"
            data-testid={add.testId}
            onClick={add.onAdd}
            title={add.label}
            type="button"
          >
            <Plus aria-hidden />
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** What needs you, above Luca while anything waits (WP-34, Decided 2): the
 *  hand, the name, and the count at the words' own ink and weight. It opens
 *  its page in the card, as Activity did. */
function NeedsYouRow({
  active,
  count,
  onOpen,
}: {
  active: boolean;
  count: number;
  onOpen: () => void;
}) {
  const note = needsYouNote(count);
  return (
    <div className="luca-rail-home" data-home-group="needs-you">
      <div
        className="luca-rail-row"
        data-active={active ? "true" : undefined}
        data-home="needs-you"
        data-home-kind="needs-you"
        data-sidebar="menu-button"
        data-testid="rail-needs-you"
      >
        <button
          aria-current={active ? "page" : undefined}
          aria-label={note ? `Needs you, ${note} waiting` : "Needs you"}
          className="luca-rail-row-hit"
          data-rail-focus="home"
          onClick={onOpen}
          title="Needs you"
          type="button"
        />
        <RowFace kind="icon">
          <Hand />
        </RowFace>
        <span aria-hidden className="luca-rail-row-name text-sm">
          Needs you
        </span>
        <span className="luca-rail-row-end">
          {note ? (
            <span
              aria-hidden
              className="luca-rail-needs text-sm"
              data-testid="rail-needs-you-count"
            >
              {note}
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
}

/** A row's face (WP-34, Decided 6): the agent mark for a mind, the maker's
 *  mark for an app, a line drawing for anything else. The row's name says
 *  who; the face is silent. */
function RowFace({
  children,
  kind,
}: {
  children: React.ReactNode;
  kind: "agent" | "app" | "icon";
}) {
  return (
    <span aria-hidden className="luca-rail-face" data-face={kind}>
      {children}
    </span>
  );
}

function homeFace(home: RailHome, working = false) {
  switch (home.kind) {
    case "luca":
    case "agent":
      // Each mind wears its own dendrite (WP-42); one not yet keyed keeps the agent mark.
      return (
        <RowFace kind="agent">
          {home.pubkey ? (
            <AgentDendrite
              group="rail"
              residentKey={home.pubkey}
              size={18}
              working={working}
            />
          ) : (
            <AgentMark />
          )}
        </RowFace>
      );
    case "app":
      return (
        <RowFace kind="app">
          <HarnessFace runtimeId={home.id.slice("app:".length)} size={16} />
        </RowFace>
      );
    case "project":
      return (
        <RowFace kind="icon">
          <Folder />
        </RowFace>
      );
    default:
      return (
        <RowFace kind="icon">
          <Hash />
        </RowFace>
      );
  }
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
  createdAtById,
  expanded,
  home,
  nests,
  onAdd,
  onOpen,
  onSession,
  onSide,
  onToggle,
  openSideId,
  selectedChannelId,
  side,
  unreadChannelIds,
  workingByChannelId,
}: {
  active: boolean;
  agent: AgentRailAgent | undefined;
  /** Whether the home has a session flow for its `+`. */
  canAdd: boolean;
  createdAtById: CreatedAtById;
  expanded: boolean;
  home: RailHome;
  /** Whether anything sits under it: an agent's or an app's work, or a
   *  project's rooms unless Settings puts them in a column. */
  nests: boolean;
  onAdd: (home: RailHome) => void;
  onOpen: (home: RailHome) => void;
  onSession: (channelId: string) => void;
  onSide: (row: RailSideRow) => void;
  onToggle: (open: boolean) => void;
  /** The side conversation open (WP-18): its row lit, no room's marked. */
  openSideId: string | null;
  selectedChannelId: string | null;
  /** The work handed to it (WP-34): an agent's exchanges, an app's tasks;
   *  none for any other home. */
  side: readonly RailSideRow[];
  unreadChannelIds: ReadonlySet<string>;
  workingByChannelId?: ReadonlyMap<string, { agentCount: number }>;
}) {
  // Luca is one chat (WP-34, Decided 3): its row speaks for the chat it
  // opens, never for sessions the rail no longer lists.
  const chats =
    home.kind === "luca"
      ? home.main
        ? [home.main]
        : []
      : home.main
        ? [home.main, ...home.sessions]
        : home.sessions;
  const unread = chats.some(
    (item) =>
      item.channel.id !== selectedChannelId &&
      unreadChannelIds.has(item.channel.id),
  );
  const nested = nests && (home.sessions.length > 0 || side.length > 0);
  // What the rail marks: the open conversation, unless a side conversation
  // is open in it (WP-18, Decided 1), when no room's row is marked.
  const marked = openSideId ? null : selectedChannelId;
  // The open side row always shows, as an open session does.
  const listed = React.useMemo(
    () =>
      openSideId
        ? side.map((row) =>
            row.id === openSideId && !row.live ? { ...row, live: true } : row,
          )
        : side,
    [openSideId, side],
  );
  // The latest three show, and the open one wherever it falls, and every
  // piece of work still going; the rest wait behind "N more",
  // which opens to the whole list and ends on "Show fewer".
  const [all, setAll] = React.useState(false);
  const { shown, hidden, total } = shownHomeEntries(
    home.sessions,
    listed,
    marked,
    all,
    createdAtById,
  );
  // "working…" is said once: by the session working, when it shows under
  // the open home, and by the home only for what you can't see (its own
  // conversation, a folded home's sessions, those behind "N more").
  const visible = new Set(
    nested && expanded
      ? shown.flatMap((entry) =>
          entry.kind === "chat" ? [entry.item.channel.id] : [],
        )
      : [],
  );
  const working = chats.reduce(
    (count, item) =>
      visible.has(item.channel.id)
        ? count
        : count + (workingByChannelId?.get(item.channel.id)?.agentCount ?? 0),
    0,
  );
  // Live work out of sight (the home folded, or behind "N more") is said on
  // the home: working… for a running task,
  // talking… for an exchange (review fix 12).
  const shownSide = new Set(
    nested && expanded
      ? shown.flatMap((entry) => (entry.kind === "side" ? [entry.row.id] : []))
      : [],
  );
  const hiddenLive = side.filter((row) => row.live && !shownSide.has(row.id));
  const sideWord = hiddenLive.some((row) => row.word === "working")
    ? "working"
    : hiddenLive.length > 0
      ? "talking"
      : null;
  // State words are lowercase, as the study and the Agents rail say them.
  // Only work in progress trails off: "waking…" and "working…" keep their
  // ellipsis; a status such as "needs attention" has none.
  const waking = Boolean(agent?.waking);
  const status = waking
    ? "waking"
    : agent?.lastError
      ? "needs attention"
      : null;
  const mainOpen =
    active &&
    !openSideId &&
    (home.main
      ? home.main.channel.id === marked
      : !home.sessions.some((item) => item.channel.id === marked));
  // The study's order: a status or "working…" first, then the unread dot.
  const signal = waking ? (
    <span className="luca-rail-working text-2xs">waking</span>
  ) : status ? (
    <StatusLabel>{status}</StatusLabel>
  ) : working > 0 ? (
    <WorkingLabel count={working} />
  ) : sideWord ? (
    <span className="luca-rail-working text-2xs">{sideWord}</span>
  ) : unread ? (
    <UnreadDot />
  ) : null;
  const sessionsId = `rail-sessions-${home.id}`;
  // "N more" and "Show fewer" each leave as they act, so the focus moves on:
  // to the first row "N more" revealed, or back to "N more" from "Show
  // fewer", and the keyboard never drops out of the rail.
  const sessionsRef = React.useRef<HTMLFieldSetElement>(null);
  const focusAfterToggle = React.useRef<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `all` is the trigger: the rows have just been drawn longer or shorter.
  React.useEffect(() => {
    const index = focusAfterToggle.current;
    if (index === null) return;
    focusAfterToggle.current = null;
    sessionsRef.current
      ?.querySelectorAll<HTMLElement>('[data-rail-focus="session"]')
      [index]?.focus();
  }, [all]);
  // Onboarding's travelling mark lands on Luca's name, beside its face.
  const nameRef = React.useRef<HTMLSpanElement>(null);
  usePublishFieldAnchor(nameRef, "app", home.kind === "luca");

  return (
    <div className="luca-rail-home" data-home-group={home.id}>
      <div
        className="luca-rail-row"
        data-active={active ? "true" : undefined}
        data-agent-pubkey={home.kind === "agent" ? home.pubkey : undefined}
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
            status ?? (working > 0 ? "working" : sideWord),
          ]
            .filter(Boolean)
            .join(", ")}
          className="luca-rail-row-hit"
          data-rail-focus="home"
          onClick={() => onOpen(home)}
          title={home.name}
          type="button"
        />
        {homeFace(home, working > 0)}
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
          aria-label={
            home.kind === "project"
              ? `${home.name}'s rooms`
              : `${home.name}'s sessions`
          }
          className="luca-rail-sessions"
          // A project's rooms hang on no thread (shell-rail.css).
          data-rooms={home.kind === "project" ? "" : undefined}
          hidden={!expanded}
          id={sessionsId}
          ref={sessionsRef}
        >
          {(expanded ? shown : []).map((entry, index) => {
            // The thread turns into the last row shown (shell-rail.css).
            const last = index === shown.length - 1 ? "true" : undefined;
            if (entry.kind === "side") {
              const row = entry.row;
              const lit = row.id === openSideId;
              const ago = row.shownAt
                ? relativeTime(new Date(row.shownAt).toISOString())
                : "";
              return (
                <button
                  aria-current={lit ? "page" : undefined}
                  aria-label={[row.label, row.word].filter(Boolean).join(", ")}
                  className="luca-rail-session text-lip"
                  data-current={lit ? "true" : undefined}
                  data-last={last}
                  data-rail-focus="session"
                  data-side-id={row.id}
                  data-side-row={row.live ? "live" : "quiet"}
                  data-testid={`rail-side-${row.id}`}
                  key={row.id}
                  onClick={() => onSide(row)}
                  title={row.label}
                  type="button"
                >
                  <span className="luca-rail-session-title">{row.label}</span>
                  {row.word === "paused" ? (
                    <StatusLabel>paused</StatusLabel>
                  ) : row.word ? (
                    <span className="luca-rail-working text-2xs">
                      {row.word}
                    </span>
                  ) : ago ? (
                    <span className="luca-rail-session-ago text-2xs">
                      {ago}
                    </span>
                  ) : null}
                </button>
              );
            }
            const item = entry.item;
            const current = item.channel.id === marked;
            const isUnread =
              item.channel.id !== selectedChannelId &&
              unreadChannelIds.has(item.channel.id);
            const busy = workingByChannelId?.get(item.channel.id)?.agentCount;
            const ago = relativeTime(activeAt(item, createdAtById));
            return (
              <button
                aria-current={current ? "page" : undefined}
                aria-label={[item.label, isUnread ? "unread" : null]
                  .filter(Boolean)
                  .join(", ")}
                className="luca-rail-session text-lip"
                data-channel-id={item.channel.id}
                data-current={current ? "true" : undefined}
                data-last={last}
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
                  focusAfterToggle.current = shown.length;
                setAll(true);
              }}
              type="button"
            >
              {hidden} more
            </button>
          ) : null}
          {expanded && all && total > 3 ? (
            <button
              aria-label={`Show fewer in ${home.name}`}
              className="luca-rail-session luca-rail-session-more text-xs"
              data-rail-focus="session"
              data-testid={`rail-fewer-${home.id}`}
              onClick={(event) => {
                // "N more" comes back after the latest rows (and the open
                // one, if it is further down).
                if (event.currentTarget === document.activeElement)
                  focusAfterToggle.current = shownHomeEntries(
                    home.sessions,
                    listed,
                    marked,
                    false,
                    createdAtById,
                  ).shown.length;
                setAll(false);
              }}
              type="button"
            >
              Show fewer
            </button>
          ) : null}
        </fieldset>
      ) : null}
    </div>
  );
}
import { openTaskWindow } from "@/features/exchange/openTaskWindow";
