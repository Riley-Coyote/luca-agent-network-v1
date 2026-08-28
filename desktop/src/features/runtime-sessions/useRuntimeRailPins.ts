import * as React from "react";

import { useCommunities } from "@/features/communities/useCommunities";
import { useIdentityQuery } from "@/shared/api/hooks";

import {
  DEFAULT_RUNTIME_RAIL_PINS,
  parseRuntimeRailPins,
  type RuntimeRailFamilyId,
  type RuntimeRailPinsV1,
  runtimeRailPinsStorageKey,
  type RuntimeRailPreferenceScope,
  updateRuntimeRailFamilyPin,
} from "./runtimeRailPreferences";

const PINS_CHANGED_EVENT = "luca:runtime-rail-pins-changed";

type PinsChangedDetail = {
  key: string;
  pins: RuntimeRailPinsV1;
};

function readPreference(scope: RuntimeRailPreferenceScope): RuntimeRailPinsV1 {
  const key = runtimeRailPinsStorageKey(scope);
  if (!key) return parseRuntimeRailPins(null);
  try {
    return parseRuntimeRailPins(globalThis.localStorage?.getItem(key));
  } catch {
    return parseRuntimeRailPins(null);
  }
}

function persistPreference(key: string, pins: RuntimeRailPinsV1): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(pins));
  } catch {
    // Device-local persistence is best-effort. The live state still updates.
  }
}

export function useRuntimeRailPins(scope: RuntimeRailPreferenceScope) {
  const { ownerPubkey, workspaceId } = scope;
  const key = runtimeRailPinsStorageKey({ ownerPubkey, workspaceId });
  const [pins, setPins] = React.useState<RuntimeRailPinsV1>(() =>
    readPreference({ ownerPubkey, workspaceId }),
  );

  React.useEffect(() => {
    setPins(readPreference({ ownerPubkey, workspaceId }));
  }, [ownerPubkey, workspaceId]);

  React.useEffect(() => {
    if (!key || typeof window === "undefined") return;

    const handleStorage = (event: StorageEvent) => {
      if (event.key === key) setPins(parseRuntimeRailPins(event.newValue));
    };
    const handleLocalChange = (event: Event) => {
      const detail = (event as CustomEvent<PinsChangedDetail>).detail;
      if (detail?.key === key) setPins(detail.pins);
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(PINS_CHANGED_EVENT, handleLocalChange);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(PINS_CHANGED_EVENT, handleLocalChange);
    };
  }, [key]);

  const setFamilyPinned = React.useCallback(
    (family: RuntimeRailFamilyId, enabled: boolean) => {
      if (!key) return;
      setPins((current) => {
        const next = updateRuntimeRailFamilyPin(current, family, enabled);
        persistPreference(key, next);
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent<PinsChangedDetail>(PINS_CHANGED_EVENT, {
              detail: { key, pins: next },
            }),
          );
        }
        return next;
      });
    },
    [key],
  );

  return {
    isReady: key !== null,
    pins: key ? pins : DEFAULT_RUNTIME_RAIL_PINS,
    setFamilyPinned,
  };
}

export function useCurrentRuntimeRailPins() {
  const identityQuery = useIdentityQuery();
  const communities = useCommunities();
  return useRuntimeRailPins({
    ownerPubkey: identityQuery.data?.pubkey,
    workspaceId: communities.activeCommunity?.id,
  });
}
