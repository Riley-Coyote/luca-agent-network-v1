/**
 * The Mnemos place's own shapes: a mind's notebook as the notebook's own page
 * is given it (Mnemos `companion/export.py`, the `life` and `memories`
 * documents that `room.js` and the Ghost lab's `app.js` read). Rooms, helpers
 * and tests read only these. What today's `mnemos interface` (0.6.7) can't
 * give is optional, and is absent rather than invented; one adapter
 * (`adapt.ts`) fills these from what it does give.
 */

/** How a memory stands: one it can reach, one gone quiet, one let go. */
export type MemoryState = "active" | "dormant" | "archived";

/** Who wrote a memory, as Mnemos records it. */
export type MemoryAuthor = "agent" | "person" | "tool" | "unknown";

/** A tie to another memory: [other id, relation, strength, formed, by, from
 *  this one (1) or to it (0)]. */
export type MemoryTie = [string, string, number, string | null, string, 0 | 1];

/** One memory (export `memories[]`). */
export type BookMemory = {
  id: string;
  /** When it was first kept. */
  born: string | null;
  content: string;
  /** What it changed, in its words; empty when it says nothing more. */
  impact: string;
  state: MemoryState;
  author: MemoryAuthor;
  /** How reachable it is, 0 to 1 (under .05 it goes quiet). */
  acc: number;
  touched?: string | null;
  kind?: string;
  lesson?: boolean;
  standing?: boolean;
  /** Its memory asked it a question about this one. */
  asked?: boolean;
  /** The model that signed it; "" when unsigned. */
  model?: string;
  recalls?: number;
  ties?: MemoryTie[];
  strength?: number;
  stability?: number;
  /** When this version replaced another through a correction (the
   *  interface's; the export doesn't carry it). */
  corrected?: string | null;
};

/** One search result: the memory, how close, and how it was found. */
export type BookFound = {
  memory: Pick<BookMemory, "id" | "born" | "content">;
  /** Relative within this search; the first is 1. */
  closeness: number;
  found: "meaning" | "words" | "link";
};

/** One journal entry (export `life.journal[]`). */
export type BookEntry = {
  id: string;
  at: string | null;
  text: string;
  /** In its own words; "" when it gave none. */
  mood: string;
  /** "between_sessions" or "in_session"; "" when unknown. */
  written: string;
  model: string;
  hour?: string;
};

/** One note, the mind's or the person's (export `life.notes[]`). */
export type BookNote = {
  id: string;
  at: string | null;
  kind: string;
  text: string;
  author: "agent" | "person";
  model: string;
  /** The note it answers; "" when it starts a thread. */
  replyTo: string;
  hour?: string;
  delivered: string | null;
  /** When it was read; null while unread. */
  read: string | null;
};

/** One belief (export `life.beliefs[]`). */
export type BookBelief = {
  text: string;
  confidence?: number;
  born?: string | null;
  revised?: string | null;
  revisions?: number;
};

/** One note the mind left itself to carry forward (export
 *  `life.handoffs[]`). */
export type BookHandoff = {
  text: string;
  at?: string | null;
  model?: string;
};

/** The memory's own numbers (export `life.memory`). */
export type BookMemoryFacts = {
  states: Record<MemoryState, number>;
  newest?: string | null;
  count?: number;
  storeBytes?: number;
  version?: string;
};
