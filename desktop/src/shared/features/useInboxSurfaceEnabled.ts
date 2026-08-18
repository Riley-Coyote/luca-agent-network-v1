import { resolveInboxSurfaceEnabled } from "./inboxSurface";
import { getOverrides } from "./store";
import { useFeatureSnapshot } from "./useFeatureEnabled";

/**
 * Reactive read of the Inbox surface flag. Re-renders when the override
 * changes (including from another window). See `./inboxSurface.ts` for the
 * single value that flips the shipped default.
 */
export function useInboxSurfaceEnabled(): boolean {
  return resolveInboxSurfaceEnabled(useFeatureSnapshot());
}

/**
 * Non-reactive read for callers outside React — router `beforeLoad` guards
 * and other imperative paths.
 */
export function readInboxSurfaceEnabled(): boolean {
  if (typeof window === "undefined") {
    return resolveInboxSurfaceEnabled({});
  }
  return resolveInboxSurfaceEnabled(getOverrides());
}
