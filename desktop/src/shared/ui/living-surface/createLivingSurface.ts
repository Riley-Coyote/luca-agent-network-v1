import { TuringSurface } from "./turingSurface";
import type { LivingSurface, LivingSurfaceKind } from "./types";

export const SURFACE_KINDS: readonly LivingSurfaceKind[] = ["turing"];

/** The surface of the given kind on a fresh canvas, or null where it can't run. */
export function createLivingSurface(
  _kind: LivingSurfaceKind,
  canvas: HTMLCanvasElement,
): LivingSurface | null {
  return TuringSurface.create(canvas);
}
