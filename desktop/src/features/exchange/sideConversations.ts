import { placeDayLabel } from "@/app/shell/placeRails/placeDays";
import type { ExchangePhase, ExchangeRecord } from "@/shared/api/types";
import type {
  RuntimeTaskProjection,
  RuntimeTaskState,
} from "@/shared/api/tauriRuntimeTasks";

/**
 * Side conversations: everything agents say to each other for you, as one
 * list (NAVIGATION.md, "Activity"; SHELL_BUILD.md WP-14, Decided 1). Two
 * real records feed it and nothing else: exchanges (kind 30178, a resident
 * asking another inside one of your rooms) and runtime tasks (a resident
 * running Claude Code or Codex for you). Pure, so it is unit-tested under
 * node; `useSideConversations` feeds it the app's live data.
 */

export type ExchangeWord = "talking" | "paused" | "closed" | "expired";
export type TaskWord =
  | "working"
  | "in the app"
  | "done"
  | "stopped"
  | "failed"
  | "interrupted";

type Common = {
  /** Stable across renders: the exchange's or the task's own id. */
  id: string;
  conversationId: string;
  /** When it last moved (ms): what orders the list and what the row says. */
  at: number;
  /** Still going: an exchange talking, a task working. */
  live: boolean;
};

export type ExchangeSide = Common & {
  kind: "exchange";
  ownerPubkey: string;
  openedBy: string;
  /** Everyone else in it, opener excluded, lowercase. */
  others: string[];
  members: string[];
  phase: ExchangePhase;
  word: ExchangeWord;
  /** Turns spoken, as the relay counts them; null before the first. */
  turns: number | null;
  /** The owner's message that started it: where it opens. */
  rootEventId: string;
  /** What `at` is: a turn's time, the first message's, or the deadline. */
  atFrom: "turn" | "root" | "deadline";
};

export type TaskSide = Common & {
  kind: "task";
  residentPubkey: string;
  runtimeFamily: RuntimeTaskProjection["runtimeFamily"];
  summary: string;
  state: RuntimeTaskState;
  word: TaskWord;
};

export type SideConversation = ExchangeSide | TaskSide;

export type ExchangeInput = {
  record: ExchangeRecord;
  spent: number;
  phase: ExchangePhase;
};

/** What the loaded messages say about an exchange: its latest turn and its
 *  first message, both in unix seconds. */
export type ExchangeTimes = { latestTurnAt?: number; rootAt?: number };

export function runtimeLabel(family: RuntimeTaskProjection["runtimeFamily"]) {
  return family === "codex" ? "Codex" : "Claude Code";
}

export function exchangeWord(phase: ExchangePhase): ExchangeWord {
  if (phase === "open") return "talking";
  if (phase === "paused") return "paused";
  return phase;
}

/** Transport lifecycle, not an inferred execution outcome. */
export function exchangeStatusLabel(phase: ExchangePhase | undefined): string {
  switch (phase) {
    case "open":
      return "Open";
    case "paused":
      return "Paused";
    case "closed":
      return "Closed";
    case "expired":
      return "Expired";
    default:
      return "Status unavailable";
  }
}

/** A bounded task subject from the actual brief; no participant-room title. */
export function exchangeTaskSubject(
  brief: string | null | undefined,
  recipient = "agent",
): string {
  const line = brief
    ?.split(/\r?\n/)
    .map((part) => part.trim())
    .find(Boolean)
    ?.replace(/^[#>*\s]+/, "")
    .replace(/^Task:\s*/i, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/\p{Cc}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!line) return `Conversation with ${recipient}`;
  return line.length > 96 ? `${line.slice(0, 95).trimEnd()}…` : line;
}

export function taskWord(state: RuntimeTaskState): TaskWord {
  switch (state) {
    case "queued":
    case "active":
    case "stopping":
      return "working";
    case "awaiting_native":
      return "in the app";
    case "succeeded":
      return "done";
    case "stopped":
      return "stopped";
    case "failed":
      return "failed";
    case "interrupted":
      return "interrupted";
  }
}

const ms = (iso: string | null | undefined) => {
  const at = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(at) ? at : 0;
};

/** One exchange as a side conversation. */
export function exchangeSide(
  entry: ExchangeInput,
  times: ExchangeTimes | undefined,
): ExchangeSide {
  const { record } = entry;
  const opener = record.openedBy.toLowerCase();
  const members = record.members.map((member) => member.toLowerCase());
  const atFrom = times?.latestTurnAt
    ? "turn"
    : times?.rootAt
      ? "root"
      : "deadline";
  const seconds =
    times?.latestTurnAt ?? times?.rootAt ?? Math.max(0, record.deadline);
  return {
    kind: "exchange",
    ownerPubkey: record.owner.toLowerCase(),
    id: record.exchangeId,
    conversationId: record.conversationId,
    at: seconds * 1000,
    atFrom,
    live: entry.phase === "open",
    openedBy: opener,
    others: members.filter((member) => member !== opener),
    members,
    phase: entry.phase,
    word: exchangeWord(entry.phase),
    turns: entry.spent > 0 ? entry.spent : null,
    rootEventId: record.rootEventId,
  };
}

/** One runtime task as a side conversation: it last moved when it finished,
 *  or when it last reported. */
export function taskSide(task: RuntimeTaskProjection): TaskSide {
  const word = taskWord(task.state);
  return {
    kind: "task",
    id: task.taskId,
    conversationId: task.conversationId,
    at: ms(task.completedAt) || ms(task.updatedAt) || ms(task.startedAt),
    live: word === "working",
    residentPubkey: task.residentPubkey.toLowerCase(),
    runtimeFamily: task.runtimeFamily,
    summary: task.summary,
    state: task.state,
    word,
  };
}

/** The time a row says, or null: an exchange known only by its deadline
 *  says no time, since the record keeps no opened-at and a deadline is not
 *  when anything was said (review fix 15). It still orders by it. */
export function shownAt(item: SideConversation): number | null {
  if (item.kind === "exchange" && item.atFrom === "deadline") return null;
  return item.at > 0 ? item.at : null;
}

/** The word a live or waiting side conversation says where a time would go
 *  (review fix 16): talking, working, paused; null for one at rest. */
export function sideLiveWord(
  item: SideConversation,
): "talking" | "working" | "paused" | null {
  if (item.kind === "task") return item.live ? "working" : null;
  if (item.live) return "talking";
  return item.phase === "paused" ? "paused" : null;
}

/** Every exchange and every runtime task, newest first. */
export function buildSideConversations({
  exchanges,
  tasks,
  times,
}: {
  exchanges: readonly ExchangeInput[];
  tasks: readonly RuntimeTaskProjection[];
  times?: ReadonlyMap<string, ExchangeTimes>;
}): SideConversation[] {
  const items: SideConversation[] = [
    ...exchanges.map((entry) =>
      exchangeSide(entry, times?.get(entry.record.exchangeId)),
    ),
    ...tasks.map(taskSide),
  ];
  return items.sort((a, b) =>
    a.at !== b.at ? b.at - a.at : a.id.localeCompare(b.id),
  );
}

/** A list of names as a person reads it: "Atlas", "Atlas and Wren",
 *  "Atlas, Wren and Mira". */
export function namesAsList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The row's sentence (Decided 5): "Luca asked Atlas", "Luca asked Claude
 *  Code". */
export function sideTitle(
  item: SideConversation,
  nameOf: (pubkey: string) => string,
): string {
  if (item.kind === "task")
    return `${nameOf(item.residentPubkey)} asked ${runtimeLabel(item.runtimeFamily)}`;
  const others = item.others.map(nameOf);
  return others.length > 0
    ? `${nameOf(item.openedBy)} asked ${namesAsList(others)}`
    : nameOf(item.openedBy);
}

/** "3 turns", "1 turn", or nothing before the first. */
export function turnsLabel(turns: number | null): string {
  if (!turns) return "";
  return turns === 1 ? "1 turn" : `${turns} turns`;
}

/** The feed by day (Decided 5), each day named as every page names one
 *  (placeDays.ts). */
export function sideDays<T extends { at: number }>(
  items: readonly T[],
  now: Date = new Date(),
  locale?: string,
): { key: string; label: string; items: T[] }[] {
  const days: { key: string; label: string; items: T[] }[] = [];
  for (const item of items) {
    const day = new Date(item.at);
    day.setHours(0, 0, 0, 0);
    const key = day.toISOString();
    const label = placeDayLabel(day, now, locale);
    const last = days[days.length - 1];
    if (last?.key === key) last.items.push(item);
    else days.push({ key, label, items: [item] });
  }
  return days;
}

/** Whether Luca took part: an exchange Luca opened or was asked into, a
 *  runtime task Luca ran. */
export function isLucas(item: SideConversation, luca: string): boolean {
  const key = luca.toLowerCase();
  return item.kind === "task"
    ? item.residentPubkey === key
    : item.openedBy === key || item.members.includes(key);
}

/** A side row under Luca in the Chats rail (Decided 6): "Atlas · Tidepool"
 *  for an exchange (the others, then the room), "Claude Code · <summary>"
 *  for a task. Under Luca's row the "with Luca" goes without saying. */
export function lucaRowLabel(
  item: SideConversation,
  luca: string,
  nameOf: (pubkey: string) => string,
  roomOf: (conversationId: string) => string,
): string {
  if (item.kind === "task")
    return `${runtimeLabel(item.runtimeFamily)} · ${item.summary}`;
  const key = luca.toLowerCase();
  const others = item.members.filter((member) => member !== key);
  const who = (others.length > 0 ? others : item.members).map(nameOf);
  const room = roomOf(item.conversationId);
  return room ? `${namesAsList(who)} · ${room}` : namesAsList(who);
}

/** The messages a room has loaded, read for its exchanges' times: each
 *  exchange's latest turn (a message tagged ["exchange", id, n]) and its
 *  first message (the record's root). Seconds. */
export function exchangeTimesFromMessages(
  messages: readonly {
    id: string;
    created_at: number;
    tags: readonly (readonly string[])[];
  }[],
  roots: ReadonlyMap<string, string>,
  into: Map<string, ExchangeTimes> = new Map(),
): Map<string, ExchangeTimes> {
  for (const message of messages) {
    const rootOf = roots.get(message.id.toLowerCase());
    if (rootOf) {
      const times = into.get(rootOf) ?? {};
      times.rootAt = message.created_at;
      into.set(rootOf, times);
    }
    for (const tag of message.tags) {
      if (tag[0] !== "exchange" || typeof tag[1] !== "string") continue;
      const id = tag[1].toLowerCase();
      const times = into.get(id) ?? {};
      times.latestTurnAt = Math.max(
        times.latestTurnAt ?? 0,
        message.created_at,
      );
      into.set(id, times);
      break;
    }
  }
  return into;
}
