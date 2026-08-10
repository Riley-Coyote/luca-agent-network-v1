const CODEX_SKILL_CONTEXT_NOTICE =
  "Warning: Skill descriptions were shortened to fit the 2% skills context budget. Codex can still see every skill, but some descriptions are shorter. Disable unused skills or plugins to leave more room for the rest.";

/**
 * Remove a known adapter-generated notice when it was prepended to an
 * otherwise valid conversational answer. This is deliberately exact and
 * prefix-only: normal warnings authored by a resident remain untouched.
 */
export function stripRuntimeNoticePreamble(content: string): string {
  if (content === CODEX_SKILL_CONTEXT_NOTICE) return "";
  if (!content.startsWith(`${CODEX_SKILL_CONTEXT_NOTICE}\n`)) return content;
  return content.slice(CODEX_SKILL_CONTEXT_NOTICE.length).trimStart();
}
