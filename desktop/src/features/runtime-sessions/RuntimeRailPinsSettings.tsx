import * as React from "react";

import { useAcpRuntimesQuery } from "@/features/agents/hooks";
import {
  SettingsOptionGroup,
  SettingsOptionRow,
} from "@/features/settings/ui/SettingsOptionGroup";
import { HarnessLogo, HARNESS_LABELS } from "@/shared/ui/HarnessLogo";
import { Switch } from "@/shared/ui/switch";

import { useRuntimeConnectionsQuery } from "./hooks";
import {
  buildRuntimeRailConnections,
  runtimeRailFamilyFromRuntimeId,
  SUPPORTED_RUNTIME_RAIL_FAMILIES,
  type RuntimeRailFamilyId,
} from "./runtimeRailPreferences";
import { useCurrentRuntimeRailPins } from "./useRuntimeRailPins";

function connectionStatus(
  family: RuntimeRailFamilyId,
  connectionByFamily: ReadonlyMap<
    RuntimeRailFamilyId,
    ReturnType<typeof buildRuntimeRailConnections>[number]
  >,
) {
  const connection = connectionByFamily.get(family);
  if (!connection) return "Not installed · appears after discovery";
  if (connection.authentication === "required") {
    return "Installed · sign in required";
  }
  if (connection.readiness === "ready") return "Installed and ready";
  return "Installed · needs attention";
}

export function RuntimeRailPinsSettings() {
  const statusQuery = useRuntimeConnectionsQuery();
  const catalogQuery = useAcpRuntimesQuery();
  const { isReady, pins, setFamilyPinned } = useCurrentRuntimeRailPins();
  const connectionByFamily = React.useMemo(
    () =>
      new Map(
        buildRuntimeRailConnections(
          statusQuery.data ?? [],
          catalogQuery.data ?? [],
        ).flatMap((connection) => {
          const family = runtimeRailFamilyFromRuntimeId(connection.runtimeId);
          return family ? [[family, connection] as const] : [];
        }),
      ),
    [catalogQuery.data, statusQuery.data],
  );
  const pinned = React.useMemo(
    () => new Set(pins.pinnedFamilies),
    [pins.pinnedFamilies],
  );

  return (
    <div className="mt-8" data-testid="runtime-rail-pins-settings">
      <h3 className="mb-2 px-1 text-sm font-medium">Sidebar runtimes</h3>
      <p className="mb-3 px-1 text-sm leading-6 text-muted-foreground">
        Choose which installed harnesses stay within reach. Native Hermes and
        OpenClaw residents remain in the Agent Library.
      </p>
      <SettingsOptionGroup>
        {SUPPORTED_RUNTIME_RAIL_FAMILIES.map((family, index) => {
          const label = HARNESS_LABELS[family];
          const switchId = `runtime-rail-pin-${family}`;
          return (
            <SettingsOptionRow
              className={index === 0 ? undefined : "border-t border-border/45"}
              key={family}
            >
              <div className="flex min-w-0 items-center gap-3">
                <HarnessLogo
                  appearance="brand"
                  decorative
                  harness={family}
                  size={20}
                />
                <div className="min-w-0">
                  <label className="text-sm font-medium" htmlFor={switchId}>
                    {label}
                  </label>
                  <p className="text-sm font-normal text-muted-foreground">
                    {statusQuery.isLoading || catalogQuery.isLoading
                      ? "Checking this Mac…"
                      : connectionStatus(family, connectionByFamily)}
                  </p>
                </div>
              </div>
              <Switch
                aria-label={`Show ${label} in the runtime rail`}
                checked={pinned.has(family)}
                data-testid={switchId}
                disabled={!isReady}
                id={switchId}
                onCheckedChange={(enabled) => setFamilyPinned(family, enabled)}
              />
            </SettingsOptionRow>
          );
        })}
      </SettingsOptionGroup>
    </div>
  );
}
