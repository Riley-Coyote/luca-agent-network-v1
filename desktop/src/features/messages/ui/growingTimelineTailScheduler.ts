export const GROWING_TAIL_FOLLOW_INTERVAL_MS = 40;

export type GrowingTimelineTailClock = {
  cancelAnimationFrame: (handle: number) => void;
  clearTimeout: (handle: number) => void;
  now: () => number;
  requestAnimationFrame: (callback: FrameRequestCallback) => number;
  setTimeout: (callback: () => void, delayMs: number) => number;
};

function browserClock(): GrowingTimelineTailClock {
  return {
    cancelAnimationFrame: (handle) => cancelAnimationFrame(handle),
    clearTimeout: (handle) => clearTimeout(handle),
    now: () => performance.now(),
    requestAnimationFrame: (callback) => requestAnimationFrame(callback),
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  };
}

/**
 * Coalesces streamed-row growth into one virtualizer write per presentation
 * paint boundary. ResizeObserver can echo virtualizer measurement changes; a
 * separate global gate keeps those echoes from becoming a 60 Hz settle loop.
 */
export class GrowingTimelineTailScheduler {
  private animationFrame: number | null = null;
  private readonly clock: GrowingTimelineTailClock;
  private enabled = true;
  private readonly follow: () => void;
  private lastFollowAt = Number.NEGATIVE_INFINITY;
  private timer: number | null = null;

  constructor(
    follow: () => void,
    clock: GrowingTimelineTailClock = browserClock(),
  ) {
    this.follow = follow;
    this.clock = clock;
  }

  request(): void {
    if (!this.enabled || this.animationFrame !== null || this.timer !== null) {
      return;
    }
    const waitMs = Math.max(
      0,
      GROWING_TAIL_FOLLOW_INTERVAL_MS - (this.clock.now() - this.lastFollowAt),
    );
    if (waitMs > 0) {
      this.timer = this.clock.setTimeout(() => {
        this.timer = null;
        this.requestFrame();
      }, waitMs);
      return;
    }
    this.requestFrame();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.cancelPending();
  }

  dispose(): void {
    this.enabled = false;
    this.cancelPending();
  }

  private requestFrame(): void {
    if (!this.enabled || this.animationFrame !== null) return;
    this.animationFrame = this.clock.requestAnimationFrame(() => {
      this.animationFrame = null;
      if (!this.enabled) return;
      this.lastFollowAt = this.clock.now();
      this.follow();
    });
  }

  private cancelPending(): void {
    if (this.animationFrame !== null) {
      this.clock.cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    if (this.timer !== null) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
