import {
  ArrowRight,
  Check,
  ChevronRight,
  Monitor,
  Moon,
  Pencil,
  RotateCw,
  Send,
  Sun,
  X,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import * as React from "react";

import { cn } from "@/shared/lib/cn";
import { useSystemColorScheme } from "@/shared/theme/useSystemColorScheme";
import { DotSigil } from "@/shared/ui/dot-display/DotSigil";
import { StartupWindowDragRegion } from "@/shared/ui/StartupWindowDragRegion";
import { POLYPHONIC_IDENTITY_SEED } from "./PolyphonicThresholdField";

type Appearance = "system" | "light" | "dark";
type PrototypeState =
  | "welcome"
  | "preparing"
  | "runtime"
  | "conversation"
  | "proposal";

type PrototypePalette = React.CSSProperties &
  Record<`--prototype-${string}`, string>;

const lightPalette: PrototypePalette = {
  "--prototype-accent": "#262722",
  "--prototype-accent-ink": "#ffffff",
  "--prototype-canvas": "#eeede8",
  "--prototype-field": "#ffffff",
  "--prototype-hairline": "rgba(34, 35, 31, 0.12)",
  "--prototype-hairline-soft": "rgba(34, 35, 31, 0.075)",
  "--prototype-ink": "#242521",
  "--prototype-muted": "#73736d",
  "--prototype-muted-strong": "#585954",
  "--prototype-raised": "#f8f7f3",
  "--prototype-selection": "rgba(38, 39, 34, 0.075)",
  "--prototype-shadow": "rgba(27, 28, 24, 0.12)",
  colorScheme: "light",
};

const darkPalette: PrototypePalette = {
  "--prototype-accent": "#f1f1ed",
  "--prototype-accent-ink": "#171815",
  "--prototype-canvas": "#11120f",
  "--prototype-field": "#1b1c18",
  "--prototype-hairline": "rgba(244, 244, 238, 0.12)",
  "--prototype-hairline-soft": "rgba(244, 244, 238, 0.07)",
  "--prototype-ink": "#f0f0ec",
  "--prototype-muted": "#96978f",
  "--prototype-muted-strong": "#b1b2aa",
  "--prototype-raised": "#171814",
  "--prototype-selection": "rgba(244, 244, 238, 0.08)",
  "--prototype-shadow": "rgba(0, 0, 0, 0.42)",
  colorScheme: "dark",
};

const prototypeStates = new Set<PrototypeState>([
  "welcome",
  "preparing",
  "runtime",
  "conversation",
  "proposal",
]);

function readPrototypeState(): PrototypeState {
  const value = new URL(window.location.href).searchParams.get(
    "prototypeState",
  );
  return prototypeStates.has(value as PrototypeState)
    ? (value as PrototypeState)
    : "welcome";
}

function LucaMark({ size = 26 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center overflow-hidden rounded-[7px] bg-[#252621]"
      style={{ height: size + 10, width: size + 10 }}
    >
      <DotSigil
        cell={3}
        dot="246,246,241"
        scene="sigil"
        seed={POLYPHONIC_IDENTITY_SEED}
        size={size}
      />
    </span>
  );
}

function AppearanceControl({
  appearance,
  onChange,
}: {
  appearance: Appearance;
  onChange: (appearance: Appearance) => void;
}) {
  const options: Array<{
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    value: Appearance;
  }> = [
    { icon: Monitor, label: "System", value: "system" },
    { icon: Sun, label: "Light", value: "light" },
    { icon: Moon, label: "Dark", value: "dark" },
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

function PrototypeHeader() {
  return (
    <header className="flex items-center gap-2.5">
      <LucaMark size={21} />
      <span className="text-[14px] font-semibold tracking-[-0.015em]">
        Luca
      </span>
    </header>
  );
}

function PrimaryButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className="inline-flex h-9 items-center justify-center gap-2 rounded-[9px] bg-[var(--prototype-accent)] px-4 text-[13px] font-semibold text-[var(--prototype-accent-ink)] shadow-[0_1px_2px_var(--prototype-shadow)] transition-[opacity,transform] hover:opacity-90 active:translate-y-px"
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function WelcomeState({
  appearance,
  name,
  onAppearanceChange,
  onBegin,
  onManualSetup,
  onNameChange,
}: {
  appearance: Appearance;
  name: string;
  onAppearanceChange: (appearance: Appearance) => void;
  onBegin: () => void;
  onManualSetup: () => void;
  onNameChange: (value: string) => void;
}) {
  return (
    <section
      aria-labelledby="conversational-welcome-heading"
      className="w-full max-w-[34rem]"
      data-testid="conversational-onboarding-welcome"
    >
      <PrototypeHeader />
      <div className="pb-8 pt-14">
        <p className="mb-3 text-[12px] font-medium tracking-[0.08em] text-[var(--prototype-muted)] uppercase">
          Your personal agent home
        </p>
        <h1
          className="max-w-[30rem] text-[2rem] font-medium leading-[1.08] tracking-[-0.045em] text-[var(--prototype-ink)]"
          id="conversational-welcome-heading"
        >
          Bring your agents together.
        </h1>
        <p className="mt-3 max-w-[31rem] text-[15px] leading-6 text-[var(--prototype-muted-strong)]">
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
            className="h-10 rounded-[9px] border border-[var(--prototype-hairline)] bg-[var(--prototype-field)] px-3 text-[14px] text-[var(--prototype-ink)] shadow-[inset_0_1px_1px_var(--prototype-shadow)] outline-none placeholder:text-[var(--prototype-muted)] focus:border-[color-mix(in_srgb,var(--prototype-ink)_35%,transparent)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--prototype-ink)_12%,transparent)]"
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
        <button
          className="rounded-md px-1 py-1 text-[13px] text-[var(--prototype-muted)] hover:text-[var(--prototype-ink)]"
          onClick={onManualSetup}
          type="button"
        >
          Set up manually
        </button>
        <PrimaryButton onClick={onBegin}>
          Begin
          <ArrowRight className="size-3.5" />
        </PrimaryButton>
      </div>
    </section>
  );
}

function PreparingState() {
  return (
    <section
      aria-live="polite"
      className="flex w-full max-w-[31rem] flex-col items-center text-center"
      data-testid="conversational-onboarding-preparing"
    >
      <motion.div
        animate={{ opacity: [0.82, 1, 0.82], scale: [0.985, 1, 0.985] }}
        transition={{
          duration: 2.2,
          ease: "easeInOut",
          repeat: Number.POSITIVE_INFINITY,
        }}
      >
        <LucaMark size={28} />
      </motion.div>
      <h1 className="mt-6 text-[24px] font-medium tracking-[-0.035em]">
        Getting Luca ready…
      </h1>
      <p className="mt-2 text-[14px] leading-5 text-[var(--prototype-muted)]">
        This should only take a moment.
      </p>
    </section>
  );
}

function RuntimeState({ onRetry }: { onRetry: () => void }) {
  return (
    <section
      aria-labelledby="runtime-required-heading"
      className="w-full max-w-[32rem]"
      data-testid="conversational-onboarding-runtime"
    >
      <PrototypeHeader />
      <div className="pt-14">
        <h1
          className="text-[1.8rem] font-medium leading-tight tracking-[-0.04em]"
          id="runtime-required-heading"
        >
          Luca needs one AI runtime to begin.
        </h1>
        <p className="mt-3 max-w-[29rem] text-[14px] leading-6 text-[var(--prototype-muted-strong)]">
          Codex is installed on this Mac, but it needs your attention before
          Luca can start a conversation.
        </p>
      </div>

      <div className="mt-8 flex items-center gap-3 rounded-[11px] bg-[var(--prototype-selection)] px-3.5 py-3">
        <span className="grid size-8 place-items-center rounded-[8px] bg-[var(--prototype-field)] text-[var(--prototype-ink)] shadow-[0_1px_2px_var(--prototype-shadow)]">
          <Monitor className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium">Codex</p>
          <p className="mt-0.5 text-[12px] text-[var(--prototype-muted)]">
            Sign in to continue
          </p>
        </div>
        <button
          className="h-8 rounded-[8px] border border-[var(--prototype-hairline)] bg-[var(--prototype-field)] px-3 text-[12px] font-medium hover:bg-[var(--prototype-selection)]"
          type="button"
        >
          Open Codex
        </button>
      </div>

      <div className="mt-10 flex items-center justify-between">
        <button
          className="text-[13px] text-[var(--prototype-muted)] hover:text-[var(--prototype-ink)]"
          type="button"
        >
          Choose another runtime
        </button>
        <PrimaryButton onClick={onRetry}>
          <RotateCw className="size-3.5" />
          Check again
        </PrimaryButton>
      </div>
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
  forceProposal,
  name,
  onShowProposal,
}: {
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
      className="flex h-[min(42rem,calc(100dvh-4rem))] min-h-[30rem] w-[min(62rem,calc(100vw-4rem))] overflow-hidden rounded-[16px] border border-[var(--prototype-hairline)] bg-[var(--prototype-raised)] shadow-[0_24px_80px_var(--prototype-shadow)]"
      data-testid="conversational-onboarding-conversation"
    >
      <aside className="hidden w-[13rem] shrink-0 flex-col bg-[color-mix(in_srgb,var(--prototype-canvas)_70%,var(--prototype-raised))] p-3 md:flex">
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <LucaMark size={17} />
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
          <LucaMark size={14} />
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
          <LucaMark size={16} />
          <div>
            <p className="text-[13px] font-semibold">Luca</p>
            <p className="text-[10px] text-[var(--prototype-muted)]">Ready</p>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8 sm:px-9">
          <div className="mx-auto max-w-[38rem]">
            <div className="flex gap-3">
              <LucaMark size={20} />
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
                    <LucaMark size={20} />
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

  const resolvedAppearance =
    appearance === "system" ? systemColorScheme : appearance;
  const palette = resolvedAppearance === "dark" ? darkPalette : lightPalette;

  React.useEffect(() => {
    if (state !== "preparing") return;
    const timeout = window.setTimeout(() => setState("conversation"), 900);
    return () => window.clearTimeout(timeout);
  }, [state]);

  const openManualSetup = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("polyphonicOnboardingPreview", "agents");
    url.searchParams.delete("prototypeState");
    window.location.assign(url.toString());
  };

  return (
    <div
      className="relative h-dvh overflow-hidden bg-[var(--prototype-canvas)] text-[var(--prototype-ink)]"
      data-appearance={resolvedAppearance}
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
      <main className="grid h-full place-items-center px-8 pb-8 pt-12">
        <AnimatePresence mode="wait">
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="grid w-full place-items-center"
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            key={state}
            transition={
              reduceMotion
                ? { duration: 0 }
                : { duration: 0.28, ease: [0.2, 0, 0, 1] }
            }
          >
            {state === "welcome" ? (
              <WelcomeState
                appearance={appearance}
                name={name}
                onAppearanceChange={setAppearance}
                onBegin={() => setState("preparing")}
                onManualSetup={openManualSetup}
                onNameChange={setName}
              />
            ) : null}
            {state === "preparing" ? <PreparingState /> : null}
            {state === "runtime" ? (
              <RuntimeState onRetry={() => setState("preparing")} />
            ) : null}
            {state === "conversation" || state === "proposal" ? (
              <ConversationState
                forceProposal={state === "proposal"}
                name={name}
                onShowProposal={() => setState("proposal")}
              />
            ) : null}
          </motion.div>
        </AnimatePresence>
      </main>

      <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-[var(--prototype-hairline)] bg-[var(--prototype-raised)] px-2 py-0.5 text-[9px] tracking-[0.08em] text-[var(--prototype-muted)] uppercase opacity-0 transition-opacity hover:opacity-100">
        Prototype
      </div>
    </div>
  );
}
