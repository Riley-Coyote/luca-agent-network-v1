import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useRef } from "react";

import { cn } from "@/shared/lib/cn";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { isLightTheme } from "@/shared/theme/theme-loader";
import { useSystemColorScheme } from "@/shared/theme/useSystemColorScheme";
import { StartupWindowDragRegion } from "@/shared/ui/StartupWindowDragRegion";
import { Button } from "@/shared/ui/button";
import {
  POLYPHONIC_CARD_HEIGHT,
  POLYPHONIC_CARD_WIDTH,
  POLYPHONIC_PANE_TRACK,
  POLYPHONIC_PANE_WIDTH,
  polyphonicCardFrameStyle,
  usePublishFieldAnchor,
} from "../polyphonicOnboardingGeometry";
import { setPolyphonicScene } from "../polyphonicOnboardingScene";
import type { PolyphonicOnboardingChapter } from "../polyphonicOnboardingState";
import {
  polyphonicDarkPalette,
  polyphonicLightPalette,
  PolyphonicPresentationHeading,
} from "./PolyphonicOnboardingPresentation";

const EASE: [number, number, number, number] = [0.2, 0, 0, 1];

/** Reveal radius: from the field's heart past the card's far corner and its shadow. */
const REVEAL_RADIUS = Math.ceil(
  Math.hypot(
    POLYPHONIC_CARD_WIDTH - POLYPHONIC_PANE_WIDTH / 2,
    POLYPHONIC_CARD_HEIGHT / 2,
  ) + 220,
);
/**
 * The surface accretes outward from the field's heart with a soft edge — the
 * same gesture as the dendrite — rather than an iris wipe. `--reveal` is the
 * animated radius.
 */
const REVEAL_MASK = `radial-gradient(circle at calc(${POLYPHONIC_PANE_TRACK} / 2) 50%, #000 calc(var(--reveal, 0px) - 140px), transparent var(--reveal, 0px))`;

/** Chapters move with the direction of travel; arriving from the door waits
 *  for the surface to pass under the column first. */
const chapterVariants = {
  enter: (dir: number) => ({
    opacity: 0,
    y: dir < 0 ? -12 : dir > 0 ? 12 : 6,
  }),
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

/**
 * The setup card: a living visual on the left, the interaction on the right.
 *
 * The visual is the same field that grew on the door — it is drawn by
 * PolyphonicOnboardingFieldLayer, not here; this frame only publishes where
 * its pane is. On mount the card materialises outward from the field. The
 * The doorway remains dark. Once the card is present, it reflects the
 * appearance the owner chooses so setup and the application open as one
 * continuous surface.
 */
export function PolyphonicSetupFrame({
  backDisabled = false,
  children,
  continueDisabled = false,
  continueLabel = "Continue",
  direction = 1,
  footerSecondary,
  onBack,
  onContinue,
  showFooter = true,
  stage,
  steps,
}: {
  backDisabled?: boolean;
  children: ReactNode;
  continueDisabled?: boolean;
  continueLabel?: string;
  /** -1 back, +1 forward, 0 arriving from the door. */
  direction?: number;
  footerSecondary?: ReactNode;
  onBack: () => void;
  onContinue: () => void;
  showFooter?: boolean;
  stage: PolyphonicOnboardingChapter;
  /** Which chapter this is, of the chapters this owner will see. */
  steps?: { current: number; total: number };
}) {
  const reduceMotion = useReducedMotion();
  const theme = useTheme();
  const systemColorScheme = useSystemColorScheme();
  const chosenColorScheme = theme.followSystem
    ? systemColorScheme
    : isLightTheme(theme.selectedThemeName)
      ? "light"
      : "dark";
  const palette =
    chosenColorScheme === "light"
      ? polyphonicLightPalette
      : polyphonicDarkPalette;
  const paneRef = useRef<HTMLDivElement>(null);
  usePublishFieldAnchor(paneRef, "card");
  useEffect(() => {
    setPolyphonicScene({ resolving: stage === "preparing" });
  }, [stage]);

  return (
    <div
      className="buzz-onboarding-neutral-theme buzz-startup-shell relative h-dvh overflow-hidden !bg-[var(--prototype-canvas)] text-[var(--prototype-ink)]"
      data-system-color-scheme={chosenColorScheme}
      data-stage={stage}
      data-testid="polyphonic-onboarding"
      style={{ ...palette, fontFamily: "var(--font-ui)" }}
    >
      <StartupWindowDragRegion />
      <p aria-live="polite" className="sr-only" role="status">
        {stage === "preparing" ? "Getting Luca ready" : "Polyphonic setup"}
      </p>
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <motion.section
          animate={{ "--reveal": `${REVEAL_RADIUS}px`, opacity: 1 }}
          aria-labelledby={`polyphonic-${stage}-heading`}
          className="relative grid overflow-hidden rounded-[15px] border border-[var(--prototype-hairline)] bg-[var(--prototype-raised)] shadow-[inset_0_1px_0_var(--prototype-hairline-soft),0_1px_2px_rgb(0_0_0/0.08),0_22px_64px_var(--prototype-shadow)]"
          data-testid="polyphonic-setup-assistant"
          initial={reduceMotion ? false : { "--reveal": "0px", opacity: 0 }}
          style={{
            ...polyphonicCardFrameStyle,
            WebkitMaskImage: REVEAL_MASK,
            maskImage: REVEAL_MASK,
          }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : {
                  "--reveal": { delay: 0.1, duration: 1.0, ease: EASE },
                  opacity: { delay: 0.1, duration: 0.2 },
                }
          }
        >
          {/* visual pane: the field lives here, drawn by the layer above. */}
          <div
            className="relative border-r border-[var(--prototype-hairline)] bg-[var(--prototype-recessed)]"
            data-testid="polyphonic-setup-pane"
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
          <form
            className="grid min-h-0 grid-rows-[3.5rem_minmax(0,1fr)_3.5rem]"
            onSubmit={(event) => {
              event.preventDefault();
              if (showFooter && !continueDisabled) onContinue();
            }}
          >
            <header className="flex items-center justify-end px-9">
              {steps ? (
                <div
                  aria-label={`Step ${Math.min(steps.current + 1, steps.total)} of ${steps.total}`}
                  className="flex items-center gap-1.5"
                  role="img"
                >
                  {Array.from({ length: steps.total }, (_, index) => (
                    <span
                      className={cn(
                        "block h-px w-4 rounded-full bg-[var(--prototype-ink)] transition-opacity duration-300",
                        index <= steps.current ? "opacity-100" : "opacity-20",
                      )}
                      // biome-ignore lint/suspicious/noArrayIndexKey: the marks are positional by nature — the third mark is the third step whatever it is called
                      key={index}
                    />
                  ))}
                </div>
              ) : null}
            </header>
            <div className="polyphonic-onboarding-body relative min-h-0 overflow-hidden px-9 pb-6 pt-2">
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
                  key={stage}
                  variants={reduceMotion ? undefined : chapterVariants}
                >
                  {children}
                </motion.div>
              </AnimatePresence>
            </div>
            <footer className="polyphonic-onboarding-footer relative z-10 flex items-center justify-between gap-4 px-9">
              {showFooter ? (
                <>
                  <Button
                    className="h-9 rounded-[7px] px-1 text-[length:var(--prototype-support-size)] font-normal text-[var(--prototype-muted)] hover:bg-[var(--prototype-selection)] hover:text-[var(--prototype-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--prototype-focus)]"
                    disabled={backDisabled}
                    onClick={onBack}
                    type="button"
                    variant="ghost"
                  >
                    Back
                  </Button>
                  <div className="flex items-center gap-4">
                    {footerSecondary}
                    <Button
                      className="min-h-9 min-w-24 rounded-[9px] bg-[var(--prototype-accent)] px-4 py-2 text-[length:var(--prototype-support-size)] font-semibold text-[var(--prototype-accent-ink)] shadow-[0_1px_2px_var(--prototype-shadow)] transition-[background-color,box-shadow,opacity] duration-[80ms] hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--prototype-focus)]"
                      data-testid="polyphonic-setup-continue"
                      disabled={continueDisabled}
                      type="submit"
                    >
                      {continueLabel}
                    </Button>
                  </div>
                </>
              ) : null}
            </footer>
          </form>
        </motion.section>
      </div>
    </div>
  );
}

export function PolyphonicStepHeading({
  description,
  stage,
  title,
}: {
  description: string;
  stage: PolyphonicOnboardingChapter | "you" | "brain" | "ready";
  title: string;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <PolyphonicPresentationHeading
      description={description}
      headingRef={headingRef}
      id={`polyphonic-${stage}-heading`}
      title={title}
    />
  );
}

export function PolyphonicNotice({
  children,
  kind = "status",
}: {
  children: ReactNode;
  kind?: "error" | "status";
}) {
  return (
    <div
      className={cn(
        "mt-3 rounded-md px-3 py-2.5 text-sm leading-5",
        kind === "error"
          ? "border border-destructive/35 bg-destructive/5 text-destructive"
          : "bg-foreground/[0.04] text-ink-faint",
      )}
      role={kind === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
