/**
 * A mind's days (NAVIGATION.md, "A mind's own space"; SHELL_BUILD.md WP-13,
 * Decided 3): one stream, newest first, by day, built from what the app
 * already holds about them. Nothing here is invented: every line is a
 * record's own verb and object, a page's own title and words, a note's own
 * first line, or an artifact's own title. Pure, so it is tested without
 * React.
 */

import { placeDayLabel } from "@/app/shell/placeRails/placeDays";

export type MindKind = "you" | "own" | "journal" | "memory";
export type MindFilter = "all" | MindKind;

/** The filters, in the study's order (`NOTEBOOK_FILTERS`). */
export const MIND_FILTERS: { id: MindFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "you", label: "For you" },
  { id: "own", label: "Their own" },
  { id: "journal", label: "Journal" },
  { id: "memory", label: "Memory" },
];

/** Each entry's kind, as its label says it (`KIND_LABEL`). */
export const MIND_KIND_LABEL: Record<MindKind, string> = {
  you: "For you",
  own: "Their own",
  journal: "Journal",
  memory: "Memory",
};

/** A notebook item, in the shape `listResidentNotebookItems` returns. */
export type StreamNotebookItem = {
  itemId: string;
  kind: "memory_note" | "journal_page" | "journal_annotation";
  status: string;
  authorship: "resident" | "owner";
  title: string | null;
  body: string;
  sourcePageIds: string[];
  createdAt: string;
};

/** A relay memory (engram): `createdAt` in Unix seconds. */
export type StreamEngram = { slug: string; body: string; createdAt: number };

/** A signed record: `createdAt` in Unix seconds. */
export type StreamRecord = {
  id: string;
  family: "speech" | "code" | "work" | "signal";
  verb: string;
  object: string | null;
  channelId: string | null;
  createdAt: number;
};

/** Something they made. */
export type StreamArtifact = {
  id: string;
  title: string;
  kind: string;
  summary: string | null;
  currentVersion: number;
  conversationId: string | null;
  createdAt: string;
};

export type MindEntry = {
  id: string;
  kind: MindKind;
  /** Milliseconds since the epoch. */
  at: number;
  text: string;
  /** A journal page's first lines, in the journal's voice. */
  excerpt?: string;
  /** Your notes on a journal page, with their page. */
  annotations?: string[];
  /** The notebook item this entry opens, when it is one. */
  notebookItemId?: string;
  made?: StreamArtifact;
  /** The conversation it happened in, when it was one: its room opens. */
  channelId?: string | null;
};

export type MindDay = { key: string; label: string; entries: MindEntry[] };

export type MindStreamInput = {
  notebook: readonly StreamNotebookItem[];
  engrams: readonly StreamEngram[];
  records: readonly StreamRecord[];
  artifacts: readonly StreamArtifact[];
  /** Conversations you are a member of: their records are For you. */
  memberChannelIds: ReadonlySet<string>;
  /** Conversation names, for "Talked in …". */
  channelNames: ReadonlyMap<string, string>;
};

/** A body's first line, plain: markdown heading marks and list bullets off. */
export function firstLine(body: string, max = 160): string {
  const line =
    body
      .split("\n")
      .map((each) =>
        each
          .replace(/^\s*#{1,6}\s+/, "")
          .replace(/^\s*[-*+]\s+/, "")
          .trim(),
      )
      .find((each) => each.length > 0) ?? "";
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}

/** A page's first lines, after its first line when that is a heading; its
 *  list items joined by " · ". */
export function firstLines(body: string, max = 220): string {
  let text = "";
  for (const raw of body.split("\n")) {
    if (/^\s*#{1,6}\s+/.test(raw)) continue;
    const item = /^\s*[-*+]\s+/.test(raw);
    const line = raw.replace(/^\s*[-*+]\s+/, "").trim();
    if (!line) continue;
    text = text ? `${text}${item ? " · " : " "}${line}` : line;
  }
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function dayKey(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/** A day's name, as every page that groups by day says it (placeDays.ts). */
export function dayLabel(at: number, now: number = Date.now()): string {
  return placeDayLabel(at, now);
}

/** What an empty Notebook says it holds (BETA14_RELEASE.md WP-37,
 *  Decided 2). */
export function emptyDaysLine(name: string): string {
  return `${name}'s days will gather here: what they do for you, their own work, their journal.`;
}

/** An entry's time of day. */
export function entryTime(at: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(at));
}

function isoMs(iso: string): number {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? 0 : at;
}

/** For you in a conversation you're a member of; anywhere else their own. */
export function forYouOrOwn(
  channelId: string | null,
  memberChannelIds: ReadonlySet<string>,
): "you" | "own" {
  return channelId && memberChannelIds.has(channelId) ? "you" : "own";
}

/** Every entry, newest first. */
export function buildMindEntries(input: MindStreamInput): MindEntry[] {
  const entries: MindEntry[] = [];
  const active = input.notebook.filter((item) => item.status === "active");

  // Journal: pages, with your annotations folded under their page.
  const annotationsByPage = new Map<string, string[]>();
  for (const item of active) {
    if (item.kind !== "journal_annotation") continue;
    for (const pageId of item.sourcePageIds) {
      const list = annotationsByPage.get(pageId) ?? [];
      list.push(firstLine(item.body));
      annotationsByPage.set(pageId, list);
    }
  }
  for (const item of active) {
    if (item.kind === "journal_page") {
      const title = item.title?.trim() || firstLine(item.body);
      const excerpt = item.title?.trim()
        ? firstLines(item.body)
        : firstLines(item.body.split("\n").slice(1).join("\n"));
      entries.push({
        id: `journal:${item.itemId}`,
        kind: "journal",
        at: isoMs(item.createdAt),
        text: title,
        excerpt: excerpt || undefined,
        annotations: annotationsByPage.get(item.itemId),
        notebookItemId: item.itemId,
      });
    } else if (item.kind === "memory_note") {
      entries.push({
        id: `note:${item.itemId}`,
        kind: "memory",
        at: isoMs(item.createdAt),
        text: `Kept: ${firstLine(item.body)}`,
        notebookItemId: item.itemId,
      });
    }
  }

  // Memory: the relay's engrams.
  for (const engram of input.engrams) {
    const line = firstLine(engram.body);
    if (!line) continue;
    entries.push({
      id: `engram:${engram.slug}`,
      kind: "memory",
      at: engram.createdAt * 1000,
      text: `Kept: ${line}`,
    });
  }

  // The signed record: code and work one by one; speech one line per
  // conversation per day; signals left out.
  const talk = new Map<
    string,
    { channelId: string | null; count: number; at: number }
  >();
  for (const record of input.records) {
    const at = record.createdAt * 1000;
    if (record.family === "signal") continue;
    if (record.family === "speech") {
      const key = `${record.channelId ?? ""}|${dayKey(at)}`;
      const group = talk.get(key);
      if (group) {
        group.count += 1;
        group.at = Math.max(group.at, at);
      } else talk.set(key, { channelId: record.channelId, count: 1, at });
      continue;
    }
    entries.push({
      id: `record:${record.id}`,
      kind: forYouOrOwn(record.channelId, input.memberChannelIds),
      at,
      text: record.object ? `${record.verb}: ${record.object}` : record.verb,
      channelId: record.channelId,
    });
  }
  for (const [key, group] of talk) {
    const name = group.channelId
      ? input.channelNames.get(group.channelId)
      : undefined;
    const where = name ? `Talked in ${name}` : "Talked in a conversation";
    entries.push({
      id: `talk:${key}`,
      kind: forYouOrOwn(group.channelId, input.memberChannelIds),
      at: group.at,
      text: `${where} · ${group.count} ${group.count === 1 ? "message" : "messages"}`,
      channelId: group.channelId,
    });
  }

  // What they made, as a receipt.
  for (const artifact of input.artifacts) {
    entries.push({
      id: `made:${artifact.id}`,
      kind: forYouOrOwn(artifact.conversationId, input.memberChannelIds),
      at: isoMs(artifact.createdAt),
      // Its own summary when it has one, else its title: the row's line.
      text: artifact.summary?.trim() || artifact.title,
      made: artifact,
    });
  }

  return entries.sort((left, right) => right.at - left.at);
}

/** The kinds that have anything in them: a filter with nothing hides. */
export function presentKinds(entries: readonly MindEntry[]): Set<MindKind> {
  return new Set(entries.map((entry) => entry.kind));
}

/** The stream for one filter, by day, newest first. */
export function groupMindDays(
  entries: readonly MindEntry[],
  filter: MindFilter,
  now: number = Date.now(),
): MindDay[] {
  const days: MindDay[] = [];
  for (const entry of entries) {
    if (filter !== "all" && entry.kind !== filter) continue;
    const key = dayKey(entry.at);
    let day = days[days.length - 1];
    if (!day || day.key !== key) {
      day = { key, label: dayLabel(entry.at, now), entries: [] };
      days.push(day);
    }
    day.entries.push(entry);
  }
  return days;
}

/**
 * The other minds in a room, as a Days talk entry names them (WP-43, Riley's
 * call on Works with): "A and B", "A, B and C", "A, B and 2 others".
 */
export function namesInRoom(names: readonly string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}
