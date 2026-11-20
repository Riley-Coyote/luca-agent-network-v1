/**
 * What The mind's frame is given (WP-50, Decided 2). Mnemos's own page asks
 * its server for `../data/life.json`, `../data/memories.json`,
 * `../data/pulse.json` and `../data/search.json`, and posts to `../act`. In
 * the app there is no server: each of its requests is answered here, only
 * from what the place already holds (the notebook as last read, and what
 * comes to the mind through the same session), and nothing it asks for
 * reaches the network. Its writes are always refused (every write stays in
 * the place's own acts), and so is its search (the place has its own).
 *
 * Pure but for `pulse`, which the place answers through its session.
 */
import type { BookLife } from "../book";
import type { NotebookMemories } from "../notebookLoad";

/** What the place holds for the frame, read afresh for each request. */
export type FeedHoldings = {
  life: BookLife;
  memories: NotebookMemories;
  /** What came to the mind since a moment (the engine's `pulse` part), as
   *  the engine gave it; null when the session couldn't say. */
  pulse: (since: string | null) => Promise<unknown | null>;
};

/** The frame's requests, by what they are. */
export type FeedKind =
  | "life"
  | "memories"
  | "pulse"
  | "search"
  | "act"
  | "other";

export type FeedAnswer = {
  kind: FeedKind;
  status: number;
  body: unknown;
  /** Answered from what the place holds, or refused. Either way, nothing
   *  left the app. */
  answered: "memory" | "refused";
};

/** The words the frame is given back when it asks to write or to search. */
export const REFUSED = {
  act: "Writes are made in the place, not here.",
  search: "The place has its own search.",
  other: "Nothing else is answered here.",
} as const;

/**
 * Which of the page's requests an address is. `root` is the folder the
 * page's `../` reaches (the copy's own root), so `data/life.json` under it
 * is the life document, and so on.
 */
export function kindOf(url: URL, root: URL): FeedKind {
  if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname))
    return "other";
  const rest = url.pathname.slice(root.pathname.length);
  if (rest === "data/life.json") return "life";
  if (rest === "data/memories.json") return "memories";
  if (rest === "data/pulse.json") return "pulse";
  if (rest === "data/search.json") return "search";
  if (rest === "act") return "act";
  return "other";
}

/** The life document as the frame is given it: the place's own reading,
 *  with no address for any picture (the page would load them for its paper,
 *  which the place doesn't show). */
export function lifeForFrame(life: BookLife): BookLife {
  return {
    ...life,
    studio: life.studio.map((item) => ({ ...item, picture: null })),
  };
}

/** One recall, as the engine logs it: which memory came back, and when. */
export type Recalled = [id: string, at: string];

/** The engine's log of recall, whole, where the place read it
 *  (`recalledLog`); a reading without it gives none. Anything not shaped
 *  as the engine writes it is left out. */
export function recalledOf(memories: NotebookMemories): Recalled[] {
  const log = (memories as { recalledLog?: unknown }).recalledLog;
  if (!Array.isArray(log)) return [];
  return log.filter(
    (entry): entry is Recalled =>
      Array.isArray(entry) &&
      entry.length >= 2 &&
      typeof entry[0] === "string" &&
      typeof entry[1] === "string",
  );
}

/** The memories document as the page reads it, its recall log included. */
export function memoriesForFrame(
  memories: NotebookMemories,
  made: string | null,
) {
  return {
    version: memories.version,
    made,
    memories: memories.memories,
    recalled: recalledOf(memories),
  };
}

const refused = (
  kind: FeedKind,
  status: number,
  body: unknown,
): FeedAnswer => ({
  kind,
  status,
  body,
  answered: "refused",
});

/** The answer to one of the frame's requests. */
export async function answerFeed(
  url: URL,
  method: string,
  root: URL,
  holdings: FeedHoldings | null,
): Promise<FeedAnswer> {
  const kind = kindOf(url, root);
  if (kind === "act") return refused(kind, 403, { error: REFUSED.act });
  if (kind === "search")
    return refused(kind, 403, { results: [], error: REFUSED.search });
  if (kind === "other" || method.toUpperCase() !== "GET")
    return refused(kind, 404, { error: REFUSED.other });
  // Not read yet (or let go): the page says it couldn't read its memory,
  // and asks again on its own.
  if (!holdings) return refused(kind, 503, { error: "Not read yet." });
  if (kind === "life")
    return {
      kind,
      status: 200,
      body: lifeForFrame(holdings.life),
      answered: "memory",
    };
  if (kind === "memories")
    return {
      kind,
      status: 200,
      body: memoriesForFrame(holdings.memories, holdings.life.made),
      answered: "memory",
    };
  const since = url.searchParams.get("since");
  const said = await holdings.pulse(since);
  if (!said) return refused(kind, 503, { error: "Not now." });
  return { kind, status: 200, body: said, answered: "memory" };
}

/** A count of the frame's requests, by kind and how each was answered. */
export type FeedLog = Record<FeedKind, { memory: number; refused: number }>;

export const emptyLog = (): FeedLog => ({
  life: { memory: 0, refused: 0 },
  memories: { memory: 0, refused: 0 },
  pulse: { memory: 0, refused: 0 },
  search: { memory: 0, refused: 0 },
  act: { memory: 0, refused: 0 },
  other: { memory: 0, refused: 0 },
});

/** The log in one line, for the frame's host to carry. */
export const logLine = (log: FeedLog) =>
  (Object.keys(log) as FeedKind[])
    .map((k) => `${k}:${log[k].memory}/${log[k].refused}`)
    .join(" ");
