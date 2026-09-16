import { motion, useReducedMotion } from "motion/react";
import * as React from "react";

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
import { startPolyphonicSetupDiscovery } from "../polyphonicSetupDiscovery";
import { polyphonicDarkPalette } from "./PolyphonicOnboardingPresentation";

const EASE: [number, number, number, number] = [0.2, 0, 0, 1];

/**
 * The door. It is the setup card, already here: the shell, the pane, the field
 * and the mark are all drawn by PolyphonicOnboardingFieldLayer, and the door
 * contributes only the column content on a transparent frame of exactly the
 * card's geometry. So on Begin nothing materialises — the copy lifts away,
 * the field flares for a beat, and the first question arrives in the same
 * object, wherever the app's gates let it mount.
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
  const paneRef = React.useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = React.useState(false);
  usePublishFieldAnchor(anchorRef, "door");

  // Ask the Mac what AI it has while the owner is reading this page, so the
  // runtime page opens on its rows rather than on a spinner.
  React.useEffect(startPolyphonicSetupDiscovery, []);

  // Floating, the window has no title bar to take hold of: the pane the field
  // lives in is the handle. It carries no controls, so there is nothing here
  // a drag could steal.
  usePolyphonicCardDrag(paneRef, usePolyphonicFloatingCard());

  const begin = () => {
    setLeaving(true);
    setPolyphonicScene({ stage: "opening" });
    onBegin();
  };

  return (
    <div
      className="relative grid h-dvh w-full place-items-center"
      data-testid="polyphonic-door"
      style={{ ...polyphonicDarkPalette, fontFamily: "var(--font-ui)" }}
    >
      {/* The card's geometry alone; the shell itself is drawn by the layer
          above the canvas, and it has no stroke for this to match. */}
      <div className="relative z-[45] grid" style={polyphonicCardFrameStyle}>
        <div
          aria-hidden
          className="grid place-items-center"
          data-luca-card-drag-handle=""
          ref={paneRef}
        >
          <div ref={anchorRef} style={polyphonicFieldBoxStyle} />
        </div>
        <motion.div
          // Leaving, the copy dims and settles rather than vanishing: the
          // gates between the door and the first question take as long as
          // they take, and an empty pane for that second is the one thing the
          // card must never show. It rests here, quiet and inert, until the
          // question crossfades in over it.
          animate={leaving ? { opacity: 0.24, y: -6 } : { opacity: 1, y: 0 }}
          className="mx-auto flex w-full flex-col justify-center px-6 text-center"
          style={{ maxWidth: `calc(${POLYPHONIC_COLUMN_MEASURE} + 3rem)` }}
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
          <p className="mx-auto mt-3 max-w-[26rem] text-sm leading-6 text-white/60">
            A private home for your agents and the work that makes them useful.
          </p>
          {error ? (
            <p className="mt-4 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="mt-10 flex flex-col items-center gap-5">
            <Button
              className="h-10 rounded-lg bg-white px-5 text-sm font-medium text-black hover:bg-white/90"
              data-testid="polyphonic-door-begin"
              disabled={isPending || leaving}
              onClick={begin}
              type="button"
            >
              {isPending ? "Opening…" : "Begin setup"}
            </Button>
            <p className="flex items-center justify-center gap-2 text-xs text-white/45">
              <button
                className="rounded-[5px] border border-transparent px-1 py-0.5 outline-none hover:text-white/80 focus-visible:border-white/50 focus-visible:text-white/80 focus-visible:outline-none disabled:opacity-50"
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
                className="rounded-[5px] border border-transparent px-1 py-0.5 outline-none hover:text-white/80 focus-visible:border-white/50 focus-visible:text-white/80 focus-visible:outline-none disabled:opacity-50"
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
