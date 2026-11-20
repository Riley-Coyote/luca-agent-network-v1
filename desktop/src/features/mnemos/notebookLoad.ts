/**
 * Reading a newer Mnemos's notebook (`docs/host-interface.md` in the engine):
 * `life` whole, `memories` in pages of 500 following `next` (starting over
 * when `version` changes under it), and `summary`, whose `change_token` is
 * the only reason to read the parts again. Pure: each takes the session's
 * own `ask`, so the unit tests drive them with a made-up engine.
 */
import type { ViewCounts, ViewItem } from "@/shared/api/mnemosView";
import { type Ask, type Book, bookOf } from "./adapt";
import type { BookLife, BookMemory, BookSummary } from "./book";
import { lifeOf, memoryPageOf, summaryOf } from "./notebookShapes";
import type { Reader } from "./useReader";

/** A page of memories, as the notebook's own page asks for them. */
export const NOTEBOOK_PAGE = 500;
/** How often the summary is asked while the window is on screen. */
export const SUMMARY_EVERY_MS = 5_000;
/** Times the memories are read again from the start when they change while
 *  being read, before the place says it couldn't. */
const RESTARTS = 3;

/** Every memory it can reach, and the version they all belong to. */
export type NotebookMemories = {
  version: string;
  memories: BookMemory[];
  /** Ids recalled lately (the first page's). */
  recalled: string[];
};

/** What the place holds of a mind's notebook, while it is on screen. */
export type Loaded = {
  token: string | null;
  summary: BookSummary | null;
  life: BookLife | null;
  memories: NotebookMemories | null;
};

export const NOTHING_LOADED: Loaded = {
  token: null,
  summary: null,
  life: null,
  memories: null,
};

function notebookReply(
  reply: Awaited<ReturnType<Ask>>,
  part: "life" | "memories",
) {
  if (reply.kind !== "notebook" || reply.part !== part)
    throw new Error("invalid_reply");
  return reply;
}

export async function loadSummary(ask: Ask): Promise<BookSummary> {
  const reply = await ask({ command: "summary" });
  if (reply.kind !== "summary") throw new Error("invalid_reply");
  return summaryOf(reply.summary);
}

export async function loadLife(ask: Ask): Promise<BookLife> {
  const reply = notebookReply(
    await ask({ command: "notebook", part: "life" }),
    "life",
  );
  return lifeOf(reply.document);
}

/** Every memory, a page at a time, following `next`. A page of another
 *  version means they changed while being read: start over. */
export async function loadMemories(
  ask: Ask,
  size = NOTEBOOK_PAGE,
): Promise<NotebookMemories> {
  for (let attempt = 0; attempt < RESTARTS; attempt++) {
    let offset: number | null = 0;
    let version: string | null = null;
    let recalled: string[] = [];
    const memories: BookMemory[] = [];
    let moved = false;
    while (offset !== null) {
      const reply = notebookReply(
        await ask({
          command: "notebook",
          part: "memories",
          limit: size,
          offset,
        }),
        "memories",
      );
      const page = memoryPageOf(reply.document, reply.page);
      if (version === null) {
        version = page.version;
        recalled = page.recalled;
      } else if (page.version !== version) {
        moved = true;
        break;
      }
      memories.push(...page.memories);
      // Onward only: a `next` that doesn't move on ends the reading.
      offset = page.next !== null && page.next > offset ? page.next : null;
    }
    if (!moved) return { version: version ?? "", memories, recalled };
  }
  throw new Error("notebook_changing");
}

/**
 * One turn of the token loop: the summary, and only when its token changed
 * (or nothing is held yet), `life` again; the memories only when `life`
 * says their version moved. `fetched` names what was read, in order.
 */
export async function refresh(
  ask: Ask,
  before: Loaded,
): Promise<{ next: Loaded; fetched: ("summary" | "life" | "memories")[] }> {
  const summary = await loadSummary(ask);
  if (before.life && before.memories && summary.changeToken === before.token)
    return { next: { ...before, summary }, fetched: ["summary"] };
  const life = await loadLife(ask);
  const fetched: ("summary" | "life" | "memories")[] = ["summary", "life"];
  let memories = before.memories;
  if (!memories || (life.memory.version ?? "") !== memories.version) {
    memories = await loadMemories(ask);
    fetched.push("memories");
  }
  return {
    next: { token: summary.changeToken, summary, life, memories },
    fetched,
  };
}

const time = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(t) ? 0 : t;
};

/**
 * The rooms' own reading (`Book`), served from the notebook as last read:
 * the same shapes the older interface's answers become, so every room reads
 * one way. A search still asks the engine (the notebook has none).
 */
export function bookOfNotebook(
  life: BookLife,
  all: NotebookMemories,
  ask: Ask,
): Book {
  const searching = bookOf(ask);
  const facts = () => ({
    ...life.memory,
    states: life.memory.states,
  });
  return {
    async facts() {
      return facts();
    },
    async memories(page) {
      // Oldest first, as the engine lists them.
      const held = all.memories.filter((m) =>
        page.state ? m.state === page.state : m.state !== "archived",
      );
      return {
        memories: held.slice(page.offset, page.offset + page.limit),
        facts: facts(),
      };
    },
    search: searching.search,
    async journal(last) {
      return [...life.journal]
        .sort((a, b) => time(b.at) - time(a.at))
        .slice(0, last);
    },
    async notes() {
      return [...life.notes].sort((a, b) => time(b.at) - time(a.at));
    },
  };
}

/** The old reader's three sections, from the notebook instead: on a newer
 *  Mnemos the old reader is never used. */
export function readerOfNotebook(
  life: BookLife,
  all: NotebookMemories,
): Reader {
  const sections: Record<string, ViewItem[]> = {
    standing: all.memories
      .filter((m) => m.standing && m.state !== "archived")
      .map((m) => ({
        text: m.content,
        clipped: false,
        at: m.born ?? undefined,
      })),
    beliefs: life.beliefs.map((b) => ({
      text: b.text,
      clipped: false,
      at: b.born ?? undefined,
      confidence: b.confidence,
    })),
    handoffs: life.handoffs.map((h) => ({
      text: h.text,
      clipped: false,
      at: h.at ?? undefined,
    })),
  };
  const counts: ViewCounts = {
    memories: life.memory.states,
    notes: {
      all: life.notes.length,
      unread: life.notes.filter((n) => n.author === "agent" && !n.read).length,
    },
    standing: sections.standing?.length ?? 0,
    journal: life.journal.length,
    handoffs: life.handoffs.length,
    beliefs: life.beliefs.length,
  };
  return {
    kind: "ready",
    read: async (section) => sections[section] ?? [],
    counts: async () => counts,
  };
}
