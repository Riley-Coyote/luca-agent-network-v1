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
const FORCED_COLORS_QUERY = "(forced-colors: active)";
const SUPPRESSED_SELECTOR = `${ANSWERED_SELECTOR}, [data-md-stream-effect]`;
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

const hosts = new Map<HTMLElement, number>();
// null means geometry needs checking; false means intersection has put it asleep.
const words = new Map<HTMLElement, boolean | null>();
let light: InkLight | null = null;
let frame = 0;
let lastFrameMs = 0;
let mutations: MutationObserver | null = null;
let intersections: IntersectionObserver | null = null;
let media: MediaQueryList[] = [];

function paused(): boolean {
  return document.hidden || media.some((query) => query.matches);
}

function stop(): void {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  lastFrameMs = 0;
}

function refresh(): void {
  const next = new Set<HTMLElement>();
  for (const host of hosts.keys()) {
    for (const word of host.querySelectorAll<HTMLElement>(WET_WORD_SELECTOR)) {
      if (!word.closest(SUPPRESSED_SELECTOR)) next.add(word);
    }
  }
  for (const word of words.keys()) {
    if (next.has(word)) continue;
    intersections?.unobserve(word);
    words.delete(word);
  }
  for (const word of next) {
    if (words.has(word)) continue;
    words.set(word, null);
    intersections?.observe(word);
  }
  wake();
}

/** Read eligibility and clipping, sharing ancestor reads across all wet words. */
function drawableBox(
  word: HTMLElement,
  styles: Map<HTMLElement, CSSStyleDeclaration>,
  boxes: Map<HTMLElement, DOMRect>,
): DOMRect | null {
  if (!word.isConnected || word.closest(SUPPRESSED_SELECTOR)) return null;
  const readBox = (element: HTMLElement) => {
    let box = boxes.get(element);
    if (!box) {
      box = element.getBoundingClientRect();
      boxes.set(element, box);
    }
    return box;
  };
  const box = readBox(word);
  let left = Math.max(0, box.left);
  let right = Math.min(globalThis.innerWidth, box.right);
  let top = Math.max(0, box.top);
  let bottom = Math.min(globalThis.innerHeight, box.bottom);
  if (right <= left || bottom <= top) return null;
  for (
    let element: HTMLElement | null = word;
    element;
    element = element.parentElement
  ) {
    let style = styles.get(element);
    if (!style) {
      style = getComputedStyle(element);
      styles.set(element, style);
    }
    if (
      element.hidden ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.contentVisibility === "hidden" ||
      Number(style.opacity) === 0
    )
      return null;
    if (element === word) continue;
    const clipsX = /^(auto|scroll|hidden|clip)$/.test(style.overflowX);
    const clipsY = /^(auto|scroll|hidden|clip)$/.test(style.overflowY);
    if (!clipsX && !clipsY) continue;
    const clip = readBox(element);
    if (clipsX) {
      left = Math.max(left, clip.left + element.clientLeft);
      right = Math.min(
        right,
        clip.left + element.clientLeft + element.clientWidth,
      );
    }
    if (clipsY) {
      top = Math.max(top, clip.top + element.clientTop);
      bottom = Math.min(
        bottom,
        clip.top + element.clientTop + element.clientHeight,
      );
    }
    if (right <= left || bottom <= top) return null;
  }
  return box;
}

function paint(nowMs: number): void {
  frame = 0;
  if (!light || paused()) {
    lastFrameMs = 0;
    return;
  }
  const dt = lastFrameMs ? Math.min(0.05, (nowMs - lastFrameMs) / 1000) : 0;
  lastFrameMs = nowMs;
  const height = globalThis.innerHeight ?? 0;
  stepInkLight(
    light,
    inkLightTarget(light, nowMs, globalThis.innerWidth ?? 0, height),
    dt,
  );
  const styles = new Map<HTMLElement, CSSStyleDeclaration>();
  const boxes = new Map<HTMLElement, DOMRect>();
  const writes: [HTMLElement, string][] = [];
  for (const [word, intersecting] of words) {
    if (intersecting === false) continue;
    const box = drawableBox(word, styles, boxes);
    if (!box) continue;
    writes.push([word, `${inkLightAlong(light, box).toFixed(1)}px`]);
  }
  // No style writes until every host's geometry and visibility have been read.
  for (const [word, value] of writes)
    word.style.setProperty("--ink-light", value);
  if (writes.length > 0) frame = requestAnimationFrame(paint);
  else lastFrameMs = 0;
}

function wake(): void {
  if (
    hosts.size === 0 ||
    paused() ||
    ![...words.values()].some((value) => value !== false)
  ) {
    stop();
    return;
  }
  if (frame) return;
  frame = requestAnimationFrame(paint);
}

function recheck(): void {
  for (const word of words.keys()) words.set(word, null);
  wake();
}

function onAppearanceSettled(event: Event): void {
  const target = event.target as Node | null;
  if (
    target &&
    [...hosts.keys()].some(
      (host) => host.contains(target) || target.contains(host),
    )
  ) {
    recheck();
  }
}

function withoutLight(style: string | null): string {
  return (style ?? "").replace(/--ink-light\s*:[^;]*(;|$)/g, "").trim();
}

function listen(): void {
  media = [REDUCED_MOTION_QUERY, FORCED_COLORS_QUERY].flatMap((query) => {
    const result = globalThis.matchMedia?.(query);
    return result ? [result] : [];
  });
  for (const query of media) query.addEventListener("change", recheck);
  globalThis.addEventListener("pointermove", onPointerMove, { passive: true });
  globalThis.addEventListener("resize", recheck, { passive: true });
  document.addEventListener("scroll", recheck, {
    capture: true,
    passive: true,
  });
  document.addEventListener("visibilitychange", recheck);
  // A CSS-only reveal can start at opacity zero without another mutation.
  document.addEventListener("transitionend", onAppearanceSettled);
  document.addEventListener("animationend", onAppearanceSettled);
  if (typeof IntersectionObserver === "function") {
    intersections = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (words.has(entry.target as HTMLElement)) {
          words.set(
            entry.target as HTMLElement,
            entry.isIntersecting &&
              entry.intersectionRect.width > 0 &&
              entry.intersectionRect.height > 0,
          );
        }
      }
      wake();
    });
  }
  mutations = new MutationObserver((records) => {
    const relevant = records.some((record) => {
      // Painting must not schedule itself through the observer.
      if (
        record.attributeName === "style" &&
        withoutLight(record.oldValue) ===
          withoutLight((record.target as HTMLElement).getAttribute("style"))
      )
        return false;
      return [...hosts.keys()].some(
        (host) => host.contains(record.target) || record.target.contains(host),
      );
    });
    if (relevant) {
      refresh();
      recheck();
    }
  });
  mutations.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: [
      "class",
      "style",
      "hidden",
      "data-ink-answered",
      "data-md-stream-effect",
      "data-expression-wet-word",
    ],
  });
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
  if (
    !host ||
    typeof requestAnimationFrame !== "function" ||
    typeof document === "undefined"
  )
    return undefined;
  if (!light) {
    const x = (globalThis.innerWidth ?? 0) * 0.62;
    const y = (globalThis.innerHeight ?? 0) * 0.3;
    light = { x, y, targetX: x, targetY: y, at: -Infinity };
  }
  if (hosts.size === 0) listen();
  hosts.set(host, (hosts.get(host) ?? 0) + 1);
  refresh();
  let attached = true;
  return () => {
    if (!attached) return;
    attached = false;
    const remaining = (hosts.get(host) ?? 1) - 1;
    if (remaining) hosts.set(host, remaining);
    else hosts.delete(host);
    refresh();
    if (hosts.size > 0) return;
    stop();
    mutations?.disconnect();
    mutations = null;
    intersections?.disconnect();
    intersections = null;
    words.clear();
    for (const query of media) query.removeEventListener("change", recheck);
    media = [];
    globalThis.removeEventListener("pointermove", onPointerMove);
    globalThis.removeEventListener("resize", recheck);
    document.removeEventListener("scroll", recheck, true);
    document.removeEventListener("visibilitychange", recheck);
    document.removeEventListener("transitionend", onAppearanceSettled);
    document.removeEventListener("animationend", onAppearanceSettled);
  };
}
