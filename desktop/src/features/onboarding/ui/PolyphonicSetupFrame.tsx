import { animate, motion, useReducedMotion } from "motion/react";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";

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
  const cardRef = useRef<HTMLElement>(null);
  useSmoothHeight(cardRef, !reduceMotion);
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
        {/* The card is sized by its chapter, not by the tallest chapter. A
            fixed box left the short chapters (name, runtime, summary,
            preparing) reading as a dialog with content missing — the void
            was leftover, not designed. Now the canvas around the card is the
            silence. It still caps where it used to so list-bearing chapters
            scroll inside instead of growing the window, and it keeps a floor
            so the briefest chapter does not read as a toast. Height changes
            are tweened by useSmoothHeight so the frame never jumps. */}
        <section
          aria-labelledby={`polyphonic-${stage}-heading`}
          className="relative grid max-h-[min(34.5rem,calc(100dvh-2rem))] min-h-[21rem] w-[min(37rem,calc(100vw-2rem))] grid-rows-[3.5rem_minmax(0,1fr)_3.5rem] overflow-hidden rounded-[15px] border border-[var(--prototype-hairline)] bg-[var(--prototype-raised)] shadow-[inset_0_1px_0_var(--prototype-hairline-soft),0_1px_2px_rgb(0_0_0/0.08),0_22px_64px_var(--prototype-shadow)]"
          data-testid="polyphonic-setup-assistant"
          ref={cardRef}
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

/**
 * Tween the card between its natural heights instead of snapping.
 *
 * The card is `height: auto`, so any content change — a chapter swap, the
 * runtime list expanding, a notice appearing — would otherwise jump. A
 * ResizeObserver callback runs after layout and before paint, so we can pin
 * the element at its previous height and animate to the new one before the
 * user ever sees the snap. `layout` animation was rejected on purpose: it
 * scales the box with transforms, which stretches the type for the duration.
 *
 * The tween is driven numerically rather than handed to the DOM, because the
 * target can move while it runs: a chapter mounts before its query resolves,
 * so its natural height arrives a few frames late. Every frame we release the
 * pinned height, read the true natural height, pin again at the tweened value,
 * and retarget if the destination changed. That is two forced reflows a frame
 * for a third of a second, on a card with a dozen elements — cheap, and it is
 * the difference between one continuous motion and a dip followed by a jump.
 *
 * While a tween is running the element carries an explicit height; the grid's
 * middle row is `minmax(0, 1fr)`, so chapter content that owns its own scroll
 * simply clips for those few frames. On completion the height is released
 * back to `auto` so later content growth is measured, not fought.
 */
function useSmoothHeight(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !enabled || typeof ResizeObserver === "undefined") return;
    let last: number | null = null;
    let running: ReturnType<typeof animate> | null = null;
    let target = 0;

    const natural = () => {
      const pinned = element.style.height;
      element.style.height = "";
      const height = element.getBoundingClientRect().height;
      element.style.height = pinned;
      return height;
    };

    const tween = (from: number, to: number) => {
      running?.stop();
      target = to;
      running = animate(from, to, {
        duration: 0.34,
        ease: [0.2, 0, 0, 1],
        onUpdate: (value) => {
          const destination = natural();
          if (Math.abs(destination - target) >= 1) {
            // Content moved under us: continue from where we are, not from
            // where we started.
            tween(value, destination);
            return;
          }
          element.style.height = `${value}px`;
        },
        onComplete: () => {
          running = null;
          element.style.height = "";
          last = element.getBoundingClientRect().height;
        },
      });
    };

    // A hidden document does not tick requestAnimationFrame, so a tween begun
    // there would park the card at a clipped intermediate height until the
    // window is seen again. Land immediately instead; nobody is watching.
    const settle = () => {
      running?.stop();
      running = null;
      element.style.height = "";
      last = element.getBoundingClientRect().height;
    };
    const onVisibility = () => {
      if (document.hidden && running) settle();
    };

    const observer = new ResizeObserver(() => {
      if (running) return;
      const next = element.getBoundingClientRect().height;
      const from = last;
      last = next;
      if (from === null || document.hidden || Math.abs(next - from) < 1) return;
      element.style.height = `${from}px`;
      tween(from, next);
    });
    observer.observe(element);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      running?.stop();
      element.style.height = "";
    };
  }, [enabled, ref]);
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
