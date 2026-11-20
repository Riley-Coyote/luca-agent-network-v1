/**
 * The owner's own unsent words in the Mnemos place: theirs, not the mind's.
 * Kept in this module's memory only (never storage) for as long as the app
 * runs, per mind and per thing they answer, so a section change, another
 * item opened, a hidden window or leaving the place never loses them. They
 * go when sent, when the owner clears the field, and with the community
 * (`resetMnemosPlace`, from `resetCommunityState`).
 */
const drafts = new Map<string, string>();

/** The key for a field: the mind, and what the words answer (a thread, a
 *  new note, the memory being corrected). */
export const draftKey = (mind: string, what: string) => `${mind}\u0000${what}`;

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
