import { motion, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useRef } from "react";

import { cn } from "@/shared/lib/cn";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { isLightTheme } from "@/shared/theme/theme-loader";
import { useSystemColorScheme } from "@/shared/theme/useSystemColorScheme";
import { StartupWindowDragRegion } from "@/shared/ui/StartupWindowDragRegion";
import { Button } from "@/shared/ui/button";
import {
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

/**
 * The setup card: a living visual on the left, the interaction on the right.
 *
 * The visual is the same field that grew on the door — it is drawn by
 * PolyphonicOnboardingFieldLayer, not here; this frame only publishes where
 * its pane is. The doorway remains dark. Once the card is present, it reflects the
 * appearance the owner chooses so setup and the application open as one
 * continuous surface.
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
          animate={{ opacity: 1 }}
          aria-labelledby={`polyphonic-${stage}-heading`}
          className="relative grid overflow-hidden rounded-[15px] border border-[var(--prototype-hairline)] bg-[var(--prototype-raised)] shadow-[inset_0_1px_0_var(--prototype-hairline-soft),0_1px_2px_rgb(0_0_0/0.08),0_22px_64px_var(--prototype-shadow)]"
          data-testid="polyphonic-setup-assistant"
          initial={reduceMotion ? false : { opacity: 0 }}
          style={polyphonicCardFrameStyle}
          transition={{ duration: reduceMotion ? 0 : 0.16, ease: EASE }}
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
                  {Array.from(
                    { length: steps.total },
                    (_, index) => index + 1,
                  ).map((step) => (
                    <span
                      className={cn(
                        "block h-px w-4 rounded-full bg-[var(--prototype-ink)] transition-opacity duration-300",
                        step <= steps.current + 1
                          ? "opacity-100"
                          : "opacity-20",
                      )}
                      key={step}
                    />
                  ))}
                </div>
              ) : null}
            </header>
            <div className="polyphonic-onboarding-body relative min-h-0 overflow-hidden px-9 pb-6 pt-2">
              <motion.div
                animate={{ opacity: 1 }}
                className="h-full min-h-0"
                initial={reduceMotion ? false : { opacity: 0 }}
                key={stage}
                transition={{ duration: reduceMotion ? 0 : 0.12 }}
              >
                {children}
              </motion.div>
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
