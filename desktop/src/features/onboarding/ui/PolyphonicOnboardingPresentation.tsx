import type * as React from "react";
import {
  Check,
  LoaderCircle,
  Monitor,
  Moon,
  RefreshCw,
  Search,
  Sun,
  TerminalSquare,
  TriangleAlert,
} from "lucide-react";

import { cn } from "@/shared/lib/cn";

export type PolyphonicPresentationPalette = React.CSSProperties &
  Record<`--prototype-${string}`, string>;

export const polyphonicLightPalette: PolyphonicPresentationPalette = {
  "--prototype-accent": "#30312d",
  "--prototype-accent-ink": "#ffffff",
  "--prototype-body-size": "0.9375rem",
  "--prototype-canvas": "#e9e8e3",
  "--prototype-elevated": "#ffffff",
  "--prototype-field": "#f1f0ec",
  "--prototype-focus": "-webkit-focus-ring-color",
  "--prototype-hairline": "rgba(34, 35, 31, 0.11)",
  "--prototype-hairline-soft": "rgba(34, 35, 31, 0.065)",
  "--prototype-grid-dot": "rgba(33, 34, 30, 0.05)",
  "--prototype-heading-size": "1.75rem",
  "--prototype-ink": "#242521",
  "--prototype-muted": "#686963",
  "--prototype-muted-strong": "#575852",
  "--prototype-raised": "#f6f5f1",
  "--prototype-recessed": "#e3e2dd",
  "--prototype-selection": "rgba(38, 39, 34, 0.055)",
  "--prototype-shadow": "rgba(27, 28, 24, 0.09)",
  "--prototype-support-size": "0.8125rem",
  colorScheme: "light",
};

export const polyphonicDarkPalette: PolyphonicPresentationPalette = {
  "--prototype-accent": "rgba(244, 243, 240, 0.93)",
  "--prototype-accent-ink": "#0e0e10",
  "--prototype-body-size": "0.9375rem",
  "--prototype-canvas": "#060608",
  "--prototype-elevated": "#222224",
  "--prototype-field": "#0e0e10",
  "--prototype-focus": "-webkit-focus-ring-color",
  "--prototype-hairline": "rgba(220, 219, 216, 0.08)",
  "--prototype-hairline-soft": "rgba(220, 219, 216, 0.045)",
  "--prototype-grid-dot": "rgba(220, 219, 216, 0.035)",
  "--prototype-heading-size": "1.75rem",
  "--prototype-ink": "rgba(244, 243, 240, 0.93)",
  "--prototype-muted": "rgba(210, 208, 204, 0.68)",
  "--prototype-muted-strong": "rgba(210, 208, 204, 0.78)",
  "--prototype-raised": "#141416",
  "--prototype-recessed": "#0a0a0c",
  "--prototype-selection": "rgba(220, 219, 216, 0.07)",
  "--prototype-shadow": "rgba(0, 0, 0, 0.42)",
  "--prototype-support-size": "0.8125rem",
  colorScheme: "dark",
};

export function PolyphonicPresentationHeading({
  description,
  headingRef,
  id,
  title,
}: {
  description: string;
  headingRef?: React.Ref<HTMLHeadingElement>;
  id: string;
  title: string;
}) {
  return (
    <header data-testid="polyphonic-step-origin">
      <h1
        className="text-[length:var(--prototype-heading-size)] font-medium leading-[1.15] tracking-[-0.018em] text-[var(--prototype-ink)] outline-none"
        id={id}
        ref={headingRef}
        tabIndex={-1}
      >
        {title}
      </h1>
      <p className="mt-2 max-w-[34rem] text-[length:var(--prototype-body-size)] leading-[1.375rem] text-[var(--prototype-muted-strong)]">
        {description}
      </p>
    </header>
  );
}

export type PolyphonicAppearance = "system" | "light" | "dark";

/** Tiny surface swatches: what the app will look like, not what this card looks like. */
const APPEARANCE_SWATCH: Record<PolyphonicAppearance, string> = {
  system: "linear-gradient(135deg, #f6f5f1 50%, #141416 50%)",
  light: "#f6f5f1",
  dark: "#141416",
};

export function PolyphonicPresentationAppearanceControl({
  appearance,
  onChange,
  swatches = false,
}: {
  appearance: PolyphonicAppearance;
  onChange: (appearance: PolyphonicAppearance) => void;
  /** Show a surface swatch instead of an icon. Used where the card itself
   *  does not change with the choice, so the choice needs a preview. */
  swatches?: boolean;
}) {
  const options = [
    { icon: Monitor, label: "System", value: "system" as const },
    { icon: Sun, label: "Light", value: "light" as const },
    { icon: Moon, label: "Dark", value: "dark" as const },
  ];
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-medium text-[var(--prototype-muted-strong)]">
        Appearance
      </legend>
      <div className="inline-flex rounded-[9px] bg-[var(--prototype-selection)] p-[3px]">
        {options.map((option) => {
          const Icon = option.icon;
          const active = appearance === option.value;
          return (
            <button
              aria-pressed={active}
              className={cn(
                "flex min-h-8 items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-xs font-medium transition-[background-color,color,box-shadow] duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--prototype-focus)]",
                active
                  ? "bg-[var(--prototype-field)] text-[var(--prototype-ink)] shadow-[0_1px_2px_var(--prototype-shadow)]"
                  : "text-[var(--prototype-muted)] hover:text-[var(--prototype-ink)]",
              )}
              key={option.value}
              onClick={() => onChange(option.value)}
              type="button"
            >
              {swatches ? (
                <span
                  aria-hidden="true"
                  className="size-3 rounded-full border border-[var(--prototype-hairline)]"
                  style={{ background: APPEARANCE_SWATCH[option.value] }}
                />
              ) : (
                <Icon className="size-3.5" />
              )}
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export type PolyphonicPresentationAgent = {
  detail: string;
  disabled?: boolean;
  id: string;
  name: string;
  source: "Hermes" | "OpenClaw";
  status?: "idle" | "importing" | "imported" | "needs-attention";
};

export function PolyphonicPresentationAgentSelector({
  agents,
  disabled = false,
  isScanning = false,
  onClear,
  onQueryChange,
  onRescan,
  onRetry,
  onSelectAll,
  onToggle,
  query,
  inventoryTestId = "onboarding-agent-import-list",
  rowTestIdPrefix = "onboarding-agent-row-",
  selectedIds,
}: {
  agents: readonly PolyphonicPresentationAgent[];
  disabled?: boolean;
  isScanning?: boolean;
  onClear: () => void;
  onQueryChange: (query: string) => void;
  onRescan?: () => void;
  onRetry?: (id: string) => void;
  onSelectAll: () => void;
  onToggle: (id: string) => void;
  query: string;
  inventoryTestId?: string;
  rowTestIdPrefix?: string;
  selectedIds: ReadonlySet<string>;
}) {
  const normalized = query.trim().toLocaleLowerCase();
  const visibleAgents = agents.filter(
    (agent) =>
      !normalized ||
      `${agent.name} ${agent.detail} ${agent.source}`
        .toLocaleLowerCase()
        .includes(normalized),
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="agents-select">
      <div className="shrink-0">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[var(--prototype-muted)]" />
          <input
            aria-label="Search agents"
            className="min-h-9 w-full rounded-[8px] border border-[var(--prototype-hairline)] bg-[var(--prototype-field)] py-2 pl-9 pr-3 text-[length:var(--prototype-support-size)] text-[var(--prototype-ink)] outline-none placeholder:text-[var(--prototype-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--prototype-focus)]"
            disabled={disabled}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search agents"
            value={query}
          />
        </label>
        <div className="mt-2.5 flex min-h-8 items-center gap-5 text-xs">
          <button
            className="rounded-[4px] text-[var(--prototype-muted-strong)] hover:text-[var(--prototype-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--prototype-focus)] disabled:opacity-40"
            disabled={disabled}
            onClick={onSelectAll}
            type="button"
          >
            Select all ready
          </button>
          <button
            className="rounded-[4px] text-[var(--prototype-muted)] hover:text-[var(--prototype-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--prototype-focus)] disabled:opacity-40"
            disabled={disabled || selectedIds.size === 0}
            onClick={onClear}
            type="button"
          >
            Clear
          </button>
          <span
            aria-live="polite"
            className="ml-auto flex items-center gap-2 text-[var(--prototype-muted)]"
            role="status"
          >
            {selectedIds.size} selected
            {onRescan ? (
              <button
                aria-label="Scan again"
                className="grid size-7 place-items-center rounded-[6px] hover:bg-[var(--prototype-selection)] hover:text-[var(--prototype-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--prototype-focus)] disabled:opacity-40"
                disabled={disabled || isScanning}
                onClick={onRescan}
                type="button"
              >
                <RefreshCw
                  className={cn(
                    "size-3.5",
                    isScanning && "animate-spin motion-reduce:animate-none",
                  )}
                />
              </button>
            ) : null}
          </span>
        </div>
      </div>
      <section
        aria-busy={isScanning}
        aria-label="Discovered agents"
        className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-[9px] bg-[var(--prototype-recessed)] p-1 [scroll-padding-block:0.5rem] [scrollbar-gutter:stable] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--prototype-focus)]"
        data-prototype-scroll-owner="true"
        data-testid={inventoryTestId}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the independently scrollable inventory must be keyboard reachable
        tabIndex={0}
      >
        {isScanning && agents.length === 0 ? (
          <div className="grid h-full min-h-40 place-items-center text-[var(--prototype-muted)]">
            <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
          </div>
        ) : null}
        {(["Hermes", "OpenClaw"] as const).map((source) => {
          const group = visibleAgents.filter(
            (agent) => agent.source === source,
          );
          if (!group.length) return null;
          return (
            <div key={source}>
              <p className="sticky top-0 z-10 bg-[var(--prototype-recessed)] px-3 pb-1 pt-2 text-2xs font-semibold tracking-[0.12em] text-[var(--prototype-muted)] uppercase">
                {source}
              </p>
              {group.map((agent) => {
                const selected = selectedIds.has(agent.id);
                const status = agent.status ?? "idle";
                const importing = status === "importing";
                const imported = status === "imported";
                const needsAttention = status === "needs-attention";
                return (
                  <div
                    className="flex min-h-11 items-center"
                    data-testid={`${rowTestIdPrefix}${agent.id}`}
                    key={agent.id}
                  >
                    <button
                      aria-describedby={`onboarding-agent-${agent.id}-detail`}
                      aria-pressed={selected}
                      className={cn(
                        "flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-[7px] px-3 py-2 text-left text-[var(--prototype-ink)] hover:bg-[var(--prototype-selection)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--prototype-focus)] disabled:cursor-not-allowed disabled:opacity-45",
                        (selected || imported) &&
                          "bg-[var(--prototype-raised)]",
                      )}
                      disabled={
                        disabled || importing || imported || agent.disabled
                      }
                      onClick={() => onToggle(agent.id)}
                      type="button"
                    >
                      <span className="grid size-4 shrink-0 place-items-center text-[var(--prototype-muted)]">
                        {importing ? (
                          <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
                        ) : imported ? (
                          <Check className="size-3.5" />
                        ) : needsAttention ? (
                          <TriangleAlert className="size-3.5" />
                        ) : (
                          <TerminalSquare
                            className="size-4"
                            strokeWidth={1.2}
                          />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">
                          {agent.name}
                        </span>
                        <span
                          className={cn(
                            "block text-[length:var(--prototype-support-size)] leading-[1.125rem] text-[var(--prototype-muted)]",
                            needsAttention && "text-destructive",
                          )}
                          id={`onboarding-agent-${agent.id}-detail`}
                        >
                          {importing
                            ? "Importing"
                            : imported
                              ? "Imported"
                              : agent.detail}
                        </span>
                      </span>
                      {!needsAttention ? (
                        <span
                          aria-hidden="true"
                          className={cn(
                            "grid size-4 shrink-0 place-items-center rounded-[5px] border",
                            selected || imported
                              ? "border-[var(--prototype-ink)] bg-[var(--prototype-ink)] text-[var(--prototype-field)]"
                              : "border-[var(--prototype-hairline)]",
                          )}
                        >
                          {selected || imported ? (
                            <Check className="size-3" />
                          ) : null}
                        </span>
                      ) : null}
                    </button>
                    {needsAttention && onRetry ? (
                      <button
                        className="mr-2 min-h-8 rounded-[7px] px-2 text-xs text-[var(--prototype-muted-strong)] hover:bg-[var(--prototype-selection)] hover:text-[var(--prototype-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--prototype-focus)]"
                        disabled={disabled}
                        onClick={() => onRetry(agent.id)}
                        type="button"
                      >
                        Retry
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          );
        })}
        {!isScanning && visibleAgents.length === 0 ? (
          <p className="px-3 py-8 text-center text-[length:var(--prototype-support-size)] leading-[1.125rem] text-[var(--prototype-muted)]">
            {normalized ? "No matching agents" : "No agents found yet."}
          </p>
        ) : null}
      </section>
    </div>
  );
}
