import { motion, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useRef } from "react";

import { cn } from "@/shared/lib/cn";
import { StartupWindowDragRegion } from "@/shared/ui/StartupWindowDragRegion";
import { Button } from "@/shared/ui/button";
import type { PolyphonicOnboardingChapter } from "../polyphonicOnboardingState";

export function PolyphonicSetupFrame({
  backDisabled = false,
  children,
  continueDisabled = false,
  continueLabel = "Continue",
  onBack,
  onContinue,
  showFooter = true,
  stage,
}: {
  backDisabled?: boolean;
  children: ReactNode;
  continueDisabled?: boolean;
  continueLabel?: string;
  onBack: () => void;
  onContinue: () => void;
  showFooter?: boolean;
  stage: PolyphonicOnboardingChapter;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <div
      className="buzz-onboarding-neutral-theme buzz-startup-shell h-dvh overflow-hidden text-foreground"
      data-stage={stage}
      data-testid="polyphonic-onboarding"
      style={{
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
          className="relative grid h-[min(34.5rem,calc(100dvh-2rem))] min-h-0 w-[min(37rem,calc(100vw-2rem))] grid-rows-[3.5rem_minmax(0,1fr)_3.5rem] overflow-hidden rounded-2xl border border-foreground/10 bg-[hsl(var(--mn-raised))] shadow-[inset_0_1px_0_rgb(255_255_255/0.04),0_20px_60px_rgb(0_0_0/0.22),0_2px_8px_rgb(0_0_0/0.12)]"
          data-testid="polyphonic-setup-assistant"
        >
          <header className="polyphonic-onboarding-header flex items-center px-9">
            <span className="text-sm font-semibold tracking-[-0.01em] text-foreground">
              Polyphonic
            </span>
          </header>
          <div className="polyphonic-onboarding-body min-h-0 overflow-y-auto overscroll-contain px-9 pb-6 pt-4 [scrollbar-gutter:stable_both-edges]">
            {children}
          </div>
          <footer className="polyphonic-onboarding-footer relative z-10 flex items-center justify-between gap-4 px-9">
            {showFooter ? (
              <>
                <Button
                  className="h-9 rounded-md px-1 text-sm font-normal text-foreground/55 hover:bg-foreground/[0.045] hover:text-foreground"
                  disabled={backDisabled}
                  onClick={onBack}
                  type="button"
                  variant="ghost"
                >
                  Back
                </Button>
                <Button
                  className="h-10 min-w-24 rounded-lg bg-foreground px-4 text-sm font-medium text-background shadow-sm hover:bg-foreground/90 focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid="polyphonic-setup-continue"
                  disabled={continueDisabled}
                  onClick={onContinue}
                  type="button"
                >
                  {continueLabel}
                </Button>
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
    <header>
      <h1
        className="text-[1.75rem] font-medium leading-[1.15] tracking-[-0.018em] text-foreground outline-none focus-visible:!outline-none"
        id={`polyphonic-${stage}-heading`}
        ref={headingRef}
        tabIndex={-1}
      >
        {title}
      </h1>
      <p className="mt-2 max-w-[32rem] text-[0.9375rem] leading-[1.375rem] text-foreground/60">
        {description}
      </p>
    </header>
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
