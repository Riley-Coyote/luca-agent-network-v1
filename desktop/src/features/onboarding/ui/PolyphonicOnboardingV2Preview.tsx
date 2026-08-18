import {
  AnimatePresence,
  motion,
  useAnimate,
  useReducedMotion,
} from "motion/react";
import * as React from "react";

import { discoverNativeResidents } from "@/shared/api/tauri";
import type { NativeResidentDiscoveryOutcome } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { DotSigil } from "@/shared/ui/dot-display/DotSigil";
import { StartupWindowDragRegion } from "@/shared/ui/StartupWindowDragRegion";
import { isSelectableAgentImportCandidate } from "../onboardingAgentImport";
import {
  clearPolyphonicOnboardingTransaction,
  createPolyphonicOnboardingTransaction,
  type PolyphonicOnboardingChapter,
  savePolyphonicOnboardingTransaction,
} from "../polyphonicOnboardingState";
import {
  PolyphonicAgentImportStep,
  type PolyphonicAgentImportMode,
  type PolyphonicAgentImportStepHandle,
} from "./PolyphonicAgentImportStep";
import { polyphonicDarkPalette } from "./PolyphonicOnboardingPresentation";
import { PolyphonicPreparingStep } from "./PolyphonicPreparingStep";
import {
  PolyphonicRuntimeStep,
  type PolyphonicRuntimeStepHandle,
} from "./PolyphonicRuntimeStep";
import {
  LucaThresholdGlyph,
  POLYPHONIC_IDENTITY_SEED,
} from "./PolyphonicThresholdField";
import {
  PolyphonicYouStep,
  type PolyphonicYouStepHandle,
} from "./PolyphonicYouStep";

/**
 * Design-lab preview of the onboarding direction agreed on 2026-08-17:
 *
 * - One continuous object. The dendrite that grows on the threshold never
 *   leaves; on Begin it travels into the card's visual pane and the card
 *   assembles around it. Chapters change the field's *state* (recall → think →
 *   net → pulse), never the object.
 * - Split card: living visual on the left, interaction on the right.
 * - One mood for the doorway: dark throughout, in the application's own type.
 *   The appearance choice is shown as a swatch and applied when the app opens.
 *
 * Reachable only via `?polyphonicOnboardingPreview=v2`. Reuses the production
 * step components and their real (mocked) commands; only the frame is new.
 */

const PREVIEW_PUBKEY = "e".repeat(64);
/** Canvas size of the field. Drawn once, at one scale, for the whole flow. */
const FIELD = 576;
const FIELD_SCALE = 0.72;
/** Card geometry, px. The pane is sized to the field so nothing has to move. */
const CARD_W = 960;
const CARD_H = 544;
const PANE_W = 416;
const EASE: [number, number, number, number] = [0.2, 0, 0, 1];
const REVEAL_MASK = `radial-gradient(circle at ${PANE_W / 2}px 50%, #000 calc(var(--reveal, 0px) - 140px), transparent var(--reveal, 0px))`;

type Stage = "threshold" | PolyphonicOnboardingChapter;

/** Chapters move with the direction of travel; arriving from the door waits
 *  for the surface to pass under the column first. */
const chapterVariants = {
  enter: (dir: number) => ({ opacity: 0, y: dir < 0 ? -12 : dir > 0 ? 12 : 6 }),
  center: (dir: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: dir === 0 ? 0.36 : 0.06,
      duration: 0.32,
      ease: EASE,
    },
  }),
  exit: (dir: number) => ({
    opacity: 0,
    y: dir < 0 ? 10 : -10,
    transition: { duration: 0.18, ease: EASE },
  }),
};

const previousChapter: Record<
  PolyphonicOnboardingChapter,
  PolyphonicOnboardingChapter
> = {
  welcome: "welcome",
  runtime: "welcome",
  agents: "runtime",
  preparing: "runtime",
};

function candidateCount(outcome: NativeResidentDiscoveryOutcome | null) {
  return (
    outcome?.runtimes.reduce(
      (count, runtime) =>
        count +
        runtime.candidates.filter(isSelectableAgentImportCandidate).length,
      0,
    ) ?? 0
  );
}

function useViewport() {
  const [size, setSize] = React.useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  React.useEffect(() => {
    const onResize = () =>
      setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
}

function useRect(ref: React.RefObject<HTMLElement | null>) {
  const [rect, setRect] = React.useState<DOMRect | null>(null);
  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setRect(element.getBoundingClientRect());
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ref]);
  return rect;
}

export function PolyphonicOnboardingV2Preview() {
  const reduceMotion = useReducedMotion();
  const viewport = useViewport();
  const paneRef = React.useRef<HTMLDivElement>(null);
  const paneRect = useRect(paneRef);

  const [stage, setStage] = React.useState<Stage>("threshold");
  /** -1 back, +1 forward, 0 arriving from the door. Drives chapter motion. */
  const [direction, setDirection] = React.useState(0);
  const [flowKey, setFlowKey] = React.useState(0);
  const [fieldScope, animateField] = useAnimate<HTMLDivElement>();
  const [displayName, setDisplayName] = React.useState("Riley");
  const [busy, setBusy] = React.useState(false);
  const [runtimeReady, setRuntimeReady] = React.useState(false);
  const [agentsContinueLabel, setAgentsContinueLabel] =
    React.useState("Continue");
  const [agentsMode, setAgentsMode] =
    React.useState<PolyphonicAgentImportMode>("summary");
  const [error, setError] = React.useState<string | null>(null);
  const [discovery, setDiscovery] =
    React.useState<NativeResidentDiscoveryOutcome | null>(null);
  const youRef = React.useRef<PolyphonicYouStepHandle>(null);
  const runtimeRef = React.useRef<PolyphonicRuntimeStepHandle>(null);
  const agentsRef = React.useRef<PolyphonicAgentImportStepHandle>(null);

  const scan = React.useCallback(async () => {
    const outcome = await discoverNativeResidents();
    setDiscovery(outcome);
    return outcome;
  }, []);
  React.useEffect(() => {
    void scan().catch(() => {});
  }, [scan]);

  const go = React.useCallback(
    (chapter: PolyphonicOnboardingChapter, dir = 1) => {
      setDirection(dir);
      savePolyphonicOnboardingTransaction({
        ...createPolyphonicOnboardingTransaction(PREVIEW_PUBKEY),
        chapter,
        profileSaved: chapter !== "welcome",
        runtimeConfirmed: chapter !== "welcome" && chapter !== "runtime",
      });
      setStage(chapter);
    },
    [],
  );

  const begin = React.useCallback(() => {
    clearPolyphonicOnboardingTransaction(PREVIEW_PUBKEY);
    setFlowKey((k) => k + 1);
    go("welcome", 0);
    // The surface comes *out of* the field: it swells for a beat as the card
    // begins to accrete, and settles as the card completes.
    if (fieldScope.current && !reduceMotion) {
      void animateField(
        fieldScope.current,
        { filter: ["brightness(1)", "brightness(1.9)", "brightness(1)"] },
        { duration: 1.1, ease: EASE, times: [0, 0.22, 1] },
      );
    }
  }, [animateField, fieldScope, go, reduceMotion]);

  const restart = React.useCallback(() => {
    // Preview only: the mock makes Luca ready instantly. Hold the last chapter
    // long enough to see the field settle and the mark come forward.
    window.setTimeout(() => {
      clearPolyphonicOnboardingTransaction(PREVIEW_PUBKEY);
      setDisplayName("Riley");
      setDirection(0);
      setStage("threshold");
    }, 2600);
  }, []);

  async function continueForward() {
    if (busy || stage === "threshold") return;
    setError(null);
    try {
      if (stage === "welcome") {
        const outcome = await youRef.current?.commit();
        if (!outcome) return;
        setDisplayName(outcome.displayName);
        go("runtime");
        return;
      }
      if (stage === "runtime") {
        const target = await runtimeRef.current?.commit();
        if (!target) return;
        go(candidateCount(discovery) > 0 ? "agents" : "preparing");
        return;
      }
      if (stage === "agents") {
        const outcome = await agentsRef.current?.commit();
        if (!outcome) return;
        go("preparing");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  // ---- geometry ----------------------------------------------------------
  // The field never moves. On the door it already sits where the card's pane
  // will be, and the title stack sits where the form will be; on Begin the
  // surface crystallises around the field and the copy swaps in place.
  const atThreshold = stage === "threshold";
  const fieldCenter = paneRect
    ? {
        x: paneRect.left + paneRect.width / 2,
        y: paneRect.top + paneRect.height / 2,
      }
    : { x: viewport.width / 2 - (CARD_W - PANE_W) / 2, y: viewport.height / 2 };
  // Reveal radius: from the field's heart to the card's far corner.
  const revealRadius = Math.ceil(
    Math.hypot(CARD_W - PANE_W / 2, CARD_H / 2) + 220,
  );

  const chapters: PolyphonicOnboardingChapter[] = [
    "welcome",
    "runtime",
    ...(candidateCount(discovery) > 0
      ? (["agents"] as PolyphonicOnboardingChapter[])
      : []),
  ];
  const chapterIndex =
    stage === "preparing" ? chapters.length : chapters.indexOf(stage as never);

  const continueDisabled =
    busy ||
    (stage === "welcome" && !displayName.trim()) ||
    (stage === "runtime" && !runtimeReady);
  const continueLabel =
    stage === "agents" ? agentsContinueLabel : busy ? "Working…" : "Continue";

  return (
    <div
      className="buzz-onboarding-neutral-theme buzz-startup-shell relative h-dvh overflow-hidden bg-[var(--prototype-canvas)] text-[var(--prototype-ink)]"
      data-testid="polyphonic-onboarding-v2"
      style={{ ...polyphonicDarkPalette, fontFamily: "var(--font-ui)" }}
    >
      <StartupWindowDragRegion />
      {/* Dot grid, as on the production door and card canvases. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle, var(--prototype-grid-dot) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
          backgroundPosition: "center",
        }}
      />

      {/* ---- the card, always mounted so the pane can be measured -------- */}
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <motion.section
          animate={
            atThreshold
              ? { "--reveal": "0px", opacity: 0 }
              : { "--reveal": `${revealRadius}px`, opacity: 1 }
          }
          aria-hidden={atThreshold || undefined}
          className={cn(
            "relative grid overflow-hidden rounded-[15px] border border-[var(--prototype-hairline)] bg-[var(--prototype-raised)] shadow-[inset_0_1px_0_var(--prototype-hairline-soft),0_1px_2px_rgb(0_0_0/0.08),0_22px_64px_var(--prototype-shadow)]",
            atThreshold && "pointer-events-none",
          )}
          data-testid="polyphonic-v2-card"
          initial={false}
          style={{
            width: `min(${CARD_W}px, calc(100vw - 2rem))`,
            height: `min(${CARD_H}px, calc(100dvh - 2rem))`,
            gridTemplateColumns: `${PANE_W}px minmax(0, 1fr)`,
            // The surface accretes outward from the field's heart with a soft
            // edge — the same gesture as the dendrite — rather than an iris
            // wipe. `--reveal` is the animated radius.
            WebkitMaskImage: REVEAL_MASK,
            maskImage: REVEAL_MASK,
          }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : atThreshold
                ? { duration: 0.32, ease: EASE }
                : {
                    "--reveal": { delay: 0.1, duration: 1.0, ease: EASE },
                    opacity: { delay: 0.1, duration: 0.2 },
                  }
          }
        >
          {/* visual pane: the field lives here (drawn by the fixed layer). */}
          <div
            className="relative border-r border-[var(--prototype-hairline)] bg-[var(--prototype-recessed)]"
            data-testid="polyphonic-v2-pane"
            ref={paneRef}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "radial-gradient(60% 55% at 50% 50%, rgb(255 255 255 / 0.028), transparent 70%)",
              }}
            />
            <span className="absolute bottom-5 left-6 text-sm font-medium tracking-[-0.01em] text-[var(--prototype-ink)]">
              Polyphonic
            </span>
          </div>

          {/* interaction column */}
          <div className="grid min-h-0 grid-rows-[3.5rem_minmax(0,1fr)_3.5rem]">
            <header className="flex items-center justify-end px-9">
              <div
                aria-label={`Step ${Math.min(chapterIndex + 1, chapters.length)} of ${chapters.length}`}
                className="flex items-center gap-1.5"
                role="img"
              >
                {chapters.map((chapter, index) => (
                  <span
                    className={cn(
                      "block h-px w-4 rounded-full transition-colors duration-300",
                      index <= chapterIndex
                        ? "bg-[var(--prototype-ink)]"
                        : "bg-[var(--prototype-ink)] opacity-20",
                    )}
                    key={chapter}
                  />
                ))}
              </div>
            </header>
            <div className="relative min-h-0 overflow-hidden px-9 pb-6 pt-2">
              <AnimatePresence
                custom={direction}
                initial={false}
                mode="popLayout"
              >
                <motion.div
                  animate="center"
                  className="h-full min-h-0"
                  custom={direction}
                  exit="exit"
                  initial="enter"
                  key={`${flowKey}:${stage}`}
                  variants={reduceMotion ? undefined : chapterVariants}
                >
                  {stage === "welcome" ? (
                    <PolyphonicYouStep
                      appearanceSwatches
                      displayName={displayName}
                      onBusyChange={setBusy}
                      onDisplayNameChange={setDisplayName}
                      pubkey={PREVIEW_PUBKEY}
                      ref={youRef}
                    />
                  ) : null}
                  {stage === "runtime" ? (
                    <PolyphonicRuntimeStep
                      onReadyChange={setRuntimeReady}
                      ref={runtimeRef}
                    />
                  ) : null}
                  {stage === "agents" && discovery ? (
                    <PolyphonicAgentImportStep
                      discovery={discovery}
                      onBusyChange={setBusy}
                      onContinueLabelChange={setAgentsContinueLabel}
                      onModeChange={setAgentsMode}
                      onRescan={scan}
                      ref={agentsRef}
                    />
                  ) : null}
                  {stage === "preparing" ? (
                    <PolyphonicPreparingStep
                      displayName={displayName}
                      onComplete={restart}
                      showMark={false}
                    />
                  ) : null}
                  {error ? (
                    <p className="mt-4 text-sm text-destructive" role="alert">
                      {error}
                    </p>
                  ) : null}
                </motion.div>
              </AnimatePresence>
            </div>
            <footer className="relative z-10 flex items-center justify-between gap-4 px-9">
              {stage !== "preparing" ? (
                <>
                  <Button
                    className="h-9 rounded-[7px] px-1 text-[length:var(--prototype-support-size)] font-normal text-[var(--prototype-muted)] hover:bg-[var(--prototype-selection)] hover:text-[var(--prototype-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--prototype-focus)]"
                    disabled={stage === "welcome" || busy}
                    onClick={() => {
                      if (stage === "threshold") return;
                      if (stage === "agents" && agentsMode === "select") {
                        agentsRef.current?.showSummary();
                        return;
                      }
                      go(previousChapter[stage], -1);
                    }}
                    type="button"
                    variant="ghost"
                  >
                    Back
                  </Button>
                  <div className="flex items-center gap-4">
                    {stage === "agents" && agentsMode === "summary" ? (
                      <button
                        className="rounded-[7px] px-1 py-1 text-[length:var(--prototype-support-size)] text-[var(--prototype-muted)] hover:text-[var(--prototype-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--prototype-focus)]"
                        onClick={() => go("preparing")}
                        type="button"
                      >
                        Not now
                      </button>
                    ) : null}
                    <Button
                      className="min-h-9 min-w-24 rounded-[9px] bg-[var(--prototype-accent)] px-4 py-2 text-[length:var(--prototype-support-size)] font-semibold text-[var(--prototype-accent-ink)] shadow-[0_1px_2px_var(--prototype-shadow)] transition-[background-color,box-shadow,opacity] duration-[80ms] hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--prototype-focus)]"
                      data-testid="polyphonic-setup-continue"
                      disabled={continueDisabled}
                      onClick={() => void continueForward()}
                      type="button"
                    >
                      {continueLabel}
                    </Button>
                  </div>
                </>
              ) : null}
            </footer>
          </div>
        </motion.section>
      </div>

      {/* ---- threshold copy: lives where the form will live ---------------- */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
        <div
          className="grid"
          style={{
            width: `min(${CARD_W}px, calc(100vw - 2rem))`,
            height: `min(${CARD_H}px, calc(100dvh - 2rem))`,
            gridTemplateColumns: `${PANE_W}px minmax(0, 1fr)`,
          }}
        >
          <div />
          <motion.div
            animate={atThreshold ? { opacity: 1, y: 0 } : { opacity: 0, y: -8 }}
            className={cn(
              "flex flex-col justify-center px-9",
              atThreshold ? "pointer-events-auto" : "pointer-events-none",
            )}
            initial={false}
            transition={
              reduceMotion
                ? { duration: 0 }
                : atThreshold
                  ? { delay: 0.35, duration: 0.5, ease: EASE }
                  : { duration: 0.22, ease: EASE }
            }
          >
            <h1 className="text-4xl font-medium tracking-[-0.04em] text-white">
              Polyphonic
            </h1>
            <p className="mt-3 max-w-[26rem] text-sm leading-6 text-white/60">
              A private home for your agents and the work that makes them
              useful.
            </p>
            <div className="mt-10 flex flex-col items-start gap-5">
              <Button
                className="h-10 rounded-lg bg-white px-5 text-sm font-medium text-black hover:bg-white/90"
                data-testid="polyphonic-v2-begin"
                onClick={begin}
                type="button"
              >
                Begin setup
              </Button>
              <p className="flex items-center gap-2.5 text-xs text-white/45">
                <button
                  className="rounded-[4px] hover:text-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--prototype-focus)]"
                  type="button"
                >
                  Use an existing identity
                </button>
                <span aria-hidden="true" className="text-white/25">
                  ·
                </span>
                <button
                  className="rounded-[4px] hover:text-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--prototype-focus)]"
                  type="button"
                >
                  Set up later
                </button>
              </p>
            </div>
          </motion.div>
        </div>
      </div>

      {/* ---- the field: one canvas, one place, for the whole flow -------- */}
      <div
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-20 flex items-center justify-center"
        style={{
          width: FIELD,
          height: FIELD,
          transform: `translate(${fieldCenter.x - FIELD / 2}px, ${fieldCenter.y - FIELD / 2}px) scale(${FIELD_SCALE})`,
        }}
      >
        <motion.div
          animate={{
            opacity: atThreshold
              ? [0.7, 0.86, 0.7]
              : stage === "preparing"
                ? 0.42
                : 0.86,
          }}
          className="absolute inset-0"
          ref={fieldScope}
          transition={
            atThreshold && !reduceMotion
              ? {
                  duration: 12,
                  ease: "easeInOut",
                  repeat: Number.POSITIVE_INFINITY,
                }
              : { duration: stage === "preparing" ? 1.4 : 0.6, ease: EASE }
          }
        >
          <DotSigil
            bloom={0.02}
            cell={4}
            dot="164,167,173"
            scene="recall"
            seed={`${POLYPHONIC_IDENTITY_SEED}:threshold`}
            size={FIELD}
          />
        </motion.div>
        {/* The mark at the heart of the field is Luca. While Luca is being
            made ready the noise settles and the name comes forward. */}
        <motion.div
          animate={
            stage === "preparing"
              ? { scale: 1.16, filter: "brightness(1.35)" }
              : { scale: 1, filter: "brightness(1)" }
          }
          className="relative flex h-20 w-20 items-center justify-center"
          transition={{ duration: reduceMotion ? 0 : 1.4, ease: EASE }}
        >
          <LucaThresholdGlyph />
        </motion.div>
      </div>
    </div>
  );
}
