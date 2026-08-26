import { DotSigil } from "@/shared/ui/dot-display/DotSigil";
import { cn } from "@/shared/lib/cn";

/**
 * The house busy mark — the one indicator for surface-level waits.
 *
 * A dot-matrix panel running the `work` scene: brand-native, tiny, and
 * already reduced-motion-safe (the engine settles to a static frame and
 * never starts the loop). Use this wherever a panel, card, or background
 * task is doing something; `Spinner` stays for micro-waits inside buttons.
 */

/** Fixed seed so the busy mark is the same mark everywhere it appears. */
const BUSY_MARK_SEED = "luca-busy-mark";

export function BusyMark({
  accessibleName = "Working",
  className,
  size = 20,
}: {
  accessibleName?: string;
  className?: string;
  size?: number;
}) {
  return (
    <DotSigil
      accessibleName={accessibleName}
      className={cn("shrink-0", className)}
      scene="work"
      seed={BUSY_MARK_SEED}
      size={size}
    />
  );
}
