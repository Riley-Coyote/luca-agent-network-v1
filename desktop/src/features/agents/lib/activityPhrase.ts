/**
 * The one plain phrase a working row shows, and nothing else.
 *
 * Riley, 2026-09-15: "I just want it to say what they're doing and change as
 * they change steps." So this maps a step to an everyday present-tense phrase
 * from a CLOSED vocabulary — never the runtime's own words, never a thought
 * header, never a command line, never a path. The row replaces the phrase in
 * place as the step changes; that is the whole surface.
 *
 * WHY THIS IS A CLASSIFIER AND NOT A LOOKUP: the native store hands the
 * renderer two already-public strings per step — `text` (owner-visible, may
 * name the object) and `roomText` (the shared-room projection, drawn from a
 * closed set of kind labels). The ACP tool kind itself does not cross the
 * process boundary, so the kind is recovered from `roomText`, which is
 * produced from it directly. `text` is consulted only for the object and to
 * tell a write from a read; anything unrecognised becomes "Working" rather
 * than leaking the source string into the conversation.
 *
 * The private/room boundary is the one `activityPhase.ts:13-16` already draws:
 * in an owner-and-residents conversation the object may be named ("Reading
 * notes.md"); anywhere else the object is dropped entirely ("Reading a file").
 */

/** The newest public step on a working turn. */
export type ActivityPhraseStep = {
  /** Owner-visible step text, for example `Reading notes.md`. */
  text: string;
  /** Shared-room projection of the same step, for example `Reading files`. */
  roomText: string;
  /** The step is still open. A settled step loses to streaming reply text. */
  active: boolean;
};

export type ActivityPhraseInput = {
  /** The newest activity step, or null before any tool has opened. */
  step: ActivityPhraseStep | null;
  /** The resident's reply text is already arriving. */
  streaming: boolean;
  /** An owner-and-residents conversation may name the object. */
  privateConversation: boolean;
};

/** What the phrase is about, recovered from a step's public label. */
export type ActivityPhraseKind =
  | "read"
  | "edit"
  | "write"
  | "search"
  | "explore"
  | "command"
  | "web-search"
  | "web-read"
  | "think"
  | "other";

const THINKING = "Thinking";
const WRITING = "Writing";

/**
 * Ordered because labels overlap: "Running a command" must not be read as a
 * search, and "Reading the page" is the web, not a file.
 */
const KIND_PATTERNS: readonly (readonly [RegExp, ActivityPhraseKind])[] = [
  [/\bthink|\bthought|\breason/, "think"],
  [
    /\bweb\b|\bbrowser|\bbrowsing\b|\bpage\b|\bsite\b|\burl\b|\bonline\b/,
    "web-read",
  ],
  [
    /\brun\b|\brunning\b|\bran\b|\bcommand|\bshell\b|\bbash\b|\bterminal\b|\bexecut/,
    "command",
  ],
  [
    /\blist|\bexplor|\bdirector|\bfolder|\brepositor|\btree\b|\bglob\b/,
    "explore",
  ],
  [
    /\bsearch|\bgrep\b|\bfind\b|\bfinding\b|\bpattern\b|\bquer(y|ying)\b/,
    "search",
  ],
  [/\bwrit(e|es|ing)\b/, "write"],
  [
    /\bedit|\bupdat|\bcreat|\bmodif|\bdelet|\bmov(e|es|ing)\b|\bpatch|\breplac/,
    "edit",
  ],
  [/\bread|\bview|\bopen|\binspect|\bfile/, "read"],
];

/** Recover the kind from one public label, or null when nothing is recognised. */
export function activityPhraseKind(label: string): ActivityPhraseKind | null {
  const lower = stripBrackets(label).toLowerCase();
  if (!lower) return null;
  for (const [pattern, kind] of KIND_PATTERNS) {
    if (!pattern.test(lower)) continue;
    // The web is the one kind whose two phrases are told apart by the label.
    if (kind === "web-read")
      return /\bsearch|\bquer(y|ying)\b|\blooking\b/.test(lower)
        ? "web-search"
        : "web-read";
    return kind;
  }
  return null;
}

const FILE_KINDS: ReadonlySet<ActivityPhraseKind> = new Set([
  "read",
  "edit",
  "write",
]);

/**
 * Kinds that say the same thing about privacy and differ only in their verb.
 * The room label picks the family; the owner's own text may sharpen the verb
 * inside it, and never crosses from one family to another.
 */
const KIND_FAMILIES: Readonly<Record<ActivityPhraseKind, string>> = {
  read: "file",
  edit: "file",
  write: "file",
  "web-read": "web",
  "web-search": "web",
  search: "search",
  explore: "explore",
  command: "command",
  think: "think",
  other: "other",
};

/** Verbs the native store and the ACP projection actually emit ahead of a path. */
const OBJECT_VERBS: ReadonlySet<string> = new Set([
  "reading",
  "editing",
  "writing",
  "viewing",
  "opening",
  "creating",
  "updating",
  "modifying",
  "deleting",
  "moving",
  "patching",
]);

/** Words a runtime uses where a name would go; naming them says nothing. */
const GENERIC_OBJECTS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "the",
  "it",
  "this",
  "that",
  "file",
  "files",
  "something",
]);

const MAX_OBJECT_LENGTH = 48;

/**
 * The file's own name, never its path and never prose. A step whose text is a
 * runtime-written title rather than `<verb> <path>` yields no object at all,
 * and the phrase falls back to "a file".
 */
export function activityPhraseObject(text: string): string | null {
  const cleaned = stripBrackets(text).trim();
  const boundary = cleaned.indexOf(" ");
  if (boundary <= 0) return null;
  if (!OBJECT_VERBS.has(cleaned.slice(0, boundary).toLowerCase())) return null;
  const segments = cleaned
    .slice(boundary + 1)
    .trim()
    .split(/[/\\]/);
  const name = (segments.at(-1) ?? "")
    .replace(/^[`'"([{<]+/, "")
    .replace(/[`'"),\].;:}>…]+$/, "")
    .trim();
  if (!name || name.length > MAX_OBJECT_LENGTH) return null;
  // Whitespace means the runtime wrote a sentence, not a name.
  if (/\s/.test(name)) return null;
  if (GENERIC_OBJECTS.has(name.toLowerCase())) return null;
  return name;
}

/**
 * Some sources still wrap commentary in square brackets. The bracketed line is
 * gone from this surface, but a stray wrapper must never reach the row.
 */
export function stripBrackets(value: string): string {
  let text = value.trim();
  while (text.startsWith("[") && text.endsWith("]"))
    text = text.slice(1, -1).trim();
  if (text.startsWith("[")) text = text.slice(1).trim();
  if (text.endsWith("]")) text = text.slice(0, -1).trim();
  return text;
}

function objectPhrase(
  verb: string,
  object: string | null,
  fallback: string,
): string {
  return object ? `${verb} ${object}` : fallback;
}

/** The single phrase a working row shows right now. */
export function activityPhrase({
  step,
  streaming,
  privateConversation,
}: ActivityPhraseInput): string {
  if (!step) return streaming ? WRITING : THINKING;
  // A finished tool does not hold the row while the reply is already arriving.
  if (streaming && !step.active) return WRITING;

  // A room reads the room projection and nothing else: the owner's text is in
  // the same object, and the only thing keeping it out of a shared room is
  // this line.
  const owned = privateConversation ? activityPhraseKind(step.text) : null;
  let kind = activityPhraseKind(step.roomText) ?? owned ?? "other";
  if (owned && KIND_FAMILIES[owned] === KIND_FAMILIES[kind]) kind = owned;

  const object =
    privateConversation && FILE_KINDS.has(kind)
      ? activityPhraseObject(step.text)
      : null;

  switch (kind) {
    case "read":
      return objectPhrase("Reading", object, "Reading a file");
    case "edit":
      return objectPhrase("Editing", object, "Editing a file");
    case "write":
      return objectPhrase("Writing", object, "Writing a file");
    case "search":
      return "Searching the code";
    case "explore":
      return "Exploring the repository";
    case "command":
      return "Running a command";
    case "web-search":
      return "Searching the web";
    case "web-read":
      return "Reading a page";
    case "think":
      return THINKING;
    default:
      return "Working";
  }
}
