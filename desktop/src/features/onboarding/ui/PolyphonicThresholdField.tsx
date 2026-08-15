import { motion, useReducedMotion } from "motion/react";

import { DotSigil } from "@/shared/ui/dot-display/DotSigil";

export const POLYPHONIC_IDENTITY_SEED =
  "9dee6768a16dc99a2f399672eabffe3d1c2d30cd9daaeda8ae0c36074751b9f2";

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

export function LucaThresholdGlyph() {
  return (
    <DotSigil
      cell={7}
      dot="240,240,242"
      scene="sigil"
      seed={POLYPHONIC_IDENTITY_SEED}
      size={66}
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
    <DotSigil
      accessibleName="Polyphonic mark"
      cell={3}
      dot="236,236,239"
      scene="sigil"
      seed={POLYPHONIC_IDENTITY_SEED}
      size={size}
    />
  );
}
