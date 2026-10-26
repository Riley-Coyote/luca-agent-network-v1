/**
 * SETTINGS AS A PLACE IN HISTORY (SHELL_BUILD.md WP-17, from the final flows
 * review). Under the shell's frame a section pick is a history step, as every
 * other place's pick is: Back and Forward walk the sections you visited, and
 * Back from Chats returns to the section you were on. Escape and ⌘, still
 * close Settings, so closing has to step back past every Settings entry at
 * once, to where you came from.
 *
 * What each entry was is known only for the entries this window has shown,
 * by their history index (`__TSR_index`); a session that began in Settings,
 * or reloaded inside it, has none before it, and closes to Chats.
 */

/** Where each history index of this window was: in Settings or not. */
export type SettingsEntries = Map<number, boolean>;

/**
 * How many steps back leave Settings from `index`: past every Settings entry
 * just behind it, to the entry before them. Null when that entry was never
 * seen, or there is none.
 */
export function stepsOutOfSettings(
  entries: SettingsEntries,
  index: number,
): number | null {
  let at = index;
  while (entries.get(at - 1) === true) at -= 1;
  const target = at - 1;
  if (target < 0 || entries.get(target) !== false) return null;
  return target - index;
}

/** The entries kept: the most recent, never the whole of a long session. */
const KEPT = 400;

/** Records the entry at `index`; forgets the oldest past `KEPT`. */
export function recordEntry(
  entries: SettingsEntries,
  index: number,
  inSettings: boolean,
) {
  entries.set(index, inSettings);
  if (entries.size <= KEPT) return;
  const oldest = Math.min(...entries.keys());
  entries.delete(oldest);
}
