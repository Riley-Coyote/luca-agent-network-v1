import { motion, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useRef } from "react";

import { cn } from "@/shared/lib/cn";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { isLightTheme } from "@/shared/theme/theme-loader";
import { useSystemColorScheme } from "@/shared/theme/useSystemColorScheme";
import { StartupWindowDragRegion } from "@/shared/ui/StartupWindowDragRegion";
import { Button } from "@/shared/ui/button";
import { usePolyphonicCardDrag } from "../polyphonicFloatingWindow";
import {
  polyphonicCardFrameStyle,
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
  usePublishFieldAnchor(paneRef, "card");
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
          {/* visual pane: the field lives here, drawn by the layer. */}
          <div
            aria-hidden
            className="relative"
            data-luca-card-drag-handle=""
            data-testid="polyphonic-setup-pane"
            ref={paneRef}
          />

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
