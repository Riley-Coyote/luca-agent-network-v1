import * as React from "react";

import { useAcpRuntimesQuery } from "@/features/agents/hooks";
import {
  RAIL_ROW_CLASS,
  RAIL_SECTION_CLASS,
  RailSectionHeader,
} from "@/features/sidebar/ui/ChatList";
import type { RuntimeConnectionStatusV1 } from "@/shared/api/tauriMcp";
import { HarnessLogo, harnessIdFromRuntimeId } from "@/shared/ui/HarnessLogo";

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
    // The rail's grammar, not the stock sidebar group's: the same header,
    // inset and row as Projects and Agents above it.
    <div
      className={`${RAIL_SECTION_CLASS} px-2`}
      data-testid="sidebar-runtime-section"
    >
      <RailSectionHeader title="Runtimes" />
      {isLoading ? (
        <div
          aria-live="polite"
          className="px-2 py-1.5 text-xs text-muted-foreground"
        >
          Checking installed runtimes…
        </div>
      ) : (
        runtimes.map((runtime) => {
          const key = runtimeConnectionKey(runtime);
          const isOpen = key === selectedRuntimeKey;
          const needsAttention =
            runtime.readiness !== "ready" ||
            runtime.authentication === "required";
          const readiness = runtimeReadinessLabel(runtime);
          return (
            <button
              aria-controls="runtime-sessions-panel"
              aria-expanded={isOpen}
              aria-label={`Open ${runtime.label} local sessions`}
              className={RAIL_ROW_CLASS}
              data-open={isOpen ? "true" : undefined}
              data-runtime-connection-key={key}
              data-sidebar="menu-button"
              data-testid={`runtime-rail-${runtime.runtimeId}`}
              key={key}
              onClick={() => onSelect(runtime)}
              title={`${runtime.label} · ${readiness}`}
              type="button"
            >
              <span className="flex size-5 shrink-0 items-center justify-center text-ink-muted group-data-[open=true]:text-foreground">
                <HarnessLogo
                  decorative
                  harness={harnessIdFromRuntimeId(runtime.runtimeId)}
                  size={14}
                />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">
                {runtime.label}
              </span>
              {/* Connected is the ordinary state and says nothing. Only a
                  runtime that needs the owner wears a mark: a hollow ring,
                  not the unread signal — it is a request, not news. */}
              {needsAttention ? (
                <span
                  aria-label={readiness}
                  className="size-1.5 shrink-0 rounded-full border border-ink-faint"
                  role="img"
                />
              ) : null}
            </button>
          );
        })
      )}
    </div>
  );
}
