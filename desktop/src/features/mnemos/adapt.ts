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
  WireEntry,
  WireFound,
  WireMemory,
  WireNote,
  WireState,
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
