/**
 * A newer Mnemos's answers (`hello`, `summary`, `notebook`), which the app
 * passes through as the engine gave them, made into the notebook's own
 * shapes (`book.ts`). Forgiving: a field missing or of the wrong kind
 * becomes its plain empty value, and an item that isn't one is left out, so
 * one odd row never empties a section. Nothing here invents a word.
 */
import type { HourKind } from "./api";
import type {
  BookAnswered,
  BookAsked,
  BookBelief,
  BookEntry,
  BookHandoff,
  BookHello,
  BookHermesHour,
  BookHour,
  BookHourSetting,
  BookHourWeb,
  BookIdentity,
  BookLife,
  BookMemory,
  BookMemoryFacts,
  BookNote,
  BookQuietHours,
  BookSharedRow,
  BookStudioItem,
  BookSummary,
  MemoryAuthor,
  MemoryState,
  MemoryTie,
} from "./book";

type Loose = Record<string, unknown>;

const obj = (v: unknown): Loose =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Loose) : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null =>
  typeof v === "string" && v !== "" ? v : null;
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const bool = (v: unknown): boolean => v === true;
const strings = (v: unknown): string[] =>
  list(v).filter((x): x is string => typeof x === "string");
/** Each item that has an id (a string), shaped by `shape`. */
const items = <T>(v: unknown, shape: (o: Loose) => T | null): T[] =>
  list(v)
    .map((x) => shape(obj(x)))
    .filter((x): x is T => x !== null);

const STATES: readonly MemoryState[] = ["active", "dormant", "archived"];
const AUTHORS: readonly MemoryAuthor[] = ["agent", "person", "tool", "unknown"];

/** What a newer Mnemos said to `hello`; null when it said nothing usable. */
export function helloOf(said: unknown): BookHello | null {
  const o = obj(said);
  if (typeof o.protocol !== "number" || !Array.isArray(o.commands)) return null;
  return {
    mnemos: str(o.mnemos),
    commands: strings(o.commands),
    parts: strings(o.parts),
  };
}

/** Whether this engine gives the notebook (`summary` and `notebook`). */
export function givesNotebook(hello: BookHello | null): boolean {
  if (!hello) return false;
  const { commands, parts } = hello;
  return (
    commands.includes("notebook") &&
    commands.includes("summary") &&
    parts.includes("life") &&
    parts.includes("memories")
  );
}

/** Whether this engine answers `command` (an older one: the first eight). */
export function answers(hello: BookHello | null, command: string): boolean {
  return hello
    ? hello.commands.includes(command)
    : FIRST_EIGHT.includes(command);
}

/** The commands every `mnemos interface` answers. */
const FIRST_EIGHT = [
  "memories",
  "search",
  "correct",
  "forget",
  "journal",
  "notes",
  "reply",
  "note",
];

export function summaryOf(said: unknown): BookSummary {
  const o = obj(said);
  const counts: BookSummary["counts"] = {};
  for (const [key, value] of Object.entries(obj(o.counts))) {
    const n = num(value);
    if (n !== null) (counts as Record<string, number>)[key] = n;
  }
  return {
    missing: bool(o.missing),
    counts,
    unread: num(o.unread) ?? 0,
    waiting: num(o.waiting) ?? 0,
    changeToken: str(o.change_token),
  };
}

function tieOf(v: unknown): MemoryTie | null {
  const t = list(v);
  if (typeof t[0] !== "string") return null;
  return [
    t[0],
    str(t[1]),
    num(t[2]) ?? 0,
    strOrNull(t[3]),
    str(t[4]),
    t[5] === 0 ? 0 : 1,
  ];
}

export function memoryOfNotebook(o: Loose): BookMemory | null {
  if (typeof o.id !== "string" || o.id === "") return null;
  const state = STATES.includes(o.state as MemoryState)
    ? (o.state as MemoryState)
    : "active";
  const author = AUTHORS.includes(o.author as MemoryAuthor)
    ? (o.author as MemoryAuthor)
    : "unknown";
  return {
    id: o.id,
    born: strOrNull(o.born),
    content: str(o.content),
    impact: str(o.impact),
    state,
    author,
    acc: num(o.acc) ?? 0,
    touched: strOrNull(o.touched),
    kind: str(o.kind),
    lesson: bool(o.lesson),
    standing: bool(o.standing),
    asked: bool(o.asked),
    model: str(o.model),
    recalls: num(o.recalls) ?? 0,
    ties: list(o.ties)
      .map(tieOf)
      .filter((t): t is MemoryTie => t !== null),
    strength: num(o.strength) ?? undefined,
    stability: num(o.stability) ?? undefined,
  };
}

/** One page of `notebook part=memories`: its memories, the version they
 *  belong to, the ids recalled lately (the first page only), and where the
 *  next page starts (null at the end). */
export type MemoryPage = {
  version: string;
  memories: BookMemory[];
  recalled: string[];
  /** The engine's `recalled` as given, whole and untouched: each time a
   *  memory came back, and when (`[id, iso]`, oldest first). */
  recalledLog: unknown[];
  next: number | null;
  total: number | null;
};

export function memoryPageOf(document: unknown, page: unknown): MemoryPage {
  const d = obj(document);
  const p = obj(page);
  return {
    version: str(d.version),
    memories: items(d.memories, memoryOfNotebook),
    // The engine gives `[id, when]` for each recall; an id alone, or
    // `{ id }`, is read too.
    recalled: list(d.recalled)
      .map((r) =>
        typeof r === "string"
          ? r
          : Array.isArray(r)
            ? str(r[0])
            : str(obj(r).id),
      )
      .filter((r) => r !== ""),
    recalledLog: Array.isArray(d.recalled) ? d.recalled : [],
    next: num(p.next),
    total: num(p.total),
  };
}

const entryOfNotebook = (o: Loose): BookEntry | null =>
  typeof o.id === "string"
    ? {
        id: o.id,
        at: strOrNull(o.at),
        text: str(o.text),
        mood: str(o.mood),
        written: str(o.written),
        model: str(o.model),
        hour: str(o.hour) || undefined,
      }
    : null;

const noteOfNotebook = (o: Loose): BookNote | null =>
  typeof o.id === "string" && (o.author === "agent" || o.author === "person")
    ? {
        id: o.id,
        at: strOrNull(o.at),
        kind: str(o.kind),
        text: str(o.text),
        author: o.author,
        model: str(o.model),
        replyTo: str(o.replyTo),
        hour: str(o.hour) || undefined,
        delivered: strOrNull(o.delivered),
        read: strOrNull(o.read),
      }
    : null;

const hourOf = (o: Loose): BookHour | null => {
  if (typeof o.id !== "string") return null;
  const trail = obj(o.trail);
  const untouched = o.untouched;
  return {
    id: o.id,
    kind: str(o.kind),
    practice: bool(o.practice),
    status: str(o.status),
    reason: str(o.reason),
    start: strOrNull(o.start),
    end: strOrNull(o.end),
    minutes: num(o.minutes),
    model: str(o.model),
    modelName: str(o.modelName),
    tokens: num(o.tokens),
    untouched: typeof untouched === "boolean" ? untouched : null,
    journal: items(o.journal, entryOfNotebook),
    notes: items(o.notes, noteOfNotebook),
    made: strings(o.made),
    said: str(o.said),
    refused: strings(o.refused),
    trail: {
      woke: strings(trail.woke),
      waiting: strings(trail.waiting),
      reached: strings(trail.reached),
    },
    online: typeof o.online === "boolean" ? o.online : null,
    web: webOf(o.web),
  };
};

/** What an hour read and searched online, each a non-empty string as the
 *  hour wrote it (room.js `webHTML`). */
function webOf(v: unknown): BookHourWeb {
  const web = obj(v);
  const said = (x: unknown) => strings(x).filter((s) => s !== "");
  return { read: said(web.read), searched: said(web.searched) };
}

/** `life.quietHours`, as Settings reads it (room.js `savedHours`); null
 *  from a Mnemos before 0.7.0, which gives none. */
export function quietHoursOf(v: unknown): BookQuietHours | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const q = v as Loose;
  const read = q.hours !== null && typeof q.hours === "object";
  const hours = obj(q.hours);
  if (q.where === "hermes") {
    const job = (x: unknown): BookHermesHour | null => {
      if (typeof x !== "object" || x === null) return null;
      const j = obj(x);
      return {
        on: bool(j.on),
        at: str(j.at),
        online: bool(j.online),
        limited: bool(j.limited),
      };
    };
    return {
      where: "hermes",
      hours: read
        ? {
            mine: job(hours.mine),
            ours: job(hours.ours),
            dream: job(hours.dream),
          }
        : null,
    };
  }
  if (q.where !== "here") return null;
  const setting = (kind: HourKind): BookHourSetting => {
    const h = obj(hours[kind]);
    return {
      on: bool(h.on),
      at: str(h.at),
      minutes: num(h.minutes),
      online: kind !== "dream" && bool(h.online),
    };
  };
  return {
    where: "here",
    hours: read
      ? {
          mine: setting("mine"),
          ours: setting("ours"),
          dream: setting("dream"),
        }
      : null,
    cant: strOrNull(q.cant),
  };
}

const beliefOfNotebook = (o: Loose): BookBelief | null =>
  typeof o.text === "string" && o.text !== ""
    ? {
        text: o.text,
        confidence: num(o.confidence) ?? undefined,
        born: strOrNull(o.born),
        revised: strOrNull(o.revised),
        revisions: num(o.revisions) ?? 0,
        history: list(o.history).map((h) => {
          const c = obj(h);
          return { at: strOrNull(c.at), from: num(c.from), to: num(c.to) };
        }),
        supports: strings(o.supports),
      }
    : null;

const handoffOfNotebook = (o: Loose): BookHandoff | null =>
  typeof o.text === "string" && o.text !== ""
    ? { text: o.text, at: strOrNull(o.at), model: str(o.model) }
    : null;

const askedOf = (o: Loose): BookAsked | null =>
  typeof o.id === "string"
    ? {
        id: o.id,
        kind: str(o.kind),
        prompt: str(o.prompt),
        excerpt: str(o.excerpt),
        shown: num(o.shown) ?? 0,
        at: strOrNull(o.at),
        about: str(o.about),
      }
    : null;

const answeredOf = (o: Loose): BookAnswered | null =>
  typeof o.prompt === "string" || typeof o.answer === "string"
    ? {
        kind: str(o.kind),
        prompt: str(o.prompt),
        excerpt: str(o.excerpt),
        answer: str(o.answer),
        at: strOrNull(o.at),
        about: str(o.about),
      }
    : null;

const sharedRowOf = (o: Loose): BookSharedRow | null =>
  typeof o.id === "string"
    ? {
        id: o.id,
        content: str(o.content),
        author: str(o.author),
        person: str(o.person),
        model: str(o.model),
        born: strOrNull(o.born),
        editable: bool(o.editable),
      }
    : null;

const studioItemOf = (o: Loose): BookStudioItem | null =>
  typeof o.path === "string" && o.path !== ""
    ? {
        path: o.path,
        bytes: num(o.bytes) ?? 0,
        at: strOrNull(o.at),
        picture: strOrNull(o.picture),
      }
    : null;

function identityOf(v: unknown): BookIdentity {
  const o = obj(v);
  return {
    agentId: str(o.agentId),
    name: str(o.name),
    model: str(o.model),
    person: strOrNull(o.person),
    personId: str(o.personId),
    project: str(o.project),
    store: str(o.store),
  };
}

function factsOf(v: unknown): BookMemoryFacts {
  const o = obj(v);
  const states = obj(o.states);
  return {
    states: {
      active: num(states.active) ?? 0,
      dormant: num(states.dormant) ?? 0,
      archived: num(states.archived) ?? 0,
    },
    newest: strOrNull(o.newest),
    count: num(o.count) ?? undefined,
    storeBytes: num(o.storeBytes) ?? undefined,
    version: str(o.version) || undefined,
  };
}

/** `notebook part=life`, in the notebook's shapes. */
export function lifeOf(document: unknown): BookLife {
  const d = obj(document);
  const shared = obj(d.shared);
  const questions = obj(d.questions);
  const byKind: Record<string, number> = {};
  for (const [kind, n] of Object.entries(obj(questions.byKind))) {
    const count = num(n);
    if (count !== null) byKind[kind] = count;
  }
  const jev = obj(d.jev);
  return {
    made: strOrNull(d.made),
    missing: bool(d.missing),
    identity: identityOf(d.identity),
    hours: items(d.hours, hourOf),
    quietHours: quietHoursOf(d.quietHours),
    schedule: list(d.schedule).map(obj),
    jev:
      typeof jev.on === "boolean"
        ? {
            on: jev.on,
            key: bool(jev.key),
            env: bool(jev.env),
            host: str(jev.host),
          }
        : null,
    shared: {
      status: str(shared.status),
      rows: items(shared.rows, sharedRowOf),
    },
    journal: items(d.journal, entryOfNotebook),
    notes: items(d.notes, noteOfNotebook),
    studio: items(d.studio, studioItemOf),
    questions: {
      open: num(questions.open) ?? 0,
      byKind,
      asked: items(questions.asked, askedOf),
      answered: items(questions.answered, answeredOf),
    },
    memory: factsOf(d.memory),
    beliefs: items(d.beliefs, beliefOfNotebook),
    handoffs: items(d.handoffs, handoffOfNotebook),
  };
}
