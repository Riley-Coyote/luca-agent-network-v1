import { motion, useReducedMotion } from "motion/react";
import * as React from "react";

import { Button } from "@/shared/ui/button";
import {
  polyphonicCardFrameStyle,
  usePublishFieldAnchor,
} from "../polyphonicOnboardingGeometry";
import { setPolyphonicScene } from "../polyphonicOnboardingScene";
import { polyphonicDarkPalette } from "./PolyphonicOnboardingPresentation";

const EASE: [number, number, number, number] = [0.2, 0, 0, 1];

/**
 * The door. It is laid out as the setup card's skeleton — the field (drawn by
 * PolyphonicOnboardingFieldLayer) where the card's pane will be, the title
 * where the form will be — so that on Begin nothing moves: the copy lifts
 * away, the scene goes to "opening", and the card materialises around the
 * field wherever the app's gates let it mount.
 *
 * The door is the application; Luca — the resident who greets you — is
 * introduced one step later, so the name is not spent before it means
 * anything.
 */
export function PolyphonicDoor({
  error,
  isPending,
  onBegin,
  onExistingIdentity,
  onSetUpLater,
}: {
  error: string | null;
  isPending: boolean;
  onBegin: () => void;
  onExistingIdentity: () => void;
  onSetUpLater: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const anchorRef = React.useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = React.useState(false);
  usePublishFieldAnchor(anchorRef, "door");

  const begin = () => {
    setLeaving(true);
    setPolyphonicScene({ stage: "opening" });
    onBegin();
  };

  return (
    <div
      className="relative flex h-dvh w-full items-center justify-center p-4"
      data-testid="polyphonic-door"
      style={{ ...polyphonicDarkPalette, fontFamily: "var(--font-ui)" }}
    >
      {/* Transparent border so the columns sit exactly where the card's will. */}
      <div
        className="grid border border-transparent"
        style={polyphonicCardFrameStyle}
      >
        <div aria-hidden ref={anchorRef} />
        <motion.div
          animate={leaving ? { opacity: 0, y: -8 } : { opacity: 1, y: 0 }}
          className="flex flex-col justify-center px-9 text-left"
          initial={reduceMotion ? false : { opacity: 0, y: 6 }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : leaving
                ? { duration: 0.22, ease: EASE }
                : { delay: 0.35, duration: 0.5, ease: EASE }
          }
        >
          <h1 className="text-4xl font-medium tracking-[-0.04em] text-white">
            Polyphonic
          </h1>
          <p className="mt-3 max-w-[26rem] text-sm leading-6 text-white/60">
            A private home for your agents and the work that makes them useful.
          </p>
          {error ? (
            <p className="mt-4 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="mt-10 flex flex-col items-start gap-5">
            <Button
              className="h-10 rounded-lg bg-white px-5 text-sm font-medium text-black hover:bg-white/90"
              data-testid="polyphonic-door-begin"
              disabled={isPending || leaving}
              onClick={begin}
              type="button"
            >
              {isPending ? "Opening…" : "Begin setup"}
            </Button>
            <p className="flex items-center gap-2.5 text-xs text-white/45">
              <button
                className="rounded-[4px] hover:text-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--prototype-focus)] disabled:opacity-50"
                disabled={isPending || leaving}
                onClick={onExistingIdentity}
                type="button"
              >
                Use an existing identity
              </button>
              <span aria-hidden="true" className="text-white/25">
                ·
              </span>
              <button
                className="rounded-[4px] hover:text-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--prototype-focus)] disabled:opacity-50"
                disabled={isPending || leaving}
                onClick={onSetUpLater}
                type="button"
              >
                Set up later
              </button>
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
