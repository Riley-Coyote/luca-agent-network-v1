import * as React from "react";
import {
  AlertTriangle,
  Plus,
  Search,
  Settings2,
  UsersRound,
} from "lucide-react";

import { cn } from "@/shared/lib/cn";
import { AgentIdentitySpecimen } from "@/shared/ui/AgentIdentitySpecimen";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  NATIVE_STARTED_DETAIL,
  residentAvailabilityLabel,
  residentSourceLabel,
  type ResidentSummaryViewModel,
} from "./agentLibraryViewModel";

export type AgentLibraryFilter = "all" | "running" | "attention";

function isMockPreview(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("e2e") === "mock";
}

export function AgentLibraryRoster({
  fillPane = false,
  filter,
  onAdd,
  onFilterChange,
  onGroups,
  onOpenDefaults,
  onQueryChange,
  onSelect,
  query,
  residents,
  selectedId,
  showAdd = true,
  showFooter = true,
}: {
  fillPane?: boolean;
  filter: AgentLibraryFilter;
  onAdd: () => void;
  onFilterChange: (filter: AgentLibraryFilter) => void;
  onGroups: () => void;
  onOpenDefaults: () => void;
  onQueryChange: (query: string) => void;
  onSelect: (resident: ResidentSummaryViewModel) => void;
  query: string;
  residents: ResidentSummaryViewModel[];
  selectedId: string | null;
  showAdd?: boolean;
  showFooter?: boolean;
}) {
  const rosterId = React.useId();
  const filterId = (value: AgentLibraryFilter) => `${rosterId}-${value}`;
  const panelId = `${rosterId}-results`;
  const visible = React.useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return residents.filter((resident) => {
      if (
        filter === "running" &&
        resident.availability !== "ready" &&
        resident.availability !== "started" &&
        resident.availability !== "working"
      ) {
        return false;
      }
      if (filter === "attention" && !resident.needsAttention) return false;
      if (!needle) return true;
      return [
        resident.displayName,
        resident.runtimeLabel,
        resident.modelLabel,
      ].some((value) => value?.toLocaleLowerCase().includes(needle));
    });
  }, [filter, query, residents]);

  return (
    <aside
      aria-label="Agent library"
      className={cn(
        "flex min-h-0 w-full shrink-0 flex-col border-border/60 bg-card/45",
        !fillPane && "md:w-[292px] md:border-r",
      )}
    >
      <header className="space-y-4 border-b border-border/55 px-4 pb-4 pt-11 md:pt-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-medium tracking-tight">Agents</h1>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
              <span>
                {residents.length} {residents.length === 1 ? "agent" : "agents"}
              </span>
              {isMockPreview() ? (
                <span className="text-2xs uppercase tracking-caps-wide text-ink-faint">
                  Mock data
                </span>
              ) : null}
            </div>
          </div>
          {showAdd ? (
            <Button
              aria-label="Add agent"
              onClick={onAdd}
              size="icon"
              variant="outline"
            >
              <Plus />
            </Button>
          ) : null}
        </div>
        <label className="relative block" htmlFor={`${rosterId}-search`}>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <span className="sr-only">Search agents</span>
          <Input
            className="h-9 border-border/50 bg-background/35 pl-9"
            id={`${rosterId}-search`}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search agents"
            value={query}
          />
        </label>
        <div
          aria-label="Filter agents"
          className="flex gap-1"
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
              return;
            const tabs = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                '[role="tab"]',
              ),
            );
            const current = tabs.indexOf(event.target as HTMLButtonElement);
            if (current < 0) return;
            event.preventDefault();
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? tabs.length - 1
                  : (current +
                      (event.key === "ArrowRight" ? 1 : -1) +
                      tabs.length) %
                    tabs.length;
            tabs[next]?.focus();
            tabs[next]?.click();
          }}
          role="tablist"
        >
          <RosterFilter
            active={filter === "all"}
            id={filterId("all")}
            label="All"
            onClick={() => onFilterChange("all")}
            panelId={panelId}
          />
          <RosterFilter
            active={filter === "running"}
            id={filterId("running")}
            label="Running"
            onClick={() => onFilterChange("running")}
            panelId={panelId}
          />
          <RosterFilter
            active={filter === "attention"}
            id={filterId("attention")}
            label="Attention"
            onClick={() => onFilterChange("attention")}
            panelId={panelId}
          />
        </div>
      </header>

      <div
        aria-labelledby={filterId(filter)}
        className="min-h-0 flex-1 overflow-y-auto py-2"
        id={panelId}
        role="tabpanel"
      >
        {visible.length > 0 ? (
          <div className="space-y-0.5 px-2">
            {visible.map((resident) => (
              <ResidentRosterRow
                key={resident.residentId}
                onClick={() => onSelect(resident)}
                resident={resident}
                selected={resident.residentId === selectedId}
              />
            ))}
          </div>
        ) : (
          <div className="px-5 py-12 text-center">
            <p className="text-sm text-foreground">No matching agents</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Change the filter or add another agent.
            </p>
          </div>
        )}
      </div>

      {showFooter ? (
        <footer className="grid grid-cols-2 border-t border-border/55 p-2">
          <Button className="justify-start" onClick={onGroups} variant="ghost">
            <UsersRound /> Groups
          </Button>
          <Button
            className="justify-start"
            onClick={onOpenDefaults}
            variant="ghost"
          >
            <Settings2 /> Defaults
          </Button>
        </footer>
      ) : null}
    </aside>
  );
}

function RosterFilter({
  active,
  id,
  label,
  onClick,
  panelId,
}: {
  active: boolean;
  id: string;
  label: string;
  onClick: () => void;
  panelId: string;
}) {
  return (
    <button
      aria-controls={panelId}
      aria-selected={active}
      className={cn(
        "min-h-7 rounded-md px-2.5 text-xs transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/45 hover:text-foreground",
      )}
      id={id}
      onClick={onClick}
      role="tab"
      tabIndex={active ? 0 : -1}
      type="button"
    >
      {label}
    </button>
  );
}

function ResidentRosterRow({
  onClick,
  resident,
  selected,
}: {
  onClick: () => void;
  resident: ResidentSummaryViewModel;
  selected: boolean;
}) {
  const identityState =
    resident.availability === "failed"
      ? "fault"
      : resident.availability === "offline" || resident.kind === "persona_only"
        ? "unavailable"
        : resident.availability === "working"
          ? "working"
          : resident.availability === "idle"
            ? "idle"
            : "present";

  return (
    <button
      aria-current={selected ? "page" : undefined}
      className={cn(
        "group flex min-h-16 w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
        selected
          ? "bg-muted/80 text-foreground"
          : "text-foreground hover:bg-muted/40",
      )}
      data-testid={`agent-library-row-${resident.residentId}`}
      onClick={onClick}
      title={
        resident.availability === "started" ? NATIVE_STARTED_DETAIL : undefined
      }
      type="button"
    >
      {resident.pubkey ? (
        <AgentIdentitySpecimen
          accessibleName={resident.displayName}
          avatarUrl={resident.avatarUrl}
          publicKey={resident.pubkey}
          size={32}
          state={identityState}
        />
      ) : (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-dashed border-border/70 font-mono text-xs text-muted-foreground">
          {resident.displayName.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium">
            {resident.displayName}
          </span>
          {resident.needsAttention ? (
            <AlertTriangle
              aria-label="Needs attention"
              className="size-3.5 shrink-0 text-destructive"
            />
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {residentSourceLabel(resident)} ·{" "}
          {residentAvailabilityLabel(resident.availability)}
          {resident.wakesWithApp ? (
            <span
              className="text-ink-faint"
              data-testid="agent-library-wakes-with-app"
            >
              {" "}
              · wakes with the app
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}
