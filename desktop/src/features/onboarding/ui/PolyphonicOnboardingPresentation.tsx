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
  /* The same surface with the desktop showing through, for the one case
     where the card IS the window and a native blur sits behind it. */
  "--prototype-raised-glass": "rgba(246, 245, 241, 0.76)",
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
  /* 76%: dark enough that the dendrite's dots hold over a bright desktop,
     open enough that the desktop's colour is unmistakably there. */
  "--prototype-raised-glass": "rgba(20, 20, 22, 0.76)",
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
  /** Omitted where the heading is the whole sentence. */
  description?: string;
  headingRef?: React.Ref<HTMLHeadingElement>;
  id: string;
  title: string;
}) {
  return (
    <header data-testid="polyphonic-step-origin">
      <h1
        className="text-[length:var(--prototype-heading-size)] font-medium leading-[1.15] tracking-[-0.018em] text-[var(--prototype-ink)] !outline-none"
        id={id}
        ref={headingRef}
        tabIndex={-1}
      >
        {title}
      </h1>
      {description ? (
        <p className="mx-auto mt-2 max-w-[34rem] text-[length:var(--prototype-body-size)] leading-[1.375rem] text-[var(--prototype-muted-strong)]">
          {description}
        </p>
      ) : null}
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
  /** What fits on the row's one line. */
  detail: string;
  /** Everything the runtime said, for the row's title. Defaults to `detail`. */
  detailFull?: string;
  disabled?: boolean;
  id: string;
  name: string;
  source: "Hermes" | "OpenClaw";
  status?: "idle" | "importing" | "imported" | "needs-attention";
};

export function PolyphonicPresentationAgentSelector({
  agents,
  compact = false,
  disabled = false,
  emptyMessage,
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
  /** The setup card always lists agents as plain hairline rows. The full
   *  inventory (search, select-all, grouped scroll box) is the conversational
   *  prototype's surface only. */
  compact?: boolean;
  disabled?: boolean;
  /** What the list says once the scan is done and nobody was found. */
  emptyMessage?: string;
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
  if (compact) {
    return (
      <PolyphonicPresentationAgentRows
        agents={agents}
        disabled={disabled}
        emptyMessage={emptyMessage}
        inventoryTestId={inventoryTestId}
        isScanning={isScanning}
        onRescan={onRescan}
        onRetry={onRetry}
        onToggle={onToggle}
        rowTestIdPrefix={rowTestIdPrefix}
        selectedIds={selectedIds}
      />
    );
  }
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
            className="min-h-9 w-full rounded-[8px] border border-[var(--prototype-hairline)] bg-[var(--prototype-field)] py-2 pl-9 pr-3 text-left text-[length:var(--prototype-support-size)] text-[var(--prototype-ink)] outline-none placeholder:text-[var(--prototype-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--prototype-focus)]"
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
              <p className="sticky top-0 z-10 bg-[var(--prototype-recessed)] px-3 pb-1 pt-2 text-2xs font-semibold tracking-caps-wide text-[var(--prototype-muted)] uppercase">
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

/**
 * The agents on this Mac, in exactly the clothes the runtime list wears one
 * page earlier: 52px rows on the pane's own ground, a 12px radius, a hairline
 * that brightens when the row is chosen, and an icon, a name, a detail line
 * and a control at the right — here a checkbox, since more than one may come.
 * No plate under them and no fill inside them: two adjacent pages that list
 * things should list them the same way. Five rows, then it scrolls, so a list
 * never runs past the bottom edge of the card.
 */
function PolyphonicPresentationAgentRows({
  agents,
  disabled,
  emptyMessage = "No agents found yet.",
  inventoryTestId,
  isScanning,
  onRescan,
  onRetry,
  onToggle,
  rowTestIdPrefix,
  selectedIds,
}: {
  agents: readonly PolyphonicPresentationAgent[];
  disabled: boolean;
  emptyMessage?: string;
  inventoryTestId: string;
  isScanning: boolean;
  onRescan?: () => void;
  onRetry?: (id: string) => void;
  onToggle: (id: string) => void;
  rowTestIdPrefix: string;
  selectedIds: ReadonlySet<string>;
}) {
  const scrolls = agents.length > 5;
  return (
    <section
      aria-busy={isScanning}
      aria-label="Discovered agents"
      className={cn(
        "grid min-h-0 grid-cols-1 content-start gap-1",
        // Five rows, then it scrolls: the same height the runtime list is
        // allowed, counted the same way (5 × 52px + 4 × 4px).
        scrolls &&
          "max-h-[17.25rem] overflow-y-auto overscroll-contain [scrollbar-gutter:stable]",
      )}
      data-prototype-scroll-owner={scrolls ? "true" : undefined}
      data-testid={inventoryTestId}
      tabIndex={scrolls ? 0 : undefined}
    >
      {agents.map((agent) => {
        const selected = selectedIds.has(agent.id);
        const status = agent.status ?? "idle";
        const importing = status === "importing";
        const imported = status === "imported";
        const needsAttention = status === "needs-attention";
        // Where an agent came from is part of who it is, so the row says it
        // — unless the runtime's own sentence already opens with the name.
        const sourced = (line: string) =>
          line.toLocaleLowerCase().startsWith(agent.source.toLocaleLowerCase())
            ? line
            : `${agent.source} · ${line}`;
        const detail = importing
          ? "Importing"
          : imported
            ? "Imported"
            : sourced(agent.detail);
        // The row shows one line and the title holds all of it, so a runtime
        // that explains itself in a paragraph cannot push the next row down.
        const detailTitle =
          importing || imported
            ? detail
            : sourced(agent.detailFull ?? agent.detail);
        return (
          <div
            className="flex items-center"
            data-testid={`${rowTestIdPrefix}${agent.id}`}
            key={agent.id}
          >
            <button
              aria-describedby={`onboarding-agent-${agent.id}-detail`}
              aria-pressed={selected}
              className={cn(
                "group relative flex h-[52px] min-w-0 flex-1 items-center gap-3 rounded-[12px] border px-3.5 text-left outline-none transition-[border-color,background-color] duration-[90ms] disabled:cursor-not-allowed disabled:opacity-45",
                // Focus is this row's own border coming up, in place.
                "focus-visible:border-[color-mix(in_srgb,var(--prototype-ink)_50%,transparent)]",
                selected || imported
                  ? "border-[color-mix(in_srgb,var(--prototype-ink)_28%,transparent)]"
                  : "border-[var(--prototype-hairline)] hover:border-[color-mix(in_srgb,var(--prototype-ink)_18%,transparent)]",
              )}
              disabled={disabled || importing || imported || agent.disabled}
              onClick={() => onToggle(agent.id)}
              title={detailTitle}
              type="button"
            >
              <span className="grid size-5 shrink-0 place-items-center text-[var(--prototype-muted)]">
                {importing ? (
                  <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
                ) : needsAttention ? (
                  <TriangleAlert className="size-3.5 text-destructive" />
                ) : (
                  <TerminalSquare className="h-4 w-4" strokeWidth={1.2} />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-[var(--prototype-ink)]">
                  {agent.name}
                </span>
                <span
                  className={cn(
                    "mt-0.5 block truncate text-[length:var(--prototype-support-size)] leading-[1.125rem] text-[var(--prototype-muted)]",
                    needsAttention && "text-destructive",
                  )}
                  id={`onboarding-agent-${agent.id}-detail`}
                >
                  {detail}
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
                  {selected || imported ? <Check className="size-3" /> : null}
                </span>
              ) : null}
            </button>
            {needsAttention && onRetry ? (
              <button
                className="ml-2 min-h-8 rounded-[7px] border border-transparent px-2 text-xs text-[var(--prototype-muted-strong)] outline-none hover:text-[var(--prototype-ink)] focus-visible:border-[color-mix(in_srgb,var(--prototype-ink)_50%,transparent)] focus-visible:outline-none"
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
      {/* With no plate under the list, a sentence about an empty one belongs
          on the same left edge as the question above it. */}
      {isScanning && agents.length === 0 ? (
        <p className="flex min-h-[52px] items-center gap-2 text-[length:var(--prototype-support-size)] text-[var(--prototype-muted)]">
          <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
          Looking for agents on this Mac…
        </p>
      ) : null}
      {!isScanning && agents.length === 0 ? (
        <p className="flex min-h-[52px] items-center gap-3 text-[length:var(--prototype-support-size)] leading-[1.125rem] text-[var(--prototype-muted)]">
          {emptyMessage}
          {onRescan ? (
            <button
              className="shrink-0 rounded-[4px] border border-transparent text-[var(--prototype-muted-strong)] outline-none hover:text-[var(--prototype-ink)] focus-visible:border-[color-mix(in_srgb,var(--prototype-ink)_50%,transparent)] focus-visible:outline-none"
              disabled={disabled}
              onClick={onRescan}
              type="button"
            >
              Scan again
            </button>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}
