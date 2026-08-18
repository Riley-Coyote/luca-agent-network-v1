import { normalizePubkey } from "@/shared/lib/pubkey";
import {
  GLYPH_N,
  glyphLit,
  identityGlyph,
} from "@/shared/ui/dot-display/identity/glyph";
import { glyphToSvgPath } from "@/shared/ui/dot-display/identity/render";

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

/**
 * Return the stable 7x7 identity glyph used by custom resident marks — the
 * same joined mark the dot-display identity system draws everywhere else.
 * Runtime binding is deliberately absent: a resident keeps this mark when its
 * provider or model changes.
 */
export function residentIdentityMatrix(publicKey: string): boolean[][] {
  const glyph = identityGlyph(normalizePubkey(publicKey));
  return Array.from({ length: GLYPH_N }, (_, y) =>
    Array.from({ length: GLYPH_N }, (_, x) => glyphLit(glyph, x, y)),
  );
}

/**
 * The same mark as one joined SVG path in a `0 0 7 7` viewBox: cells abut and
 * corners round only where they face empty space, so identity reads as a
 * continuous stroke — who — while live activity stays a dotted field — what.
 */
export function residentIdentityPath(publicKey: string): string {
  return glyphToSvgPath(identityGlyph(normalizePubkey(publicKey)));
}
