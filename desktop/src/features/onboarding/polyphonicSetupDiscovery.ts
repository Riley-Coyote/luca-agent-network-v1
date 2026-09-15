import type { QueryClient } from "@tanstack/react-query";

import { acpRuntimesQueryKey } from "@/features/agents/hooks";
import { operatorForgeSettingsQueryKey } from "@/features/agents/operatorForgeQueries";
import {
  discoverAcpRuntimes,
  discoverNativeResidents,
} from "@/shared/api/tauri";
import { getOperatorForgeSettings } from "@/shared/api/tauriOperatorForge";
import { nativeResidentDiscoveryQueryKey } from "./onboardingAgentImport";

/**
 * What is on this Mac, asked once, at the door.
 *
 * Setup asks this Mac three questions about itself — which AI it has, what
 * the owner's runtime preferences already are, and which agents are living
 * here — and each of them takes the better part of a second. The owner spends
 * that second reading the door, so all three are asked there, and the pages
 * that need them open on answers instead of on spinners.
 *
 * It cannot be a react-query prefetch: the door is above the community query
 * client and the card is below a fresh one, so a cache written on the door is
 * not the cache the card reads. The promise is the thing that crosses, held
 * here at module scope, and each client adopts it when it lands. Whichever
 * resolves first — this, or the page's own query — is what the owner sees;
 * nothing waits on the other.
 *
 * The flow keeps its own `prefetchNativeResidentDiscovery` on the runtime
 * chapter for the walks that never saw a door — a resumed setup, the preview
 * harness. Both write the same key, so they cannot disagree: the earlier
 * answer simply wins.
 */
let settingsInFlight: ReturnType<typeof getOperatorForgeSettings> | null = null;
let runtimesInFlight: ReturnType<typeof discoverAcpRuntimes> | null = null;
let residentsInFlight: ReturnType<typeof discoverNativeResidents> | null = null;

export function startPolyphonicSetupDiscovery() {
  settingsInFlight ??= getOperatorForgeSettings();
  runtimesInFlight ??= discoverAcpRuntimes();
  // The slowest of the three, and two chapters from where it is needed.
  residentsInFlight ??= discoverNativeResidents();
  // Nobody awaits these here; an unhandled rejection is not a reason to log.
  void settingsInFlight.catch(() => undefined);
  void runtimesInFlight.catch(() => undefined);
  void residentsInFlight.catch(() => undefined);
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
  void residentsInFlight
    ?.then((outcome) => seed(nativeResidentDiscoveryQueryKey, outcome))
    .catch(() => undefined);
}

/** Test seam: a new first run must ask again. */
export function resetPolyphonicSetupDiscovery() {
  settingsInFlight = null;
  runtimesInFlight = null;
  residentsInFlight = null;
}
