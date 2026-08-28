import { isTauri } from "@tauri-apps/api/core";

import { isMacPlatform } from "@/shared/lib/platform";
import { useIsFullscreen } from "@/shared/lib/useIsFullscreen";

/** True only while native macOS window controls are visible over app chrome. */
export function useNativeMacChrome(): boolean {
  const isFullscreen = useIsFullscreen();
  return isMacPlatform() && isTauri() && !isFullscreen;
}
