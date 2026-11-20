/**
 * The words of a resident's project card, in one place so they are tested as
 * written: what it asks, who joins, and the duplicate-name warning.
 */

function asList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "Start a project called “Ghost app”?" */
export function projectProposalTitle(projectName: string): string {
  return `Start a project called “${projectName}”?`;
}

/** "Luca joins its first chat, general." / "Luca and Atlas join …" */
export function projectProposalJoins(
  names: readonly string[],
  chatName: string,
): string {
  const who = asList(names.length > 0 ? names : ["Your resident"]);
  return `${who} ${names.length > 1 ? "join" : "joins"} its first chat, ${chatName}.`;
}

/** The card's one faint line: the purpose, then who joins. */
export function projectProposalLine(
  purpose: string,
  names: readonly string[],
  chatName: string,
): string {
  return `${purpose} · ${projectProposalJoins(names, chatName)}`;
}

function sameName(left: string, right: string) {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

/** "You already have a project called Ghost app." when one does. */
export function projectProposalDuplicate(
  projectName: string,
  existingLabels: readonly string[],
): string | null {
  return existingLabels.some((label) => sameName(label, projectName))
    ? `You already have a project called ${projectName.trim()}.`
    : null;
}

/** The line a created project leaves in the conversation. */
export function projectSettledLine(projectName: string): string {
  return `${projectName} is in your projects.`;
}
