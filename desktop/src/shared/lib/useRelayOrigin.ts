import * as React from "react";

import { getMediaRoutingSnapshot, subscribeRelayOrigin } from "./mediaUrl";

const SERVER_ROUTING_SNAPSHOT = Object.freeze({
  relayOrigin: null,
  proxyPort: null,
  supervisedLocal: false,
});

/**
 * The resolved relay origin, re-rendering when routing readiness changes.
 *
 * The origin is fetched asynchronously (see `mediaUrl.ts`) and is commonly
 * still `null` on a component's first render. Reading it through this store
 * subscription — rather than a bare synchronous `getCachedRelayOrigin()` —
 * means download eligibility recomputes the moment the origin resolves and
 * again on a workspace switch, instead of being frozen at first-render time.
 * Proxy-port and supervised-local hint changes also refresh consumers that
 * rewrite media URLs, even if the returned relay origin stays the same.
 *
 * The server snapshot has a null origin: there is no relay during SSR/prerender
 * (no Tauri backend), and callers already treat an unresolved origin as
 * "not yet downloadable" (fail closed).
 */
export function useRelayOrigin(): string | null {
  const snapshot = React.useSyncExternalStore(
    subscribeRelayOrigin,
    getMediaRoutingSnapshot,
    () => SERVER_ROUTING_SNAPSHOT,
  );
  return snapshot.relayOrigin;
}
