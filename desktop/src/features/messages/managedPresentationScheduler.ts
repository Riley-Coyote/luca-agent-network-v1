export const MANAGED_PRESENTATION_PAINT_INTERVAL_MS = 40;

export type ManagedPresentationSchedulerClock = {
  cancelAnimationFrame: (handle: number) => void;
  clearTimeout: (handle: ReturnType<typeof globalThis.setTimeout>) => void;
  now: () => number;
  requestAnimationFrame: (callback: FrameRequestCallback) => number;
  setTimeout: (
    callback: () => void,
    delay: number,
  ) => ReturnType<typeof globalThis.setTimeout>;
};

function defaultClock(): ManagedPresentationSchedulerClock {
  return {
    cancelAnimationFrame: (handle) => {
      if (typeof globalThis.cancelAnimationFrame === "function") {
        globalThis.cancelAnimationFrame(handle);
      } else {
        globalThis.clearTimeout(handle);
      }
    },
    clearTimeout: (handle) => globalThis.clearTimeout(handle),
    now: () => Date.now(),
    requestAnimationFrame: (callback) => {
      if (typeof globalThis.requestAnimationFrame === "function") {
        return globalThis.requestAnimationFrame(callback);
      }
      return globalThis.setTimeout(
        () => callback(Date.now()),
        0,
      ) as unknown as number;
    },
    setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  };
}

/**
 * One scheduler shared by every resident presentation row. It owns at most one
 * paint wake timer, one animation-frame request, and one nearest-deadline timer.
 */
export class ManagedPresentationScheduler {
  private readonly clock: ManagedPresentationSchedulerClock;
  private readonly commitPaint: (now: number) => boolean;
  private deadlineAt: number | null = null;
  private deadlineCallback: (() => void) | null = null;
  private deadlineTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private frameHandle: number | null = null;
  private lastCommitAt = Number.NEGATIVE_INFINITY;
  private paintRequested = false;
  private wakeTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

  constructor(
    commitPaint: (now: number) => boolean,
    clock: ManagedPresentationSchedulerClock = defaultClock(),
  ) {
    this.commitPaint = commitPaint;
    this.clock = clock;
  }

  requestPaint(): void {
    this.paintRequested = true;
    this.schedulePaint();
  }

  setNearestDeadline(at: number | null, callback: (() => void) | null): void {
    if (this.deadlineTimer !== null) {
      this.clock.clearTimeout(this.deadlineTimer);
      this.deadlineTimer = null;
    }
    this.deadlineAt = at;
    this.deadlineCallback = callback;
    if (at === null || callback === null) return;
    this.deadlineTimer = this.clock.setTimeout(
      () => this.fireDeadline(),
      Math.max(0, at - this.clock.now()),
    );
  }

  reset(): void {
    if (this.wakeTimer !== null) this.clock.clearTimeout(this.wakeTimer);
    if (this.deadlineTimer !== null) {
      this.clock.clearTimeout(this.deadlineTimer);
    }
    if (this.frameHandle !== null) {
      this.clock.cancelAnimationFrame(this.frameHandle);
    }
    this.deadlineAt = null;
    this.deadlineCallback = null;
    this.deadlineTimer = null;
    this.frameHandle = null;
    this.lastCommitAt = Number.NEGATIVE_INFINITY;
    this.paintRequested = false;
    this.wakeTimer = null;
  }

  /** Synchronous deterministic paint hook used by focused store tests. */
  flushForTests(now = this.clock.now()): boolean {
    this.paintRequested = false;
    this.lastCommitAt = now;
    return this.commitPaint(now);
  }

  private schedulePaint(): void {
    if (!this.paintRequested || this.frameHandle !== null) return;
    const wait = Math.max(
      0,
      this.lastCommitAt +
        MANAGED_PRESENTATION_PAINT_INTERVAL_MS -
        this.clock.now(),
    );
    if (wait > 0) {
      if (this.wakeTimer !== null) return;
      this.wakeTimer = this.clock.setTimeout(() => {
        this.wakeTimer = null;
        this.scheduleFrame();
      }, wait);
      return;
    }
    this.scheduleFrame();
  }

  private scheduleFrame(): void {
    if (!this.paintRequested || this.frameHandle !== null) return;
    this.frameHandle = this.clock.requestAnimationFrame(() => {
      this.frameHandle = null;
      if (!this.paintRequested) return;
      const now = this.clock.now();
      const wait =
        this.lastCommitAt + MANAGED_PRESENTATION_PAINT_INTERVAL_MS - now;
      if (wait > 0) {
        this.schedulePaint();
        return;
      }
      this.paintRequested = false;
      this.lastCommitAt = now;
      if (this.commitPaint(now)) this.requestPaint();
    });
  }

  private fireDeadline(): void {
    this.deadlineTimer = null;
    const callback = this.deadlineCallback;
    const at = this.deadlineAt;
    if (!callback || at === null) return;
    const wait = at - this.clock.now();
    if (wait > 0) {
      this.deadlineTimer = this.clock.setTimeout(
        () => this.fireDeadline(),
        wait,
      );
      return;
    }
    this.deadlineAt = null;
    this.deadlineCallback = null;
    callback();
  }
}
