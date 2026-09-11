import { isTauri } from "@tauri-apps/api/core";

import { invokeTauri } from "@/shared/api/tauri";

/** The running bundle's identity, as reported by the Rust side. */
export type BuildIdentity = {
  /** The Tauri bundle identifier this build was bundled with. */
  identifier: string;
  /** Whether this build should show the `DEV` mark. */
  isDev: boolean;
};

const RELEASE: BuildIdentity = { identifier: "", isDev: false };

let pending: Promise<BuildIdentity> | null = null;

/**
 * The bundle identity, fetched once per process and cached.
 *
 * Outside Tauri (vitest/node, the browser dev server) there is no bundle, so
 * the answer is "not a dev bundle" — the mark is about the installed identity,
 * not the development server.
 */
export function getBuildIdentity(): Promise<BuildIdentity> {
  if (!pending) {
    pending = isTauri()
      ? invokeTauri<BuildIdentity>("get_build_identity").catch(() => RELEASE)
      : Promise.resolve(RELEASE);
  }
  return pending;
}

/** Test seam: drop the cached answer. */
export function resetBuildIdentityCache(): void {
  pending = null;
}
