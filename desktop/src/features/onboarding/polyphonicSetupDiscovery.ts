import type { QueryClient } from "@tanstack/react-query";

import { acpRuntimesQueryKey } from "@/features/agents/hooks";
import { operatorForgeSettingsQueryKey } from "@/features/agents/operatorForgeQueries";
import { discoverAcpRuntimes } from "@/shared/api/tauri";
import { getOperatorForgeSettings } from "@/shared/api/tauriOperatorForge";

/**
 * What is on this Mac, asked once, at the door.
 *
 * Finding the AI installed here takes the better part of a second, and the
 * owner spends that second reading the door — so the question is asked there
 * and the runtime page opens on its answer instead of on a spinner.
 *
 * It cannot be a react-query prefetch: the door is above the community query
 * client and the card is below a fresh one, so a cache written on the door is
 * not the cache the card reads. The promise is the thing that crosses, held
 * here at module scope, and each client adopts it when it lands. Whichever
 * resolves first — this, or the page's own query — is what the owner sees;
 * nothing waits on the other.
 */
let settingsInFlight: ReturnType<typeof getOperatorForgeSettings> | null = null;
let runtimesInFlight: ReturnType<typeof discoverAcpRuntimes> | null = null;

export function startPolyphonicSetupDiscovery() {
  settingsInFlight ??= getOperatorForgeSettings();
  runtimesInFlight ??= discoverAcpRuntimes();
  // Nobody awaits these here; an unhandled rejection is not a reason to log.
  void settingsInFlight.catch(() => undefined);
  void runtimesInFlight.catch(() => undefined);
}

/**
 * Hand whatever the door started to this query client, without displacing
 * anything fresher it already has.
 */
export function adoptPolyphonicSetupDiscovery(queryClient: QueryClient) {
  startPolyphonicSetupDiscovery();
  const seed = <T>(key: readonly unknown[], value: T) => {
    if (queryClient.getQueryData(key) === undefined) {
      queryClient.setQueryData(key, value);
    }
  };
  void settingsInFlight
    ?.then((settings) => seed(operatorForgeSettingsQueryKey, settings))
    .catch(() => undefined);
  void runtimesInFlight
    ?.then((runtimes) => seed(acpRuntimesQueryKey, runtimes))
    .catch(() => undefined);
}

/** Test seam: a new first run must ask again. */
export function resetPolyphonicSetupDiscovery() {
  settingsInFlight = null;
  runtimesInFlight = null;
}
