import { resolveEnabled } from "./resolveEnabled";

/**
 * The shell's frame (docs/luca/rail-system/SHELL_SPEC.md): a preview feature,
 * off by default, listed in `preview-features.json`.
 */
export const SHELL_FRAME_FEATURE_ID = "shell-frame";

/** The value `<html data-luca-frame>` carries while the frame is on. */
export const SHELL_FRAME_ATTRIBUTE_VALUE = "solid";

/** Whether this build draws the shell by default: a build made with
 *  `VITE_LUCA_SHELL_FRAME=1` (the beta and the test apps). Only there is the
 *  classic layout offered. */
export function shellFrameOnByDefault(buildFlag: string | undefined): boolean {
  return buildFlag === "1";
}

/**
 * Pure resolution: a build made with `VITE_LUCA_SHELL_FRAME=1` ships with the
 * frame on, unless the classic layout is chosen (`./classicLayout.ts`);
 * otherwise the preview override decides, off when there is none, and the
 * classic choice is not read.
 */
export function resolveShellFrameEnabled(
  overrides: Record<string, boolean>,
  buildFlag: string | undefined,
  classicLayout = false,
): boolean {
  if (shellFrameOnByDefault(buildFlag)) return !classicLayout;
  return resolveEnabled(SHELL_FRAME_FEATURE_ID, overrides, false);
}
