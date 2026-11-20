/**
 * The one place the `mnemos interface` (0.6.7) and the old reader's answers
 * become the notebook's own shapes (`book.ts`). Nothing else reads a `Wire*`
 * shape or a `ViewItem`; when Mnemos gives the notebook itself, only this
 * file changes.
 */
import type { ViewItem } from "@/shared/api/mnemosView";
import type {
  PlaceReply,
  PlaceRequest,
  PlaceWrite,
  WireEntry,
  WireFound,
  WireMemory,
  WireNote,
  WireState,
  WireWritten,
} from "./api";
import type {
  BookBelief,
  BookEntry,
  BookFound,
  BookHandoff,
  BookMemory,
  BookMemoryFacts,
  BookNote,
  MemoryAuthor,
  MemoryState,
} from "./book";

const STATES: readonly MemoryState[] = ["active", "dormant", "archived"];
const AUTHORS: readonly MemoryAuthor[] = ["agent", "person", "tool", "unknown"];

const time = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(t) ? 0 : t;
};

export function memoryOf(m: WireMemory): BookMemory {
  return {
    id: m.id,
    born: m.kept,
    content: m.words,
    impact: m.impact ?? "",
    state: STATES.includes(m.state as MemoryState)
      ? (m.state as MemoryState)
      : "active",
    author: AUTHORS.includes(m.author as MemoryAuthor)
      ? (m.author as MemoryAuthor)
      : "unknown",
    acc: m.alive,
    corrected: m.corrected,
  };
}

export function foundOf(f: WireFound): BookFound {
  return {
    memory: { id: f.id, born: f.kept, content: f.words },
    closeness: f.closeness,
    found: f.found,
  };
}

export function entryOf(e: WireEntry): BookEntry {
  return {
    id: e.id,
    at: e.created_at,
    text: e.text,
    mood: e.mood ?? "",
    written: e.written ?? "",
    model: e.model ?? "",
  };
}

export function noteOf(n: WireNote): BookNote {
  return {
    id: n.id,
    at: n.created_at,
    kind: n.kind ?? "",
    text: n.text,
    author: n.author,
    model: n.model ?? "",
    replyTo: n.in_reply_to ?? "",
    delivered: n.delivered_at ?? null,
    read: n.read_at,
  };
}

/** A memory the old reader lists as standing: words and a day only. */
export type BookStanding = { text: string; at: string | null };

export const standingOf = (item: ViewItem): BookStanding => ({
  text: item.text,
  at: item.at ?? null,
});

export const beliefOf = (item: ViewItem): BookBelief => ({
  text: item.text,
  confidence: item.confidence,
  born: item.at ?? null,
});

export const handoffOf = (item: ViewItem): BookHandoff => ({
  text: item.text,
  at: item.at ?? null,
});

/** Asks the open mind one reading request (the session's own `read`). */
export type Ask = (request: PlaceRequest) => Promise<PlaceReply>;

/** Sends the open mind one of the person's writes, once. */
export type Send = (write: PlaceWrite) => Promise<WireWritten>;

/** Why a write didn't happen, as the field says it. */
export type WriteFailure =
  /** Mnemos said no in its own words (a quiet hour, a note too long). */
  | { kind: "said"; said: string }
  /** Someone else is writing to the store just now. */
  | { kind: "busy" }
  /** Mnemos didn't answer in time, and a look found nothing saved. */
  | { kind: "unanswered" }
  /** Mnemos didn't answer in time, and the look couldn't be made. */
  | { kind: "unchecked" }
  | { kind: "failed"; code: string };

/** A write's error, as the place's command gives it. */
export function writeFailure(error: unknown): WriteFailure {
  const told = error instanceof Error ? error.message : String(error);
  const refused = "mnemos_refused:";
  if (told.startsWith(refused))
    return { kind: "said", said: told.slice(refused.length) };
  if (told === "mnemos_busy") return { kind: "busy" };
  return { kind: "failed", code: told };
}

/** A memory's new version, after the person corrected it. */
export type BookCorrected = {
  id: string;
  replaces: string;
  corrected: string | null;
};

function expect<K extends PlaceReply["kind"]>(
  reply: PlaceReply,
  kind: K,
): Extract<PlaceReply, { kind: K }> {
  if (reply.kind !== kind) throw new Error("invalid_reply");
  return reply as Extract<PlaceReply, { kind: K }>;
}

/** The notebook, read through the interface, in the notebook's shapes. */
export function bookOf(ask: Ask) {
  return {
    /** The memory's numbers, with no words at all. */
    async facts(): Promise<BookMemoryFacts> {
      const reply = expect(
        await ask({ command: "memories", limit: 0, offset: 0 }),
        "memories",
      );
      return { states: reply.counts };
    },
    /** A page of memories as the engine lists them (oldest first), and the
     *  memory's numbers. */
    async memories(page: {
      state?: WireState;
      limit: number;
      offset: number;
    }): Promise<{ memories: BookMemory[]; facts: BookMemoryFacts }> {
      const reply = expect(
        await ask({ command: "memories", ...page }),
        "memories",
      );
      return {
        memories: reply.memories.map(memoryOf),
        facts: { states: reply.counts },
      };
    },
    async search(query: string): Promise<BookFound[]> {
      const reply = expect(await ask({ command: "search", query }), "search");
      return reply.results.map(foundOf);
    },
    /** The newest entries, newest first (as the notebook lists them). */
    async journal(last: number): Promise<BookEntry[]> {
      const reply = expect(await ask({ command: "journal", last }), "journal");
      return reply.entries.map(entryOf).sort((a, b) => time(b.at) - time(a.at));
    },
    /** Every note, newest first. Reading marks nothing read. */
    async notes(): Promise<BookNote[]> {
      const reply = expect(await ask({ command: "notes" }), "notes");
      return reply.notes.map(noteOf).sort((a, b) => time(b.at) - time(a.at));
    },
  };
}

export type Book = ReturnType<typeof bookOf>;

/** The most memories a look after a timeout reads at once. */
const LOOK_PAGE = 100;

/** Whether a write timed out: Mnemos may have saved it or not. */
const timedOut = (failure: WriteFailure) =>
  failure.kind === "failed" && failure.code === "mnemos_timeout";

/** Every memory it can reach, a page at a time (a look after a timeout). */
async function everyMemory(book: Book): Promise<BookMemory[]> {
  const facts = await book.facts();
  const total = facts.states.active + facts.states.dormant;
  const all: BookMemory[] = [];
  for (let offset = 0; offset < total; offset += LOOK_PAGE) {
    const got = await book.memories({ limit: LOOK_PAGE, offset });
    all.push(...got.memories);
    if (got.memories.length < LOOK_PAGE) break;
  }
  return all;
}

const same = (a: string, b: string) => a.trim() === b.trim();

/** The person's writes, in the notebook's shapes. Each is sent once; a
 *  failure throws a `WriteFailure`. A write that timed out may have been
 *  saved: before anything is said, `ask` looks for it. Found, it is the
 *  answer; not found, nothing was saved (`unanswered`); the look failing
 *  says so (`unchecked`). Nothing is sent again by itself. */
export function writesOf(send: Send, ask: Ask) {
  const book = bookOf(ask);
  const once = async <T>(
    write: PlaceWrite,
    look: () => Promise<T | null>,
  ): Promise<WireWritten | { looked: T }> => {
    try {
      return await send(write);
    } catch (error) {
      const failure = writeFailure(error);
      if (!timedOut(failure)) throw failure;
    }
    let found: T | null;
    try {
      found = await look();
    } catch {
      throw { kind: "unchecked" } satisfies WriteFailure;
    }
    if (found === null) throw { kind: "unanswered" } satisfies WriteFailure;
    return { looked: found };
  };
  /** The person's note with these words, answering `replyTo`, written
   *  since `since`. */
  const noteLook = (text: string, replyTo: string, since: number) => async () =>
    (await book.notes()).find(
      (n) =>
        n.author === "person" &&
        n.replyTo === replyTo &&
        same(n.text, text) &&
        time(n.at) >= since - 60_000,
    ) ?? null;
  const asNote = (written: WireWritten | { looked: BookNote }): BookNote => {
    if ("looked" in written) return written.looked;
    return noted(written);
  };
  const noted = (written: WireWritten): BookNote => {
    if (written.kind !== "note")
      throw { kind: "failed", code: "invalid_reply" } satisfies WriteFailure;
    return noteOf(written.note);
  };
  return {
    /** Answer one of the mind's notes. */
    async reply(noteId: string, text: string): Promise<BookNote> {
      const since = Date.now();
      return asNote(
        await once(
          { command: "reply", note_id: noteId, text },
          noteLook(text, noteId, since),
        ),
      );
    },
    /** Leave the mind a note of the person's own. */
    async note(text: string): Promise<BookNote> {
      const since = Date.now();
      return asNote(
        await once({ command: "note", text }, noteLook(text, "", since)),
      );
    },
    /** Correct a memory in the person's words. */
    async correct(memoryId: string, text: string): Promise<BookCorrected> {
      const written = await once(
        { command: "correct", memory_id: memoryId, text },
        async () => {
          // Saved, the new version is the person's, in these words, and the
          // old one is gone from what it can reach.
          const all = await everyMemory(book);
          if (all.some((m) => m.id === memoryId)) return null;
          const fresh = all.find(
            (m) =>
              m.author === "person" &&
              m.id !== memoryId &&
              same(m.content, text),
          );
          return fresh
            ? {
                id: fresh.id,
                replaces: memoryId,
                corrected: fresh.corrected ?? null,
              }
            : null;
        },
      );
      if ("looked" in written) return written.looked;
      if (written.kind !== "corrected")
        throw { kind: "failed", code: "invalid_reply" } satisfies WriteFailure;
      return {
        id: written.id,
        replaces: written.replaces,
        corrected: written.corrected,
      };
    },
    /** Let a memory go: archived, never deleted. */
    async forget(memoryId: string): Promise<void> {
      const written = await once(
        { command: "forget", memory_id: memoryId },
        // Let go, it is no longer among what it can reach.
        async () =>
          (await everyMemory(book)).some((m) => m.id === memoryId)
            ? null
            : true,
      );
      if ("looked" in written) return;
      if (written.kind !== "forgotten")
        throw { kind: "failed", code: "invalid_reply" } satisfies WriteFailure;
    },
  };
}

export type Writes = ReturnType<typeof writesOf>;
