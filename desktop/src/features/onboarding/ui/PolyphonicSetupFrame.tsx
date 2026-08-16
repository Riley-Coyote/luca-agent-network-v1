import { motion, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useRef } from "react";

import { cn } from "@/shared/lib/cn";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { useSystemColorScheme } from "@/shared/theme/useSystemColorScheme";
import { StartupWindowDragRegion } from "@/shared/ui/StartupWindowDragRegion";
import { Button } from "@/shared/ui/button";
import type { PolyphonicOnboardingChapter } from "../polyphonicOnboardingState";
import {
  polyphonicDarkPalette,
  polyphonicLightPalette,
  PolyphonicPresentationHeading,
} from "./PolyphonicOnboardingPresentation";

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
}) {
  const reduceMotion = useReducedMotion();
  const theme = useTheme();
  const systemColorScheme = useSystemColorScheme();
  const onboardingColorScheme = theme.followSystem
    ? systemColorScheme
    : theme.selectedThemeName === "buzz-dark"
      ? "dark"
      : "light";
  const palette =
    onboardingColorScheme === "dark"
      ? polyphonicDarkPalette
      : polyphonicLightPalette;
  return (
    <div
      className="buzz-onboarding-neutral-theme buzz-startup-shell h-dvh overflow-hidden bg-[var(--prototype-canvas)] text-[var(--prototype-ink)]"
      data-system-color-scheme={onboardingColorScheme}
      data-stage={stage}
      data-testid="polyphonic-onboarding"
      style={{
        ...palette,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif',
      }}
    >
      <StartupWindowDragRegion />
      <p aria-live="polite" className="sr-only" role="status">
        {stage === "preparing" ? "Getting Luca ready" : "Polyphonic setup"}
      </p>
      <motion.main
        animate={{ opacity: 1, y: 0 }}
        className="polyphonic-onboarding-main flex h-dvh min-h-0 items-center justify-center overflow-hidden p-4 pt-10"
        initial={reduceMotion ? false : { opacity: 0, y: 10 }}
        transition={
          reduceMotion
            ? { duration: 0 }
            : { duration: 0.4, ease: [0.2, 0, 0, 1] }
        }
      >
        <section
          aria-labelledby={`polyphonic-${stage}-heading`}
          className="relative grid h-[min(34.5rem,calc(100dvh-2rem))] min-h-0 w-[min(37rem,calc(100vw-2rem))] grid-rows-[3.5rem_minmax(0,1fr)_3.5rem] overflow-hidden rounded-[15px] border border-[var(--prototype-hairline)] bg-[var(--prototype-raised)] shadow-[inset_0_1px_0_var(--prototype-hairline-soft),0_1px_2px_rgb(0_0_0/0.08),0_22px_64px_var(--prototype-shadow)]"
          data-testid="polyphonic-setup-assistant"
        >
          <header className="polyphonic-onboarding-header flex items-center px-9">
            <span className="text-sm font-semibold tracking-[-0.01em] text-[var(--prototype-ink)]">
              Polyphonic
            </span>
          </header>
          <div className="polyphonic-onboarding-body min-h-0 overflow-hidden px-9 pb-6 pt-4">
            {children}
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
                    onClick={onContinue}
                    type="button"
                  >
                    {continueLabel}
                  </Button>
                </div>
              </>
            ) : null}
          </footer>
        </section>
      </motion.main>
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
          : "bg-foreground/[0.04] text-foreground/60",
      )}
      role={kind === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
