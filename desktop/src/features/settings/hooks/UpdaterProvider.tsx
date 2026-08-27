import { createContext, useContext, type ReactNode } from "react";
import { useUpdater } from "./use-updater";

type UpdaterContextValue = ReturnType<typeof useUpdater>;

const UpdaterContext = createContext<UpdaterContextValue | null>(null);

export function UpdaterProvider({ children }: { children: ReactNode }) {
  const updater = useUpdater();
  return <UpdaterContext value={updater}>{children}</UpdaterContext>;
}

export function useUpdaterContext(): UpdaterContextValue {
  const ctx = useContext(UpdaterContext);
  if (!ctx) {
    throw new Error("useUpdaterContext must be used within an UpdaterProvider");
  }
  return ctx;
}

/**
 * The updater as seen from a window that may not own one.
 *
 * Exactly one window runs the updater: checking, downloading and relaunching
 * are app-wide acts, and a second copy would offer the owner two "Update now"
 * buttons for the same install. Pop-out chat windows therefore mount no
 * `UpdaterProvider` — so a surface that merely DISPLAYS update state and is
 * shared with those windows reads it through here and shows nothing when there
 * is nothing to read.
 */
export function useOptionalUpdaterContext(): UpdaterContextValue | null {
  return useContext(UpdaterContext);
}
