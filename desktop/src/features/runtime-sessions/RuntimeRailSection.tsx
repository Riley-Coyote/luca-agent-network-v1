import * as React from "react";

import { useAcpRuntimesQuery } from "@/features/agents/hooks";
import { HarnessLogo, harnessIdFromRuntimeId } from "@/shared/ui/HarnessLogo";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";
import type { RuntimeConnectionStatusV1 } from "@/shared/api/tauriMcp";
import { cn } from "@/shared/lib/cn";

import { useRuntimeConnectionsQuery } from "./hooks";
import {
  runtimeConnectionKey,
  runtimeReadinessLabel,
} from "./runtimeSessionModel";
import {
  buildRuntimeRailConnections,
  filterPinnedRuntimeRailConnections,
} from "./runtimeRailPreferences";
import { useCurrentRuntimeRailPins } from "./useRuntimeRailPins";

export function RuntimeRailSection({
  onSelect,
  selectedRuntimeKey,
}: {
  onSelect: (runtime: RuntimeConnectionStatusV1) => void;
  selectedRuntimeKey: string | null;
}) {
  const query = useRuntimeConnectionsQuery();
  const catalogQuery = useAcpRuntimesQuery();
  const { pins } = useCurrentRuntimeRailPins();
  const runtimes = React.useMemo(
    () =>
      filterPinnedRuntimeRailConnections(
        buildRuntimeRailConnections(query.data ?? [], catalogQuery.data ?? []),
        pins,
      ),
    [catalogQuery.data, pins, query.data],
  );

  const isLoading = query.isLoading || catalogQuery.isLoading;
  if (!isLoading && runtimes.length === 0) return null;

  return (
    <SidebarGroup
      className="group/runtime-section px-0 py-1"
      data-testid="sidebar-runtime-section"
    >
      <SidebarGroupLabel className="px-2 font-mono text-2xs uppercase tracking-caps-wide text-ink-faint">
        Runtimes
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {isLoading ? (
            <li
              aria-live="polite"
              className="px-2 py-1.5 text-xs text-muted-foreground"
            >
              Checking installed runtimes…
            </li>
          ) : (
            runtimes.map((runtime) => {
              const key = runtimeConnectionKey(runtime);
              const isActive = key === selectedRuntimeKey;
              return (
                <SidebarMenuItem key={key}>
                  <SidebarMenuButton
                    aria-controls="runtime-sessions-panel"
                    aria-expanded={isActive}
                    aria-label={`Open ${runtime.label} local sessions`}
                    className={cn(
                      !isActive &&
                        "group-hover/menu-item:bg-sidebar-accent group-hover/menu-item:text-sidebar-accent-foreground",
                    )}
                    data-runtime-connection-key={key}
                    data-testid={`runtime-rail-${runtime.runtimeId}`}
                    isActive={isActive}
                    onClick={() => onSelect(runtime)}
                    tooltip={`${runtime.label} · ${runtimeReadinessLabel(runtime)}`}
                    type="button"
                  >
                    <HarnessLogo
                      appearance="brand"
                      decorative
                      harness={harnessIdFromRuntimeId(runtime.runtimeId)}
                      size={16}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {runtime.label}
                    </span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        runtime.readiness === "ready" &&
                          runtime.authentication !== "required"
                          ? "bg-emerald-400/80"
                          : "bg-amber-400/80",
                      )}
                    />
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
