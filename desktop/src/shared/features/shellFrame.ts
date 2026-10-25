import { resolveEnabled } from "./resolveEnabled";

/**
 * The shell's frame (docs/luca/rail-system/SHELL_SPEC.md): a preview feature,
 * off by default, listed in `preview-features.json`.
 */
export const SHELL_FRAME_FEATURE_ID = "shell-frame";

/** The value `<html data-luca-frame>` carries while the frame is on. */
export const SHELL_FRAME_ATTRIBUTE_VALUE = "solid";

/**
 * Pure resolution: a build made with `VITE_LUCA_SHELL_FRAME=1` (a test app)
 * ships with the frame on; otherwise the preview override decides, off when
 * there is none.
 */
export function resolveShellFrameEnabled(
  overrides: Record<string, boolean>,
  buildFlag: string | undefined,
): boolean {
  if (buildFlag === "1") return true;
  return resolveEnabled(SHELL_FRAME_FEATURE_ID, overrides, false);
}
