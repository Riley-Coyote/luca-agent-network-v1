import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useRef } from "react";

import { cn } from "@/shared/lib/cn";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { isLightTheme } from "@/shared/theme/theme-loader";
import { useSystemColorScheme } from "@/shared/theme/useSystemColorScheme";
import { StartupWindowDragRegion } from "@/shared/ui/StartupWindowDragRegion";
import { Button } from "@/shared/ui/button";
import { usePolyphonicCardDrag } from "../polyphonicFloatingWindow";
import {
  POLYPHONIC_COLUMN_MEASURE,
  polyphonicCardFrameStyle,
  polyphonicFieldBoxStyle,
  usePublishFieldAnchor,
} from "../polyphonicOnboardingGeometry";
import {
  setPolyphonicScene,
  usePolyphonicFloatingCard,
} from "../polyphonicOnboardingScene";
import type { PolyphonicOnboardingChapter } from "../polyphonicOnboardingState";
import {
  polyphonicDarkPalette,
  polyphonicLightPalette,
  PolyphonicPresentationHeading,
} from "./PolyphonicOnboardingPresentation";

/** The step change, in full: a page leaves in a tenth of a second, the next
 *  one rises 6px into place on the arrival curve. Nothing but the column. */
const STEP_OUT_MS = 100;
const STEP_IN_MS = 180;
const ARRIVAL_EASE: [number, number, number, number] = [0.2, 0, 0, 1];

/**
 * The setup card: a living visual on the left, the interaction on the right.
 *
 * The card itself — the shell, the pane, the field and the mark — is the same
 * object that was on the door, drawn by PolyphonicOnboardingFieldLayer. This
 * frame contributes only the column content on a transparent frame of exactly
 * that geometry, and publishes where the pane is. The doorway remains dark;
 * once the card is present it reflects the appearance the owner chooses so
 * setup and the application are one continuous surface.
 */
export function PolyphonicSetupFrame({
  backDisabled = false,
  children,
  continueDisabled = false,
  continueLabel = "Continue",
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
  const fieldBoxRef = useRef<HTMLDivElement>(null);
  usePublishFieldAnchor(fieldBoxRef, "card");
  // The same handle as the door's, because it is the same pane: floating, the
  // card is dragged by the panel the field lives in.
  usePolyphonicCardDrag(paneRef, usePolyphonicFloatingCard());
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
      <div className="absolute inset-0 grid place-items-center">
        <section
          aria-labelledby={`polyphonic-${stage}-heading`}
          // Transparent: the shell, the pane's recess and its hairline are
          // drawn by the layer beneath this content, so the card is never
          // built twice and never has to materialise.
          className="relative z-[45] grid border border-transparent"
          data-testid="polyphonic-setup-assistant"
          style={polyphonicCardFrameStyle}
        >
          {/* visual pane: the field lives here, drawn by the layer. The
              dendrite's own box is inset inside it, so the field has air on
              both sides, and that box — not the pane — is the anchor. */}
          <div
            aria-hidden
            className="relative grid place-items-center"
            data-luca-card-drag-handle=""
            data-testid="polyphonic-setup-pane"
            ref={paneRef}
          >
            <div
              data-testid="polyphonic-setup-field-box"
              ref={fieldBoxRef}
              style={polyphonicFieldBoxStyle}
            />
          </div>

          {/* interaction column: one measure, centred in the pane, its content
              group centred against the card's own height rather than hung from
              the top, and the actions on the column's bottom edge — not adrift
              in the card's corner. */}
          <form
            className="mx-auto grid min-h-0 w-full grid-rows-[3.5rem_minmax(0,1fr)_3.5rem] px-6"
            onSubmit={(event) => {
              event.preventDefault();
              if (showFooter && !continueDisabled) onContinue();
            }}
            style={{ maxWidth: `calc(${POLYPHONIC_COLUMN_MEASURE} + 3rem)` }}
          >
            <header className="flex items-center justify-end">
              {steps ? (
                <div
                  aria-label={`Step ${Math.min(steps.current + 1, steps.total)} of ${steps.total}`}
                  className="flex items-center gap-1.5"
                  role="img"
                >
                  {Array.from(
                    { length: steps.total },
                    (_, index) => index + 1,
                  ).map((step) => (
                    <span
                      className={cn(
                        "block h-px w-4 rounded-full bg-[var(--prototype-ink)] transition-opacity duration-300",
                        step <= steps.current + 1
                          ? "opacity-60"
                          : "opacity-[0.14]",
                      )}
                      key={step}
                    />
                  ))}
                </div>
              ) : null}
            </header>
            <div className="polyphonic-onboarding-body relative min-h-0 overflow-hidden py-4">
              {/* One page leaves while the next is already arriving, both in
                  the same place: the outgoing column dims out under the
                  incoming one, so the pane is never empty for a frame. Nothing
                  else moves — not the card, not the pane, not the field. */}
              <AnimatePresence initial={false}>
                <motion.div
                  animate={{ opacity: 1, y: 0 }}
                  className="absolute inset-x-0 inset-y-4 flex min-h-0 flex-col justify-center"
                  data-testid="polyphonic-setup-column"
                  exit={{
                    opacity: 0,
                    transition: {
                      duration: reduceMotion ? 0 : STEP_OUT_MS / 1000,
                      ease: "linear",
                    },
                  }}
                  initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                  key={stage}
                  transition={{
                    duration: reduceMotion ? 0 : STEP_IN_MS / 1000,
                    ease: ARRIVAL_EASE,
                  }}
                >
                  {children}
                </motion.div>
              </AnimatePresence>
            </div>
            <footer className="polyphonic-onboarding-footer relative z-10 flex items-center justify-between gap-4">
              {showFooter ? (
                <>
                  {/* Focus is the element's own border coming up, in place:
                      no second ring floating beside the thing it describes. */}
                  <Button
                    className="h-9 rounded-[7px] border border-transparent px-1 text-[length:var(--prototype-support-size)] font-normal text-[var(--prototype-muted)] outline-none hover:bg-[var(--prototype-selection)] hover:text-[var(--prototype-ink)] focus-visible:border-[color-mix(in_srgb,var(--prototype-ink)_40%,transparent)] focus-visible:outline-none"
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
                      className="min-h-9 min-w-24 rounded-[9px] border border-[var(--prototype-accent)] bg-[var(--prototype-accent)] px-4 py-2 text-[length:var(--prototype-support-size)] font-medium text-[var(--prototype-accent-ink)] shadow-[0_1px_2px_var(--prototype-shadow)] outline-none transition-[background-color,border-color,opacity] duration-[80ms] hover:opacity-90 focus-visible:border-[var(--prototype-ink)] focus-visible:outline-none"
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
        </section>
      </div>
    </div>
  );
}

export function PolyphonicStepHeading({
  description,
  stage,
  title,
}: {
  /** Omitted where the heading is the whole sentence. */
  description?: string;
  stage: PolyphonicOnboardingChapter | "you" | "ready";
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
