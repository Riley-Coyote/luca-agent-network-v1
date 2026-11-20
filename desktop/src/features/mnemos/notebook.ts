/**
 * The notebook's own small rules, for the Mnemos place: threads of notes and
 * what waits on you (Mnemos `shared/words.js` `waiting`, the Ghost lab's
 * `threads`), memories newest first from a list the engine gives oldest
 * first, the days a mind kept something, and the words the notebook uses
 * (`words.js` @ 8ca8e76: `titleOf`, `firstLine`, `modelName`). Pure, so each
 * is tested without React.
 */
import type { PlaceMind } from "./api";
import type { BookMemory, BookMemoryFacts, BookNote } from "./book";

/** The notes, gathered into threads by what each answers: each thread's
 *  notes oldest first, and the thread with the newest word first. */
export type Thread = {
  id: string;
  notes: BookNote[];
  last: BookNote;
  /** Its last word is the mind's and ends in a question: it waits on you. */
  waits: boolean;
};

const time = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(t) ? 0 : t;
};

export function threads(notes: readonly BookNote[]): Thread[] {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const root = (n: BookNote) => {
    let x = n;
    for (let i = 0; i < 50 && x.replyTo && byId.has(x.replyTo); i++)
      x = byId.get(x.replyTo) as BookNote;
    return x.id;
  };
  const groups = new Map<string, BookNote[]>();
  for (const n of notes) {
    const r = root(n);
    const list = groups.get(r) ?? [];
    list.push(n);
    groups.set(r, list);
  }
  return [...groups.entries()]
    .map(([id, list]) => {
      const sorted = [...list].sort((a, b) => time(a.at) - time(b.at));
      const last = sorted[sorted.length - 1] as BookNote;
      return {
        id,
        notes: sorted,
        last,
        waits: last.author === "agent" && /\?\s*$/.test(last.text.trim()),
      };
    })
    .sort((a, b) => time(b.last.at) - time(a.last.at));
}

/** What waits on you, newest first: threads whose last note is the mind's
 *  and ends in a question. */
export function waitingOnYou(list: readonly Thread[]): Thread[] {
  return list.filter((t) => t.waits);
}

/** Whether a note of the mind's hasn't been read yet, by the engine's own
 *  `read` (the place never marks one read). */
export const unread = (note: BookNote) => note.author === "agent" && !note.read;

/** Page `page` (0 first) of a list the engine gives oldest first, asked from
 *  its end so the newest come first; null past the oldest. */
export function newestFirstPage(
  total: number,
  page: number,
  size: number,
): { offset: number; limit: number } | null {
  const end = total - page * size;
  if (end <= 0 || size <= 0 || page < 0) return null;
  const offset = Math.max(0, end - size);
  return { offset, limit: end - offset };
}

/** A page of memories as the engine gave it (oldest first), newest first. */
export const newestFirst = (page: readonly BookMemory[]) => [...page].reverse();

/** A day's key, in the viewer's own time zone: YYYY-MM-DD. */
export function dayKey(at: Date): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, "0");
  const d = String(at.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** How many memories were kept each day, added to `into` (counts only:
 *  never a word of them). */
export function countPerDay(
  memories: readonly Pick<BookMemory, "born">[],
  into: Map<string, number> = new Map(),
): Map<string, number> {
  for (const m of memories) {
    if (!m.born) continue;
    const at = new Date(m.born);
    if (Number.isNaN(at.getTime())) continue;
    const key = dayKey(at);
    into.set(key, (into.get(key) ?? 0) + 1);
  }
  return into;
}

/** Every day from the first one that kept something to `today`, with its
 *  count (0 for a day that kept nothing), as the lab's day line. */
export function dayLine(
  counts: ReadonlyMap<string, number>,
  today: Date = new Date(),
): { key: string; count: number }[] {
  const keys = [...counts.keys()].sort();
  if (!keys.length) return [];
  const [y, m, d] = (keys[0] as string).split("-").map(Number);
  const line: { key: string; count: number }[] = [];
  const last = dayKey(today);
  for (
    let at = new Date(y as number, (m as number) - 1, d as number);
    dayKey(at) <= last && line.length < 20_000;
    at = new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1)
  ) {
    const key = dayKey(at);
    line.push({ key, count: counts.get(key) ?? 0 });
  }
  return line;
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** The day of a mind's newest memory, said as the head says it. */
export function newestWords(newest: string | null, today = new Date()) {
  if (!newest) return null;
  const [y, m, d] = newest.split("-").map(Number);
  const day = new Date(y as number, (m as number) - 1, d as number);
  if (Number.isNaN(day.getTime())) return null;
  if (dayKey(day) === dayKey(today)) return "newest today";
  const yesterday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - 1,
  );
  if (dayKey(day) === dayKey(yesterday)) return "newest yesterday";
  return `newest ${day.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: day.getFullYear() === today.getFullYear() ? undefined : "numeric",
  })}`;
}

/** Who remembers with a mind, in a breath: "Luca remembers with this". */
export function linkedWords(mind: Pick<PlaceMind, "linked">) {
  const names = mind.linked.map((r) => r.name);
  if (!names.length) return null;
  const who =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${who} remember${names.length === 1 ? "s" : ""} with this`;
}

/** The head's state line, from real numbers only:
 *  "2,804 memories it can reach · newest today · Luca remembers with this". */
export function stateLine(
  mind: Pick<PlaceMind, "memories" | "newest" | "linked">,
  today = new Date(),
): string {
  return [
    `${plural(mind.memories, "memory", "memories")} it can reach`,
    newestWords(mind.newest, today),
    linkedWords(mind),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The rail's one line under the mind's name: its numbers. */
export function railLine(
  mind: Pick<PlaceMind, "memories" | "newest">,
  today = new Date(),
): string {
  return [
    plural(mind.memories, "memory", "memories"),
    newestWords(mind.newest, today),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** An entry's title is its own first sentence (or first line); what follows
 *  is its body (`words.js` `titleOf`). */
export function titleOf(text: string): { title: string; body: string } {
  const t = (text || "").trim();
  const line = t.split("\n")[0] ?? "";
  const sentence = line.match(/^(.{1,160}?[.!?…]["'’”)\]]*)(?=\s|$)/);
  let title = sentence
    ? (sentence[1] as string)
    : line.length <= 120
      ? line
      : "";
  if (!title) {
    const clause = line.slice(0, 110).match(/^(.{24,}?[,:;—])\s/);
    // Cut at the last word that starts before 90; a first word longer
    // than that is the title whole (`words.js` cut it to all but its last
    // letter, leaving that letter alone as the body).
    const space = line.lastIndexOf(" ", 90);
    title = clause
      ? (clause[1] as string)
      : space > 0
        ? line.slice(0, space)
        : line;
  }
  return { title, body: t.slice(title.length).trim() };
}

/** The first line with words, cut at a word near `n` (`words.js`). */
export function firstLine(text: string, n = 140): string {
  const s = (text || "").split("\n").find((l) => l.trim()) ?? "";
  return s.length > n ? `${s.slice(0, s.lastIndexOf(" ", n))}…` : s;
}

/** A model's name as Mnemos names it: claude-opus-5-5 is Opus 5.5. */
export function modelName(model: string | null | undefined): string {
  const m = (model || "")
    .replace(/\[[^\]]*\]$/, "")
    .split("/")
    .pop()
    ?.replace(/-\d{8}$/, "");
  if (!m) return model || "";
  let x = m.match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?$/);
  if (x)
    return `${(x[1] as string)[0]?.toUpperCase()}${(x[1] as string).slice(1)} ${x[2]}${x[3] ? `.${x[3]}` : ""}`;
  x = m.match(/^claude-(\d+)(?:-(\d{1,2}))?-([a-z]+)$/);
  if (x)
    return `${(x[3] as string)[0]?.toUpperCase()}${(x[3] as string).slice(1)} ${x[1]}${x[2] ? `.${x[2]}` : ""}`;
  return model || "";
}

/** How a search result was found, as the notebook says it. */
export function foundWords(found: string): string {
  if (found === "meaning") return "by meaning";
  if (found === "words") return "by its words";
  return "through a link";
}

/** Who wrote a memory (`words.js` `signedBy`). Where the engine doesn't say
 *  which model signed it (`model` absent, as today's interface gives it), an
 *  agent's memory is said to be the mind's own. */
export function signedBy(
  m: Pick<BookMemory, "author" | "model">,
  who: { name: string; model?: string },
): string {
  if (m.author === "person") return "in your words";
  if (m.model && who.model && modelName(m.model) === modelName(who.model))
    return `signed ${who.name}`;
  if (m.model) return `written by ${modelName(m.model)}, a colleague`;
  if (m.author === "agent")
    return m.model === undefined
      ? `written by ${who.name}`
      : `written by ${who.name} before memories were signed`;
  if (m.author === "tool") return "brought in by a tool";
  return "no one can say who wrote it";
}

/** How a memory stands, in the notebook's words. */
export function stateWords(state: BookMemory["state"]): string {
  if (state === "dormant") return "gone quiet";
  if (state === "archived") return "let go";
  return "it can reach";
}

/** Where an entry was written, in the notebook's words (`room.js`). */
export const writtenWords = (written: string) =>
  written === "between_sessions"
    ? "written between conversations"
    : "written in conversation";

/** The rooms' filters over memories: those gone quiet. */
export const goneQuiet = (list: readonly BookMemory[]) =>
  list.filter((m) => m.state === "dormant");

/** The longest note, answer or correction Mnemos keeps, in characters. */
export const MAX_TEXT = 16_384;
/** From here on, the field says how many characters are left. */
export const NEAR_LIMIT = 15_000;

/** What a field of the person's words may do, by what's in it: the count
 *  only near the limit, and no sending past it or with nothing said. */
export function fieldState(text: string): {
  count: string | null;
  over: boolean;
  canSend: boolean;
} {
  const n = [...text].length;
  const over = n > MAX_TEXT;
  const count =
    n < NEAR_LIMIT
      ? null
      : over
        ? `${(n - MAX_TEXT).toLocaleString("en-US")} over`
        : `${(MAX_TEXT - n).toLocaleString("en-US")} left`;
  return { count, over, canSend: !over && text.trim().length > 0 };
}

/** The notes after one of the person's was kept: added once, by its id,
 *  and the note it answers read, as the engine marks it on a reply. */
export function withNote(
  notes: readonly BookNote[],
  note: BookNote,
): BookNote[] {
  const marked = notes.map((n) =>
    note.replyTo && n.id === note.replyTo && !n.read
      ? { ...n, read: note.at ?? new Date().toISOString() }
      : n,
  );
  return marked.some((n) => n.id === note.id) ? marked : [note, ...marked];
}

/** The memory's numbers after one was let go: one fewer where it was, one
 *  more let go. */
export function afterLetGo(
  facts: BookMemoryFacts,
  from: BookMemory["state"],
): BookMemoryFacts {
  if (from === "archived") return facts;
  return {
    ...facts,
    states: {
      ...facts.states,
      [from]: Math.max(0, facts.states[from] - 1),
      archived: facts.states.archived + 1,
    },
  };
}
