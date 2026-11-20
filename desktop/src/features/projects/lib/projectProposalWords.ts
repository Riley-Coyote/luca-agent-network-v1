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

/** What a Create that stopped part-way left behind, in the card's terms. */
export type ProjectMadeSoFar = {
  /** The project itself is saved. */
  project: boolean;
  /** Its first chat exists. */
  chat: boolean;
  /** The chat sits in the project. */
  inProject: boolean;
  /** Residents who could not be added, by name. */
  missing: readonly string[];
};

/** The one sentence a card shows after Create stopped part-way. */
export function projectPartlyMade(
  projectName: string,
  made: ProjectMadeSoFar,
): string {
  const name = projectName.trim();
  if (!made.project) return `${name} couldn't be made. Nothing was saved.`;
  if (!made.chat) return "The project was made, but its first chat wasn't.";
  if (!made.inProject)
    return `${name} and its chat were made, but the chat isn't in the project yet.`;
  if (made.missing.length > 0)
    return `${name} and its chat were made, but ${asList(made.missing)} couldn't be added.`;
  return `${name} was only partly made.`;
}

/** The line a project the owner left part-made leaves: what is there. */
export function projectLeftLine(
  projectName: string,
  made: ProjectMadeSoFar,
): string {
  const name = projectName.trim();
  if (!made.chat) return `${name} is in your projects, without its first chat.`;
  if (!made.inProject)
    return `${name} is in your projects, but its chat isn't in it yet.`;
  if (made.missing.length > 0)
    return `${name} is in your projects, without ${asList(made.missing)} in it yet.`;
  return projectSettledLine(name);
}
