export type ResidentMarkKind = "custom" | "codex" | "claude";

export const DIRECT_CODEX_PERSONA_ID = "builtin:direct-runtime:codex";
export const DIRECT_CLAUDE_PERSONA_ID = "builtin:direct-runtime:claude";

/**
 * Provider marks identify only the two direct runtime contacts. A custom
 * resident keeps its key-derived identity even when Codex or Claude powers it.
 */
export function residentMarkKind(personaId?: string | null): ResidentMarkKind {
  if (personaId === DIRECT_CODEX_PERSONA_ID) return "codex";
  if (personaId === DIRECT_CLAUDE_PERSONA_ID) return "claude";
  return "custom";
}
