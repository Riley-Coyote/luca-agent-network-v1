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
import {
  LucaThresholdGlyph,
  POLYPHONIC_IDENTITY_SEED,
  PolyphonicThresholdDendrite,
} from "./PolyphonicThresholdField";

type Appearance = "system" | "light" | "dark";
type PrototypeState =
  | "threshold"
  | "threshold-opening"
  | "welcome"
  | "runtime"
  | "agents-summary"
  | "agents-select"
  | "preparing"
  | "opening"
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
  "--prototype-body-size": "0.9375rem",
  "--prototype-canvas": "#e9e8e3",
  "--prototype-elevated": "#ffffff",
  "--prototype-field": "#f1f0ec",
  "--prototype-focus": "-webkit-focus-ring-color",
  "--prototype-hairline": "rgba(34, 35, 31, 0.11)",
  "--prototype-hairline-soft": "rgba(34, 35, 31, 0.065)",
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

const darkPalette: PrototypePalette = {
  "--prototype-accent": "rgba(244, 243, 240, 0.93)",
  "--prototype-accent-ink": "#0e0e10",
  "--prototype-body-size": "0.9375rem",
  "--prototype-canvas": "#060608",
  "--prototype-elevated": "#222224",
  "--prototype-field": "#0e0e10",
  "--prototype-focus": "-webkit-focus-ring-color",
  "--prototype-hairline": "rgba(220, 219, 216, 0.08)",
  "--prototype-hairline-soft": "rgba(220, 219, 216, 0.045)",
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

const prototypeStates = new Set<PrototypeState>([
  "threshold",
  "threshold-opening",
  "welcome",
  "runtime",
  "agents-summary",
  "agents-select",
  "preparing",
  "opening",
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
  return readQueryValue("prototypeState", prototypeStates, "threshold");
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
      detail: "Full conversations and collaboration with Luca.",
      iconUrl: claudeLogoUrl,
      id: "claude",
      name: "Claude Code",
      status: "ready",
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
      detail: "Full conversations and collaboration with Luca.",
      iconUrl: grokLogoUrl,
      id: "grok",
      name: "Grok",
      status: "ready",
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
      data-testid="luca-glyph"
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

function RuntimeMark({
  appearance,
  runtime,
}: {
  appearance: "light" | "dark";
  runtime: RuntimeChoice;
}) {
  const opticalSize = {
    claude: 16,
    codex: 17,
    grok: 17,
    hermes: 16,
    kimi: 18,
    openclaw: 16,
  }[runtime.id];
  if (runtime.iconUrl) {
    return (
      <span className="relative grid size-5 place-items-center">
        <img
          alt=""
          className="object-contain"
          src={runtime.iconUrl}
          style={{
            filter:
              runtime.id === "codex" && appearance === "dark"
                ? "brightness(0) invert(1)"
                : (runtime.id === "grok" || runtime.id === "kimi") &&
                    appearance === "light"
                  ? "brightness(0)"
                  : undefined,
            height: opticalSize,
            width: opticalSize,
          }}
        />
        {runtime.id === "kimi" && appearance === "light" ? (
          <span
            aria-hidden
            className="absolute right-px top-px size-[3px] rounded-full bg-[#147cf3]"
          />
        ) : null}
      </span>
    );
  }
  return (
    <TerminalSquare
      aria-hidden
      className="text-[var(--prototype-muted-strong)]"
      strokeWidth={1.35}
      style={{ height: opticalSize, width: opticalSize }}
    />
  );
}

type PrototypeRect = {
  height: number;
  width: number;
  x: number;
  y: number;
};

function measuredRect(element: HTMLElement | null): PrototypeRect | null {
  if (!element) return null;
  const box = element.getBoundingClientRect();
  if (box.width < 1 || box.height < 1) return null;
  return {
    height: Math.round(box.height),
    width: Math.round(box.width),
    x: Math.round(box.x),
    y: Math.round(box.y),
  };
}

function sameRect(
  left: PrototypeRect | null,
  right: PrototypeRect | null,
): boolean {
  if (left === right) return true;
  if (!(left && right)) return false;
  return (
    left.height === right.height &&
    left.width === right.width &&
    left.x === right.x &&
    left.y === right.y
  );
}

function PrototypeThresholdContinuity({
  appearance,
  hold,
  opening,
  onThresholdSettled,
  sourceRef,
  state,
  thresholdEpoch,
}: {
  appearance: "light" | "dark";
  hold: boolean;
  opening: boolean;
  onThresholdSettled: (epoch: number) => void;
  sourceRef: React.RefObject<HTMLDivElement | null>;
  state: PrototypeState;
  thresholdEpoch: number;
}) {
  const reduceMotion = useReducedMotion();
  const [sourceRect, setSourceRect] = React.useState<PrototypeRect | null>(
    null,
  );
  const [viewportRect, setViewportRect] = React.useState<PrototypeRect | null>(
    null,
  );

  React.useLayoutEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const nextSource = measuredRect(sourceRef.current);
      const nextViewport = {
        height: window.innerHeight,
        width: window.innerWidth,
        x: 0,
        y: 0,
      };
      setSourceRect((current) =>
        sameRect(current, nextSource) ? current : nextSource,
      );
      setViewportRect((current) =>
        sameRect(current, nextViewport) ? current : nextViewport,
      );
    };
    const scheduleUpdate = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(scheduleUpdate);
    if (sourceRef.current) observer.observe(sourceRef.current);
    window.addEventListener("resize", scheduleUpdate);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [sourceRef]);

  const isThreshold = state === "threshold";
  const isThresholdOpening = state === "threshold-opening";
  const isHome = state === "conversation" || state === "proposal";
  const destinationRect = isThreshold
    ? sourceRect
    : (viewportRect ?? sourceRect);
  if (!destinationRect || isHome) return null;

  const viewportWidth = viewportRect?.width ?? sourceRect?.width ?? 1024;
  const viewportHeight = viewportRect?.height ?? sourceRect?.height ?? 768;
  const growthFieldSize = Math.min(
    1600,
    Math.ceil(Math.hypot(viewportWidth, viewportHeight)),
  );
  const visibleOpacity = isThreshold
    ? 1
    : isThresholdOpening
      ? reduceMotion
        ? [1, hold ? 1 : 0]
        : [1, 1, hold ? 1 : 0]
      : opening
        ? reduceMotion
          ? 0
          : [0, 1, 0]
        : 0;
  const geometryDuration = reduceMotion || !isThresholdOpening ? 0 : 1.78;
  const geometryDelay = reduceMotion || !isThresholdOpening ? 0 : 0.02;
  const geometryTransition = {
    delay: geometryDelay,
    duration: geometryDuration,
    ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
  };
  const opacityTransition = isThresholdOpening
    ? {
        delay: 0,
        duration: reduceMotion ? 0.12 : 1.78,
        ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
        times: reduceMotion ? undefined : [0, 0.88, 1],
      }
    : opening
      ? {
          delay: 0,
          duration: reduceMotion ? 0.12 : 0.44,
          ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
          times: reduceMotion ? undefined : [0, 0.34, 1],
        }
      : { duration: 0 };
  // The production core remains spatially fixed. The sense of expansion comes
  // from new DLA growth around it, never from enlarging the existing artwork.
  const coreScale = 1;
  const coreOpacity = isThreshold
    ? 1
    : isThresholdOpening
      ? reduceMotion
        ? [1, 0]
        : [1, 1, 0.82, hold ? 0.34 : 0]
      : 0;
  const fieldFilter = isThreshold
    ? "brightness(1) contrast(1)"
    : appearance === "dark"
      ? "brightness(1.28) contrast(1.12)"
      : "brightness(0.22) contrast(1.72)";
  // In light mode, keep the field luminous while the room is still dark. Its
  // polarity changes only as the surrounding canvas itself changes tone.
  const fieldFilterDelay =
    isThresholdOpening && !reduceMotion && appearance === "light" ? 1.16 : 0;
  // Let the full field accrete invisibly while the threshold is being read,
  // then reveal its existing branches through an expanding feathered mask.
  // The canvas never scales, and it keeps growing throughout the handoff.
  const showGrowthField = isThreshold || isThresholdOpening || opening;

  return (
    <motion.div
      animate={{
        height: destinationRect.height,
        left: destinationRect.x,
        opacity: visibleOpacity,
        top: destinationRect.y,
        width: destinationRect.width,
      }}
      aria-hidden
      className={cn(
        "pointer-events-none fixed overflow-hidden",
        isThreshold || isThresholdOpening ? "z-40" : "z-0",
      )}
      data-testid="prototype-threshold-passage"
      initial={false}
      onAnimationComplete={() => {
        if (isThresholdOpening && viewportRect) {
          onThresholdSettled(thresholdEpoch);
        }
      }}
      style={{ borderRadius: 0 }}
      transition={{
        height: geometryTransition,
        left: geometryTransition,
        opacity: opacityTransition,
        top: geometryTransition,
        width: geometryTransition,
      }}
    >
      <motion.div
        animate={{
          filter: fieldFilter,
          opacity: coreOpacity,
          scale: coreScale,
        }}
        className="absolute inset-0 origin-center transform-gpu"
        data-testid="prototype-threshold-core"
        initial={false}
        transition={{
          filter: {
            delay: fieldFilterDelay,
            duration: isThresholdOpening && !reduceMotion ? 0.48 : 0.12,
            ease: "easeOut",
          },
          scale: {
            delay: isThresholdOpening && !reduceMotion ? 0.02 : 0,
            duration: isThresholdOpening && !reduceMotion ? 0.78 : 0.38,
            ease: [0.22, 1, 0.36, 1],
            times:
              isThresholdOpening && !reduceMotion ? [0, 0.52, 1] : undefined,
          },
          opacity: {
            delay: 0,
            duration: reduceMotion ? 0.12 : 1.6,
            ease: [0.22, 1, 0.36, 1],
            times:
              isThresholdOpening && !reduceMotion
                ? [0, 0.2, 0.58, 1]
                : undefined,
          },
        }}
      >
        <PolyphonicThresholdDendrite ambient={isThreshold} />
      </motion.div>
      {showGrowthField && !reduceMotion ? (
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{ height: growthFieldSize, width: growthFieldSize }}
        >
          <motion.div
            animate={{
              filter: fieldFilter,
              maskSize: isThreshold
                ? "12% 12%"
                : isThresholdOpening
                  ? ["12% 12%", "44% 44%", "106% 106%", "160% 160%"]
                  : "160% 160%",
              opacity: isThreshold
                ? 0
                : isThresholdOpening
                  ? [0, 0.98, 0.94, hold ? 0.58 : 0]
                  : [0, appearance === "dark" ? 0.34 : 0.24, 0],
            }}
            className="h-full w-full"
            data-testid="prototype-threshold-growth-field"
            initial={false}
            style={{
              maskImage:
                "radial-gradient(circle at center, #000 0%, #000 54%, transparent 74%)",
              maskPosition: "center",
              maskRepeat: "no-repeat",
              WebkitMaskImage:
                "radial-gradient(circle at center, #000 0%, #000 54%, transparent 74%)",
              WebkitMaskPosition: "center",
              WebkitMaskRepeat: "no-repeat",
            }}
            transition={{
              filter: {
                delay: fieldFilterDelay,
                duration: 0.48,
              },
              maskSize: {
                delay: isThresholdOpening ? 0.04 : 0,
                duration: isThresholdOpening ? 1.42 : 0,
                ease: [0.22, 1, 0.36, 1],
                times: isThresholdOpening ? [0, 0.2, 0.64, 1] : undefined,
              },
              opacity: {
                delay: isThresholdOpening ? 0.04 : 0,
                duration: isThresholdOpening ? 1.72 : opening ? 0.44 : 0,
                ease: [0.22, 1, 0.36, 1],
                times: isThresholdOpening
                  ? [0, 0.1, 0.84, 1]
                  : opening
                    ? [0, 0.4, 1]
                    : undefined,
              },
            }}
          >
            <DotSigil
              bloom={0.03}
              cell={8}
              dot="164,167,173"
              scene="recall"
              seed={`${POLYPHONIC_IDENTITY_SEED}:threshold`}
              size={growthFieldSize}
            />
          </motion.div>
        </div>
      ) : null}
      <motion.div
        animate={{ opacity: isThreshold ? 1 : 0 }}
        className="absolute left-1/2 top-1/2 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
        data-testid="prototype-threshold-sigil"
        initial={false}
        transition={{ duration: reduceMotion ? 0.12 : 0.11, ease: "easeOut" }}
      >
        <LucaThresholdGlyph />
      </motion.div>
    </motion.div>
  );
}

function PrototypeThresholdStage({
  onBegin,
  onManualSetup,
  sourceRef,
  transitioning,
}: {
  onBegin: () => void;
  onManualSetup: () => void;
  sourceRef: React.RefObject<HTMLDivElement | null>;
  transitioning: boolean;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <section
      aria-hidden={transitioning || undefined}
      className={cn(
        "absolute inset-0 z-30 flex items-center justify-center overflow-hidden px-4 py-8 text-center text-white",
        transitioning && "pointer-events-none",
      )}
      data-testid="prototype-threshold-stage"
    >
      <motion.div
        animate={{ opacity: transitioning ? 0 : 1 }}
        className="absolute inset-0 bg-[#0b0c0f]"
        initial={false}
        style={{
          backgroundImage:
            "radial-gradient(circle, rgb(255 255 255 / 0.045) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
        transition={{
          delay: transitioning && !reduceMotion ? 1.3 : 0,
          duration: transitioning ? (reduceMotion ? 0.12 : 0.38) : 0,
          ease: "easeOut",
        }}
      />
      <motion.div
        animate={{ opacity: transitioning ? 0 : 1 }}
        className="relative flex w-full max-w-[720px] flex-col items-center"
        data-testid="prototype-threshold-copy"
        initial={false}
        transition={{
          duration: transitioning ? (reduceMotion ? 0.12 : 0.14) : 0,
          ease: "easeOut",
        }}
      >
        <div
          className="relative flex h-[21rem] w-[21rem] items-center justify-center sm:h-[26rem] sm:w-[26rem]"
          data-testid="prototype-threshold-field-origin"
          ref={sourceRef}
        />
        <h1 className="relative -mt-8 text-4xl font-medium tracking-[-0.04em] text-white">
          Luca
        </h1>
        <p className="mt-3 max-w-[26rem] text-center text-sm leading-6 text-white/60">
          A private home for your agents and the work that makes them useful.
        </p>
        <div className="mt-10 flex flex-col items-center gap-3">
          <button
            className="h-10 rounded-lg bg-white px-5 text-sm font-medium text-black transition-opacity duration-[80ms] hover:bg-white/90 active:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            onClick={onBegin}
            tabIndex={transitioning ? -1 : 0}
            type="button"
          >
            Begin setup
          </button>
          <button
            className="h-9 rounded-lg px-4 text-xs text-white/55 transition-colors hover:bg-white/[0.05] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            onClick={onManualSetup}
            tabIndex={transitioning ? -1 : 0}
            type="button"
          >
            Set up manually
          </button>
        </div>
      </motion.div>
    </section>
  );
}

function PrototypeHeader() {
  return (
    <header
      className="flex h-full min-w-0 items-center"
      data-testid="prototype-header"
    >
      <span className="text-sm font-semibold tracking-[-0.015em]">
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
      className="inline-flex min-h-9 items-center justify-center gap-2 rounded-[9px] bg-[var(--prototype-accent)] px-4 py-2 text-[length:var(--prototype-support-size)] font-semibold text-[var(--prototype-accent-ink)] shadow-[0_1px_2px_var(--prototype-shadow)] transition-[background-color,box-shadow,opacity] duration-[80ms] hover:opacity-90 active:shadow-[inset_0_1px_2px_color-mix(in_srgb,var(--prototype-canvas)_28%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--prototype-focus)] disabled:pointer-events-none disabled:opacity-35"
      data-testid="prototype-primary-action"
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
      className="rounded-[7px] px-1 py-1 text-[length:var(--prototype-support-size)] text-[var(--prototype-muted)] transition-colors hover:text-[var(--prototype-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--prototype-focus)]"
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function PrototypeSetupShell({
  children,
  footer,
  state,
}: {
  children: React.ReactNode;
  footer: React.ReactNode;
  state: PrototypeState;
}) {
  const shellRef = React.useRef<HTMLDivElement>(null);
  const [contentOverflows, setContentOverflows] = React.useState(false);
  const visibleState = state === "threshold-opening" ? "welcome" : state;
  const stepOwnsScroll =
    visibleState === "welcome" || visibleState === "agents-summary";

  React.useLayoutEffect(() => {
    const shell = shellRef.current;
    const selector =
      visibleState === "runtime"
        ? '[data-testid="prototype-runtime-scroll"]'
        : visibleState === "agents-select"
          ? '[data-testid="prototype-agent-inventory"]'
          : visibleState === "welcome" || visibleState === "agents-summary"
            ? '[data-testid="prototype-step-scroll"]'
            : null;
    const scrollOwner = selector
      ? shell?.querySelector<HTMLElement>(selector)
      : null;
    if (!(shell && scrollOwner)) {
      setContentOverflows(false);
      return;
    }

    const updateOverflow = () =>
      setContentOverflows(
        scrollOwner.scrollHeight > scrollOwner.clientHeight + 1,
      );
    updateOverflow();
    const resizeObserver = new ResizeObserver(updateOverflow);
    resizeObserver.observe(scrollOwner);
    const mutationObserver = new MutationObserver(updateOverflow);
    mutationObserver.observe(scrollOwner, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    window.addEventListener("resize", updateOverflow);
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", updateOverflow);
    };
  }, [visibleState]);

  return (
    <div
      className="grid h-full min-h-0 grid-rows-[56px_minmax(0,1fr)_56px]"
      ref={shellRef}
    >
      <div className="px-[36px]">
        <PrototypeHeader />
      </div>
      <div
        className={cn(
          "min-h-0 px-[36px] pb-6 pt-4",
          stepOwnsScroll ? "overflow-y-auto" : "overflow-hidden",
        )}
        data-prototype-scroll-owner={stepOwnsScroll ? "true" : undefined}
        data-testid="prototype-step-scroll"
      >
        {children}
      </div>
      <footer
        className={cn(
          "flex h-full items-center justify-between px-[36px]",
          contentOverflows &&
            "border-t border-[var(--prototype-hairline-soft)]",
        )}
        data-overflow-divider={contentOverflows ? "true" : "false"}
        data-testid="prototype-footer"
      >
        {footer}
      </footer>
    </div>
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
  onNameChange,
}: {
  appearance: Appearance;
  name: string;
  onAppearanceChange: (appearance: Appearance) => void;
  onBegin: () => void;
  onNameChange: (value: string) => void;
}) {
  return (
    <section
      aria-labelledby="conversational-welcome-heading"
      className="min-h-full w-full pt-6"
      data-testid="conversational-onboarding-welcome"
    >
      <div data-testid="prototype-step-origin">
        <p className="mb-3 text-2xs font-semibold tracking-[0.09em] text-[var(--prototype-muted)] uppercase">
          Your personal agent home
        </p>
        <h1
          className="max-w-[31rem] text-[length:var(--prototype-heading-size)] font-medium leading-[1.15] tracking-[-0.018em]"
          id="conversational-welcome-heading"
        >
          Bring your agents together.
        </h1>
        <p className="mt-3 max-w-[32rem] text-[length:var(--prototype-body-size)] leading-[1.375rem] text-[var(--prototype-muted-strong)]">
          Luca gives you one calm place to talk with the AI agents already on
          your Mac—and helps you set up the rest as you go.
        </p>
      </div>
      <div className="mt-7 grid gap-5">
        <label className="grid gap-2">
          <span className="text-xs font-medium text-[var(--prototype-muted-strong)]">
            What should Luca call you?
          </span>
          <input
            autoComplete="name"
            className="min-h-10 rounded-[9px] border border-[var(--prototype-hairline)] bg-[var(--prototype-field)] px-3 py-2 text-sm shadow-[inset_0_1px_1px_var(--prototype-shadow)] outline-none placeholder:text-[var(--prototype-muted)] focus-visible:border-[color-mix(in_srgb,var(--prototype-ink)_35%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--prototype-focus)]"
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
    </section>
  );
}

function RuntimeState({
  appearance,
  error,
  onRecover,
  onSelect,
  runtimes,
  selectedId,
}: {
  appearance: "light" | "dark";
  error: string | null;
  onRecover: (runtime: RuntimeChoice) => void;
  onSelect: (id: RuntimeId) => void;
  runtimes: RuntimeChoice[];
  selectedId: RuntimeId;
}) {
  const [showOtherRuntimes, setShowOtherRuntimes] = React.useState(false);
  const selected =
    runtimes.find((runtime) => runtime.id === selectedId) ?? runtimes[0];
  const ready = selected.status === "ready";
  const readyRuntimes = [...runtimes]
    .filter((runtime) => runtime.status === "ready")
    .sort(
      (left, right) =>
        Number(Boolean(right.recommended)) - Number(Boolean(left.recommended)),
    );
  const unreadyRuntimes = runtimes.filter(
    (runtime) => runtime.status !== "ready",
  );
  const revealAll = showOtherRuntimes || readyRuntimes.length === 0 || !ready;
  const visibleRuntimes = revealAll
    ? [...readyRuntimes, ...unreadyRuntimes]
    : readyRuntimes;

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
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0" data-testid="prototype-step-origin">
        <h1
          className="text-[length:var(--prototype-heading-size)] font-medium leading-[1.15] tracking-[-0.018em]"
          id="runtime-heading"
        >
          Choose what powers Luca
        </h1>
        <p className="mt-2 max-w-[34rem] text-[length:var(--prototype-body-size)] leading-[1.375rem] text-[var(--prototype-muted-strong)]">
          Pick the AI Luca should use on this Mac. You can change it later
          without changing who Luca is.
        </p>
      </div>
      <div
        className="mt-5 min-h-0 flex-1 overflow-y-auto pb-1"
        data-prototype-scroll-owner="true"
        data-testid="prototype-runtime-scroll"
      >
        <div
          aria-labelledby="runtime-heading"
          className="grid grid-cols-1 rounded-[10px] bg-[var(--prototype-recessed)] p-1"
          role="radiogroup"
        >
          {visibleRuntimes.map((runtime) => {
            const active = runtime.id === selected.id;
            const statusId = `runtime-${runtime.id}-status`;
            const detailId = `runtime-${runtime.id}-detail`;
            return (
              <label
                className={cn(
                  "group flex min-h-[52px] w-full cursor-pointer items-center gap-3 rounded-[8px] px-3 py-2 text-left outline-none transition-[background-color,box-shadow] duration-[90ms] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-[-2px] has-[:focus-visible]:outline-[var(--prototype-focus)]",
                  active
                    ? "bg-[var(--prototype-raised)] shadow-[0_1px_2px_var(--prototype-shadow)]"
                    : "hover:bg-[var(--prototype-selection)]",
                )}
                data-testid={`runtime-choice-${runtime.id}`}
                key={runtime.id}
              >
                <input
                  aria-describedby={`${statusId}${active ? ` ${detailId}` : ""}`}
                  checked={active}
                  className="sr-only"
                  name="luca-runtime"
                  onChange={() => onSelect(runtime.id)}
                  type="radio"
                  value={runtime.id}
                />
                <span className="grid size-5 shrink-0 place-items-center">
                  <RuntimeMark appearance={appearance} runtime={runtime} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {runtime.name}
                  </span>
                  <span
                    className="mt-0.5 block text-[length:var(--prototype-support-size)] leading-[1.125rem] text-[var(--prototype-muted)]"
                    id={statusId}
                  >
                    {runtime.status === "ready"
                      ? `Ready on this Mac${runtime.recommended ? " · Recommended" : ""}`
                      : statusLabels[runtime.status]}
                  </span>
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
        {unreadyRuntimes.length > 0 && !revealAll ? (
          <button
            aria-expanded="false"
            className="mt-2.5 w-fit rounded-[6px] py-1 text-xs text-[var(--prototype-muted)] outline-none hover:text-[var(--prototype-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--prototype-focus)]"
            onClick={() => setShowOtherRuntimes(true)}
            type="button"
          >
            Choose another runtime
          </button>
        ) : null}
        <p
          className="mt-3 text-[length:var(--prototype-support-size)] leading-[1.125rem] text-[var(--prototype-muted-strong)]"
          id={`runtime-${selected.id}-detail`}
        >
          {selected.detail}
        </p>
        {!ready ? (
          <div
            aria-live="polite"
            className="mt-4 pb-px"
            data-testid="runtime-recovery"
          >
            <div className="flex items-start gap-3">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-[var(--prototype-muted-strong)]" />
              <div className="min-w-0 flex-1">
                <p className="text-[length:var(--prototype-support-size)] font-medium leading-[1.125rem]">
                  {selected.name} needs attention
                </p>
                <p className="mt-1 text-[length:var(--prototype-support-size)] leading-[1.125rem] text-[var(--prototype-muted)]">
                  {selected.status === "unavailable"
                    ? "This runtime cannot be used in this fixture. Choose another option."
                    : selected.id === "hermes" || selected.id === "openclaw"
                      ? "Finish setup in its native system. Existing provider settings, including OpenRouter, stay there."
                      : "Complete the existing setup, then let Luca check readiness again."}
                </p>
                {error ? (
                  <p
                    className="mt-2 text-[length:var(--prototype-support-size)] leading-[1.125rem] text-red-600 dark:text-red-400"
                    role="alert"
                  >
                    {error}
                  </p>
                ) : null}
              </div>
              {selected.status !== "unavailable" ? (
                <button
                  className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-[8px] border border-[var(--prototype-hairline)] bg-[var(--prototype-field)] px-3 py-1 text-[length:var(--prototype-support-size)] font-medium hover:bg-[var(--prototype-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--prototype-focus)] disabled:opacity-50"
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
      </div>
      <span className="sr-only" aria-live="polite">
        {selected.name}: {statusLabels[selected.status]}
      </span>
    </div>
  );
}

function AgentsSummaryState() {
  return (
    <div className="min-h-full" data-testid="agents-summary">
      <div data-testid="prototype-step-origin">
        <h1 className="text-[length:var(--prototype-heading-size)] font-medium leading-[1.15] tracking-[-0.018em]">
          Bring in agents you already use
        </h1>
        <p className="mt-2 max-w-[32rem] text-[length:var(--prototype-body-size)] leading-[1.375rem] text-[var(--prototype-muted-strong)]">
          We found {agentCandidates.length} agents on this Mac. Nothing is
          imported unless you choose it.
        </p>
      </div>
      <div className="mt-7 grid grid-cols-2 gap-5 rounded-[10px] bg-[var(--prototype-recessed)] px-4 py-3.5">
        <div>
          <p className="text-sm font-medium">Hermes</p>
          <p className="mt-1 text-[length:var(--prototype-support-size)] leading-[1.125rem] text-[var(--prototype-muted)]">
            4 profiles found
          </p>
        </div>
        <div>
          <p className="text-sm font-medium">OpenClaw</p>
          <p className="mt-1 text-[length:var(--prototype-support-size)] leading-[1.125rem] text-[var(--prototype-muted)]">
            4 agents found
          </p>
        </div>
      </div>
    </div>
  );
}

function AgentsSelectState({
  onToggle,
  selectedIds,
}: {
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
    <div className="flex h-full min-h-0 flex-col" data-testid="agents-select">
      <div className="shrink-0" data-testid="prototype-step-origin">
        <h1 className="text-[length:var(--prototype-heading-size)] font-medium leading-[1.15] tracking-[-0.018em]">
          Choose agents
        </h1>
        <p className="mt-1 text-[length:var(--prototype-support-size)] leading-[1.125rem] text-[var(--prototype-muted)]">
          Nothing is imported unless you select it.
        </p>
        <label className="relative mt-4 block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[var(--prototype-muted)]" />
          <input
            aria-label="Search agents"
            className="min-h-9 w-full rounded-[8px] border border-[var(--prototype-hairline)] bg-[var(--prototype-field)] py-2 pl-9 pr-3 text-[length:var(--prototype-support-size)] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--prototype-focus)]"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search agents"
            value={query}
          />
        </label>
        <div className="mt-2.5 flex items-center gap-5 text-xs">
          <button
            className="rounded-[4px] text-[var(--prototype-muted-strong)] hover:text-[var(--prototype-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--prototype-focus)]"
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
            className="rounded-[4px] text-[var(--prototype-muted)] hover:text-[var(--prototype-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--prototype-focus)]"
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
        className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-[9px] bg-[var(--prototype-recessed)] p-1"
        data-prototype-scroll-owner="true"
        data-testid="prototype-agent-inventory"
      >
        {(["Hermes", "OpenClaw"] as const).map((source) => {
          const group = filtered.filter((agent) => agent.source === source);
          if (!group.length) return null;
          return (
            <div key={source}>
              <p className="px-3 pb-1 pt-2 text-2xs font-semibold tracking-[0.12em] text-[var(--prototype-muted)] uppercase">
                {source}
              </p>
              {group.map((agent) => {
                const selected = selectedIds.has(agent.id);
                return (
                  <button
                    aria-pressed={selected}
                    className={cn(
                      "flex min-h-11 w-full items-center gap-3 rounded-[7px] px-3 py-2 text-left hover:bg-[var(--prototype-selection)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--prototype-focus)] disabled:cursor-not-allowed disabled:opacity-45",
                      selected && "bg-[var(--prototype-raised)]",
                    )}
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
                      <span className="block text-sm font-medium">
                        {agent.name}
                      </span>
                      <span className="block text-[length:var(--prototype-support-size)] leading-[1.125rem] text-[var(--prototype-muted)]">
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
          <p className="px-3 py-8 text-center text-[length:var(--prototype-support-size)] leading-[1.125rem] text-[var(--prototype-muted)]">
            No matching agents
          </p>
        ) : null}
      </section>
    </div>
  );
}

function PreparingState({
  appearance,
  opening,
  showIndicator,
}: {
  appearance: "light" | "dark";
  opening: boolean;
  showIndicator: boolean;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <section
      aria-live="polite"
      className="flex min-h-full w-full flex-col items-start"
      data-testid="conversational-onboarding-preparing"
    >
      <div data-testid="prototype-step-origin">
        <div data-testid="prototype-setup-luca-glyph">
          <LucaMark appearance={appearance} size={30} />
        </div>
        <motion.div
          animate={{ opacity: opening ? 0 : 1 }}
          data-testid="prototype-preparation-copy"
          transition={{ duration: reduceMotion ? 0.12 : 0.1 }}
        >
          <h1 className="mt-5 text-[length:var(--prototype-heading-size)] font-medium leading-[1.15] tracking-[-0.018em]">
            Getting Luca ready…
          </h1>
          <div className="mt-4 grid h-5 place-items-center text-[var(--prototype-muted-strong)]">
            {showIndicator ? (
              reduceMotion ? (
                <span className="size-2 rounded-full bg-current" />
              ) : (
                <LoaderCircle
                  className="size-5 animate-spin"
                  strokeWidth={1.4}
                />
              )
            ) : null}
          </div>
        </motion.div>
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
          <p className="text-[length:var(--prototype-support-size)] font-semibold">
            Create a Polyphonic Agent
          </p>
          <p className="mt-1 text-[length:var(--prototype-support-size)] leading-5 text-[var(--prototype-muted-strong)]">
            A research partner named Atlas, using Codex on this Mac.
          </p>
        </div>
        <span className="rounded-full bg-[var(--prototype-field)] px-2 py-1 text-badge font-medium tracking-[0.06em] text-[var(--prototype-muted)] uppercase">
          Review
        </span>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <button
          className="inline-flex min-h-8 items-center gap-1.5 rounded-[8px] bg-[var(--prototype-accent)] px-3 py-1 text-sm font-semibold text-[var(--prototype-accent-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--prototype-focus)]"
          type="button"
        >
          <Check className="size-3.5" />
          Approve
        </button>
        <button
          className="inline-flex min-h-8 items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-sm text-[var(--prototype-muted-strong)] hover:bg-[var(--prototype-field)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--prototype-focus)]"
          type="button"
        >
          <Pencil className="size-3.5" />
          Edit
        </button>
        <button
          className="inline-flex min-h-8 items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-sm text-[var(--prototype-muted-strong)] hover:bg-[var(--prototype-field)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--prototype-focus)]"
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
  autoFocus,
  forceProposal,
  name,
  onOpeningComplete,
  onShowProposal,
  opening,
  showGreeting,
}: {
  appearance: "light" | "dark";
  autoFocus: boolean;
  forceProposal: boolean;
  name: string;
  onOpeningComplete?: () => void;
  onShowProposal: () => void;
  opening: boolean;
  showGreeting: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const composerRef = React.useRef<HTMLTextAreaElement>(null);
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
  React.useEffect(() => {
    if (!autoFocus) return;
    composerRef.current?.focus();
  }, [autoFocus]);
  const chromeTransition = opening
    ? {
        delay: reduceMotion ? 0 : 0.11,
        duration: reduceMotion ? 0.12 : 0.2,
      }
    : { duration: 0 };
  return (
    <div
      className="flex h-full w-full overflow-hidden"
      data-testid="conversational-onboarding-conversation"
    >
      <motion.aside
        animate={{ opacity: 1 }}
        className="hidden w-[13rem] shrink-0 flex-col bg-[color-mix(in_srgb,var(--prototype-canvas)_70%,var(--prototype-raised))] p-3 md:flex"
        initial={{ opacity: opening ? 0 : 1 }}
        transition={chromeTransition}
      >
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <LucaMark appearance={appearance} size={17} />
          <span className="text-[length:var(--prototype-support-size)] font-semibold">
            Luca
          </span>
        </div>
        <nav className="mt-5 grid gap-0.5 text-xs text-[var(--prototype-muted-strong)]">
          {["New conversation", "Inbox", "Agents", "Brain"].map((item) => (
            <button
              className="flex h-8 items-center justify-between rounded-[7px] px-2 text-left hover:bg-[var(--prototype-selection)]"
              key={item}
              type="button"
            >
              {item}
              {item === "Inbox" ? <span className="text-badge">1</span> : null}
            </button>
          ))}
        </nav>
        <p className="mb-2 mt-7 px-2 text-badge font-medium tracking-[0.09em] text-[var(--prototype-muted)] uppercase">
          Direct messages
        </p>
        <button
          className="flex h-9 items-center gap-2 rounded-[8px] bg-[var(--prototype-selection)] px-2 text-left text-xs font-medium"
          type="button"
        >
          <LucaMark appearance={appearance} size={14} />
          Luca
        </button>
        <button
          className="mt-auto flex h-8 items-center justify-between rounded-[7px] px-2 text-left text-xs text-[var(--prototype-muted)] hover:bg-[var(--prototype-selection)]"
          type="button"
        >
          Settings
          <ChevronRight className="size-3" />
        </button>
      </motion.aside>
      <motion.div
        animate={{ opacity: 1 }}
        className="flex min-w-0 flex-1 flex-col bg-[var(--prototype-field)]"
        initial={{ opacity: opening ? 0 : 1 }}
        transition={chromeTransition}
      >
        <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-[var(--prototype-hairline-soft)] px-5">
          <motion.span
            animate={{ opacity: 1 }}
            data-testid="prototype-destination-luca-glyph"
            initial={{ opacity: opening ? 0 : 1 }}
            transition={
              opening
                ? {
                    delay: reduceMotion ? 0 : 0.16,
                    duration: reduceMotion ? 0.12 : 0.08,
                  }
                : { duration: 0 }
            }
          >
            <LucaMark appearance={appearance} size={16} />
          </motion.span>
          <div>
            <p className="text-[length:var(--prototype-support-size)] font-semibold">
              Luca
            </p>
            <p className="text-badge text-[var(--prototype-muted)]">Ready</p>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8 sm:px-9">
          <div className="mx-auto max-w-[38rem]">
            {showGreeting ? (
              <motion.div
                animate={{ opacity: 1 }}
                className="flex gap-3"
                data-testid="prototype-canonical-greeting"
                initial={{ opacity: opening ? 0 : 1 }}
                onAnimationComplete={opening ? onOpeningComplete : undefined}
                transition={{
                  delay: opening && !reduceMotion ? 0.22 : 0,
                  duration: opening && reduceMotion ? 0.12 : 0.16,
                }}
              >
                <LucaMark appearance={appearance} size={20} />
                <div className="pt-0.5">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[length:var(--prototype-support-size)] font-semibold">
                      Luca
                    </span>
                    <span className="text-badge text-[var(--prototype-muted)]">
                      now
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-6">
                    Hi, {name || "Riley"} — I’m Luca. I’m ready. What would you
                    like help with first?
                  </p>
                </div>
              </motion.div>
            ) : null}
            {sentMessage ? (
              <div className="mt-7 pl-[3rem]">
                <div className="flex items-baseline gap-2">
                  <span className="text-[length:var(--prototype-support-size)] font-semibold">
                    {name || "Riley"}
                  </span>
                  <span className="text-badge text-[var(--prototype-muted)]">
                    now
                  </span>
                </div>
                <p className="mt-1 text-sm leading-6">{sentMessage}</p>
                {forceProposal ? (
                  <div className="mt-7 flex gap-3">
                    <LucaMark appearance={appearance} size={20} />
                    <div className="min-w-0 flex-1 pt-0.5">
                      <span className="text-[length:var(--prototype-support-size)] font-semibold">
                        Luca
                      </span>
                      <p className="mt-1 text-sm leading-6">
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
              className="max-h-32 min-h-8 flex-1 resize-none bg-transparent px-2 py-1.5 text-[length:var(--prototype-support-size)] leading-5 outline-none placeholder:text-[var(--prototype-muted)]"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder="Message Luca"
              ref={composerRef}
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
      </motion.div>
    </div>
  );
}

export function ConversationalOnboardingPreview() {
  const reduceMotion = useReducedMotion();
  const systemColorScheme = useSystemColorScheme();
  const [appearance, setAppearance] = React.useState<Appearance>("system");
  const [name, setName] = React.useState("Riley");
  const [state, setState] = React.useState<PrototypeState>(readPrototypeState);
  const stateRef = React.useRef(state);
  const thresholdSourceRef = React.useRef<HTMLDivElement>(null);
  const thresholdEpochRef = React.useRef(state === "threshold-opening" ? 1 : 0);
  const [thresholdEpoch, setThresholdEpoch] = React.useState(
    thresholdEpochRef.current,
  );
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
  const [transitionDirection, setTransitionDirection] = React.useState(1);
  const [showPreparingIndicator, setShowPreparingIndicator] =
    React.useState(false);
  const holdReviewState = React.useRef(
    new URL(window.location.href).searchParams.get("prototypeHold") === "1",
  );
  const resolvedAppearance =
    appearance === "system" ? systemColorScheme : appearance;
  const palette = resolvedAppearance === "dark" ? darkPalette : lightPalette;
  const discoveryStatus = discoveryForScenario(scenario);
  const selectedRuntime =
    runtimes.find((runtime) => runtime.id === selectedRuntimeId) ?? runtimes[0];

  const navigate = React.useCallback((next: PrototypeState, direction = 1) => {
    stateRef.current = next;
    setTransitionDirection(direction);
    setState(next);
  }, []);

  const beginThresholdOpening = React.useCallback(() => {
    if (stateRef.current !== "threshold") return;
    const nextEpoch = thresholdEpochRef.current + 1;
    thresholdEpochRef.current = nextEpoch;
    setThresholdEpoch(nextEpoch);
    navigate("threshold-opening");
  }, [navigate]);

  const completeThresholdOpening = React.useCallback(
    (epoch: number) => {
      if (
        epoch !== thresholdEpochRef.current ||
        stateRef.current !== "threshold-opening" ||
        holdReviewState.current
      ) {
        return;
      }
      navigate("welcome");
    },
    [navigate],
  );

  React.useEffect(() => {
    if (state !== "preparing") return;
    setShowPreparingIndicator(false);
    const indicatorTimeout = window.setTimeout(
      () => setShowPreparingIndicator(true),
      300,
    );
    if (holdReviewState.current) {
      return () => window.clearTimeout(indicatorTimeout);
    }
    const completionFrame = window.requestAnimationFrame(() =>
      navigate("opening"),
    );
    return () => {
      window.clearTimeout(indicatorTimeout);
      window.cancelAnimationFrame(completionFrame);
    };
  }, [navigate, state]);

  const continueFromRuntime = () => {
    navigate(discoveryStatus === "found" ? "agents-summary" : "preparing");
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

  const visibleSetupState = state === "threshold-opening" ? "welcome" : state;
  const thresholdVisible =
    state === "threshold" || state === "threshold-opening";
  const setupState =
    state !== "threshold" && state !== "conversation" && state !== "proposal";
  const homeSized =
    state === "opening" || state === "conversation" || state === "proposal";
  const renderHome =
    state === "opening" || state === "conversation" || state === "proposal";
  const activeOpening = state === "opening" && !holdReviewState.current;

  const setupFooter = (() => {
    if (state === "welcome" || state === "threshold-opening") {
      return (
        <>
          <QuietButton onClick={openManualSetup}>Set up manually</QuietButton>
          <PrimaryButton
            disabled={!name.trim()}
            onClick={() => navigate("runtime")}
          >
            Begin
            <ArrowRight className="size-3.5" />
          </PrimaryButton>
        </>
      );
    }
    if (state === "runtime") {
      return (
        <>
          <QuietButton onClick={() => navigate("welcome", -1)}>
            Back
          </QuietButton>
          <PrimaryButton
            disabled={selectedRuntime.status !== "ready"}
            onClick={continueFromRuntime}
          >
            Continue
          </PrimaryButton>
        </>
      );
    }
    if (state === "agents-summary") {
      return (
        <>
          <QuietButton onClick={() => navigate("runtime", -1)}>
            Back
          </QuietButton>
          <div className="flex items-center gap-4">
            <QuietButton onClick={() => navigate("preparing")}>
              Not now
            </QuietButton>
            <PrimaryButton onClick={() => navigate("agents-select")}>
              Choose agents
              <ArrowRight className="size-3.5" />
            </PrimaryButton>
          </div>
        </>
      );
    }
    if (state === "agents-select") {
      return (
        <>
          <QuietButton onClick={() => navigate("agents-summary", -1)}>
            <span className="inline-flex items-center gap-1">
              <ArrowLeft className="size-3" />
              Back
            </span>
          </QuietButton>
          <PrimaryButton onClick={() => navigate("preparing")}>
            {selectedAgentIds.size
              ? `Import ${selectedAgentIds.size} and continue`
              : "Continue"}
          </PrimaryButton>
        </>
      );
    }
    return <span aria-hidden />;
  })();

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
            ? "radial-gradient(circle, rgba(220,219,216,0.035) 1px, transparent 1px)"
            : "radial-gradient(circle, rgba(33,34,30,0.05) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif',
      }}
    >
      <StartupWindowDragRegion />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at center, var(--prototype-canvas) 0%, color-mix(in srgb, var(--prototype-canvas) 94%, transparent) 34%, transparent 68%)",
        }}
      />
      {thresholdVisible ? (
        <PrototypeThresholdStage
          onBegin={beginThresholdOpening}
          onManualSetup={openManualSetup}
          sourceRef={thresholdSourceRef}
          transitioning={state === "threshold-opening"}
        />
      ) : null}
      <main className="relative grid h-full place-items-center p-4">
        <motion.section
          animate={{
            clipPath:
              state === "threshold"
                ? "inset(41% 36% 41% 36% round 24px)"
                : "inset(0% 0% 0% 0% round 15px)",
            opacity: state === "threshold" ? 0 : 1,
            y: 0,
          }}
          className={cn(
            "relative overflow-hidden border border-[var(--prototype-hairline)] bg-[color-mix(in_srgb,var(--prototype-field)_96%,transparent)]",
            state === "threshold-opening" ? "z-50" : "z-10",
            homeSized
              ? "h-[min(42rem,calc(100dvh-2rem))] w-[min(62rem,calc(100vw-2rem))] rounded-[16px]"
              : "h-[min(34.5rem,calc(100dvh-2rem))] w-[min(37rem,calc(100vw-2rem))] rounded-[15px]",
          )}
          data-phase={state}
          data-testid="prototype-home-surface"
          layout={reduceMotion ? false : "size"}
          style={{
            boxShadow:
              "inset 0 1px 0 var(--prototype-hairline-soft), 0 1px 2px rgba(0,0,0,0.08), 0 22px 64px var(--prototype-shadow)",
          }}
          transition={{
            layout: {
              duration: 0.36,
              ease: [0.22, 1, 0.36, 1],
            },
            clipPath: {
              delay: state === "threshold-opening" && !reduceMotion ? 0.94 : 0,
              duration:
                state === "threshold-opening" && !reduceMotion ? 0.62 : 0,
              ease: [0.22, 1, 0.36, 1],
            },
            opacity: {
              delay: state === "threshold-opening" && !reduceMotion ? 0.88 : 0,
              duration:
                state === "threshold-opening"
                  ? reduceMotion
                    ? 0.12
                    : 0.52
                  : 0,
              ease: "easeOut",
            },
          }}
        >
          <AnimatePresence initial={false}>
            {setupState ? (
              <motion.div
                animate={{ opacity: activeOpening ? 0 : 1 }}
                className={cn(
                  "absolute inset-0 z-10",
                  (state === "opening" || state === "threshold-opening") &&
                    "pointer-events-none",
                )}
                data-testid="prototype-setup-layer"
                exit={{ opacity: 0 }}
                initial={{
                  opacity: state === "threshold-opening" ? 0 : 1,
                }}
                key="setup-shell"
                transition={{
                  delay:
                    state === "threshold-opening" && !reduceMotion
                      ? 0.82
                      : activeOpening && !reduceMotion
                        ? 0.22
                        : 0,
                  duration:
                    state === "threshold-opening"
                      ? reduceMotion
                        ? 0.12
                        : 0.34
                      : activeOpening && reduceMotion
                        ? 0.12
                        : 0.08,
                }}
              >
                <PrototypeSetupShell footer={setupFooter} state={state}>
                  <AnimatePresence initial={false} mode="wait">
                    <motion.div
                      animate={{ opacity: 1, x: 0 }}
                      className="h-full"
                      exit={{
                        opacity: 0,
                        x: reduceMotion ? 0 : transitionDirection * -3,
                      }}
                      initial={{
                        opacity: 0,
                        x: reduceMotion ? 0 : transitionDirection * 3,
                      }}
                      key={visibleSetupState}
                      transition={{
                        duration: reduceMotion ? 0.11 : 0.18,
                        ease: [0.2, 0, 0, 1],
                      }}
                    >
                      {visibleSetupState === "welcome" ? (
                        <WelcomeState
                          appearance={appearance}
                          name={name}
                          onAppearanceChange={setAppearance}
                          onBegin={() => navigate("runtime")}
                          onNameChange={setName}
                        />
                      ) : null}
                      {visibleSetupState === "runtime" ? (
                        <RuntimeState
                          appearance={resolvedAppearance}
                          error={runtimeError}
                          onRecover={recoverRuntime}
                          onSelect={(id) => {
                            setSelectedRuntimeId(id);
                            setRuntimeError(null);
                          }}
                          runtimes={runtimes}
                          selectedId={selectedRuntimeId}
                        />
                      ) : null}
                      {visibleSetupState === "agents-summary" ? (
                        <AgentsSummaryState />
                      ) : null}
                      {visibleSetupState === "agents-select" ? (
                        <AgentsSelectState
                          onToggle={toggleAgent}
                          selectedIds={selectedAgentIds}
                        />
                      ) : null}
                      {visibleSetupState === "preparing" ||
                      visibleSetupState === "opening" ? (
                        <PreparingState
                          appearance={resolvedAppearance}
                          opening={activeOpening}
                          showIndicator={showPreparingIndicator}
                        />
                      ) : null}
                    </motion.div>
                  </AnimatePresence>
                </PrototypeSetupShell>
              </motion.div>
            ) : null}
          </AnimatePresence>
          {renderHome ? (
            <motion.div
              animate={{ opacity: 1 }}
              className="absolute inset-0 z-0"
              data-testid="prototype-home-layer"
              initial={{ opacity: state === "opening" ? 0 : 1 }}
              transition={{
                delay: state === "opening" && !reduceMotion ? 0.11 : 0,
                duration: state === "opening" ? (reduceMotion ? 0.12 : 0.2) : 0,
              }}
            >
              <ConversationState
                appearance={resolvedAppearance}
                autoFocus={state === "conversation" || state === "proposal"}
                forceProposal={state === "proposal"}
                name={name}
                onOpeningComplete={
                  activeOpening ? () => navigate("conversation") : undefined
                }
                onShowProposal={() => navigate("proposal")}
                opening={state === "opening"}
                showGreeting={state !== "opening" || activeOpening}
              />
            </motion.div>
          ) : null}
          <span aria-live="polite" className="sr-only">
            {state === "conversation" || state === "proposal"
              ? "Polyphonic is ready. Luca is ready."
              : ""}
          </span>
        </motion.section>
      </main>
      <PrototypeThresholdContinuity
        appearance={resolvedAppearance}
        hold={holdReviewState.current}
        onThresholdSettled={completeThresholdOpening}
        opening={activeOpening}
        sourceRef={thresholdSourceRef}
        state={state}
        thresholdEpoch={thresholdEpoch}
      />
    </div>
  );
}
