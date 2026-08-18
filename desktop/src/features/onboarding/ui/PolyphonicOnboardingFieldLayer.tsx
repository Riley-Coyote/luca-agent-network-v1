import {
  AnimatePresence,
  motion,
  useAnimate,
  useReducedMotion,
} from "motion/react";
import * as React from "react";

import { DotSigil } from "@/shared/ui/dot-display/DotSigil";
import {
  setPolyphonicScene,
  usePolyphonicScene,
} from "../polyphonicOnboardingScene";
import {
  LucaThresholdGlyph,
  POLYPHONIC_IDENTITY_SEED,
} from "./PolyphonicThresholdField";

/** Canvas size of the field. Drawn once; only its placement changes. */
export const POLYPHONIC_FIELD_SIZE = 576;
const EASE: [number, number, number, number] = [0.2, 0, 0, 1];

/**
 * The one field of onboarding, drawn above every onboarding tree and gate.
 * See polyphonicOnboardingScene.ts for why it lives here and not in the door
 * or the card. Mount once, at the top of the app.
 */
export function PolyphonicOnboardingFieldLayer() {
  const scene = usePolyphonicScene();
  const reduceMotion = useReducedMotion();
  const [fieldScope, animateField] = useAnimate<HTMLDivElement>();
  const previousStage = React.useRef(scene.stage);

  // The surface comes *out of* the field: on Begin it swells for a beat and
  // settles as the card completes.
  React.useEffect(() => {
    const was = previousStage.current;
    previousStage.current = scene.stage;
    if (
      was === "door" &&
      scene.stage === "opening" &&
      fieldScope.current &&
      !reduceMotion
    ) {
      void animateField(
        fieldScope.current,
        { filter: ["brightness(1)", "brightness(1.9)", "brightness(1)"] },
        { duration: 1.1, ease: EASE, times: [0, 0.22, 1] },
      );
    }
  }, [animateField, fieldScope, reduceMotion, scene.stage]);

  // Leaving: hold the veil while the conversation mounts beneath, then let go.
  React.useEffect(() => {
    if (scene.stage !== "leaving") return;
    const timer = window.setTimeout(
      () =>
        setPolyphonicScene({ stage: "off", anchor: null, resolving: false }),
      reduceMotion ? 0 : 420,
    );
    return () => window.clearTimeout(timer);
  }, [reduceMotion, scene.stage]);

  const anchor = scene.anchor;
  const visible = scene.stage !== "off" && anchor !== null;
  const leaving = scene.stage === "leaving";
  const scale = anchor ? anchor.width / POLYPHONIC_FIELD_SIZE : 1;
  const atDoor = scene.stage === "door";

  return (
    <AnimatePresence>
      {leaving ? (
        <motion.div
          animate={{ opacity: 1 }}
          aria-hidden
          className="pointer-events-none fixed inset-0 z-[59] bg-[#060608]"
          data-testid="polyphonic-onboarding-veil"
          exit={{ opacity: 0, transition: { duration: 0.7, ease: EASE } }}
          initial={{ opacity: 0 }}
          key="veil"
          transition={{ duration: reduceMotion ? 0 : 0.28, ease: EASE }}
        />
      ) : null}
      {visible && anchor ? (
        <motion.div
          animate={{
            opacity: 1,
            x: anchor.x - POLYPHONIC_FIELD_SIZE / 2,
            y: anchor.y - POLYPHONIC_FIELD_SIZE / 2,
            scale,
          }}
          aria-hidden
          className="pointer-events-none fixed left-0 top-0 z-[60] flex items-center justify-center"
          data-testid="polyphonic-onboarding-field"
          exit={{ opacity: 0, transition: { duration: 0.7, ease: EASE } }}
          initial={{
            opacity: 0,
            x: anchor.x - POLYPHONIC_FIELD_SIZE / 2,
            y: anchor.y - POLYPHONIC_FIELD_SIZE / 2,
            scale,
          }}
          key="field"
          style={{
            width: POLYPHONIC_FIELD_SIZE,
            height: POLYPHONIC_FIELD_SIZE,
          }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : {
                  opacity: { duration: 1.1, ease: EASE },
                  // Placement follows the pane through resizes; it should not
                  // read as travel, so it is quick.
                  default: { duration: 0.35, ease: EASE },
                }
          }
        >
          <motion.div
            animate={{
              opacity: atDoor
                ? [0.7, 0.86, 0.7]
                : scene.resolving
                  ? 0.42
                  : 0.86,
            }}
            className="absolute inset-0"
            ref={fieldScope}
            transition={
              atDoor && !reduceMotion
                ? {
                    duration: 12,
                    ease: "easeInOut",
                    repeat: Number.POSITIVE_INFINITY,
                  }
                : {
                    duration: reduceMotion ? 0 : scene.resolving ? 1.4 : 0.6,
                    ease: EASE,
                  }
            }
          >
            <DotSigil
              bloom={0.02}
              cell={4}
              dot="164,167,173"
              scene="recall"
              seed={`${POLYPHONIC_IDENTITY_SEED}:threshold`}
              size={POLYPHONIC_FIELD_SIZE}
            />
          </motion.div>
          {/* The mark at the heart of the field is Luca. While Luca is being
              made ready the noise settles and the name comes forward. */}
          <motion.div
            animate={
              scene.resolving
                ? { scale: 1.16, filter: "brightness(1.35)" }
                : { scale: 1, filter: "brightness(1)" }
            }
            className="relative flex h-20 w-20 items-center justify-center"
            transition={{ duration: reduceMotion ? 0 : 1.4, ease: EASE }}
          >
            <LucaThresholdGlyph />
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
