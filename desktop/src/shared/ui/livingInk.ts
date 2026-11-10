import {
  formatExpressionColor,
  parseExpressionColor,
  type RGB,
} from "../lib/expressionColorMath";
import { inkGestureKey, InkGestureLedger } from "../lib/inkGestureLifecycle";
import {
  livingInkColor,
  livingInkPhase,
  livingInkRate,
  livingInkSheen,
} from "../lib/livingInkMath";
import { inkDrawableBox } from "./inkLight";

type Part = {
  element: HTMLElement;
  box: DOMRect;
  em: number;
  through: [number, number];
  stops: RGB[];
  arrived?: number;
};
type Field = {
  element: HTMLElement;
  key: string;
  born: number;
  seed: number;
  stops: RGB[];
  parts: Part[];
  ground: RGB;
  hush: boolean;
  wet: boolean;
  box: DOMRect;
  dirty: boolean;
  due: number;
  eligible: boolean;
};
const hosts = new Map<HTMLElement, number>();
const fields = new Map<HTMLElement, Field>();
const births = new Map<string, number>();
const gestures = new Map<HTMLElement, string>();
const played = new InkGestureLedger();
const scopes = new WeakMap<HTMLElement, string>();
let nextScope = 0;
const FIELD = "[data-ink-field]";
const PART = "[data-ink-field-part]";
const GESTURE = "[data-ink-gesture]";
const QUERIES = ["(prefers-reduced-motion: reduce)", "(forced-colors: active)"];
let frame = 0,
  timer: ReturnType<typeof setTimeout> | undefined;
let mutations: MutationObserver | undefined,
  intersections: IntersectionObserver | undefined;
let media: MediaQueryList[] = [];
const sleeping = new Set<HTMLElement>();
const ignoredStyle = (value: string | null) =>
  (value ?? "")
    .replace(/--ink-(?:paint|light|film-tint)\s*:[^;]*(;|$)/g, "")
    .trim();
const still = () => media[0]?.matches === true;
const forced = () => media[1]?.matches === true;

/** Community changes drop clocks as well as parsed Markdown; no cross-profile age state. */
export function resetLivingInkClocks() {
  births.clear();
  played.clear();
}

function scopeOf(host: HTMLElement): string {
  const message =
    host.closest<HTMLElement>("[data-message-id]")?.dataset.messageId;
  if (message) return message;
  let scope = scopes.get(host);
  if (!scope) {
    scope = `standalone-${++nextScope}`;
    scopes.set(host, scope);
  }
  return scope;
}

function messageHosts(messageId: string): HTMLElement[] {
  return [...hosts.keys()].filter(
    (host) =>
      host.closest<HTMLElement>("[data-message-id]")?.dataset.messageId ===
      messageId,
  );
}
/** A reader's explicit replay, never a hover or an agent/tool action. */
export function canReplayLivingInk(messageId: string): boolean {
  return (
    !still() &&
    !forced() &&
    messageHosts(messageId).some((host) =>
      host.querySelector(
        "[data-ink-field], [data-expression-motion], [data-expression-pressure='land']",
      ),
    )
  );
}
/** Re-say the expression once without sending, regenerating or changing history. */
export function replayLivingInk(messageId: string): void {
  if (!canReplayLivingInk(messageId)) return;
  const roots = messageHosts(messageId),
    now = Date.now();
  for (const [el, key] of gestures)
    if (roots.some((root) => root.contains(el))) {
      played.replay(key);
      el.dataset.inkGesture = "pending";
    }
  for (const field of fields.values())
    if (roots.some((root) => root.contains(field.element))) {
      field.born = now;
      births.set(field.key, now);
      for (const part of field.parts) part.arrived = undefined;
      field.due = 0;
    }
  for (const root of roots)
    for (const el of root.querySelectorAll("[data-ink-giving]"))
      el.removeAttribute("data-ink-giving");
  stop();
  wake();
}

function stop() {
  if (frame) cancelAnimationFrame(frame);
  if (timer !== undefined) clearTimeout(timer);
  frame = 0;
  timer = undefined;
}
function plain(field: Field) {
  field.element.removeAttribute("data-ink-field-ready");
  for (const part of field.parts)
    part.element.removeAttribute("data-ink-painted");
}
function groundOf(element: HTMLElement): RGB {
  // The actual conversation surface's theme token, not an invented palette.
  const channels = getComputedStyle(element)
    .getPropertyValue("--mn-surface")
    .trim()
    .split(/\s+/);
  return (
    parseExpressionColor(`hsl(${channels.join(",")})`) ??
    (document.documentElement.classList.contains("dark")
      ? [0, 0, 0]
      : [1, 1, 1])
  );
}
function refresh() {
  const found = new Map<HTMLElement, string>();
  const next = new Map<HTMLElement, string>();
  for (const host of hosts.keys()) {
    const scope = scopeOf(host);
    let index = 0;
    for (const el of host.querySelectorAll<HTMLElement>(FIELD))
      found.set(el, `${scope}:${index++}`);
    index = 0;
    for (const el of host.querySelectorAll<HTMLElement>(GESTURE))
      next.set(
        el,
        inkGestureKey(
          scope,
          index++,
          el.textContent ?? "",
          el.dataset.expressionMotion ?? "",
          el.dataset.expressionPressure ?? "",
        ),
      );
  }
  for (const el of gestures.keys())
    if (!next.has(el)) {
      gestures.delete(el);
      if (!found.has(el)) {
        sleeping.delete(el);
        intersections?.unobserve(el);
      }
    }
  for (const [el, key] of next) {
    if (gestures.get(el) === key) continue;
    gestures.set(el, key);
    if (still() || forced()) played.mark(key);
    el.dataset.inkGesture = played.has(key) ? "done" : "pending";
    intersections?.observe(el);
  }
  for (const [el, field] of fields)
    if (!found.has(el)) {
      plain(field);
      fields.delete(el);
      if (!next.has(el)) {
        sleeping.delete(el);
        intersections?.unobserve(el);
      }
    }
  for (const [el, scope] of found) {
    const stops = (el.dataset.inkField ?? "")
      .split("~")
      .map(parseExpressionColor);
    if (!stops.length || stops.length > 6 || stops.some((s) => !s)) continue;
    const seed = Number(el.dataset.inkFieldSeed);
    if (!Number.isFinite(seed) || seed < 0 || seed >= 1) continue;
    const key = `${scope}:${el.dataset.inkFieldSeed}:${el.dataset.inkField}:${el.textContent?.length}`;
    const born = births.get(key) ?? Date.now();
    births.set(key, born);
    if (births.size > 1000) {
      const first = births.keys().next().value;
      if (first !== undefined) births.delete(first);
    }
    const known = fields.get(el);
    if (known) {
      known.dirty = true;
      known.key = key;
      known.seed = seed;
      known.stops = stops as RGB[];
      known.born = born;
      continue;
    }
    fields.set(el, {
      element: el,
      key,
      born,
      seed,
      stops: stops as RGB[],
      parts: [],
      ground: [0, 0, 0],
      hush: false,
      wet: false,
      box: new DOMRect(),
      dirty: true,
      due: 0,
      eligible: false,
    });
    intersections?.observe(el);
  }
  wake();
}
function invalidate() {
  for (const field of fields.values()) {
    field.dirty = true;
    field.due = 0;
  }
  wake();
}
function prepare(
  field: Field,
  styles: Map<HTMLElement, CSSStyleDeclaration>,
  boxes: Map<HTMLElement, DOMRect>,
) {
  const el = field.element;
  const box = inkDrawableBox(el, styles, boxes, "");
  if (!box) return false;
  if (!field.dirty) return true;
  field.box = box;
  field.ground = groundOf(el);
  field.hush = el.dataset.expressionPressure === "hush";
  field.wet =
    el.hasAttribute("data-expression-wet") &&
    !el.closest("[data-ink-answered]");
  const previous = new Map(
    field.parts.map((part) => [part.element, part.arrived]),
  );
  field.parts = [];
  for (const part of el.querySelectorAll<HTMLElement>(PART)) {
    if (part.closest(FIELD) !== el) continue;
    const rect = part.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const through = (part.dataset.inkFieldPart ?? "").split(",").map(Number);
    if (
      through.length !== 2 ||
      through.some((p) => !Number.isFinite(p) || p < 0 || p > 1)
    )
      continue;
    const style = styles.get(part) ?? getComputedStyle(part);
    const base = parseExpressionColor(
      style.getPropertyValue("--expression-fill").trim(),
    );
    field.parts.push({
      element: part,
      box: rect,
      em: Number.parseFloat(style.fontSize) || 16,
      through: through as [number, number],
      stops:
        el.dataset.inkFieldAxis === "flow"
          ? field.stops
          : base
            ? [base]
            : field.stops,
      arrived: previous.get(part),
    });
  }
  field.dirty = false;
  return field.parts.length > 0;
}

function paint() {
  frame = 0;
  if (document.hidden || forced()) return;
  const now = Date.now(),
    at = performance.now();
  const styles = new Map<HTMLElement, CSSStyleDeclaration>(),
    boxes = new Map<HTMLElement, DOMRect>();
  const visible: Field[] = [],
    hidden: Field[] = [];
  const start: [HTMLElement, string][] = [],
    finish: [HTMLElement, string][] = [];
  // All visibility and geometry reads precede any paint writes.
  for (const [el, key] of gestures) {
    if (el.dataset.inkGesture !== "pending") continue;
    if (still() || played.has(key)) finish.push([el, key]);
    else if (
      !sleeping.has(el) &&
      inkDrawableBox(el, styles, boxes, "[data-md-stream-effect]")
    )
      start.push([el, key]);
  }
  for (const field of fields.values()) {
    if (sleeping.has(field.element) || field.due > at) continue;
    field.eligible = prepare(field, styles, boxes);
    if (field.eligible) visible.push(field);
    else hidden.push(field);
  }
  const writes: [HTMLElement, string, string][] = [];
  for (const field of visible) {
    if (!field.element.closest("[data-md-stream-effect]")) continue;
    for (const part of field.parts) {
      const word =
        part.element.querySelector<HTMLElement>("[data-md-stream-word]") ??
        part.element.closest<HTMLElement>("[data-md-stream-word]");
      if (
        part.arrived === undefined &&
        (!word || Number(getComputedStyle(word).opacity) >= 0.99)
      )
        part.arrived = at;
    }
  }
  for (const field of visible) {
    const age = (now - field.born) / 1000,
      phase = livingInkPhase(age, still());
    const streaming = field.element.closest("[data-md-stream-effect]") !== null;
    for (const part of field.parts) {
      // The stream remains responsible for entrance/holds. Pigment follows,
      // never hides a word; history and Reduce Motion open fully painted.
      const filled = still()
        ? 1
        : part.arrived !== undefined
          ? Math.max(0, Math.min(1, (at - part.arrived - 280) / 400))
          : streaming
            ? 0
            : 1;
      const samples = Math.min(
        17,
        Math.max(3, Math.ceil((part.box.width / part.em) * 4) + 1),
      );
      const colors: string[] = [];
      for (let k = 0; k < samples; k++) {
        const t = k / (samples - 1);
        const color = livingInkColor(
          part.stops,
          (part.box.left - field.box.left + part.box.width * t) / part.em,
          (part.box.top - field.box.top + part.box.height / 2) / part.em,
          phase,
          field.seed,
          part.through[0] + (part.through[1] - part.through[0]) * t,
          field.ground,
          field.hush,
          field.wet,
          filled,
        );
        colors.push(formatExpressionColor(color));
      }
      const sheen = livingInkSheen(
        (part.box.left - field.box.left) / part.em,
        (part.box.top - field.box.top) / part.em,
        phase,
        field.seed,
      );
      writes.push([
        part.element,
        `linear-gradient(90deg,${colors.join(",")})`,
        `rgb(${sheen.map((c) => Math.round(c * 255)).join(" ")} / 0.42)`,
      ]);
    }
    field.due = at + 1000 / livingInkRate(age);
  }
  for (const [el, key] of finish) {
    played.mark(key);
    el.dataset.inkGesture = "done";
  }
  for (const [el, key] of start) {
    played.mark(key);
    el.dataset.inkGesture = "playing";
  }
  for (const field of hidden) plain(field);
  for (const [part, gradient, sheen] of writes) {
    part.style.setProperty("--ink-paint", gradient);
    part.style.setProperty("--ink-film-tint", sheen);
    part.setAttribute("data-ink-painted", "");
  }
  for (const field of visible)
    field.element.setAttribute("data-ink-field-ready", "");
  if (still()) return;
  let due = Infinity;
  for (const field of fields.values())
    if (!sleeping.has(field.element) && field.eligible)
      due = Math.min(due, field.due);
  if (Number.isFinite(due))
    timer = setTimeout(
      () => {
        timer = undefined;
        wake();
      },
      Math.max(0, due - performance.now()),
    );
}
function wake() {
  if (!hosts.size || document.hidden || forced()) {
    stop();
    return;
  }
  if (frame || timer !== undefined) return;
  frame = requestAnimationFrame(paint);
}
function appearance() {
  stop();
  if (document.hidden || still() || forced())
    for (const [el, key] of gestures)
      if (el.dataset.inkGesture === "playing" || still() || forced()) {
        played.mark(key);
        el.dataset.inkGesture = "done";
      }
  if (forced()) for (const field of fields.values()) plain(field);
  invalidate();
}
function settled(event: Event) {
  const target = event.target as Node | null;
  if (event.type === "animationend" && target instanceof HTMLElement) {
    const gesture = target.closest<HTMLElement>(GESTURE);
    if (gesture && gestures.has(gesture)) {
      if (
        gesture
          .getAnimations({ subtree: true })
          .some((animation) => animation.playState === "running")
      )
        return;
      gesture.dataset.inkGesture = "done";
    }
  }
  if (
    target &&
    [...hosts.keys()].some(
      (host) => host.contains(target) || target.contains(host),
    )
  )
    invalidate();
}
function landed(event: AnimationEvent) {
  if (event.animationName !== "expression-land" || still() || forced()) return;
  const el = event.target;
  if (
    !(el instanceof HTMLElement) ||
    ![...hosts.keys()].some((host) => host.contains(el))
  )
    return;
  const lines = [...el.getClientRects()];
  const neighbours = [
    ...(el.parentElement?.querySelectorAll<HTMLElement>("[data-ink-give]") ??
      []),
  ];
  // Read every rectangle before writing; only the same line gives way.
  const active = neighbours.filter((word) => {
    const box = word.getBoundingClientRect();
    return lines.some(
      (line) => box.bottom > line.top + 2 && box.top < line.bottom - 2,
    );
  });
  for (const word of active) word.setAttribute("data-ink-giving", "");
}
function listen() {
  media = QUERIES.map((query) => matchMedia(query));
  for (const query of media) query.addEventListener("change", appearance);
  document.addEventListener("visibilitychange", appearance);
  document.addEventListener("scroll", invalidate, {
    capture: true,
    passive: true,
  });
  document.addEventListener("transitionend", settled);
  document.addEventListener("animationend", settled);
  document.addEventListener("animationstart", landed);
  globalThis.addEventListener("resize", invalidate, { passive: true });
  document.fonts?.addEventListener("loadingdone", invalidate);
  intersections =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver((entries) => {
          for (const entry of entries) {
            const el = entry.target as HTMLElement;
            if (
              entry.isIntersecting &&
              entry.intersectionRect.width > 0 &&
              entry.intersectionRect.height > 0
            )
              sleeping.delete(el);
            else sleeping.add(el);
          }
          invalidate();
        })
      : undefined;
  mutations = new MutationObserver((records) => {
    const relevant = records.some((record) => {
      if (
        record.attributeName === "style" &&
        ignoredStyle(record.oldValue) ===
          ignoredStyle((record.target as HTMLElement).getAttribute("style"))
      )
        return false;
      // Entrance opacity/blur is the stream's own 60 Hz work, not a reason
      // to remeasure or speed up this 12 Hz pigment clock.
      if (
        record.attributeName === "style" &&
        (record.target as HTMLElement).hasAttribute("data-md-stream-word")
      )
        return false;
      return [...hosts.keys()].some(
        (host) => host.contains(record.target) || record.target.contains(host),
      );
    });
    if (relevant) {
      refresh();
      // A theme switch must not wait for the slower resting tick to regain
      // reading contrast. Ordinary hover/stream changes retain their cadence.
      if (records.some((record) => record.target === document.documentElement))
        appearance();
    }
  });
  mutations.observe(document.documentElement, {
    childList: true,
    characterData: true,
    subtree: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: [
      "class",
      "style",
      "hidden",
      "data-ink-answered",
      "data-md-stream-effect",
      "data-ink-field",
      "data-ink-field-seed",
      "data-ink-field-axis",
    ],
  });
}

/** One shared, visibility-aware clock for every real Markdown surface. */
export function attachLivingInk(
  host: HTMLElement | null,
): (() => void) | undefined {
  if (
    !host ||
    typeof document === "undefined" ||
    typeof requestAnimationFrame !== "function"
  )
    return;
  if (!hosts.size) listen();
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
    if (hosts.size) return;
    stop();
    mutations?.disconnect();
    intersections?.disconnect();
    mutations = undefined;
    intersections = undefined;
    fields.clear();
    gestures.clear();
    sleeping.clear();
    for (const query of media) query.removeEventListener("change", appearance);
    media = [];
    document.removeEventListener("visibilitychange", appearance);
    document.removeEventListener("scroll", invalidate, true);
    document.removeEventListener("transitionend", settled);
    document.removeEventListener("animationend", settled);
    document.removeEventListener("animationstart", landed);
    globalThis.removeEventListener("resize", invalidate);
    document.fonts?.removeEventListener("loadingdone", invalidate);
  };
}
