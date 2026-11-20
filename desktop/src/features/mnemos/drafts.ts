/**
 * Unsent words in the Mnemos place. Kept in this module's memory only
 * (never storage), per mind and per thing they answer.
 *
 * The owner's own words (a note, an answer) are theirs, not the mind's:
 * kept for as long as the app runs, so a section change, another item
 * opened, a hidden window or leaving the place never loses them.
 *
 * A draft that holds a mind's words (an unsent "Correct it" starts from a
 * memory's words, or a shared row's) follows those words: the place lets go
 * of them when it is left or the window hides, and the draft goes with
 * them. Its key is made with `mindWordsDraftKey`; `letGoMindWordsDrafts`
 * drops them all, called from one place (`MnemosScreen`).
 *
 * Every draft goes when sent, when the owner clears the field, and with the
 * community (`resetMnemosPlace`, from `resetCommunityState`).
 */
const drafts = new Map<string, string>();

/** The key for a field: the mind, and what the words answer (a thread, a
 *  new note, the memory being corrected). */
export const draftKey = (mind: string, what: string) => `${mind}\u0000${what}`;

/** Marks a key as holding the mind's own words. */
const MIND_WORDS = "\u0000mind-words\u0000";

/** The key for a field that starts from the mind's own words (a memory
 *  being corrected): kept like any draft while the place is on screen, and
 *  let go with the words themselves (`letGoMindWordsDrafts`). */
export const mindWordsDraftKey = (mind: string, what: string) =>
  `${mind}${MIND_WORDS}${what}`;

/** Whether a draft holds the mind's own words. */
export const holdsMindWords = (key: string) => key.includes(MIND_WORDS);

/** The place was left, or the window hid: the mind's words go, and every
 *  draft made of them. The owner's own words stay. */
export function letGoMindWordsDrafts() {
  for (const key of [...drafts.keys()])
    if (holdsMindWords(key)) drafts.delete(key);
}

export function readDraft(key: string): string | undefined {
  return drafts.get(key);
}

/** Keep the words, or forget them when there are none. */
export function keepDraft(key: string, text: string) {
  if (text === "") drafts.delete(key);
  else drafts.set(key, text);
}

export function forgetDraft(key: string) {
  drafts.delete(key);
}

/** Forget every draft (a community switch). */
export function clearMnemosDrafts() {
  drafts.clear();
}
