import { normalizePubkey } from "@/shared/lib/pubkey";
import { sigilPattern } from "@/shared/ui/dot-display/engine";

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
 * Return the stable, mirrored 7x7 matrix used by custom resident marks.
 * Runtime binding is deliberately absent: a resident keeps this mark when its
 * provider or model changes.
 */
export function residentIdentityMatrix(publicKey: string): boolean[][] {
  const { grid } = sigilPattern(normalizePubkey(publicKey));
  return grid.map((row) =>
    [...row, ...row.slice(0, row.length - 1).reverse()].map(Boolean),
  );
}

export type ResidentIdentityCell = Readonly<{
  id: string;
  x: number;
  y: number;
}>;

/** Stable lit-cell coordinates for rendering the resident matrix as SVG. */
export function residentIdentityCells(
  publicKey: string,
): ResidentIdentityCell[] {
  const cells: ResidentIdentityCell[] = [];
  for (const [y, row] of residentIdentityMatrix(publicKey).entries()) {
    for (const [x, isLit] of row.entries()) {
      if (isLit) cells.push({ id: `${x}:${y}`, x, y });
    }
  }
  return cells;
}
