/**
 * The room's one light, which wet ink catches.
 *
 * The light follows the pointer a little behind it, the way light through a
 * window follows a hand turning the page; left alone for a moment, it wanders
 * slowly, as daylight crosses a desk. Every wet word is told where along it
 * the light falls (`--ink-light`, in px from its left edge), and the gloss in
 * markdown.css lies there, leaning at the same 104° on every line. One light
 * for the whole window, however many timelines are mounted.
 *
 * Only unanswered wet words are lit, and only while something may move: the
 * loop stops when there are none, and never starts under Reduce Motion.
 */

const WET_WORD_SELECTOR = "[data-expression-wet-word]";
const ANSWERED_SELECTOR = "[data-ink-answered]";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
/** After this long without a pointer, the light wanders on its own. */
export const INK_LIGHT_IDLE_MS = 2600;
/** How quickly the light closes on where it is going, per second. */
const INK_LIGHT_FOLLOW = 5;
/** The gloss leans at 104°: across a line, it shifts this much per px down. */
export const INK_LIGHT_SLOPE = 0.27;

export type InkLight = {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  /** When the pointer last moved. */
  at: number;
};

/** Where the light is going: the pointer, or its slow idle wander. */
export function inkLightTarget(
  light: InkLight,
  nowMs: number,
  width: number,
  height: number,
): { x: number; y: number } {
  if (nowMs - light.at <= INK_LIGHT_IDLE_MS)
    return { x: light.targetX, y: light.targetY };
  const seconds = nowMs / 1000;
  return {
    x: width * (0.5 + 0.42 * Math.sin(seconds * 0.19)),
    y: height * (0.35 + 0.25 * Math.sin(seconds * 0.13 + 1.1)),
  };
}

/** One frame's step toward the target, softened so the light never jumps. */
export function stepInkLight(
  light: InkLight,
  target: { x: number; y: number },
  dtSeconds: number,
): void {
  const pull = Math.min(1, Math.max(0, dtSeconds) * INK_LIGHT_FOLLOW);
  light.x += (target.x - light.x) * pull;
  light.y += (target.y - light.y) * pull;
}

/** Where along a word, in px from its left edge, the light's line crosses it. */
export function inkLightAlong(
  light: Pick<InkLight, "x" | "y">,
  box: Pick<DOMRect, "left" | "top">,
): number {
  return light.x - box.left + (light.y - box.top) * INK_LIGHT_SLOPE;
}

const hosts = new Set<HTMLElement>();
let light: InkLight | null = null;
let frame = 0;
let lastFrameMs = 0;
let listening = false;

function reducedMotion(): boolean {
  return globalThis.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false;
}

function paint(nowMs: number): void {
  frame = 0;
  if (!light || reducedMotion()) return;
  const dt = lastFrameMs ? Math.min(0.05, (nowMs - lastFrameMs) / 1000) : 0;
  lastFrameMs = nowMs;
  const height = globalThis.innerHeight ?? 0;
  stepInkLight(
    light,
    inkLightTarget(light, nowMs, globalThis.innerWidth ?? 0, height),
    dt,
  );
  let lit = false;
  for (const host of hosts) {
    for (const word of host.querySelectorAll<HTMLElement>(WET_WORD_SELECTOR)) {
      if (word.closest(ANSWERED_SELECTOR)) continue;
      lit = true;
      const box = word.getBoundingClientRect();
      if (box.bottom < -40 || box.top > height + 40) continue;
      word.style.setProperty(
        "--ink-light",
        `${inkLightAlong(light, box).toFixed(1)}px`,
      );
    }
  }
  if (lit) frame = requestAnimationFrame(paint);
  else lastFrameMs = 0;
}

function wake(): void {
  if (frame || hosts.size === 0 || reducedMotion()) return;
  frame = requestAnimationFrame(paint);
}

function onPointerMove(event: PointerEvent): void {
  if (!light) return;
  light.targetX = event.clientX;
  light.targetY = event.clientY;
  light.at = performance.now();
  wake();
}

/**
 * Lets the wet ink inside `host` catch the light. Returns the cleanup, so it
 * composes into a React callback ref.
 */
export function attachInkLight(
  host: HTMLElement | null,
): (() => void) | undefined {
  if (!host || typeof requestAnimationFrame !== "function") return undefined;
  if (!light) {
    const x = (globalThis.innerWidth ?? 0) * 0.62;
    const y = (globalThis.innerHeight ?? 0) * 0.3;
    light = { x, y, targetX: x, targetY: y, at: -Infinity };
  }
  if (!listening) {
    globalThis.addEventListener("pointermove", onPointerMove, {
      passive: true,
    });
    listening = true;
  }
  hosts.add(host);
  // New wet words arrive with new messages, or as a reply settles.
  const observer = new MutationObserver(wake);
  observer.observe(host, { childList: true, subtree: true });
  wake();
  return () => {
    observer.disconnect();
    hosts.delete(host);
    if (hosts.size > 0) return;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    lastFrameMs = 0;
    globalThis.removeEventListener("pointermove", onPointerMove);
    listening = false;
  };
}
