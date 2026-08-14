import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/shared/lib/cn";
import { StartupWindowDragRegion } from "@/shared/ui/StartupWindowDragRegion";
import { Button } from "@/shared/ui/button";
import { PolyphonicBrandMark } from "./PolyphonicThresholdField";
import type { PolyphonicOnboardingChapter } from "../polyphonicOnboardingState";

const chapterDetails: Record<
  PolyphonicOnboardingChapter,
  { current: number; label: string }
> = {
  you: { current: 2, label: "You" },
  agents: { current: 3, label: "Your agents" },
  brain: { current: 4, label: "Your Brain" },
  ready: { current: 5, label: "Ready" },
};

export function PolyphonicSetupFrame({
  backDisabled = false,
  children,
  continueDisabled = false,
  continueLabel = "Continue",
  onBack,
  onContinue,
  stage,
}: {
  backDisabled?: boolean;
  children: React.ReactNode;
  continueDisabled?: boolean;
  continueLabel?: string;
  onBack: () => void;
  onContinue: () => void;
  stage: PolyphonicOnboardingChapter;
}) {
  const reduceMotion = useReducedMotion();
  const step = chapterDetails[stage];
  return (
    <div
      className="h-dvh overflow-hidden bg-[hsl(var(--mn-navigator))] text-[hsl(var(--mn-ink))]"
      data-stage={stage}
      data-testid="polyphonic-onboarding"
      style={{
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif',
      }}
    >
      <StartupWindowDragRegion />
      <p aria-live="polite" className="sr-only" role="status">
        Step {step.current} of 5: {step.label}
      </p>
      <motion.main
        animate={{ opacity: 1, y: 0 }}
        className="polyphonic-onboarding-main flex h-dvh min-h-0 items-center justify-center overflow-hidden px-4 pb-6 pt-14 sm:px-6 sm:pb-8 sm:pt-16"
        initial={reduceMotion ? false : { opacity: 0, y: 10 }}
        transition={
          reduceMotion
            ? { duration: 0 }
            : { duration: 0.4, ease: [0.2, 0, 0, 1] }
        }
      >
        <section
          aria-labelledby={`polyphonic-${stage}-heading`}
          className="relative flex max-h-[calc(100dvh-5rem)] min-h-0 w-full max-w-[38rem] flex-col overflow-hidden rounded-2xl border border-[hsl(var(--mn-border))] bg-[hsl(var(--mn-raised))] shadow-[0_1px_1px_rgba(0,0,0,0.5),0_18px_50px_rgba(0,0,0,0.4)]"
          data-testid="polyphonic-setup-assistant"
        >
          <header className="polyphonic-onboarding-header flex shrink-0 items-center justify-between px-5 pt-5 sm:px-8 sm:pt-7">
            <div className="flex items-center gap-2.5">
              <span aria-hidden>
                <PolyphonicBrandMark />
              </span>
              <span className="text-sm font-medium tracking-[-0.01em] text-white/88">
                Luca
              </span>
            </div>
            <span className="text-xs text-white/46">
              Step {step.current} of 5
            </span>
          </header>
          <div className="polyphonic-onboarding-body min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4 pt-7 [scrollbar-gutter:stable] sm:px-8 sm:pb-5 sm:pt-8">
            {children}
          </div>
          <footer className="polyphonic-onboarding-footer flex shrink-0 items-center justify-between gap-4 border-t border-[hsl(var(--mn-border))] bg-[hsl(var(--mn-raised))] px-5 py-4 sm:px-8 sm:pb-6 sm:pt-4">
            <Button
              className="h-9 rounded-lg px-3 text-sm text-white/64 hover:bg-white/[0.05] hover:text-white"
              disabled={backDisabled}
              onClick={onBack}
              type="button"
              variant="ghost"
            >
              Back
            </Button>
            <Button
              className="h-9 rounded-lg border border-white bg-white px-4 text-sm font-medium text-black hover:bg-white/90 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--mn-surface))]"
              data-testid="polyphonic-setup-continue"
              disabled={continueDisabled}
              onClick={onContinue}
              type="button"
            >
              {continueLabel}
            </Button>
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
  stage: PolyphonicOnboardingChapter;
  title: string;
}) {
  const ref = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => ref.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);
  return (
    <header>
      <h1
        className="text-3xl font-medium tracking-[-0.035em] text-white outline-none"
        id={`polyphonic-${stage}-heading`}
        ref={ref}
        tabIndex={-1}
      >
        {title}
      </h1>
      <p className="mt-2.5 max-w-[32rem] text-sm leading-6 text-white/60">
        {description}
      </p>
    </header>
  );
}

export function PolyphonicNotice({
  children,
  kind = "status",
}: {
  children: React.ReactNode;
  kind?: "error" | "status";
}) {
  return (
    <div
      className={cn(
        "mt-4 rounded-lg border px-3.5 py-3 text-sm leading-5",
        kind === "error"
          ? "border-destructive/35 bg-destructive/5 text-destructive"
          : "border-[hsl(var(--mn-border))] bg-[hsl(var(--mn-surface))] text-white/62",
      )}
      role={kind === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
