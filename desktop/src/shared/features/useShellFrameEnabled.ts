import { useClassicLayout } from "./classicLayout";
import { resolveShellFrameEnabled, shellFrameOnByDefault } from "./shellFrame";
import { useFeatureSnapshot } from "./useFeatureEnabled";

// `?.`: node's unit tests render components without Vite's env.
const buildFlag = (): string | undefined =>
  import.meta.env?.VITE_LUCA_SHELL_FRAME;

/** Reactive: whether the shell's frame is drawn (see `./shellFrame.ts`). */
export function useShellFrameEnabled(): boolean {
  return resolveShellFrameEnabled(
    useFeatureSnapshot(),
    buildFlag(),
    useClassicLayout(),
  );
}

/** Whether this build draws the shell by default, so the classic layout is
 *  offered (Settings → Appearance). */
export function useShellFrameOnByDefault(): boolean {
  return shellFrameOnByDefault(buildFlag());
}
