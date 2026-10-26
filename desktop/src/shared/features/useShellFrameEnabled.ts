import { resolveShellFrameEnabled } from "./shellFrame";
import { useFeatureSnapshot } from "./useFeatureEnabled";

/** Reactive: whether the shell's frame is drawn (see `./shellFrame.ts`). */
export function useShellFrameEnabled(): boolean {
  return resolveShellFrameEnabled(
    useFeatureSnapshot(),
    // `?.`: node's unit tests render components without Vite's env.
    import.meta.env?.VITE_LUCA_SHELL_FRAME,
  );
}
