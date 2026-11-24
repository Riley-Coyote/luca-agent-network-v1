/**
 * The Mnemos place's own shapes: a mind's notebook as the notebook's own page
 * is given it (Mnemos `companion/export.py`, the `life` and `memories`
 * documents that `room.js` and the Ghost lab's `app.js` read). Rooms, helpers
 * and tests read only these. A newer Mnemos gives them whole (`notebook`,
 * guarded in `notebookShapes.ts`); what an older `mnemos interface` (0.6.7)
 * can't give is optional, and is absent rather than invented, and one
 * adapter (`adapt.ts`) fills these from what it does give.
 */

import type { HourKind } from "./api";

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

/** One change in how firmly a belief is held. */
export type BookBeliefChange = {
  at: string | null;
  from: number | null;
  to: number | null;
};

/** One belief (export `life.beliefs[]`). */
export type BookBelief = {
  text: string;
  confidence?: number;
  born?: string | null;
  revised?: string | null;
  revisions?: number;
  history?: BookBeliefChange[];
  /** The memories it rests on, by id. */
  supports?: string[];
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

/** What a quiet hour walked: the memories it woke with, was handed, and
 *  reached for, by id. */
export type BookTrail = {
  woke: string[];
  waiting: string[];
  reached: string[];
};

/** One quiet hour (export `life.hours[]`), newest first. */
export type BookHour = {
  id: string;
  kind: string;
  /** Spent on a copy of the memory, not the memory itself. */
  practice: boolean;
  status: string;
  reason: string;
  start: string | null;
  end: string | null;
  minutes: number | null;
  model: string;
  modelName: string;
  tokens: number | null;
  /** Whether it wrote nothing to the real memory, where that was checked. */
  untouched: boolean | null;
  journal: BookEntry[];
  notes: BookNote[];
  /** Studio paths it made. */
  made: string[];
  said: string;
  refused: string[];
  trail: BookTrail;
  /** Whether the hour was given the web, as its record says; null for an
   *  hour from before Mnemos 0.7.0. */
  online: boolean | null;
  /** What it read and searched online, as the hour recorded them. */
  web: BookHourWeb;
};

/** What an hour that went online read (addresses) and searched (queries),
 *  each as the hour wrote it. */
export type BookHourWeb = { read: string[]; searched: string[] };

/** One quiet hour as it is set now, on this Mac. */
export type BookHourSetting = {
  on: boolean;
  /** HH:MM, or "" where the engine gave none. */
  at: string;
  minutes: number | null;
  online: boolean;
};

/** One quiet hour as Hermes has it scheduled. */
export type BookHermesHour = {
  on: boolean;
  at: string;
  online: boolean;
  /** Limited to its memory, or run with every tool Hermes gives a job. */
  limited: boolean;
};

/** Each quiet hour as Settings shows it (`life.quietHours`, Mnemos 0.7.0):
 *  here, each by itself, with why none can be turned on (`cant`), when
 *  none can; or inside Hermes, as its own scheduled jobs. `hours` is null
 *  when they couldn't be read; inside Hermes, an hour with no job is null. */
export type BookQuietHours =
  | {
      where: "here";
      hours: Record<HourKind, BookHourSetting> | null;
      cant: string | null;
    }
  | {
      where: "hermes";
      hours: Record<HourKind, BookHermesHour | null> | null;
    };

/** A question its memory asked it about itself, still open. */
export type BookAsked = {
  id: string;
  kind: string;
  prompt: string;
  excerpt: string;
  shown: number;
  at: string | null;
  /** The memory it asks about, by id; "" when none. */
  about: string;
};

/** A question it answered, with its answer. */
export type BookAnswered = Omit<BookAsked, "id" | "shown"> & { answer: string };

export type BookQuestions = {
  open: number;
  byKind: Record<string, number>;
  asked: BookAsked[];
  answered: BookAnswered[];
};

/** One row of the notebook it shares with the person (`life.shared`). */
export type BookSharedRow = {
  id: string;
  content: string;
  author: string;
  person: string;
  model: string;
  born: string | null;
  /** The person may correct it or let it go. */
  editable: boolean;
};

export type BookShared = { status: string; rows: BookSharedRow[] };

/** One thing in its studio (export `life.studio[]`). */
export type BookStudioItem = {
  path: string;
  bytes: number;
  at: string | null;
  /** The page's own address for it, when it is a picture. */
  picture: string | null;
};

/** Who the mind is (export `life.identity`). */
export type BookIdentity = {
  agentId: string;
  name: string;
  model: string;
  person: string | null;
  personId: string;
  project: string;
  store: string;
};

/** Jev, the cue's judge, as Settings shows it: never its key. */
export type BookJev = {
  on: boolean;
  key: boolean;
  env: boolean;
  host: string;
};

/** The whole of a mind's life, as a newer Mnemos gives it (`life`). */
export type BookLife = {
  made: string | null;
  /** The store isn't there: nothing else is. */
  missing: boolean;
  identity: BookIdentity;
  hours: BookHour[];
  /** Each quiet hour as it is set now; null from a Mnemos before 0.7.0. */
  quietHours: BookQuietHours | null;
  /** What wakes the hours on their own (shown, never changed here). */
  schedule: Record<string, unknown>[];
  jev: BookJev | null;
  shared: BookShared;
  journal: BookEntry[];
  notes: BookNote[];
  studio: BookStudioItem[];
  questions: BookQuestions;
  memory: BookMemoryFacts;
  beliefs: BookBelief[];
  handoffs: BookHandoff[];
};

/** The counts a newer Mnemos gives cheaply, and the token that changes only
 *  when something shown does (`summary`). */
export type BookSummary = {
  missing: boolean;
  counts: Partial<
    Record<
      | "memories"
      | "shared"
      | "beliefs"
      | "questions"
      | "answered"
      | "journal"
      | "notes"
      | "replies"
      | "hours"
      | "made"
      | "carrying",
      number
    >
  >;
  unread: number;
  waiting: number;
  changeToken: string;
};

/** What a newer Mnemos said to `hello`. */
export type BookHello = {
  mnemos: string;
  commands: string[];
  parts: string[];
};
