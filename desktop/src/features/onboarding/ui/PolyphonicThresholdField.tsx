import { motion, useReducedMotion } from "motion/react";

import { LUCA_IDENTITY_SEED } from "@/features/luca/canonicalLucaResident";
import { DotSigil } from "@/shared/ui/dot-display/DotSigil";
import { IdentityMark } from "@/shared/ui/dot-display/identity/IdentityMark";

/** The doorway's field and mark are Luca's: one mark, everywhere Polyphonic runs. */
export const POLYPHONIC_IDENTITY_SEED = LUCA_IDENTITY_SEED;

export function PolyphonicThresholdDendrite({
  ambient = true,
}: {
  ambient?: boolean;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      animate={
        ambient
          ? reduceMotion
            ? undefined
            : { opacity: [0.64, 0.84, 0.64] }
          : { opacity: 0.74 }
      }
      className="absolute left-1/2 top-1/2 h-[36rem] w-[36rem] -translate-x-1/2 -translate-y-1/2 scale-[0.58] sm:scale-[0.72]"
      transition={
        ambient
          ? reduceMotion
            ? undefined
            : {
                duration: 12,
                ease: "easeInOut",
                repeat: Number.POSITIVE_INFINITY,
              }
          : { duration: reduceMotion ? 0 : 0.12, ease: "easeOut" }
      }
    >
      <DotSigil
        bloom={0.02}
        cell={4}
        dot="164,167,173"
        scene="recall"
        seed={`${POLYPHONIC_IDENTITY_SEED}:threshold`}
        size={576}
      />
    </motion.div>
  );
}

/** The mark at the heart of the field: the application's identity glyph,
 *  joined like every resident's, on the doorway's fixed dark surface. */
export function LucaThresholdGlyph({ ink = "240,240,242" }: { ink?: string }) {
  return (
    <IdentityMark
      accessibleName="Polyphonic mark"
      ink={ink}
      seed={POLYPHONIC_IDENTITY_SEED}
      size={56}
    />
  );
}

export function PolyphonicThresholdField() {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      animate={{ opacity: 1, scale: 1 }}
      aria-hidden
      className="relative flex h-[21rem] w-[21rem] items-center justify-center sm:h-[26rem] sm:w-[26rem]"
      initial={reduceMotion ? false : { opacity: 0, scale: 0.96 }}
      transition={
        reduceMotion ? { duration: 0 } : { duration: 1.1, ease: [0.2, 0, 0, 1] }
      }
    >
      <PolyphonicThresholdDendrite />

      <div className="relative flex h-20 w-20 items-center justify-center">
        <LucaThresholdGlyph />
      </div>
    </motion.div>
  );
}

export function PolyphonicBrandMark({ size = 26 }: { size?: number }) {
  return (
    <IdentityMark
      accessibleName="Polyphonic mark"
      seed={POLYPHONIC_IDENTITY_SEED}
      size={size}
    />
  );
}
