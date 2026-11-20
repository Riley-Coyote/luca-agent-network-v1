/**
 * The notebook's own words for what a newer Mnemos gives, as its page says
 * them (Mnemos `companion/page/shared/words.js`). Nothing here is renamed:
 * the place says what the notebook says.
 */
import type { BookHour } from "./book";
import { modelName } from "./notebook";

/** A quiet hour's kind. */
export const KIND: Record<string, string> = {
  mine: "Its own hour",
  ours: "Our hour",
  dream: "A dream",
};
export const KIND_LONG: Record<string, string> = {
  mine: "Its own hour",
  ours: "Our hour, for the day’s work",
  dream: "A dream, over its own memory",
};

/** Each kind of question its memory asks it: its title, and what it is. */
export const ASK: Record<string, [string, string]> = {
  lesson: [
    "What did it teach?",
    "Memories fading, asked what they taught before they go.",
  ],
  impact: [
    "What did it change?",
    "Memories kept without saying what they changed.",
  ],
  belief: [
    "A belief?",
    "Asked from how often a word recurs. Kept out of its hours until they are grounded in meaning.",
  ],
  reaffirm: ["Still true?", "Beliefs it holds, asked again each month."],
  fact: [
    "Is it still true?",
    "Facts fading, asked whether they still hold before they go.",
  ],
  // No longer asked; named only where an answered one stays in the history.
  contradiction: [
    "A contradiction?",
    "Two memories that may disagree. No longer asked.",
  ],
};
export const ASK_ORDER: Record<string, number> = {
  lesson: 0,
  fact: 1,
  impact: 2,
  belief: 3,
  reaffirm: 4,
};

/** How two memories are tied. */
export const RELATION: Record<string, string> = {
  co_activated: "came back together",
  distilled_into: "a lesson distilled from it",
  supports: "supports it",
  contradicts: "may contradict it",
};

export const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export const words = (n: number) =>
  [
    "no",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
  ][n] ?? n.toLocaleString("en-US");

/** How often a question was put to it. */
export const putTo = (n: number) =>
  n
    ? `put to it ${n === 1 ? "once" : n === 2 ? "twice" : `${n} times`}`
    : "not yet put to it";

/** A question's own question: its prompt up to the first "?". */
export const question = (prompt: string) => {
  const i = (prompt || "").indexOf("?");
  return i > 0 ? prompt.slice(0, i + 1) : prompt || "";
};

/** What an hour did, in a sentence, from its own record. */
export function trailSentence(hour: BookHour, inMemory: number | null = null) {
  const { woke, waiting, reached } = hour.trail;
  const memRefused = hour.refused.some((r) => /^mnemos_/.test(r));
  const parts: string[] = [];
  if (woke.length)
    parts.push(
      `woke with ${words(woke.length)} ${woke.length === 1 ? "memory" : "memories"} in hand`,
    );
  if (waiting.length)
    parts.push(
      `found ${words(waiting.length)} ${waiting.length === 1 ? "question" : "questions"} waiting`,
    );
  const tail = reached.length
    ? `reached for ${words(reached.length)}`
    : memRefused
      ? "reached for none: its memory tools were refused that hour"
      : "reached for none of its own";
  const said = `It ${parts.length ? `${parts.join(", ")}, and ` : ""}${tail}.`;
  return inMemory === 0 && (woke.length || waiting.length || reached.length)
    ? `${said} None of it is in the memory shown here.`
    : said;
}

/**
 * What a belief rests on, in the notebook's sentence (`room.js`
 * `beliefsHTML`: "rests on a memory of its own", "rests on a memory Sonnet
 * 5 wrote, a colleague", "resting on no memory in view"), counted: the
 * notebook names only the first memory, so where it rests on more, the
 * same sentence says how many, its own first, then each colleague's.
 */
export function restsOnWords(
  memories: readonly { model?: string }[],
  model: string,
): string {
  if (!memories.length) return "resting on no memory in view";
  const name = (m: { model?: string }) =>
    m.model && model && modelName(m.model) !== modelName(model)
      ? modelName(m.model)
      : null;
  const own = memories.filter((m) => name(m) === null).length;
  const theirs = new Map<string, number>();
  for (const m of memories) {
    const who = name(m);
    if (who) theirs.set(who, (theirs.get(who) ?? 0) + 1);
  }
  const some = (n: number, first: boolean) =>
    n === 1 ? (first ? "a memory" : "one") : `${words(n)} memories`;
  const parts: string[] = [];
  if (own) parts.push(`${some(own, true)} of its own`);
  for (const [who, n] of theirs)
    parts.push(`${some(n, parts.length === 0)} ${who} wrote, a colleague`);
  return `rests on ${parts.join(" and ")}`;
}
