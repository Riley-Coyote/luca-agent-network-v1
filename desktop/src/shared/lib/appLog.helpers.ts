/**
 * The pure half of the UI's end of the app log.
 *
 * Everything here is a plain function over plain values: no Tauri, no DOM, no
 * clock. That is what makes the rate limiter and the crash-report formatter
 * testable, and it is why `appLog.ts` — which owns `invoke`, `window` and
 * `Date.now` — has nothing in it worth a unit test.
 */

/** What the limiter decided about one line. */
export type RateDecision =
  | { allow: true; droppedBefore: number }
  | { allow: false };

export type RateLimiter = {
  /** @param now milliseconds from any monotonic-enough source. */
  admit: (now: number) => RateDecision;
};

/**
 * A fixed-window limiter: at most `limit` lines per `windowMs`, then silence.
 *
 * The count of what was dropped rides along on the first line of the next
 * window, so the log says "20 lines, then 4,000 lost" instead of quietly
 * omitting a render loop that was throwing every frame.
 */
export function createRateLimiter(limit: number, windowMs = 1000): RateLimiter {
  let windowStart: number | null = null;
  let count = 0;
  let dropped = 0;

  return {
    admit(now: number): RateDecision {
      if (windowStart === null || now - windowStart >= windowMs) {
        windowStart = now;
        count = 1;
        const droppedBefore = dropped;
        dropped = 0;
        return { allow: true, droppedBefore };
      }
      if (count < limit) {
        count += 1;
        return { allow: true, droppedBefore: 0 };
      }
      dropped += 1;
      return { allow: false };
    },
  };
}

/** A thrown value reduced to the two things a log line needs. */
export type DescribedError = {
  message: string;
  frames: string;
};

/**
 * The first `limit` stack frames, joined onto one line.
 *
 * A log line is a line. Three frames is enough to name the component, the
 * render path, and the caller; the rest is noise in a bug report.
 */
export function firstStackFrames(
  stack: string | null | undefined,
  limit = 3,
): string {
  if (!stack) {
    return "";
  }
  const lines = stack
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const frames = lines.filter((line) => line.startsWith("at "));
  // Safari and Firefox do not prefix frames with "at"; fall back to the lines
  // after the message rather than reporting no stack at all.
  const chosen = frames.length > 0 ? frames : lines.slice(1);
  return chosen.slice(0, limit).join(" | ");
}

/** Reduce anything `throw`n — Error, string, DOM event, `{}` — to a line. */
export function describeError(error: unknown, frameLimit = 3): DescribedError {
  if (error instanceof Error) {
    return {
      message: `${error.name}: ${error.message}`,
      frames: firstStackFrames(error.stack, frameLimit),
    };
  }
  if (typeof error === "string") {
    return { message: error, frames: "" };
  }
  try {
    return { message: JSON.stringify(error) ?? String(error), frames: "" };
  } catch {
    return { message: String(error), frames: "" };
  }
}

/** One log line's worth of text for a caught error. */
export function formatErrorLine(
  context: string,
  error: unknown,
  frameLimit = 3,
): string {
  const described = describeError(error, frameLimit);
  return described.frames
    ? `${context}: ${described.message} — ${described.frames}`
    : `${context}: ${described.message}`;
}

/**
 * Console arguments flattened to one message.
 *
 * `console.error("failed", err, { id })` has to survive as text; an Error in
 * the list keeps its first frames, and an object that will not serialize
 * becomes its own `String()` rather than disappearing.
 */
export function formatConsoleArguments(args: readonly unknown[]): string {
  return args
    .map((argument) => {
      if (typeof argument === "string") {
        return argument;
      }
      if (argument instanceof Error) {
        const described = describeError(argument);
        return described.frames
          ? `${described.message} — ${described.frames}`
          : described.message;
      }
      try {
        return JSON.stringify(argument) ?? String(argument);
      } catch {
        return String(argument);
      }
    })
    .join(" ");
}

export type CrashReportInput = {
  appVersion: string;
  capturedAt: string;
  error: unknown;
  /** The last lines of the app log, or "" when it could not be read. */
  logLines: string;
  /** The surface the boundary wraps, named the way the owner would name it. */
  screen: string;
};

/**
 * The text behind "Copy report".
 *
 * Deliberately plain: it is pasted into a chat, a mail, or an issue, and
 * whoever reads it should be able to see the error, the build it happened on,
 * and what the app was doing just before — without unfolding anything.
 */
export function formatCrashReport(input: CrashReportInput): string {
  const described = describeError(input.error, 3);
  const header = [
    "Polyphonic crash report",
    `screen: ${input.screen}`,
    `captured: ${input.capturedAt}`,
    `app version: ${input.appVersion}`,
    `error: ${described.message}`,
    described.frames ? `stack: ${described.frames}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  const body = input.logLines.trim();
  return `${header}\n\n--- recent log ---\n${
    body.length > 0 ? body : "(no log lines available)"
  }\n`;
}
