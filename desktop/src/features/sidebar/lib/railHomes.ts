import type { RoomProject } from "@/features/channels/lib/roomProjects";
import { normalizePubkey } from "@/shared/lib/pubkey";

import { type ChatListItem, sortChats } from "./chatListModel";

/**
 * The shell's rail as homes (docs/luca/rail-system/SPEC.md, "One home per
 * chat"): Luca, then every place you talk, each holding its sessions. No React
 * and no assets, so the grouping is unit-tested under node.
 *
 * Every chat lands in exactly one home:
 *   1. a chat that belongs to a project lives under that project;
 *   2. otherwise a chat with more than one other participant (a group) lives
 *      under Fleets, one fleet per set of members;
 *   3. otherwise a chat with one participant lives under that agent (Luca's
 *      under Luca);
 *   4. a chat with one participant who is not in the agent list (a removed
 *      agent, a person) gets a home under Agents by that participant's name.
 * A room nobody else is in yet fits none of the four; it is listed under
 * Fleets by its own name, so it is never lost.
 */

export type RailHomeKind = "luca" | "project" | "agent" | "fleet";

export type RailHome = {
  /** Stable across renders and reloads: expansion is remembered by it. */
  id: string;
  kind: RailHomeKind;
  name: string;
  /** The home's own conversation, opened by the parent row and never listed
   *  under it: Luca's thread, an agent's 1:1, a fleet's group chat. */
  main: ChatListItem | null;
  /** Everything else in the home, newest first: the child rows. */
  sessions: ChatListItem[];
  /** Luca's, an agent's or the one person's key (lowercase); null otherwise. */
  pubkey: string | null;
  /** A fleet's members, lowercase and sorted; empty for every other kind. */
  members: string[];
  project: RoomProject | null;
  /** The newest activity anywhere in the home (ms), which orders fleets. */
  mostRecent: number;
};

export type RailHomes = {
  luca: RailHome | null;
  projects: RailHome[];
  agents: RailHome[];
  fleets: RailHome[];
};

export type RailHomeAgent = { name: string; pubkey: string };

const lastActive = (item: ChatListItem) =>
  item.channel.lastMessageAt ? Date.parse(item.channel.lastMessageAt) || 0 : 0;

const membersOf = (item: ChatListItem) =>
  [...new Set(item.participants.map(normalizePubkey))].sort();

export const agentHomeId = (pubkey: string) =>
  `agent:${normalizePubkey(pubkey)}`;
export const projectHomeId = (projectId: string) => `project:${projectId}`;
export const fleetHomeId = (members: readonly string[]) =>
  `fleet:${members.join("+")}`;

/** Which home a chat lives in, by the four rules above. */
export function homeIdOfChat(
  item: ChatListItem,
  {
    primaryPubkey,
    projectByChannelId,
  }: {
    primaryPubkey: string | null;
    projectByChannelId: ReadonlyMap<string, RoomProject>;
  },
): string {
  const project = projectByChannelId.get(item.channel.id);
  if (project) return projectHomeId(project.id);
  const members = membersOf(item);
  if (members.length > 1) return fleetHomeId(members);
  if (members.length === 1) {
    return primaryPubkey && members[0] === normalizePubkey(primaryPubkey)
      ? "luca"
      : agentHomeId(members[0]);
  }
  return `room:${item.channel.id}`;
}

/** A 1:1 direct conversation with exactly this participant. */
const isDirectWith = (item: ChatListItem, pubkey: string) =>
  item.channel.channelType === "dm" &&
  item.participants.length === 1 &&
  normalizePubkey(item.participants[0]) === pubkey;

/** Split a home's chats into its own conversation and its sessions. */
function settle(home: RailHome, chats: ChatListItem[]) {
  const sorted = sortChats(chats);
  let main: ChatListItem | null = null;
  if (home.kind === "luca" || home.kind === "agent") {
    const pubkey = home.pubkey;
    main = pubkey
      ? (sorted.find((item) => isDirectWith(item, pubkey)) ?? null)
      : null;
  } else if (home.kind === "fleet") {
    // The group chat itself, or the room that is the whole of a room home.
    main =
      sorted.find((item) => item.channel.channelType === "dm") ??
      (home.id.startsWith("room:") ? (sorted[0] ?? null) : null);
  }
  home.main = main;
  home.sessions = main ? sorted.filter((item) => item !== main) : sorted;
  home.mostRecent = sorted.reduce(
    (newest, item) => Math.max(newest, lastActive(item)),
    0,
  );
}

/**
 * Group the rail's chats into homes. `agents` is the resident list in display
 * order (Luca among them); `projects` is the project catalog, so a project with
 * no rooms yet still has its row.
 */
export function buildRailHomes({
  items,
  agents,
  primaryPubkey,
  projects,
  projectByChannelId,
}: {
  items: readonly ChatListItem[];
  agents: readonly RailHomeAgent[];
  primaryPubkey: string | null;
  projects: readonly RoomProject[];
  projectByChannelId: ReadonlyMap<string, RoomProject>;
}): RailHomes {
  const primary = primaryPubkey ? normalizePubkey(primaryPubkey) : null;
  const agentNames = new Map(
    agents.map((agent) => [normalizePubkey(agent.pubkey), agent.name]),
  );
  const chatsByHome = new Map<string, ChatListItem[]>();
  for (const item of items) {
    const id = homeIdOfChat(item, {
      primaryPubkey: primary,
      projectByChannelId,
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
    settle(luca, take("luca"));
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
    settle(each, take(each.id));
    return each;
  });
  projectHomes.sort((a, b) =>
    a.mostRecent !== b.mostRecent
      ? b.mostRecent - a.mostRecent
      : a.name.localeCompare(b.name),
  );

  // A person's name: the label of their 1:1, or of the newest chat with them.
  const nameOf = (pubkey: string) => {
    const known = agentNames.get(pubkey);
    if (known) return known;
    const direct = items.find((item) => isDirectWith(item, pubkey));
    return direct?.label ?? null;
  };

  // Agents: every resident in display order, then anyone else by recency.
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
    settle(each, take(each.id));
    agentHomes.push(each);
  }
  const others: RailHome[] = [];
  const fleets: RailHome[] = [];
  for (const [id, chats] of [...chatsByHome]) {
    chatsByHome.delete(id);
    if (id.startsWith("agent:")) {
      const pubkey = id.slice("agent:".length);
      const each = home({ id, kind: "agent", name: "", pubkey });
      settle(each, chats);
      each.name =
        nameOf(pubkey) ?? each.main?.label ?? each.sessions[0]?.label ?? "";
      others.push(each);
    } else if (id.startsWith("fleet:")) {
      const members = membersOf(chats[0]);
      const each = home({ id, kind: "fleet", name: "", members });
      settle(each, chats);
      each.name = fleetName(members, nameOf, primary, each);
      fleets.push(each);
    } else {
      // A room only the owner is in, under Fleets by its own name.
      const each = home({ id, kind: "fleet", name: chats[0]?.label ?? "" });
      settle(each, chats);
      fleets.push(each);
    }
  }
  const byRecency = (a: RailHome, b: RailHome) =>
    a.mostRecent !== b.mostRecent
      ? b.mostRecent - a.mostRecent
      : a.name.localeCompare(b.name);
  others.sort(byRecency);
  fleets.sort(byRecency);

  return {
    luca,
    projects: projectHomes,
    agents: [...agentHomes, ...others],
    fleets,
  };
}

/** "Luca + Wren": Luca first, then the members by name. A group chat without
 *  a name shows its members until it is named; when a member can't be named,
 *  the group chat's own label stands in. */
function fleetName(
  members: readonly string[],
  nameOf: (pubkey: string) => string | null,
  primary: string | null,
  home: RailHome,
) {
  const names = members.map((pubkey) => ({ pubkey, name: nameOf(pubkey) }));
  if (names.every((entry) => entry.name)) {
    return names
      .sort((a, b) =>
        a.pubkey === primary
          ? -1
          : b.pubkey === primary
            ? 1
            : (a.name ?? "").localeCompare(b.name ?? ""),
      )
      .map((entry) => entry.name)
      .join(" + ");
  }
  return home.main?.label ?? home.sessions[0]?.label ?? "Group";
}

/** Every home in the rail's order, Luca first. */
export function railHomeList(homes: RailHomes): RailHome[] {
  return [
    ...(homes.luca ? [homes.luca] : []),
    ...homes.projects,
    ...homes.agents,
    ...homes.fleets,
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
