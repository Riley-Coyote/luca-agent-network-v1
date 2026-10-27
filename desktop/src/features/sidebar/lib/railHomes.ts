import type { RoomProject } from "@/features/channels/lib/roomProjects";
import { normalizePubkey } from "@/shared/lib/pubkey";

import type { ChatListItem } from "./chatListModel";

/**
 * The Chats rail as homes (docs/luca/rail-system/SPEC.md, "One home per chat",
 * amended 2026-10-25): Luca, then Projects, Agents, People and Rooms. No React
 * and no assets, so the grouping is unit-tested under node.
 *
 * A chat's home is decided by what it is, not only by who is in it, and every
 * chat lands in exactly one home:
 *   1. a chat that belongs to a project lives under that project;
 *   2. a direct conversation with one agent (one of this Mac's agents, or anyone
 *      whose profile says it is an agent) is that agent's own conversation; your
 *      own with Luca is Luca's;
 *   3. a private room whose only other member is one agent is a session of that
 *      agent's (Luca's, for Luca);
 *   4. a direct conversation with one person is that person's row, under People;
 *   5. everything else is a room of its own, under Rooms, by its own name: an
 *      open room, a forum, a group conversation, a private room with several
 *      others or none. A group conversation with no name of its own is named by
 *      its members ("Luca + Wren").
 * Luca's side conversations (WP-14) are not chats: they are exchanges and
 * runtime tasks Luca took part in, shown among Luca's sessions by time
 * (`shownHomeEntries`), each opening the room where it happened.
 */

/** An `app` is a connected app's home (WP-34), made by the rail from the
 *  apps on this Mac, never by `buildRailHomes`. */
export type RailHomeKind =
  | "luca"
  | "project"
  | "agent"
  | "person"
  | "room"
  | "app";

export type RailHome = {
  /** Stable across renders and reloads: expansion is remembered by it. */
  id: string;
  kind: RailHomeKind;
  name: string;
  /** The home's own conversation, opened by the parent row and never listed
   *  under it: Luca's thread, an agent's or a person's 1:1, a room itself. */
  main: ChatListItem | null;
  /** Everything else in the home, newest first: the child rows. */
  sessions: ChatListItem[];
  /** Luca's, an agent's or a person's key (lowercase); null otherwise. */
  pubkey: string | null;
  /** A room's other members, lowercase and sorted; empty for every other kind. */
  members: string[];
  /** A room's members by name ("Luca + Wren"), whatever the room is called:
   *  its + starts a session with them. Empty for every other kind. */
  membersName: string;
  project: RoomProject | null;
  /** The newest activity anywhere in the home (ms), which orders it. */
  mostRecent: number;
};

export type RailHomes = {
  luca: RailHome | null;
  projects: RailHome[];
  agents: RailHome[];
  people: RailHome[];
  rooms: RailHome[];
};

export type RailHomeAgent = { name: string; pubkey: string };

/** When a chat was made, by id (ISO), for chats nothing has been said in. */
export type CreatedAtById = ReadonlyMap<string, string>;

/**
 * When a chat was last active: its last message, or, for a chat nothing has
 * been said in yet, when it was made, so a chat you just made comes first
 * instead of sinking below weeks-old ones. ISO, or null when neither is known.
 */
export function activeAt(
  item: ChatListItem,
  createdAtById?: CreatedAtById,
): string | null {
  return (
    item.channel.lastMessageAt ?? createdAtById?.get(item.channel.id) ?? null
  );
}

const activeMs = (item: ChatListItem, createdAtById?: CreatedAtById) => {
  const at = activeAt(item, createdAtById);
  return at ? Date.parse(at) || 0 : 0;
};

/** Newest first by activeAt; never-active chats last, by name. */
function byActivity(createdAtById?: CreatedAtById) {
  return (a: ChatListItem, b: ChatListItem) => {
    const at = activeMs(a, createdAtById);
    const bt = activeMs(b, createdAtById);
    return at !== bt ? bt - at : a.label.localeCompare(b.label);
  };
}

const membersOf = (item: ChatListItem) =>
  [...new Set(item.participants.map(normalizePubkey))].sort();

export const agentHomeId = (pubkey: string) =>
  `agent:${normalizePubkey(pubkey)}`;
export const personHomeId = (pubkey: string) =>
  `person:${normalizePubkey(pubkey)}`;
export const projectHomeId = (projectId: string) => `project:${projectId}`;
export const roomHomeId = (channelId: string) => `room:${channelId}`;

/** A direct conversation's stand-in name ("DM", "Group DM (3)"): not a name
 *  of its own, so the conversation is named by its members. */
export function isGenericDmChannelName(name: string) {
  const normalized = name.trim().toLowerCase();
  return (
    normalized.length === 0 ||
    normalized === "dm" ||
    normalized === "direct message" ||
    normalized === "direct messages" ||
    /^group dm\s*(\(\d+\))?$/.test(normalized)
  );
}

/** Which home a chat lives in, by the five rules above. */
export function homeIdOfChat(
  item: ChatListItem,
  {
    primaryPubkey,
    projectByChannelId,
    isAgent = () => false,
  }: {
    primaryPubkey: string | null;
    projectByChannelId: ReadonlyMap<string, RoomProject>;
    /** Whether a member (lowercase key) is an agent; Luca always is. */
    isAgent?: (pubkey: string) => boolean;
  },
): string {
  const project = projectByChannelId.get(item.channel.id);
  if (project) return projectHomeId(project.id);
  const members = membersOf(item);
  if (members.length === 1) {
    const other = members[0];
    const primary = primaryPubkey ? normalizePubkey(primaryPubkey) : null;
    const agent = other === primary || isAgent(other);
    const agentHome = other === primary ? "luca" : agentHomeId(other);
    const { channelType, visibility } = item.channel;
    if (channelType === "dm") return agent ? agentHome : personHomeId(other);
    if (channelType === "stream" && visibility === "private" && agent)
      return agentHome;
  }
  return roomHomeId(item.channel.id);
}

/** A 1:1 direct conversation with exactly this participant. */
const isDirectWith = (item: ChatListItem, pubkey: string) =>
  item.channel.channelType === "dm" &&
  membersOf(item).length === 1 &&
  membersOf(item)[0] === pubkey;

/** Split a home's chats into its own conversation and its sessions. */
function settle(
  home: RailHome,
  chats: ChatListItem[],
  createdAtById?: CreatedAtById,
) {
  const sorted = [...chats].sort(byActivity(createdAtById));
  let main: ChatListItem | null = null;
  if (home.kind === "room") {
    main = sorted[0] ?? null;
  } else if (home.kind !== "project" && home.pubkey) {
    const pubkey = home.pubkey;
    main = sorted.find((item) => isDirectWith(item, pubkey)) ?? null;
  }
  home.main = main;
  home.sessions = main ? sorted.filter((item) => item !== main) : sorted;
  home.mostRecent = sorted.reduce(
    (newest, item) => Math.max(newest, activeMs(item, createdAtById)),
    0,
  );
}

const byRecency = (a: RailHome, b: RailHome) =>
  a.mostRecent !== b.mostRecent
    ? b.mostRecent - a.mostRecent
    : a.name.localeCompare(b.name);

/**
 * Group the rail's chats into homes. `agents` is this Mac's resident list in
 * display order (Luca among them); `agentPubkeys` adds anyone else known to be
 * an agent (their profile says so); `projects` is the project catalog, so a
 * project with no rooms yet still has its row.
 */
export function buildRailHomes({
  items,
  agents,
  agentPubkeys,
  primaryPubkey,
  projects,
  projectByChannelId,
  names,
  createdAtById,
}: {
  items: readonly ChatListItem[];
  agents: readonly RailHomeAgent[];
  agentPubkeys?: ReadonlySet<string>;
  primaryPubkey: string | null;
  projects: readonly RoomProject[];
  projectByChannelId: ReadonlyMap<string, RoomProject>;
  /** Profile names by key (lowercase), for members who are not this Mac's
   *  agents and have no 1:1 to be named by. */
  names?: ReadonlyMap<string, string>;
  /** When each chat with no messages yet was made (see activeAt). */
  createdAtById?: CreatedAtById;
}): RailHomes {
  const primary = primaryPubkey ? normalizePubkey(primaryPubkey) : null;
  const agentNames = new Map(
    agents.map((agent) => [normalizePubkey(agent.pubkey), agent.name]),
  );
  const isAgent = (pubkey: string) =>
    agentNames.has(pubkey) || Boolean(agentPubkeys?.has(pubkey));
  const chatsByHome = new Map<string, ChatListItem[]>();
  for (const item of items) {
    const id = homeIdOfChat(item, {
      primaryPubkey: primary,
      projectByChannelId,
      isAgent,
    });
    const chats = chatsByHome.get(id);
    if (chats) chats.push(item);
    else chatsByHome.set(id, [item]);
  }
  const take = (id: string) => {
    const chats = chatsByHome.get(id) ?? [];
    chatsByHome.delete(id);
    return chats;
  };
  const home = (
    fields: Pick<RailHome, "id" | "kind" | "name"> & Partial<RailHome>,
  ): RailHome => ({
    main: null,
    sessions: [],
    pubkey: null,
    members: [],
    membersName: "",
    project: null,
    mostRecent: 0,
    ...fields,
  });

  // Luca: the primary resident's own home, above everything.
  let luca: RailHome | null = null;
  const lucaAgent = primary
    ? agents.find((agent) => normalizePubkey(agent.pubkey) === primary)
    : undefined;
  if (primary && lucaAgent) {
    luca = home({
      id: "luca",
      kind: "luca",
      name: lucaAgent.name,
      pubkey: primary,
    });
    settle(luca, take("luca"), createdAtById);
  } else {
    // No primary resident known yet: its chats wait under its agent home.
    const chats = take("luca");
    if (primary && chats.length > 0) {
      chatsByHome.set(agentHomeId(primary), [
        ...(chatsByHome.get(agentHomeId(primary)) ?? []),
        ...chats,
      ]);
    }
  }

  // Projects, in today's order: most recent first, then by name.
  const projectHomes = projects.map((project) => {
    const each = home({
      id: projectHomeId(project.id),
      kind: "project",
      name: project.label,
      project,
    });
    settle(each, take(each.id), createdAtById);
    return each;
  });
  projectHomes.sort(byRecency);

  // A member's name: an agent's own, else the label of their 1:1, else their
  // profile's.
  const nameOf = (pubkey: string) => {
    const known = agentNames.get(pubkey);
    if (known) return known;
    const direct = items.find((item) => isDirectWith(item, pubkey));
    return direct?.label ?? names?.get(pubkey) ?? null;
  };

  // Agents: every resident in display order, then any other agent by recency.
  const agentHomes: RailHome[] = [];
  for (const agent of agents) {
    const pubkey = normalizePubkey(agent.pubkey);
    if (pubkey === primary && luca) continue;
    const each = home({
      id: agentHomeId(pubkey),
      kind: "agent",
      name: agent.name,
      pubkey,
    });
    settle(each, take(each.id), createdAtById);
    agentHomes.push(each);
  }
  const otherAgents: RailHome[] = [];
  const people: RailHome[] = [];
  const rooms: RailHome[] = [];
  for (const [id, chats] of [...chatsByHome]) {
    chatsByHome.delete(id);
    if (id.startsWith("agent:") || id.startsWith("person:")) {
      const kind = id.startsWith("agent:") ? "agent" : "person";
      const pubkey = id.slice(id.indexOf(":") + 1);
      const each = home({ id, kind, name: "", pubkey });
      settle(each, chats, createdAtById);
      // Another agent's home is named after the agent, by its profile, never
      // by the title of the conversation you have with it (WP-19).
      const own = kind === "agent" ? names?.get(pubkey) : undefined;
      each.name =
        own ??
        nameOf(pubkey) ??
        each.main?.label ??
        each.sessions[0]?.label ??
        "";
      (kind === "agent" ? otherAgents : people).push(each);
    } else {
      const each = home({ id, kind: "room", name: "" });
      settle(each, chats, createdAtById);
      const chat = each.main;
      each.members = chat ? membersOf(chat) : [];
      each.membersName = membersName(each.members, nameOf, primary);
      // A room by its own name; a group conversation with no name of its own
      // by its members, until it is named.
      const unnamed =
        chat?.channel.channelType === "dm" &&
        isGenericDmChannelName(chat.channel.name) &&
        each.members.length > 0;
      each.name =
        (unnamed ? each.membersName : chat?.label) || each.membersName;
      rooms.push(each);
    }
  }
  otherAgents.sort(byRecency);
  people.sort(byRecency);
  rooms.sort(byRecency);

  return {
    luca,
    projects: projectHomes,
    agents: [...agentHomes, ...otherAgents],
    people,
    rooms,
  };
}

/** "Luca + Wren": Luca first, then the members by name. Members nobody can
 *  name are counted ("Luca + Wren + 1 other"), so a group is never named after
 *  one of its chats. */
export function membersName(
  members: readonly string[],
  nameOf: (pubkey: string) => string | null,
  primary: string | null,
) {
  const named = members.flatMap((pubkey) => {
    const name = nameOf(pubkey);
    return name ? [{ pubkey, name }] : [];
  });
  named.sort((a, b) =>
    a.pubkey === primary
      ? -1
      : b.pubkey === primary
        ? 1
        : a.name.localeCompare(b.name),
  );
  const unnamed = members.length - named.length;
  const parts = named.map((entry) => entry.name);
  if (unnamed > 0) {
    parts.push(
      named.length === 0
        ? `${unnamed} people`
        : `${unnamed} ${unnamed === 1 ? "other" : "others"}`,
    );
  }
  return parts.join(" + ");
}

/** Every home in the rail's order, Luca first. */
export function railHomeList(homes: RailHomes): RailHome[] {
  return [
    ...(homes.luca ? [homes.luca] : []),
    ...homes.projects,
    ...homes.agents,
    ...homes.people,
    ...homes.rooms,
  ];
}

/** The home whose chats include the open channel (or the selected project). */
export function activeRailHome(
  homes: RailHomes,
  selectedChannelId: string | null,
  selectedProjectId: string | null,
): RailHome | null {
  for (const each of railHomeList(homes)) {
    if (
      selectedChannelId &&
      (each.main?.channel.id === selectedChannelId ||
        each.sessions.some((item) => item.channel.id === selectedChannelId))
    )
      return each;
  }
  if (selectedProjectId) {
    return (
      homes.projects.find((each) => each.project?.id === selectedProjectId) ??
      null
    );
  }
  return null;
}

/**
 * The sessions a home shows (SPEC.md, "The latest few show"): its latest
 * three, newest first, and the open one wherever it falls; the rest wait
 * behind one quiet "N more" row. `all` shows every one.
 */
export function shownSessions(
  sessions: readonly ChatListItem[],
  selectedChannelId: string | null,
  all = false,
): { shown: ChatListItem[]; hidden: number } {
  if (all || sessions.length <= 3) return { shown: [...sessions], hidden: 0 };
  const latest = sessions.slice(0, 3);
  const open = sessions.find((item) => item.channel.id === selectedChannelId);
  const shown = open && !latest.includes(open) ? [...latest, open] : latest;
  return { shown, hidden: sessions.length - shown.length };
}

/** One of Luca's side conversations as the rail lists it (WP-14, Decided 6):
 *  "Atlas · Tidepool", "Claude Code · fix the build". */
export type RailSideRow = {
  id: string;
  label: string;
  /** When it last moved (ms): what orders it. */
  at: number;
  /** The time the row says, or null when none is known yet. */
  shownAt?: number | null;
  /** What it says in place of a time: talking…, working…, paused. */
  word?: "talking" | "working" | "paused" | null;
  /** Talking or working: it never folds away. */
  live: boolean;
  conversationId: string;
  /** Where it opens in its room: an exchange's first message. */
  messageId: string | null;
};

export type RailHomeEntry =
  | { kind: "chat"; item: ChatListItem }
  | { kind: "side"; row: RailSideRow };

/**
 * A home's sessions and side conversations in one list, newest first, as
 * `shownSessions` shows sessions: the latest three, the open one wherever it
 * falls, and (WP-14) every side conversation still talking; the rest wait
 * behind "N more". With no side conversations it is `shownSessions`.
 */
export function shownHomeEntries(
  sessions: readonly ChatListItem[],
  side: readonly RailSideRow[],
  selectedChannelId: string | null,
  all = false,
  createdAtById?: CreatedAtById,
): { shown: RailHomeEntry[]; hidden: number; total: number } {
  // Both lists are newest first already; merge, keeping each one's order.
  const sorted = [...side].sort((a, b) => b.at - a.at);
  const merged: RailHomeEntry[] = [];
  let c = 0;
  let s = 0;
  while (c < sessions.length || s < sorted.length) {
    const chat = sessions[c];
    const row = sorted[s];
    if (chat && (!row || activeMs(chat, createdAtById) >= row.at)) {
      merged.push({ kind: "chat", item: chat });
      c += 1;
    } else if (row) {
      merged.push({ kind: "side", row });
      s += 1;
    }
  }
  if (all || merged.length <= 3)
    return { shown: merged, hidden: 0, total: merged.length };
  const keep = new Set<RailHomeEntry>(merged.slice(0, 3));
  for (const entry of merged) {
    if (
      (entry.kind === "chat" && entry.item.channel.id === selectedChannelId) ||
      (entry.kind === "side" && entry.row.live)
    )
      keep.add(entry);
  }
  const shown = merged.filter((entry) => keep.has(entry));
  return { shown, hidden: merged.length - shown.length, total: merged.length };
}
