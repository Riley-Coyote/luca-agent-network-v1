/**
 * The frame The mind is drawn in (WP-50, Decided 2, 3 and 5): Mnemos's own
 * page (`public/mnemos-mind/mind/`, copied unchanged), held the way the
 * Ghost lab holds it (`?behind`), and fed only from what the place holds
 * (`mindFeed.ts`). Everything here is the frame, never the picture: its
 * requests answered, its own chrome hidden, its light matched to the
 * app's, a press on a memory heard, and the whole of it let go.
 */
import {
  answerFeed,
  emptyLog,
  type FeedHoldings,
  type FeedLog,
  logLine,
} from "./mindFeed";

/** Where the copy is served from, in the browser build and the app alike
 *  (Vite copies `public/` into the bundle). */
export const MIND_PAGE = "/mnemos-mind/mind/index.html?behind";

export type MindState =
  | { kind: "drawing" }
  | { kind: "drawn"; counts: string }
  /** It can't be drawn: no graphics card, no WebGL, or the engine didn't
   *  start. `why` is the engine's own reason, for the record only. */
  | { kind: "cannot"; why: string };

/** Colours as the renderer takes them: linear light, 0 to 1. */
export type Rgb = [number, number, number];

/** The picture's light, from the app's: the floor it prints on (the card
 *  it sits on), the colour light burns, its one colour. `invert` turns the
 *  picture into ink on a light card (see `lightOf`). */
export type MindLight = {
  /** In display (sRGB) values: the renderer adds it after its own encode. */
  floor: Rgb;
  /** In linear light, like the rest of the scene. */
  fire: Rgb;
  pulse: Rgb;
  /** The floor as CSS, for the frame's page and its edge. */
  floorCss: string;
  invert: boolean;
};

export type MindFrameOptions = {
  holdings: () => FeedHoldings | null;
  light: MindLight;
  /** Every memory's id, in the place's reading (to name a cell). */
  ids: () => readonly string[];
  onState: (state: MindState) => void;
  onPick: (id: string) => void;
  onLetGo: () => void;
};

/** The parts of the engine's page this frame reads (`window.__mind`). */
type MindApi = {
  N: number;
  frames: number;
  selected: number;
  built: unknown;
  byId: (id: string) => number | undefined;
  pick: (x: number, y: number) => number;
  closeRoom: () => void;
};

type FrameWindow = Window &
  typeof globalThis & {
    __mind?: MindApi;
  };

// ── light ────────────────────────────────────────────────────────────

const toLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

/** A CSS colour as sRGB 0..1 (any form a canvas understands). */
export function srgbOf(css: string, doc: Document = document): Rgb {
  const g = doc.createElement("canvas").getContext("2d");
  if (!g) return [0, 0, 0];
  g.fillStyle = "#000";
  g.fillStyle = css;
  const v = String(g.fillStyle);
  if (v.startsWith("#"))
    return [1, 3, 5].map(
      (k) => Number.parseInt(v.slice(k, k + 2), 16) / 255,
    ) as Rgb;
  const n = v
    .match(/[\d.]+/g)
    ?.slice(0, 3)
    .map(Number) ?? [0, 0, 0];
  return [n[0] / 255, n[1] / 255, n[2] / 255];
}

const luma = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** CSS `invert(1) hue-rotate(180deg)`, on an sRGB colour. Both halves undo
 *  themselves and commute, so the pair is its own inverse: a colour passed
 *  through it twice comes back. */
export function inkOnPaper([r0, g0, b0]: Rgb): Rgb {
  const [r, g, b] = [1 - r0, 1 - g0, 1 - b0];
  // hue-rotate(180deg): 2A − I, A the luminance projection CSS uses.
  const y = 0.213 * r + 0.715 * g + 0.072 * b;
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  return [clamp(2 * y - r), clamp(2 * y - g), clamp(2 * y - b)];
}

const css = ([r, g, b]: Rgb) =>
  `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;

const rgbaOf = (v: string) => {
  const m = v.match(/[\d.]+/g)?.map(Number) ?? [];
  const a = m.length >= 4 ? (m[3] ?? 1) : m.length === 3 ? 1 : 0;
  return { c: [m[0] / 255, m[1] / 255, m[2] / 255] as Rgb, a };
};

/**
 * The card the picture sits on. The shell paints its one card as a layer of
 * its own behind the page (`[data-luca-one-card]`), not on any of the
 * page's ancestors, so that layer's colour is read first; else what's
 * behind the element, composited down to the first opaque layer.
 */
function cardOf(el: Element): Rgb {
  const card = document.querySelector("[data-luca-one-card]");
  if (card) {
    const { c, a } = rgbaOf(getComputedStyle(card).backgroundColor);
    if (a >= 0.99) return c;
  }
  const layers: { c: Rgb; a: number }[] = [];
  for (let at: Element | null = el; at; at = at.parentElement) {
    const layer = rgbaOf(getComputedStyle(at).backgroundColor);
    if (layer.a > 0) layers.push(layer);
    if (layer.a >= 1) break;
  }
  let out: Rgb = [0, 0, 0];
  for (const { c, a } of layers.reverse())
    out = [0, 1, 2].map((k) => out[k] * (1 - a) + c[k] * a) as Rgb;
  return out;
}

/**
 * The app's light, as the picture takes it (the lab's `mindLight`): the
 * card as its floor, the page's ink as the colour light burns, the place's
 * signal blue as its one colour. By night that is all of it. By day the
 * renderer can only add light to its floor (its last pass is
 * `floor + (1 − floor) × light`), so on a light card it would draw almost
 * nothing; instead it is drawn in the night colours that, turned to ink on
 * paper (`inkOnPaper`, the frame's CSS filter), land exactly on the card,
 * the ink and the blue.
 */
export function lightOf(host: HTMLElement): MindLight {
  const style = getComputedStyle(host);
  const card = cardOf(host);
  const ink = srgbOf(style.color);
  const signal = style.getPropertyValue("--mn-signal").trim();
  const blue = srgbOf(signal ? `hsl(${signal})` : "#6d93c9");
  const invert = luma(card) > 0.5;
  const [floor, fire, pulse] = invert
    ? [inkOnPaper(card), inkOnPaper(ink), inkOnPaper(blue)]
    : [card, ink, blue];
  const linear = (c: Rgb) => c.map(toLinear) as Rgb;
  return {
    floor,
    fire: linear(fire),
    pulse: linear(pulse),
    floorCss: css(floor),
    invert,
  };
}

// ── the frame ────────────────────────────────────────────────────────

/** How long the frame may take to start its page before the place says
 *  it can't be drawn. */
const START_MS = 60_000;

/** The look the place gives the page: its own chrome hidden (the lab's
 *  list), its reading room laid out but never seen (opening a memory its
 *  own way draws that memory finely, where the room leaves space), the
 *  app's type for the one control left, and an edge that melts into the
 *  card. */
function dress(doc: Document, light: MindLight) {
  const style = doc.createElement("style");
  style.dataset.polyphonic = "mind";
  style.textContent = `html,body{background:${light.floorCss};overflow:hidden}
:root{--floor:${light.floorCss};--sans:-apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;--display:var(--sans);--own:var(--sans);--house:var(--sans)}
.hero > .ui:not(.recenter),#regions,#full,.paper,#loading,.aside{display:none !important}
#room{visibility:hidden !important;pointer-events:none !important}
.hero::before{content:"";position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 28px 26px ${light.floorCss}}
.recenter{background:none;-webkit-backdrop-filter:none;backdrop-filter:none;font-family:var(--sans)}`;
  doc.head.append(style);
}

/**
 * The page's renderer given the app's light: the same modules its page
 * runs (one copy per frame, imported in its own realm), wrapped so every
 * frame it draws is printed on the app's card, in its ink and blue.
 * Reduce Motion: the engine turns nothing and walks nothing; held to one
 * print of its grain, the picture is still.
 */
async function giveLight(win: FrameWindow, light: MindLight) {
  const load = (path: string) =>
    new win.Function(
      `return import(${JSON.stringify(new URL(path, win.location.href).href)})`,
    )() as Promise<Record<string, { prototype: Record<string, unknown> }>>;
  const [post, tissue] = await Promise.all([
    load("../engine/post.js"),
    load("../engine/tissue.js"),
  ]);
  const Post = post.Post?.prototype;
  const Tissue = tissue.Tissue?.prototype;
  if (!Post || !Tissue) throw new Error("the renderer isn't the one copied");
  const calm = win.matchMedia("(prefers-reduced-motion: reduce)");
  const finish = Post.finish as (o?: object, seed?: number) => void;
  const draw = Tissue.draw as (into: unknown, o?: object) => void;
  Post.finish = function (this: unknown, o: object = {}, seed?: number) {
    return finish.call(
      this,
      { ...o, floor: light.floor },
      calm.matches ? 1 : seed,
    );
  };
  Tissue.draw = function (this: unknown, into: unknown, o: object = {}) {
    return draw.call(this, into, {
      ...o,
      fire: light.fire,
      pulse: light.pulse,
    });
  };
}

/** A constructor that refuses: the frame reaches nothing but its feed. */
function refusing(win: FrameWindow) {
  return function Refused() {
    throw new win.DOMException(
      "Nothing is reached from here.",
      "SecurityError",
    );
  };
}

/**
 * Answers every request the page makes with `fetch` from the feed, and
 * takes away every other way it could reach out. Installed on the page's
 * own window before its script runs (`MindFrame.catchStart`).
 */
function installFeed(
  win: FrameWindow,
  root: URL,
  holdings: () => FeedHoldings | null,
  log: FeedLog,
  onLog: () => void,
) {
  const feed = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new win.Request(input, init);
    const answer = await answerFeed(
      new URL(request.url),
      request.method,
      root,
      holdings(),
    );
    log[answer.kind][answer.answered] += 1;
    onLog();
    return new win.Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { "Content-Type": "application/json" },
    });
  };
  const fix = (target: object, name: string, value: unknown) =>
    Object.defineProperty(target, name, {
      configurable: false,
      value,
      writable: false,
    });
  fix(win, "fetch", feed);
  for (const name of ["XMLHttpRequest", "WebSocket", "EventSource"])
    fix(win, name, refusing(win));
  fix(win.navigator, "sendBeacon", () => false);
}

/**
 * One frame, from mounting to letting go. Its life is the section's: it is
 * built when The mind is shown and destroyed, not hidden, when it isn't.
 */
export class MindFrame {
  readonly frame: HTMLIFrameElement;
  readonly log: FeedLog = emptyLog();
  /** When it was asked for, and when its first picture was drawn. */
  readonly startedAt = performance.now();
  firstPictureAt: number | null = null;
  /** Whether the feed was on the page's window before its script ran. */
  fedInTime: boolean | null = null;
  private state: MindState = { kind: "drawing" };
  private win: FrameWindow | null = null;
  private api: MindApi | null = null;
  private ids: string[] = [];
  private built: unknown = null;
  private want: string | null = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private undo: (() => void)[] = [];
  private gone = false;

  private readonly options: MindFrameOptions;

  constructor(host: HTMLElement, options: MindFrameOptions) {
    this.options = options;
    const frame = document.createElement("iframe");
    frame.className = "luca-mnemos-mind-frame";
    frame.title = "The mind: every memory a cell, every link a fibre";
    frame.tabIndex = -1;
    frame.dataset.testid = "mnemos-mind-frame";
    frame.dataset.feed = logLine(this.log);
    if (options.light.invert) frame.dataset.ink = "";
    this.frame = frame;
    host.append(frame);
    const onMessage = (event: MessageEvent) => this.heard(event);
    window.addEventListener("message", onMessage);
    this.undo.push(() => window.removeEventListener("message", onMessage));
    frame.src = MIND_PAGE;
    this.catchStart(frame.contentDocument);
    this.later(() => {
      if (this.state.kind === "drawing") this.cannot("it didn't start in time");
    }, START_MS);
  }

  /** What's shown: the memory picked, or the whole mind. */
  show(id: string | null) {
    this.want = id;
    this.apply();
  }

  /** Lets go of everything: the frame, its drawing on the graphics card,
   *  its workers and timers, and what it was given. */
  destroy() {
    if (this.gone) return;
    this.gone = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    for (const undo of this.undo.splice(0)) undo();
    try {
      const canvas = this.win?.document.getElementById("mind") as
        | HTMLCanvasElement
        | null
        | undefined;
      const gl = canvas?.getContext("webgl2");
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      // Already gone with its window.
    }
    this.win = null;
    this.api = null;
    this.frame.remove();
  }

  private later(run: () => void, ms: number) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.gone) run();
    }, ms);
    this.timers.add(timer);
  }

  private setState(state: MindState) {
    if (this.gone) return;
    this.state = state;
    this.options.onState(state);
  }

  private cannot(why: string) {
    if (this.state.kind === "cannot") return;
    this.setState({ kind: "cannot", why });
  }

  /**
   * The page's own window exists from the moment its address commits, before
   * its script runs (a module runs once the page is parsed, and asks for
   * its memory only after its fonts and glyphs are made). It is caught here,
   * a task at a time, and fed before it can ask.
   */
  private catchStart(blank: Document | null) {
    const channel = new MessageChannel();
    const until = performance.now() + START_MS;
    const look = () => {
      if (this.gone) return;
      const doc = this.frame.contentDocument;
      const win = this.frame.contentWindow as FrameWindow | null;
      if (doc && win && doc !== blank && win.location.href !== "about:blank") {
        channel.port1.close();
        this.started(win, doc);
        return;
      }
      if (performance.now() > until) {
        channel.port1.close();
        return;
      }
      channel.port2.postMessage(0);
    };
    channel.port1.onmessage = look;
    this.undo.push(() => channel.port1.close());
    look();
  }

  private started(win: FrameWindow, doc: Document) {
    this.win = win;
    this.fedInTime = doc.readyState === "loading";
    const root = new URL("../", win.location.href);
    const holdings = () => (this.gone ? null : this.options.holdings());
    installFeed(win, root, holdings, this.log, () => {
      this.frame.dataset.feed = logLine(this.log);
    });
    // Its own refusals (no graphics card, no WebGL, nothing to draw) end
    // its script: they are the place's one line, not the console's.
    const onError = (event: ErrorEvent | PromiseRejectionEvent) => {
      event.preventDefault();
      if (!this.api) {
        const why =
          event instanceof win.ErrorEvent
            ? event.message
            : String((event as PromiseRejectionEvent).reason);
        this.cannot(why);
      }
    };
    win.addEventListener("error", onError);
    win.addEventListener("unhandledrejection", onError);
    // Dressed as soon as its head is parsed, before anything is laid out:
    // its own words never show, so their faces are never asked for.
    if (doc.head) dress(doc, this.options.light);
    else {
      const observer = new win.MutationObserver(() => {
        if (!doc.head) return;
        observer.disconnect();
        dress(doc, this.options.light);
      });
      observer.observe(doc, { childList: true, subtree: true });
    }
    doc.addEventListener(
      "DOMContentLoaded",
      () => {
        if (this.gone) return;
        giveLight(win, this.options.light).catch(() => {
          // The picture keeps its own light.
        });
        win.postMessage({ mnemos: "reveal" }, "/");
        this.bind(win);
        this.watch(win);
      },
      { once: true },
    );
  }

  /** The page's own word that it can't draw (it says it to its host). */
  private heard(event: MessageEvent) {
    if (!this.win || event.source !== this.win) return;
    const what = (event.data as { mnemos?: string } | null)?.mnemos;
    if (what === "cannot") this.cannot("the page said it can't draw");
  }

  /** Watched until it has drawn its first picture; then its count line,
   *  as the page itself sets it. */
  private watch(win: FrameWindow) {
    const poll = () => {
      const api = win.__mind;
      if (api && api.frames > 0) {
        this.api = api;
        this.firstPictureAt = performance.now();
        this.frame.dataset.drawn = "";
        this.frame.dataset.firstPictureMs = String(
          Math.round(this.firstPictureAt - this.startedAt),
        );
        this.frame.dataset.fedInTime = String(this.fedInTime);
        const counts = win.document.getElementById("who-sub");
        const say = () =>
          this.setState({
            kind: "drawn",
            counts: counts?.textContent?.trim() ?? "",
          });
        if (counts) {
          const observer = new win.MutationObserver(say);
          observer.observe(counts, {
            childList: true,
            characterData: true,
            subtree: true,
          });
          this.undo.push(() => observer.disconnect());
        }
        say();
        this.apply();
        this.watchContext(win);
        return;
      }
      if (this.state.kind !== "cannot") this.later(poll, 100);
    };
    poll();
  }

  /** The graphics card let the drawing go and didn't give it back. */
  private watchContext(win: FrameWindow) {
    const canvas = win.document.getElementById("mind");
    if (!canvas) return;
    let lost: ReturnType<typeof setTimeout> | null = null;
    const onLost = () => {
      if (this.gone) return;
      lost = setTimeout(() => {
        if (!this.gone) this.cannot("the graphics card let it go");
      }, 6_000);
      this.timers.add(lost);
    };
    const onBack = () => {
      if (lost) clearTimeout(lost);
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onBack);
    this.undo.push(() => {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onBack);
    });
  }

  /** Which memory each cell is, as the engine placed them. */
  private idOf(index: number): string | null {
    const api = this.api;
    if (!api) return null;
    if (api.built !== this.built) {
      this.built = api.built;
      this.ids = [];
      for (const id of this.options.ids()) {
        const i = api.byId(id);
        if (i !== undefined) this.ids[i] = id;
      }
    }
    return this.ids[index] ?? null;
  }

  /** The engine shown what's wanted: the memory marked, its own way (as the
   *  log's "See it in the mind" asks), or the whole mind. */
  private apply() {
    const api = this.api;
    const win = this.win;
    if (!api || !win) return;
    const want = this.want ? (api.byId(this.want) ?? -1) : -1;
    if (want >= 0 && api.selected !== want)
      win.postMessage(
        {
          mnemos: "reveal",
          hash: `#memory/${encodeURIComponent(this.want ?? "")}`,
        },
        "/",
      );
    else if (want < 0 && api.selected >= 0) api.closeRoom();
  }

  /** A press on a cell picks its memory (as the engine tells a press from
   *  a turn: under six pixels and half a second); Escape lets it go. */
  private bind(win: FrameWindow) {
    let down: { x: number; y: number; t: number } | null = null;
    win.addEventListener("pointerdown", (e) => {
      down =
        e.button === 0
          ? { x: e.clientX, y: e.clientY, t: performance.now() }
          : null;
    });
    win.addEventListener("pointerup", (e) => {
      const d = down;
      down = null;
      const api = this.api;
      if (!api || !d) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) >= 6) return;
      if (performance.now() - d.t >= 450) return;
      if (!(e.target as Element | null)?.closest?.("canvas")) return;
      const id = this.idOf(api.pick(e.clientX, e.clientY));
      if (id) this.options.onPick(id);
    });
    win.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (this.want) this.options.onLetGo();
      },
      true,
    );
  }
}
