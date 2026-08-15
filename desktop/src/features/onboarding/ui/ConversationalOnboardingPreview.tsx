import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  Monitor,
  Moon,
  Pencil,
  RefreshCw,
  Search,
  Send,
  Sun,
  TerminalSquare,
  X,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import * as React from "react";

import { cn } from "@/shared/lib/cn";
import { useSystemColorScheme } from "@/shared/theme/useSystemColorScheme";
import { DotSigil } from "@/shared/ui/dot-display/DotSigil";
import { StartupWindowDragRegion } from "@/shared/ui/StartupWindowDragRegion";
import chatgptLogoUrl from "../assets/harness-logos/chatgpt.png?inline";
import claudeLogoUrl from "../assets/harness-logos/claude.png?inline";
import grokLogoUrl from "../assets/harness-logos/grok-mark.svg?inline";
import kimiLogoUrl from "../assets/harness-logos/kimi-mark.svg?inline";
import { POLYPHONIC_IDENTITY_SEED } from "./PolyphonicThresholdField";

type Appearance = "system" | "light" | "dark";
type PrototypeState =
  | "welcome"
  | "runtime"
  | "agents-summary"
  | "agents-select"
  | "preparing"
  | "conversation"
  | "proposal";
type PrototypeScenario =
  | "mixed"
  | "codex-auth"
  | "claude-auth"
  | "install"
  | "hermes-only"
  | "openclaw-only"
  | "none-ready"
  | "setup-success"
  | "setup-failure"
  | "agents-found"
  | "agents-none"
  | "agents-delayed"
  | "agents-failed";
type RuntimeId = "codex" | "claude" | "kimi" | "grok" | "hermes" | "openclaw";
type RuntimeStatus =
  | "ready"
  | "sign-in"
  | "set-up"
  | "checking"
  | "unavailable";
type RuntimeAction = "sign-in" | "install" | "guide" | "check";
type DiscoveryStatus = "found" | "none" | "delayed" | "failed";

type RuntimeChoice = {
  action?: RuntimeAction;
  detail: string;
  iconUrl?: string;
  id: RuntimeId;
  name: string;
  recommended?: boolean;
  status: RuntimeStatus;
};

type AgentCandidate = {
  disabledReason?: string;
  id: string;
  name: string;
  source: "Hermes" | "OpenClaw";
};

type PrototypePalette = React.CSSProperties &
  Record<`--prototype-${string}`, string>;

const lightPalette: PrototypePalette = {
  "--prototype-accent": "#30312d",
  "--prototype-accent-ink": "#ffffff",
  "--prototype-canvas": "#efeee9",
  "--prototype-field": "#deddd8",
  "--prototype-hairline": "rgba(34, 35, 31, 0.11)",
  "--prototype-hairline-soft": "rgba(34, 35, 31, 0.065)",
  "--prototype-ink": "#242521",
  "--prototype-muted": "#777871",
  "--prototype-muted-strong": "#575852",
  "--prototype-raised": "#efeee9",
  "--prototype-selection": "rgba(38, 39, 34, 0.06)",
  "--prototype-shadow": "rgba(27, 28, 24, 0.1)",
  colorScheme: "light",
};

const darkPalette: PrototypePalette = {
  "--prototype-accent": "#f1f1ed",
  "--prototype-accent-ink": "#171815",
  "--prototype-canvas": "#11120f",
  "--prototype-field": "#1b1c18",
  "--prototype-hairline": "rgba(244, 244, 238, 0.13)",
  "--prototype-hairline-soft": "rgba(244, 244, 238, 0.07)",
  "--prototype-ink": "#f0f0ec",
  "--prototype-muted": "#95968f",
  "--prototype-muted-strong": "#b2b3ac",
  "--prototype-raised": "#171814",
  "--prototype-selection": "rgba(244, 244, 238, 0.075)",
  "--prototype-shadow": "rgba(0, 0, 0, 0.42)",
  colorScheme: "dark",
};

const prototypeStates = new Set<PrototypeState>([
  "welcome",
  "runtime",
  "agents-summary",
  "agents-select",
  "preparing",
  "conversation",
  "proposal",
]);

const prototypeScenarios = new Set<PrototypeScenario>([
  "mixed",
  "codex-auth",
  "claude-auth",
  "install",
  "hermes-only",
  "openclaw-only",
  "none-ready",
  "setup-success",
  "setup-failure",
  "agents-found",
  "agents-none",
  "agents-delayed",
  "agents-failed",
]);

const statusLabels: Record<RuntimeStatus, string> = {
  ready: "Ready",
  "sign-in": "Sign in",
  "set-up": "Set up",
  checking: "Checking",
  unavailable: "Unavailable",
};

const agentCandidates: AgentCandidate[] = [
  { id: "hermes-default", name: "default", source: "Hermes" },
  { id: "hermes-axiom", name: "axiom", source: "Hermes" },
  { id: "hermes-bobby", name: "bobby", source: "Hermes" },
  {
    disabledReason: "This profile uses an unsupported schema version.",
    id: "hermes-archive",
    name: "archive",
    source: "Hermes",
  },
  { id: "openclaw-main", name: "main", source: "OpenClaw" },
  { id: "openclaw-anima", name: "Anima", source: "OpenClaw" },
  { id: "openclaw-iris", name: "iris", source: "OpenClaw" },
  { id: "openclaw-flux", name: "flux", source: "OpenClaw" },
];

function readQueryValue<T extends string>(
  key: string,
  values: Set<T>,
  fallback: T,
): T {
  const value = new URL(window.location.href).searchParams.get(key);
  return values.has(value as T) ? (value as T) : fallback;
}

function readPrototypeState(): PrototypeState {
  return readQueryValue("prototypeState", prototypeStates, "welcome");
}

function readPrototypeScenario(): PrototypeScenario {
  return readQueryValue("prototypeScenario", prototypeScenarios, "mixed");
}

function discoveryForScenario(scenario: PrototypeScenario): DiscoveryStatus {
  if (scenario === "agents-none") return "none";
  if (scenario === "agents-delayed") return "delayed";
  if (scenario === "agents-failed") return "failed";
  return "found";
}

function baseRuntimeChoices(): RuntimeChoice[] {
  return [
    {
      detail: "Full conversations and collaboration with Luca.",
      iconUrl: chatgptLogoUrl,
      id: "codex",
      name: "Codex",
      recommended: true,
      status: "ready",
    },
    {
      action: "sign-in",
      detail: "Full conversations and collaboration with Luca.",
      iconUrl: claudeLogoUrl,
      id: "claude",
      name: "Claude Code",
      status: "sign-in",
    },
    {
      action: "install",
      detail: "Full conversations and collaboration with Luca.",
      iconUrl: kimiLogoUrl,
      id: "kimi",
      name: "Kimi Code",
      status: "set-up",
    },
    {
      detail: "This runtime is not available in the current fixture.",
      iconUrl: grokLogoUrl,
      id: "grok",
      name: "Grok",
      status: "unavailable",
    },
    {
      action: "guide",
      detail:
        "Direct conversations and existing native agents. Advanced collaboration is limited.",
      id: "hermes",
      name: "Hermes",
      status: "set-up",
    },
    {
      action: "guide",
      detail:
        "Direct conversations and existing native agents. Advanced collaboration is limited.",
      id: "openclaw",
      name: "OpenClaw",
      status: "set-up",
    },
  ];
}

function runtimeChoicesForScenario(
  scenario: PrototypeScenario,
): RuntimeChoice[] {
  const runtimes = baseRuntimeChoices();
  const setOnlyReady = (id: RuntimeId) =>
    runtimes.map((runtime) => ({
      ...runtime,
      action: runtime.id === id ? undefined : runtime.action,
      recommended: runtime.id === id,
      status: runtime.id === id ? ("ready" as const) : ("unavailable" as const),
    }));

  if (scenario === "hermes-only") return setOnlyReady("hermes");
  if (scenario === "openclaw-only") return setOnlyReady("openclaw");
  if (
    scenario === "codex-auth" ||
    scenario === "setup-success" ||
    scenario === "setup-failure"
  ) {
    return runtimes.map((runtime) => ({
      ...runtime,
      action: runtime.id === "codex" ? "sign-in" : runtime.action,
      recommended: runtime.id === "codex",
      status:
        runtime.id === "codex"
          ? ("sign-in" as const)
          : ("unavailable" as const),
    }));
  }
  if (scenario === "claude-auth") {
    return runtimes.map((runtime) => ({
      ...runtime,
      action: runtime.id === "claude" ? "sign-in" : runtime.action,
      recommended: runtime.id === "claude",
      status:
        runtime.id === "claude"
          ? ("sign-in" as const)
          : ("unavailable" as const),
    }));
  }
  if (scenario === "install") {
    return runtimes.map((runtime) => ({
      ...runtime,
      action: runtime.id === "kimi" ? "install" : runtime.action,
      recommended: runtime.id === "kimi",
      status:
        runtime.id === "kimi" ? ("set-up" as const) : ("unavailable" as const),
    }));
  }
  if (scenario === "none-ready") {
    return runtimes.map((runtime) => ({
      ...runtime,
      recommended: runtime.id === "codex",
      status:
        runtime.id === "codex" || runtime.id === "claude"
          ? ("sign-in" as const)
          : runtime.id === "grok"
            ? ("unavailable" as const)
            : ("set-up" as const),
    }));
  }
  return runtimes;
}

function LucaMark({
  appearance,
  size = 26,
}: {
  appearance: "light" | "dark";
  size?: number;
}) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center"
      style={{ height: size, width: size }}
    >
      <DotSigil
        cell={3}
        dot={appearance === "dark" ? "244,244,238" : "39,40,36"}
        scene="sigil"
        seed={POLYPHONIC_IDENTITY_SEED}
        size={size}
      />
    </span>
  );
}

function RuntimeMark({ runtime }: { runtime: RuntimeChoice }) {
  if (runtime.iconUrl) {
    return (
      <img alt="" className="size-5 object-contain" src={runtime.iconUrl} />
    );
  }
  return (
    <TerminalSquare
      aria-hidden
      className="size-5 text-[var(--prototype-muted-strong)]"
      strokeWidth={1.35}
    />
  );
}

function PrototypeHeader({ appearance }: { appearance: "light" | "dark" }) {
  return (
    <header className="flex h-9 items-center gap-2.5">
      <LucaMark appearance={appearance} size={20} />
      <span className="text-[14px] font-semibold tracking-[-0.015em]">
        Polyphonic
      </span>
    </header>
  );
}

function PrimaryButton({
  children,
  disabled = false,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="inline-flex h-9 items-center justify-center gap-2 rounded-[9px] bg-[var(--prototype-accent)] px-4 text-[13px] font-semibold text-[var(--prototype-accent-ink)] shadow-[0_1px_2px_var(--prototype-shadow)] transition-[opacity,transform] duration-150 hover:opacity-90 active:translate-y-px disabled:pointer-events-none disabled:opacity-35"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function QuietButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className="rounded-[7px] px-1 py-1 text-[13px] text-[var(--prototype-muted)] transition-colors hover:text-[var(--prototype-ink)]"
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function SetupFrame({
  appearance,
  children,
  footer,
}: {
  appearance: "light" | "dark";
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <section className="flex h-[calc(100dvh-2rem)] min-h-[22rem] w-full max-w-[39rem] flex-col overflow-hidden rounded-[15px] border border-[var(--prototype-hairline)] bg-[color-mix(in_srgb,var(--prototype-field)_96%,transparent)] shadow-[0_24px_70px_var(--prototype-shadow)] sm:max-h-[38rem]">
      <div className="shrink-0 px-8 pt-6 sm:px-10">
        <PrototypeHeader appearance={appearance} />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-8 pb-5 pt-5 sm:px-10">
        {children}
      </div>
      <footer className="flex min-h-14 shrink-0 items-center justify-between border-t border-[var(--prototype-hairline-soft)] px-8 sm:px-10">
        {footer}
      </footer>
    </section>
  );
}

function AppearanceControl({
  appearance,
  onChange,
}: {
  appearance: Appearance;
  onChange: (appearance: Appearance) => void;
}) {
  const options = [
    { icon: Monitor, label: "System", value: "system" as const },
    { icon: Sun, label: "Light", value: "light" as const },
    { icon: Moon, label: "Dark", value: "dark" as const },
  ];
  return (
    <fieldset>
      <legend className="mb-2 text-[12px] font-medium text-[var(--prototype-muted-strong)]">
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
                "flex h-8 items-center gap-1.5 rounded-[7px] px-3 text-[12px] font-medium transition-[background-color,color,box-shadow] duration-150",
                active
                  ? "bg-[var(--prototype-field)] text-[var(--prototype-ink)] shadow-[0_1px_2px_var(--prototype-shadow)]"
                  : "text-[var(--prototype-muted)] hover:text-[var(--prototype-ink)]",
              )}
              key={option.value}
              onClick={() => onChange(option.value)}
              type="button"
            >
              <Icon className="size-3.5" />
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function WelcomeState({
  appearance,
  name,
  onAppearanceChange,
  onBegin,
  onManualSetup,
  onNameChange,
  resolvedAppearance,
}: {
  appearance: Appearance;
  name: string;
  onAppearanceChange: (appearance: Appearance) => void;
  onBegin: () => void;
  onManualSetup: () => void;
  onNameChange: (value: string) => void;
  resolvedAppearance: "light" | "dark";
}) {
  return (
    <section
      aria-labelledby="conversational-welcome-heading"
      className="w-full max-w-[35rem]"
      data-testid="conversational-onboarding-welcome"
    >
      <PrototypeHeader appearance={resolvedAppearance} />
      <div className="pb-8 pt-12">
        <p className="mb-3 text-[11px] font-semibold tracking-[0.09em] text-[var(--prototype-muted)] uppercase">
          Your personal agent home
        </p>
        <h1
          className="max-w-[31rem] text-[2rem] font-medium leading-[1.08] tracking-[-0.045em]"
          id="conversational-welcome-heading"
        >
          Bring your agents together.
        </h1>
        <p className="mt-3 max-w-[32rem] text-[15px] leading-6 text-[var(--prototype-muted-strong)]">
          Luca gives you one calm place to talk with the AI agents already on
          your Mac—and helps you set up the rest as you go.
        </p>
      </div>
      <div className="grid gap-5">
        <label className="grid gap-2">
          <span className="text-[12px] font-medium text-[var(--prototype-muted-strong)]">
            What should Luca call you?
          </span>
          <input
            autoComplete="name"
            className="h-10 rounded-[9px] border border-[var(--prototype-hairline)] bg-[var(--prototype-field)] px-3 text-[14px] shadow-[inset_0_1px_1px_var(--prototype-shadow)] outline-none placeholder:text-[var(--prototype-muted)] focus:border-[color-mix(in_srgb,var(--prototype-ink)_35%,transparent)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--prototype-ink)_12%,transparent)]"
            onChange={(event) => onNameChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && name.trim()) onBegin();
            }}
            placeholder="Your name"
            value={name}
          />
        </label>
        <AppearanceControl
          appearance={appearance}
          onChange={onAppearanceChange}
        />
      </div>
      <div className="mt-10 flex items-center justify-between">
        <QuietButton onClick={onManualSetup}>Set up manually</QuietButton>
        <PrimaryButton disabled={!name.trim()} onClick={onBegin}>
          Begin
          <ArrowRight className="size-3.5" />
        </PrimaryButton>
      </div>
    </section>
  );
}

function RuntimeState({
  appearance,
  error,
  onBack,
  onContinue,
  onRecover,
  onSelect,
  runtimes,
  selectedId,
}: {
  appearance: "light" | "dark";
  error: string | null;
  onBack: () => void;
  onContinue: () => void;
  onRecover: (runtime: RuntimeChoice) => void;
  onSelect: (id: RuntimeId) => void;
  runtimes: RuntimeChoice[];
  selectedId: RuntimeId;
}) {
  const selected =
    runtimes.find((runtime) => runtime.id === selectedId) ?? runtimes[0];
  const ready = selected.status === "ready";

  const actionLabel =
    selected.status === "checking"
      ? "Checking…"
      : selected.action === "sign-in"
        ? "Sign in"
        : selected.action === "install"
          ? "Install"
          : selected.action === "guide"
            ? "Open setup guide"
            : "Check again";

  return (
    <SetupFrame
      appearance={appearance}
      footer={
        <>
          <QuietButton onClick={onBack}>Back</QuietButton>
          <PrimaryButton disabled={!ready} onClick={onContinue}>
            Continue
          </PrimaryButton>
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0">
          <h1
            className="text-[1.75rem] font-medium tracking-[-0.04em]"
            id="runtime-heading"
          >
            Choose what powers Luca
          </h1>
          <p className="mt-2 max-w-[34rem] text-[14px] leading-5 text-[var(--prototype-muted-strong)]">
            Pick the AI Luca should use on this Mac. You can change it later
            without changing who Luca is.
          </p>
        </div>
        <div
          aria-labelledby="runtime-heading"
          className="mt-6 min-h-0 overflow-y-auto rounded-[10px] bg-[var(--prototype-selection)] p-1"
          role="radiogroup"
        >
          {runtimes.map((runtime) => {
            const active = runtime.id === selected.id;
            return (
              <label
                className={cn(
                  "group flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-[8px] px-3 py-2 text-left outline-none transition-[background-color,box-shadow] duration-150 focus-within:ring-2 focus-within:ring-[color-mix(in_srgb,var(--prototype-ink)_25%,transparent)]",
                  active
                    ? "bg-[var(--prototype-field)] shadow-[0_1px_2px_var(--prototype-shadow)]"
                    : "hover:bg-[color-mix(in_srgb,var(--prototype-field)_45%,transparent)]",
                )}
                data-testid={`runtime-choice-${runtime.id}`}
                key={runtime.id}
              >
                <input
                  checked={active}
                  className="sr-only"
                  name="luca-runtime"
                  onChange={() => onSelect(runtime.id)}
                  type="radio"
                  value={runtime.id}
                />
                <span className="grid size-7 shrink-0 place-items-center">
                  <RuntimeMark runtime={runtime} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="text-[13px] font-medium">
                      {runtime.name}
                    </span>
                    {runtime.recommended ? (
                      <span className="text-[9px] font-semibold tracking-[0.08em] text-[var(--prototype-muted)] uppercase">
                        Recommended
                      </span>
                    ) : null}
                  </span>
                  {active ? (
                    <span className="mt-0.5 block text-[11px] leading-4 text-[var(--prototype-muted)]">
                      {runtime.detail}
                    </span>
                  ) : null}
                </span>
                <span
                  className={cn(
                    "shrink-0 text-[11px]",
                    runtime.status === "ready"
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-[var(--prototype-muted)]",
                  )}
                >
                  {statusLabels[runtime.status]}
                </span>
                <span
                  className={cn(
                    "grid size-4 shrink-0 place-items-center rounded-full border",
                    active
                      ? "border-[var(--prototype-ink)]"
                      : "border-[var(--prototype-hairline)]",
                  )}
                >
                  {active ? (
                    <span className="size-1.5 rounded-full bg-[var(--prototype-ink)]" />
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
        {!ready ? (
          <div
            aria-live="polite"
            className="mt-4 shrink-0 rounded-[10px] bg-[var(--prototype-selection)] px-3.5 py-3"
            data-testid="runtime-recovery"
          >
            <div className="flex items-start gap-3">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-[var(--prototype-muted-strong)]" />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium">
                  {selected.name} needs attention
                </p>
                <p className="mt-1 text-[11px] leading-4 text-[var(--prototype-muted)]">
                  {selected.status === "unavailable"
                    ? "This runtime cannot be used in this fixture. Choose another option."
                    : selected.id === "hermes" || selected.id === "openclaw"
                      ? "Finish setup in its native system. Existing provider settings, including OpenRouter, stay there."
                      : "Complete the existing setup, then let Luca check readiness again."}
                </p>
                {error ? (
                  <p className="mt-2 text-[11px] text-red-600 dark:text-red-400">
                    {error}
                  </p>
                ) : null}
              </div>
              {selected.status !== "unavailable" ? (
                <button
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] border border-[var(--prototype-hairline)] bg-[var(--prototype-field)] px-3 text-[11px] font-medium hover:bg-[var(--prototype-raised)] disabled:opacity-50"
                  disabled={selected.status === "checking"}
                  onClick={() => onRecover(selected)}
                  type="button"
                >
                  {selected.status === "checking" ? (
                    <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" />
                  ) : selected.action === "guide" ? (
                    <ExternalLink className="size-3" />
                  ) : (
                    <RefreshCw className="size-3" />
                  )}
                  {actionLabel}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        <span className="sr-only" aria-live="polite">
          {selected.name}: {statusLabels[selected.status]}
        </span>
      </div>
    </SetupFrame>
  );
}

function AgentsSummaryState({
  appearance,
  onBack,
  onChoose,
  onSkip,
}: {
  appearance: "light" | "dark";
  onBack: () => void;
  onChoose: () => void;
  onSkip: () => void;
}) {
  return (
    <SetupFrame
      appearance={appearance}
      footer={
        <>
          <QuietButton onClick={onBack}>Back</QuietButton>
          <QuietButton onClick={onSkip}>Not now</QuietButton>
        </>
      }
    >
      <div
        className="flex h-full flex-col justify-center py-4"
        data-testid="agents-summary"
      >
        <p className="text-[11px] font-semibold tracking-[0.09em] text-[var(--prototype-muted)] uppercase">
          Optional
        </p>
        <h1 className="mt-3 text-[1.75rem] font-medium tracking-[-0.04em]">
          Bring in agents you already use
        </h1>
        <p className="mt-2 max-w-[32rem] text-[14px] leading-5 text-[var(--prototype-muted-strong)]">
          We found {agentCandidates.length} agents on this Mac. Nothing is
          imported unless you choose it.
        </p>
        <div className="mt-7 grid grid-cols-2 gap-3">
          <div className="rounded-[10px] bg-[var(--prototype-selection)] px-4 py-3">
            <p className="text-[12px] font-medium">Hermes</p>
            <p className="mt-1 text-[11px] text-[var(--prototype-muted)]">
              4 profiles found
            </p>
          </div>
          <div className="rounded-[10px] bg-[var(--prototype-selection)] px-4 py-3">
            <p className="text-[12px] font-medium">OpenClaw</p>
            <p className="mt-1 text-[11px] text-[var(--prototype-muted)]">
              4 agents found
            </p>
          </div>
        </div>
        <div className="mt-7">
          <PrimaryButton onClick={onChoose}>
            Choose agents
            <ArrowRight className="size-3.5" />
          </PrimaryButton>
        </div>
      </div>
    </SetupFrame>
  );
}

function AgentsSelectState({
  appearance,
  onBack,
  onContinue,
  onToggle,
  selectedIds,
}: {
  appearance: "light" | "dark";
  onBack: () => void;
  onContinue: () => void;
  onToggle: (id: string) => void;
  selectedIds: Set<string>;
}) {
  const [query, setQuery] = React.useState("");
  const normalized = query.trim().toLowerCase();
  const filtered = agentCandidates.filter((agent) =>
    agent.name.toLowerCase().includes(normalized),
  );
  const selectedCount = selectedIds.size;
  return (
    <SetupFrame
      appearance={appearance}
      footer={
        <>
          <QuietButton onClick={onBack}>
            <span className="inline-flex items-center gap-1">
              <ArrowLeft className="size-3" />
              Back
            </span>
          </QuietButton>
          <PrimaryButton onClick={onContinue}>
            {selectedCount
              ? `Import ${selectedCount} and continue`
              : "Continue"}
          </PrimaryButton>
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col" data-testid="agents-select">
        <div className="shrink-0">
          <h1 className="text-[1.6rem] font-medium tracking-[-0.04em]">
            Choose agents
          </h1>
          <p className="mt-1 text-[13px] text-[var(--prototype-muted)]">
            Nothing is imported unless you select it.
          </p>
          <label className="relative mt-4 block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[var(--prototype-muted)]" />
            <input
              aria-label="Search agents"
              className="h-9 w-full rounded-[8px] border border-[var(--prototype-hairline)] bg-[var(--prototype-field)] pl-9 pr-3 text-[13px] outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--prototype-ink)_12%,transparent)]"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search agents"
              value={query}
            />
          </label>
          <div className="mt-2.5 flex items-center gap-5 text-[11px]">
            <button
              className="text-[var(--prototype-muted-strong)] hover:text-[var(--prototype-ink)]"
              onClick={() =>
                agentCandidates
                  .filter((agent) => !agent.disabledReason)
                  .forEach((agent) => {
                    if (!selectedIds.has(agent.id)) onToggle(agent.id);
                  })
              }
              type="button"
            >
              Select all ready
            </button>
            <button
              className="text-[var(--prototype-muted)] hover:text-[var(--prototype-ink)]"
              onClick={() => Array.from(selectedIds).forEach(onToggle)}
              type="button"
            >
              Clear
            </button>
            <span className="ml-auto text-[var(--prototype-muted)]">
              {selectedCount} selected
            </span>
          </div>
        </div>
        <section
          aria-label="Discovered agents"
          className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-[9px] bg-[var(--prototype-selection)] p-1"
          data-testid="prototype-agent-inventory"
        >
          {(["Hermes", "OpenClaw"] as const).map((source) => {
            const group = filtered.filter((agent) => agent.source === source);
            if (!group.length) return null;
            return (
              <div key={source}>
                <p className="px-3 pb-1 pt-2 text-[9px] font-semibold tracking-[0.12em] text-[var(--prototype-muted)] uppercase">
                  {source}
                </p>
                {group.map((agent) => {
                  const selected = selectedIds.has(agent.id);
                  return (
                    <button
                      aria-pressed={selected}
                      className="flex min-h-11 w-full items-center gap-3 rounded-[7px] px-3 py-2 text-left hover:bg-[var(--prototype-field)] disabled:cursor-not-allowed disabled:opacity-45"
                      data-testid={`prototype-agent-${agent.id}`}
                      disabled={Boolean(agent.disabledReason)}
                      key={agent.id}
                      onClick={() => onToggle(agent.id)}
                      title={agent.disabledReason}
                      type="button"
                    >
                      <TerminalSquare
                        className="size-4 shrink-0 text-[var(--prototype-muted)]"
                        strokeWidth={1.2}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12px] font-medium">
                          {agent.name}
                        </span>
                        <span className="block truncate text-[10px] text-[var(--prototype-muted)]">
                          {agent.disabledReason ?? `${source} agent`}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "grid size-4 shrink-0 place-items-center rounded-[5px] border",
                          selected
                            ? "border-[var(--prototype-ink)] bg-[var(--prototype-ink)] text-[var(--prototype-field)]"
                            : "border-[var(--prototype-hairline)]",
                        )}
                      >
                        {selected ? <Check className="size-3" /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
          {!filtered.length ? (
            <p className="px-3 py-8 text-center text-[12px] text-[var(--prototype-muted)]">
              No matching agents
            </p>
          ) : null}
        </section>
      </div>
    </SetupFrame>
  );
}

function PreparingState({ appearance }: { appearance: "light" | "dark" }) {
  const reduceMotion = useReducedMotion();
  return (
    <section
      aria-live="polite"
      className="flex w-full max-w-[31rem] flex-col items-center text-center"
      data-testid="conversational-onboarding-preparing"
    >
      <LucaMark appearance={appearance} size={30} />
      <div className="mt-6 grid size-5 place-items-center text-[var(--prototype-muted-strong)]">
        {reduceMotion ? (
          <span className="size-2 rounded-full bg-current" />
        ) : (
          <LoaderCircle className="size-5 animate-spin" strokeWidth={1.4} />
        )}
      </div>
      <h1 className="mt-4 text-[23px] font-medium tracking-[-0.035em]">
        Getting Luca ready…
      </h1>
    </section>
  );
}

function ProposalCard() {
  return (
    <div
      className="mt-4 max-w-[31rem] rounded-[12px] bg-[var(--prototype-selection)] p-4"
      data-testid="conversational-onboarding-proposal"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[13px] font-semibold">Create a Polyphonic Agent</p>
          <p className="mt-1 text-[12px] leading-5 text-[var(--prototype-muted-strong)]">
            A research partner named Atlas, using Codex on this Mac.
          </p>
        </div>
        <span className="rounded-full bg-[var(--prototype-field)] px-2 py-1 text-[10px] font-medium tracking-[0.06em] text-[var(--prototype-muted)] uppercase">
          Review
        </span>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <button
          className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[var(--prototype-accent)] px-3 text-[12px] font-semibold text-[var(--prototype-accent-ink)]"
          type="button"
        >
          <Check className="size-3.5" />
          Approve
        </button>
        <button
          className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-[12px] text-[var(--prototype-muted-strong)] hover:bg-[var(--prototype-field)]"
          type="button"
        >
          <Pencil className="size-3.5" />
          Edit
        </button>
        <button
          className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-[12px] text-[var(--prototype-muted-strong)] hover:bg-[var(--prototype-field)]"
          type="button"
        >
          <X className="size-3.5" />
          Cancel
        </button>
      </div>
    </div>
  );
}

function ConversationState({
  appearance,
  forceProposal,
  name,
  onShowProposal,
}: {
  appearance: "light" | "dark";
  forceProposal: boolean;
  name: string;
  onShowProposal: () => void;
}) {
  const [draft, setDraft] = React.useState("");
  const [sentMessage, setSentMessage] = React.useState<string | null>(
    forceProposal ? "Can you create a research agent for me?" : null,
  );
  const send = () => {
    const message = draft.trim();
    if (!message) return;
    setSentMessage(message);
    setDraft("");
    if (/agent|research|create/i.test(message)) onShowProposal();
  };
  return (
    <section
      className="flex h-[calc(100dvh-4rem)] min-h-[22rem] w-[min(62rem,calc(100vw-4rem))] max-h-[42rem] overflow-hidden rounded-[16px] border border-[var(--prototype-hairline)] bg-[var(--prototype-raised)] shadow-[0_24px_80px_var(--prototype-shadow)]"
      data-testid="conversational-onboarding-conversation"
    >
      <aside className="hidden w-[13rem] shrink-0 flex-col bg-[color-mix(in_srgb,var(--prototype-canvas)_70%,var(--prototype-raised))] p-3 md:flex">
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <LucaMark appearance={appearance} size={17} />
          <span className="text-[13px] font-semibold">Luca</span>
        </div>
        <nav className="mt-5 grid gap-0.5 text-[12px] text-[var(--prototype-muted-strong)]">
          {["New conversation", "Inbox", "Agents", "Brain"].map((item) => (
            <button
              className="flex h-8 items-center justify-between rounded-[7px] px-2 text-left hover:bg-[var(--prototype-selection)]"
              key={item}
              type="button"
            >
              {item}
              {item === "Inbox" ? <span className="text-[10px]">1</span> : null}
            </button>
          ))}
        </nav>
        <p className="mb-2 mt-7 px-2 text-[10px] font-medium tracking-[0.09em] text-[var(--prototype-muted)] uppercase">
          Direct messages
        </p>
        <button
          className="flex h-9 items-center gap-2 rounded-[8px] bg-[var(--prototype-selection)] px-2 text-left text-[12px] font-medium"
          type="button"
        >
          <LucaMark appearance={appearance} size={14} />
          Luca
        </button>
        <button
          className="mt-auto flex h-8 items-center justify-between rounded-[7px] px-2 text-left text-[12px] text-[var(--prototype-muted)] hover:bg-[var(--prototype-selection)]"
          type="button"
        >
          Settings
          <ChevronRight className="size-3" />
        </button>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col bg-[var(--prototype-field)]">
        <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-[var(--prototype-hairline-soft)] px-5">
          <LucaMark appearance={appearance} size={16} />
          <div>
            <p className="text-[13px] font-semibold">Luca</p>
            <p className="text-[10px] text-[var(--prototype-muted)]">Ready</p>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8 sm:px-9">
          <div className="mx-auto max-w-[38rem]">
            <div className="flex gap-3">
              <LucaMark appearance={appearance} size={20} />
              <div className="pt-0.5">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-semibold">Luca</span>
                  <span className="text-[10px] text-[var(--prototype-muted)]">
                    now
                  </span>
                </div>
                <p className="mt-1 text-[14px] leading-6">
                  Hi, {name || "Riley"} — I’m Luca. I’m ready. What would you
                  like help with first?
                </p>
              </div>
            </div>
            {sentMessage ? (
              <div className="mt-7 pl-[3rem]">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-semibold">
                    {name || "Riley"}
                  </span>
                  <span className="text-[10px] text-[var(--prototype-muted)]">
                    now
                  </span>
                </div>
                <p className="mt-1 text-[14px] leading-6">{sentMessage}</p>
                {forceProposal ? (
                  <div className="mt-7 flex gap-3">
                    <LucaMark appearance={appearance} size={20} />
                    <div className="min-w-0 flex-1 pt-0.5">
                      <span className="text-[13px] font-semibold">Luca</span>
                      <p className="mt-1 text-[14px] leading-6">
                        Yes. I can set up a focused research partner for you.
                        Here’s what I’d create:
                      </p>
                      <ProposalCard />
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <div className="shrink-0 px-5 pb-5 sm:px-8">
          <div className="mx-auto flex max-w-[40rem] items-end gap-2 rounded-[12px] border border-[var(--prototype-hairline)] bg-[var(--prototype-raised)] p-2 shadow-[0_4px_18px_var(--prototype-shadow)] focus-within:border-[color-mix(in_srgb,var(--prototype-ink)_30%,transparent)]">
            <textarea
              aria-label="Message Luca"
              className="max-h-32 min-h-8 flex-1 resize-none bg-transparent px-2 py-1.5 text-[13px] leading-5 outline-none placeholder:text-[var(--prototype-muted)]"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder="Message Luca"
              rows={1}
              value={draft}
            />
            <button
              aria-label="Send message"
              className="grid size-8 place-items-center rounded-[8px] bg-[var(--prototype-accent)] text-[var(--prototype-accent-ink)] disabled:opacity-35"
              disabled={!draft.trim()}
              onClick={send}
              type="button"
            >
              <Send className="size-3.5" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

export function ConversationalOnboardingPreview() {
  const reduceMotion = useReducedMotion();
  const systemColorScheme = useSystemColorScheme();
  const [appearance, setAppearance] = React.useState<Appearance>("system");
  const [name, setName] = React.useState("Riley");
  const [state, setState] = React.useState<PrototypeState>(readPrototypeState);
  const [scenario] = React.useState<PrototypeScenario>(readPrototypeScenario);
  const [runtimes, setRuntimes] = React.useState<RuntimeChoice[]>(() =>
    runtimeChoicesForScenario(scenario),
  );
  const [runtimeError, setRuntimeError] = React.useState<string | null>(null);
  const [selectedRuntimeId, setSelectedRuntimeId] = React.useState<RuntimeId>(
    () => {
      const choices = runtimeChoicesForScenario(scenario);
      return (
        choices.find((runtime) => runtime.recommended) ??
        choices.find((runtime) => runtime.status === "ready") ??
        choices[0]
      ).id;
    },
  );
  const [selectedAgentIds, setSelectedAgentIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const resolvedAppearance =
    appearance === "system" ? systemColorScheme : appearance;
  const palette = resolvedAppearance === "dark" ? darkPalette : lightPalette;
  const discoveryStatus = discoveryForScenario(scenario);

  React.useEffect(() => {
    if (state !== "preparing") return;
    const timeout = window.setTimeout(() => setState("conversation"), 720);
    return () => window.clearTimeout(timeout);
  }, [state]);

  const continueFromRuntime = () => {
    setState(discoveryStatus === "found" ? "agents-summary" : "preparing");
  };

  const recoverRuntime = (runtime: RuntimeChoice) => {
    if (runtime.action === "guide") {
      setRuntimes((current) =>
        current.map((choice) =>
          choice.id === runtime.id ? { ...choice, action: "check" } : choice,
        ),
      );
      return;
    }
    setRuntimeError(null);
    setRuntimes((current) =>
      current.map((choice) =>
        choice.id === runtime.id ? { ...choice, status: "checking" } : choice,
      ),
    );
    window.setTimeout(() => {
      if (scenario === "setup-failure") {
        setRuntimes((current) =>
          current.map((choice) =>
            choice.id === runtime.id
              ? {
                  ...choice,
                  status: runtime.action === "install" ? "set-up" : "sign-in",
                }
              : choice,
          ),
        );
        setRuntimeError(
          "Luca could not verify the setup. Nothing changed; try again when the runtime is ready.",
        );
        return;
      }
      setRuntimes((current) =>
        current.map((choice) =>
          choice.id === runtime.id
            ? { ...choice, action: "check", status: "ready" }
            : choice,
        ),
      );
    }, 620);
  };

  const openManualSetup = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("polyphonicOnboardingPreview", "agents");
    url.searchParams.delete("prototypeState");
    window.location.assign(url.toString());
  };

  const toggleAgent = (id: string) => {
    setSelectedAgentIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div
      className="relative h-dvh overflow-hidden bg-[var(--prototype-canvas)] text-[var(--prototype-ink)]"
      data-appearance={resolvedAppearance}
      data-scenario={scenario}
      data-testid="conversational-onboarding-preview"
      style={{
        ...palette,
        backgroundImage:
          resolvedAppearance === "dark"
            ? "radial-gradient(circle, rgba(255,255,255,0.035) 1px, transparent 1px)"
            : "radial-gradient(circle, rgba(33,34,30,0.05) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif',
      }}
    >
      <StartupWindowDragRegion />
      <main className="grid h-full place-items-center px-6 pb-6 pt-10 sm:px-8 sm:pb-8 sm:pt-12">
        <AnimatePresence mode="wait">
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="grid w-full place-items-center"
            initial={reduceMotion ? false : { opacity: 0, y: 5 }}
            key={state}
            transition={
              reduceMotion
                ? { duration: 0 }
                : { duration: 0.19, ease: [0.2, 0, 0, 1] }
            }
          >
            {state === "welcome" ? (
              <WelcomeState
                appearance={appearance}
                name={name}
                onAppearanceChange={setAppearance}
                onBegin={() => setState("runtime")}
                onManualSetup={openManualSetup}
                onNameChange={setName}
                resolvedAppearance={resolvedAppearance}
              />
            ) : null}
            {state === "runtime" ? (
              <RuntimeState
                appearance={resolvedAppearance}
                error={runtimeError}
                onBack={() => setState("welcome")}
                onContinue={continueFromRuntime}
                onRecover={recoverRuntime}
                onSelect={(id) => {
                  setSelectedRuntimeId(id);
                  setRuntimeError(null);
                }}
                runtimes={runtimes}
                selectedId={selectedRuntimeId}
              />
            ) : null}
            {state === "agents-summary" ? (
              <AgentsSummaryState
                appearance={resolvedAppearance}
                onBack={() => setState("runtime")}
                onChoose={() => setState("agents-select")}
                onSkip={() => setState("preparing")}
              />
            ) : null}
            {state === "agents-select" ? (
              <AgentsSelectState
                appearance={resolvedAppearance}
                onBack={() => setState("agents-summary")}
                onContinue={() => setState("preparing")}
                onToggle={toggleAgent}
                selectedIds={selectedAgentIds}
              />
            ) : null}
            {state === "preparing" ? (
              <PreparingState appearance={resolvedAppearance} />
            ) : null}
            {state === "conversation" || state === "proposal" ? (
              <ConversationState
                appearance={resolvedAppearance}
                forceProposal={state === "proposal"}
                name={name}
                onShowProposal={() => setState("proposal")}
              />
            ) : null}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
