type MeasureCorners = () => (() => void) | undefined;

/** Read every mounted surface before applying any clip-path writes. */
export function createSmoothCornerScheduler(
  requestFrame: (callback: () => void) => number,
  cancelFrame: (id: number) => void,
) {
  const pending = new Set<MeasureCorners>();
  let frame: number | null = null;
  const flush = () => {
    frame = null;
    const measurements = [...pending];
    pending.clear();
    const writes = measurements.map((measure) => measure());
    for (const write of writes) write?.();
  };
  return {
    schedule(measure: MeasureCorners) {
      pending.add(measure);
      if (frame === null) frame = requestFrame(flush);
    },
    cancel(measure: MeasureCorners) {
      pending.delete(measure);
      if (pending.size === 0 && frame !== null) {
        cancelFrame(frame);
        frame = null;
      }
    },
  };
}
