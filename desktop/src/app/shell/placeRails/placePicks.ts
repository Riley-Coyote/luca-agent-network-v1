/**
 * Every place's pick, in the address (docs/luca/rail-system/NAVIGATION.md,
 * "The screen's rule"; SHELL_BUILD.md WP-10, Decided 7). The icons pick the
 * place, the rail lists what's in it, and the card shows the one row picked;
 * the row is in the address, so Back, Forward and reopening keep it.
 *
 * Pure: the address's own words in, a row's id out, and back again. The
 * rails (PlaceRail.tsx) and the cards (Agents, Activity, Library) read the
 * same functions, so they never disagree about what is picked.
 */

export type RailPlace = "agents" | "activity" | "library" | "brain" | "mnemos";

/** The address's words that say a place's pick. */
export const PICK_KEYS: Record<RailPlace, readonly string[]> = {
  agents: ["profile", "profilePersona", "group"],
  activity: ["stream", "record"],
  library: ["made", "skills", "deleted"],
  brain: ["view"],
  // The room is the pick; a new room starts with nothing opened in it.
  mnemos: ["room", "item"],
};

/** The words a pick sets; every other pick word of its place is cleared. */
export type PickParams = Record<string, string>;

type Search = Record<string, unknown>;

function word(search: Search, key: string): string | null {
  const value = search[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Activity's streams, by the row's id and the address's `stream` word:
 *  All activity, the record of what every mind and app did (WP-34,
 *  Decided 10; Needs you, Now and Side conversations before). */
export const ACTIVITY_STREAMS = ["all"] as const;

export type ActivityStream = (typeof ACTIVITY_STREAMS)[number];

/** Library's kinds, by the row's id, as the Library names them. */
export const LIBRARY_KINDS = [
  { id: "all", label: "All", kind: "all" },
  { id: "prototypes", label: "Prototypes", kind: "html" },
  { id: "apps", label: "Apps", kind: "app" },
  { id: "images", label: "Images", kind: "image" },
  { id: "documents", label: "Documents", kind: "markdown" },
  { id: "code", label: "Code", kind: "code" },
] as const;

/** Brain's two views, by the row's id and the address's `view` word
 *  (BETA14_RELEASE.md WP-38, Decided 2): its body's own Connections and
 *  Activity, as rows. */
export const BRAIN_VIEWS = [
  { id: "connections", label: "Connections" },
  { id: "activity", label: "Activity" },
] as const;

export type BrainViewId = (typeof BRAIN_VIEWS)[number]["id"];

/** A mind's rooms in the Mnemos place (WP-45, Decided 2), by the row's id
 *  and the address's `room` word, named as the notebook names them. */
/** The Mnemos place's sections, in the notebook's own order; Settings sits
 *  at the rail's foot (`foot`). */
export const MNEMOS_ROOMS = [
  { id: "glance", label: "At a glance" },
  { id: "log", label: "Log" },
  { id: "memories", label: "Memories" },
  { id: "shared", label: "Shared" },
  { id: "beliefs", label: "Beliefs" },
  { id: "questions", label: "Questions" },
  { id: "journal", label: "Journal" },
  { id: "notes", label: "Notes" },
  { id: "carrying", label: "Carrying forward" },
  { id: "hours", label: "Hours" },
  { id: "settings", label: "Settings", foot: true },
] as const;

export type MnemosRoomId = (typeof MNEMOS_ROOMS)[number]["id"];

export const isMnemosRoom = (value: unknown): value is MnemosRoomId =>
  MNEMOS_ROOMS.some((each) => each.id === value);

const isBrainView = (value: string | null): value is BrainViewId =>
  BRAIN_VIEWS.some((each) => each.id === value);

export type LibraryKindId = (typeof LIBRARY_KINDS)[number]["id"];
export type LibraryKind = (typeof LIBRARY_KINDS)[number]["kind"];

/** A row's id from the address, or null when it names none. */
export function pickIdOf(place: RailPlace, search: Search): string | null {
  if (place === "agents") {
    const profile = word(search, "profile");
    if (profile) return `mind:${profile.toLowerCase()}`;
    const persona = word(search, "profilePersona");
    if (persona) return `persona:${persona}`;
    const group = word(search, "group");
    if (group) return `group:${group}`;
    return null;
  }
  if (place === "activity") {
    const record = word(search, "record");
    if (record) return `record:${record.toLowerCase()}`;
    const stream = word(search, "stream");
    return stream && (ACTIVITY_STREAMS as readonly string[]).includes(stream)
      ? stream
      : null;
  }
  if (place === "brain") {
    const view = word(search, "view");
    return isBrainView(view) ? view : null;
  }
  if (place === "mnemos") {
    const room = word(search, "room");
    return isMnemosRoom(room) ? room : null;
  }
  if (word(search, "deleted") === "recently") return "deleted";
  const skills = word(search, "skills");
  if (skills) return skills === "all" ? "skills:all" : `skills:${skills}`;
  const made = word(search, "made");
  if (made && LIBRARY_KINDS.some((each) => each.id === made))
    return `made:${made}`;
  return null;
}

/** The address's words for a row. */
export function paramsOfPick(place: RailPlace, id: string): PickParams {
  const [head, ...rest] = id.split(":");
  const tail = rest.join(":");
  if (place === "agents") {
    if (head === "mind") return { profile: tail };
    if (head === "persona") return { profilePersona: tail };
    if (head === "group") return { group: tail };
    return {};
  }
  if (place === "activity") {
    if (head === "record") return { record: tail };
    return {
      stream: (ACTIVITY_STREAMS as readonly string[]).includes(id) ? id : "all",
    };
  }
  if (place === "brain") return { view: isBrainView(id) ? id : "connections" };
  if (place === "mnemos") return { room: isMnemosRoom(id) ? id : "glance" };
  // Words, never numbers: the router reads `1` in an address as a number.
  if (head === "deleted") return { deleted: "recently" };
  if (head === "skills") return { skills: tail || "all" };
  return { made: tail || "all" };
}

/** The next address for a pick: the place's other pick words cleared, the
 *  row's set. `alsoClear` names words a new pick starts without (an agent's
 *  open tab, say). */
export function searchForPick(
  place: RailPlace,
  previous: Search,
  id: string,
  alsoClear: readonly string[] = [],
): Search {
  const next: Search = { ...previous };
  for (const key of [...PICK_KEYS[place], ...alsoClear]) delete next[key];
  return { ...next, ...paramsOfPick(place, id) };
}

/** The row a place opens on, the first time (Decided 7): Agents, Luca;
 *  Activity, All activity (WP-34, Decided 10); Library, All; Brain,
 *  Connections (WP-38). Luca's row, before Luca is known, is the bare
 *  `luca`. */
export function firstPickId(place: RailPlace, lucaPubkey: string | null) {
  if (place === "agents")
    return lucaPubkey ? `mind:${lucaPubkey.toLowerCase()}` : "luca";
  if (place === "activity") return "all";
  if (place === "brain") return "connections";
  if (place === "mnemos") return "glance";
  return "made:all";
}

// ── each place's last pick, for the session ─────────────────────────────
// Kept in sessionStorage under the community, never in a module's memory,
// so nothing of one community outlives a switch to another.

const MEMORY_PREFIX = "luca-place-pick-v1";

function memoryKey(scope: string, place: RailPlace) {
  return `${MEMORY_PREFIX}:${scope}:${place}`;
}

export function readRememberedPick(
  storage: Pick<Storage, "getItem"> | null,
  scope: string,
  place: RailPlace,
): string | null {
  try {
    return storage?.getItem(memoryKey(scope, place)) ?? null;
  } catch {
    return null;
  }
}

export function rememberPick(
  storage: Pick<Storage, "setItem"> | null,
  scope: string,
  place: RailPlace,
  id: string,
) {
  try {
    storage?.setItem(memoryKey(scope, place), id);
  } catch {
    // Still picked; it just won't be remembered.
  }
}

/** What is picked: the address's row, else the place's last, else its
 *  first. */
export function resolvePickId(input: {
  place: RailPlace;
  search: Search;
  remembered: string | null;
  lucaPubkey: string | null;
}): string {
  return (
    pickIdOf(input.place, input.search) ??
    input.remembered ??
    firstPickId(input.place, input.lucaPubkey)
  );
}

// ── an agent's state word ───────────────────────────────────────────────

export type AgentStateInput = {
  /** A turn of theirs is running, or a runtime task they run (useMindState). */
  working: boolean;
  /** In a side conversation still going: an exchange with another mind
   *  (WP-18, Decided 2). */
  talking?: boolean;
  /** Being brought up (the Chats rail's "Waking"). */
  waking: boolean;
  lastError: string | null | undefined;
  availability:
    | "ready"
    | "started"
    | "working"
    | "idle"
    | "degraded"
    | "offline"
    | "failed";
};

/** A mind's one state (WP-18, Decided 2), said the same in the Agents rail,
 *  their head, their profile card and Now. */
export type MindStateWord =
  | "waking"
  | "needs attention"
  | "working"
  | "talking"
  | "off"
  | "resting";

/** The quiet word at an agent's row end (Decided 3), lowercase, as the
 *  study writes them: waking while they are brought up; needs attention for
 *  an error, or a degraded or failed agent; working while a turn of theirs
 *  or a runtime task of theirs runs; talking while a side conversation of
 *  theirs is still going (WP-18); off for a mind with no running process,
 *  stopped or never started (WP-25, Decided 3); resting for one that runs
 *  and is idle, however ready. */
export function agentStateWord(agent: AgentStateInput): MindStateWord {
  // The Chats rail's order (ShellRail.tsx): waking, then a problem, then
  // work in progress.
  if (agent.waking) return "waking";
  if (
    agent.lastError ||
    agent.availability === "degraded" ||
    agent.availability === "failed"
  )
    return "needs attention";
  if (agent.working) return "working";
  if (agent.talking) return "talking";
  // Not running (stopped, never deployed, or a persona only): it isn't
  // resting, which says it's alive; it's off, and every place says so.
  if (agent.availability === "idle" || agent.availability === "offline")
    return "off";
  return "resting";
}
