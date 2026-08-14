const CODEX_SKILL_CONTEXT_NOTICE =
  "Warning: Skill descriptions were shortened to fit the 2% skills context budget. Codex can still see every skill, but some descriptions are shorter. Disable unused skills or plugins to leave more room for the rest.";
const CODEX_SKILL_BUDGET_NOTICE_PREFIX =
  "Warning: Exceeded skills context budget of 2%.";
const CODEX_SKILL_BUDGET_NOTICE_SUFFIX = "model-visible skills list.";

/**
 * Remove a known adapter-generated notice when it was prepended to an
 * otherwise valid conversational answer. This is deliberately exact and
 * prefix-only: normal warnings authored by a resident remain untouched.
 */
export function stripRuntimeNoticePreamble(content: string): string {
  if (content === CODEX_SKILL_CONTEXT_NOTICE) return "";
  if (content.startsWith(`${CODEX_SKILL_CONTEXT_NOTICE}\n`)) {
    return content.slice(CODEX_SKILL_CONTEXT_NOTICE.length).trimStart();
  }
  if (!content.startsWith(CODEX_SKILL_BUDGET_NOTICE_PREFIX)) return content;
  const suffixStart = content.indexOf(CODEX_SKILL_BUDGET_NOTICE_SUFFIX);
  if (suffixStart < 0) return content;
  const remainder = content.slice(
    suffixStart + CODEX_SKILL_BUDGET_NOTICE_SUFFIX.length,
  );
  if (remainder === "") return "";
  if (!remainder.startsWith("\n")) return content;
  return remainder.trimStart();
}
