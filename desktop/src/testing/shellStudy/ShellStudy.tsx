/**
 * THE SHELL STUDY: places, conversations, the lip, and the frame
 * (docs/luca/rail-system/SHELL_STUDY.md).
 *
 * A thin frame (the lip and the places) holds two cards of one material:
 * the rail's and the conversation's. The frame is black, or Apple's clear
 * glass over the desktop; the cards are never glass. Where you are is a
 * solid, squircle-cornered mark.
 *
 * The third frame, Above, turns the glass the right way up: the conversation
 * is the window, and Apple's glass floats above it in three small pieces
 * (the lead, the tabs, the places pane), drawn natively with their symbols
 * inside (Lab/ShellChrome.swift), in Apple's own frame metrics.
 *
 * In the glass lab (scripts/native-glass-lab.sh) the glass is Apple's; in a
 * browser it is our own stand-in, and says so. Sample conversations only
 * (content.ts).
 */
import * as React from "react";
import {
  Activity,
  ArrowUp,
  Bot,
  Brain,
  ChevronLeft,
  ChevronRight,
  Library,
  MessagesSquare,
  PanelLeft,
  Plus,
  Search,
  Settings,
  SquarePen,
  X,
} from "lucide-react";

import {
  HOMES,
  OWNER,
  PLACE_PAGES,
  SECTIONS,
  type Home,
  type Message,
  type PlaceId,
} from "@/testing/shellStudy/content";
import {
  MarkEngine,
  type MarkGroup,
  type Rect,
} from "@/testing/shellStudy/marks";
import {
  type ChromeItem,
  dragWindow,
  placeLabLights,
  reportChrome,
  reportFrame,
  startGlass,
  stopGlass,
  titledLabWindow,
  useChromeActions,
  useLabWindow,
  useNativeGlass,
  useNativePresent,
} from "@/testing/shellStudy/nativeGlass";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

import "./shellStudy.css";

export const SHELL_STUDY_KEY = "ui-design-lab.polyphonic.shell.v2";

/** The shell's measures, in points (shellStudy.css holds the rest). */
const PLACES_WIDTH = 44;
const RAIL_WIDTH = 220;
/** Between the rail's card and the conversation's, as between the app's cards. */
const CARD_GAP = 4;
const CARD_RADIUS = 10;
/** The frame's corners, matching a window's. */
const WINDOW_RADIUS = 16;
/** Where the lab's real traffic lights go: the first light's left edge, and
 *  the line the lip's words and tabs are centred on. */
const LIGHTS_LEFT = 16;
const LIP_LINE = 22;
/** The card's travel when the rail opens or closes (shellStudy.css). */
const SLIDE_MS = 460;

type Direction = "black" | "glass" | "above";

/**
 * The glass above uses Apple's own frame metrics, never ours (the
 * liquid-glass skill's references/mac-apps.md; measured on macOS 27.0.1):
 * the band the top pieces float in, the line the traffic lights are centred
 * on and the first light's left edge, and the top pieces' height and corners.
 * Compact is Apple's compact toolbar; the title bar is a window without one,
 * where the system puts the lights anyway.
 */
const BARS = {
  compact: { band: 40, centre: 20, left: 12, h: 28, r: 10 },
  titlebar: { band: 32, centre: 16, left: 9, h: 24, r: 9 },
} as const;
type Bar = keyof typeof BARS;
/** Everything this far from the window's edge is concentric with its corner. */
const EDGE = 6;
/** The places pane's width. */
const PANE = 40;
/** The three traffic lights, from the first one's left edge to the last one's
 *  right (14 each, 23 apart). */
const LIGHTS_SPAN = 60;
/** The lead piece starts this far after the lights, and is as wide as
 *  ShellChrome.swift lays it out: 2 in, three buttons of 30, 4 between the
 *  toggle and back. */
const LEAD_AFTER = 12;
const LEAD_WIDTH = 98;

/**
 * Every material Apple offers for the frame, by Apple's names: Liquid Glass's
 * two types, plain or with Apple's own dark tint, and the fourteen frosted
 * materials (the older kind, which can hold the look of a window in use when
 * it isn't). Nothing here is ours: the veil, our darkness, is its own choice.
 */
type FrameMaterial = {
  id: string;
  label: string;
  style: "regular" | "clear" | "frosted";
  tint?: string;
  material?: string;
};

const FROSTED: [string, string][] = [
  ["sidebar", "Sidebar"],
  ["windowBackground", "Window"],
  ["underWindowBackground", "Under the window"],
  ["contentBackground", "Content"],
  ["underPageBackground", "Under a page"],
  ["headerView", "Header"],
  ["titlebar", "Title bar"],
  ["sheet", "Sheet"],
  ["popover", "Popover"],
  ["menu", "Menu"],
  ["hudWindow", "Heads-up display"],
  ["fullScreenUI", "Full screen"],
  ["toolTip", "Tooltip"],
  ["selection", "Selection"],
];

const MATERIALS: { group: string; items: FrameMaterial[] }[] = [
  {
    group: "Liquid Glass",
    items: [
      { id: "glass-regular", label: "Regular", style: "regular" },
      { id: "glass-clear", label: "Clear", style: "clear" },
      {
        id: "glass-regular-tint",
        label: "Regular, Apple's dark tint",
        style: "regular",
        tint: "#00000080",
      },
      {
        id: "glass-clear-tint",
        label: "Clear, Apple's dark tint",
        style: "clear",
        tint: "#00000080",
      },
    ],
  },
  {
    group: "Frosted, Apple's older material",
    items: FROSTED.map(([material, label]) => ({
      id: `frost-${material}`,
      label,
      style: "frosted",
      material,
    })),
  },
];

const MATERIAL_BY_ID = new Map(
  MATERIALS.flatMap((group) => group.items).map((item) => [item.id, item]),
);
const DEFAULT_MATERIAL = "glass-regular";
type Veil = "none" | "soft" | "deep";
type Choice = {
  direction: Direction;
  tabs: boolean;
  rail: boolean;
  /** The rail's surface: the card's own black, or a step lighter. */
  tone: "same" | "lighter";
  /** The frame's material, an id from MATERIALS. */
  material: string;
  /** For a frosted frame: hold the look of a window in use, or follow the window. */
  held: boolean;
  veil: Veil;
  panel: boolean;
  /** For the glass above: Apple's compact toolbar, or its plain title bar. */
  bar: Bar;
  /** For the glass above: Apple's two types of glass, every piece the same. */
  variant: "regular" | "clear";
};

const DEFAULT_CHOICE: Choice = {
  direction: "glass",
  tabs: true,
  rail: true,
  tone: "same",
  material: DEFAULT_MATERIAL,
  held: true,
  veil: "soft",
  panel: true,
  bar: "compact",
  variant: "regular",
};

function readChoice(): Choice {
  const choice = { ...DEFAULT_CHOICE };
  const take = (source: Record<string, unknown>) => {
    if (
      source.direction === "black" ||
      source.direction === "glass" ||
      source.direction === "above"
    )
      choice.direction = source.direction;
    if (source.bar === "compact" || source.bar === "titlebar")
      choice.bar = source.bar;
    if (source.variant === "regular" || source.variant === "clear")
      choice.variant = source.variant;
    if (typeof source.tabs === "boolean") choice.tabs = source.tabs;
    if (typeof source.rail === "boolean") choice.rail = source.rail;
    if (source.tone === "same" || source.tone === "lighter")
      choice.tone = source.tone;
    if (
      typeof source.material === "string" &&
      MATERIAL_BY_ID.has(source.material)
    )
      choice.material = source.material;
    if (typeof source.held === "boolean") choice.held = source.held;
    if (
      source.veil === "none" ||
      source.veil === "soft" ||
      source.veil === "deep"
    )
      choice.veil = source.veil;
    if (typeof source.panel === "boolean") choice.panel = source.panel;
  };
  try {
    const stored = JSON.parse(localStorage.getItem(SHELL_STUDY_KEY) ?? "{}");
    if (stored && typeof stored === "object") take(stored);
  } catch {
    // A study that can't read its last look opens on the default one.
  }
  // `?direction=glass&tone=lighter&tabs=1&rail=closed&material=frost-sidebar&held=0&veil=none&panel=0`
  // (or `?direction=above&bar=titlebar&variant=clear`) opens a look directly,
  // for captures.
  const params = new URLSearchParams(window.location.search);
  const flag = (name: string) =>
    params.has(name)
      ? !["0", "off", "closed", "false"].includes(params.get(name) ?? "")
      : undefined;
  take({
    direction: params.get("direction"),
    tabs: flag("tabs"),
    rail: flag("rail"),
    tone: params.get("tone"),
    material: params.get("material"),
    held: flag("held"),
    veil: params.get("veil"),
    panel: flag("panel"),
    bar: params.get("bar"),
    variant: params.get("variant"),
  });
  return choice;
}

/** A colour the page's CSS names, as "#rrggbb" for the native side. */
function cssHex(host: Element, color: string) {
  const probe = document.createElement("span");
  probe.style.color = color;
  host.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  const values = computed.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
  // "color(srgb 0.1 0.1 0.1)" counts from 0 to 1; "rgb(26, 26, 26)" to 255.
  const scale = computed.startsWith("color(") ? 255 : 1;
  return `#${values
    .slice(0, 3)
    .map((value) =>
      Math.round(Math.min(255, value * scale))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** What the native frame is told about its material. */
function frameMaterialFor(choice: Choice) {
  const material =
    MATERIAL_BY_ID.get(choice.material) ?? MATERIAL_BY_ID.get(DEFAULT_MATERIAL);
  return {
    style: material?.style ?? "regular",
    tint: material?.tint ?? null,
    material: material?.material ?? null,
    held: choice.held,
  };
}

/** A conversation: a home's own (`session` null) or one of its sessions. */
type Open = { home: string; session: string | null };
type View = { place: PlaceId; open: Open };
const keyOf = (open: Open) => `${open.home}/${open.session ?? ""}`;
const openOf = (key: string): Open => {
  const [home, session] = key.split("/");
  return { home, session: session || null };
};

type Nav = { stack: View[]; index: number };
type NavAction =
  | { type: "go"; view: View }
  | { type: "back" }
  | { type: "forward" };

function navigate(nav: Nav, action: NavAction): Nav {
  if (action.type === "back")
    return { ...nav, index: Math.max(0, nav.index - 1) };
  if (action.type === "forward")
    return { ...nav, index: Math.min(nav.stack.length - 1, nav.index + 1) };
  const here = nav.stack[nav.index];
  if (
    here.place === action.view.place &&
    keyOf(here.open) === keyOf(action.view.open)
  )
    return nav;
  const stack = [...nav.stack.slice(0, nav.index + 1), action.view].slice(-50);
  return { stack, index: stack.length - 1 };
}

/** Each place's icon on the page, and its SF Symbol in the glass above. */
const PLACES: {
  id: PlaceId;
  label: string;
  icon: typeof Library;
  symbol: string;
}[] = [
  {
    id: "conversations",
    label: "Conversations",
    icon: MessagesSquare,
    symbol: "bubble.left.and.bubble.right",
  },
  { id: "library", label: "Library", icon: Library, symbol: "books.vertical" },
  { id: "agents", label: "Agents", icon: Bot, symbol: "person.2" },
  {
    id: "activity",
    label: "Activity",
    icon: Activity,
    symbol: "waveform.path.ecg",
  },
  { id: "brain", label: "Brain", icon: Brain, symbol: "brain" },
];

/** Where a home opens: Luca's thread, an agent's 1:1, a project's last room,
 *  a fleet's newest session (or its one conversation). */
function mainOf(home: Home): Open {
  if (home.main) return { home: home.id, session: null };
  return { home: home.id, session: home.sessions[0]?.id ?? null };
}

function addLabel(home: Home) {
  if (home.kind === "project") return `New room in ${home.name}`;
  return `New session with ${home.name}`;
}

export function ShellStudy() {
  const [choice, setChoice] = React.useState(readChoice);
  const [homes, setHomes] = React.useState<Home[]>(HOMES);
  const [nav, dispatch] = React.useReducer(navigate, {
    stack: [{ place: "conversations", open: { home: "luca", session: null } }],
    index: 0,
  });
  const [expanded, setExpanded] = React.useState(
    () => new Set(["tidepool", "wren"]),
  );
  const [tabs, setTabs] = React.useState<string[]>([
    "luca/",
    "wren/wren-monday",
    "tidepool/tidepool-landing",
  ]);
  const [railShown, setRailShown] = React.useState(choice.rail);
  const [searching, setSearching] = React.useState(false);
  const [note, setNote] = React.useState("");
  const native = useNativeGlass();
  const present = useNativePresent();
  const labWindow = useLabWindow();
  const titled = titledLabWindow();
  const above = choice.direction === "above";
  /** The glass above is Apple's, drawn by the lab; in a browser, ours. */
  const chromeNative = above && present;
  const bar = BARS[choice.bar];

  const view = nav.stack[nav.index];
  const place = view.place;
  const open = view.open;
  const openHome = homes.find((home) => home.id === open.home) ?? homes[0];
  const openSession = openHome.sessions.find(
    (session) => session.id === open.session,
  );

  React.useEffect(() => {
    try {
      localStorage.setItem(SHELL_STUDY_KEY, JSON.stringify(choice));
    } catch {
      // The look still applies; it just won't be there after a reload.
    }
  }, [choice]);

  const choose = <K extends keyof Choice>(key: K, value: Choice[K]) => {
    setChoice((current) => ({ ...current, [key]: value }));
    // The card slides when the rail opens or closes: follow it frame by frame.
    if (key === "rail") follow(SLIDE_MS + 120);
  };

  // ── going places ──────────────────────────────────────────────────
  const goTo = React.useCallback((next: Open) => {
    dispatch({ type: "go", view: { place: "conversations", open: next } });
    setExpanded((current) => {
      if (!next.session || current.has(next.home)) return current;
      return new Set(current).add(next.home);
    });
    setTabs((current) => {
      const key = keyOf(next);
      if (current.includes(key)) return current;
      return [...current, key].slice(-6);
    });
  }, []);

  const openHomeRow = (home: Home) => {
    goTo(mainOf(home));
    if (home.sessions.length > 0)
      setExpanded((current) => new Set(current).add(home.id));
  };

  const toggle = (home: Home) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(home.id)) next.delete(home.id);
      else next.add(home.id);
      return next;
    });

  const addSession = (home: Home) => {
    const id = `${home.id}-new-${Date.now().toString(36)}`;
    const title = home.kind === "project" ? "New room" : "New session";
    setHomes((current) =>
      current.map((each) =>
        each.id === home.id
          ? {
              ...each,
              sessions: [{ id, title, messages: [] }, ...each.sessions],
            }
          : each,
      ),
    );
    goTo({ home: home.id, session: id });
  };

  const closeTab = (key: string) => {
    const index = tabs.indexOf(key);
    const next = tabs.filter((each) => each !== key);
    setTabs(next);
    // Closing the open tab opens its neighbour.
    if (key === keyOf(open) && place === "conversations" && next.length > 0) {
      const neighbour = openOf(next[Math.min(index, next.length - 1)]);
      dispatch({
        type: "go",
        view: { place: "conversations", open: neighbour },
      });
    }
  };

  React.useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(""), 4000);
    return () => window.clearTimeout(timer);
  }, [note]);

  React.useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.metaKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearching(true);
      }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, []);

  // ── the rail opening and closing ─────────────────────────────────
  // Closing, the rail's mark closes away at once and its card narrows;
  // opening, the card widens first and the mark swells back once it's open.
  React.useEffect(() => {
    if (!choice.rail) {
      setRailShown(false);
      return;
    }
    const timer = window.setTimeout(() => setRailShown(true), SLIDE_MS);
    return () => window.clearTimeout(timer);
  }, [choice.rail]);

  // ── where things are: the marks and the native glass ─────────────
  const shellRef = React.useRef<HTMLDivElement>(null);
  const cardRef = React.useRef<HTMLElement>(null);
  const frameLayerRef = React.useRef<HTMLDivElement>(null);
  const tabLayerRef = React.useRef<HTMLDivElement>(null);
  const railLayerRef = React.useRef<HTMLDivElement>(null);
  const marksRef = React.useRef<{
    rail: MarkGroup;
    places: MarkGroup;
    tab: MarkGroup;
  } | null>(null);
  /** What the glass above holds, from this render (set just before it
   *  returns); sync() adds where it goes. */
  const chromeRef = React.useRef<{
    lead: ChromeItem[];
    tabs: ChromeItem[] | null;
    places: ChromeItem[];
  }>({ lead: [], tabs: null, places: [] });
  /** The card's surface as the page's CSS has it now, and as "#rrggbb": the
   *  theme lands after the first render, so it's read again whenever it
   *  changes. */
  const cardHexRef = React.useRef({ surface: "", hex: "" });
  const stateRef = React.useRef({
    choice,
    place,
    railShown,
    native,
    present,
    searching,
    radius: labWindow.radius,
  });
  stateRef.current = {
    choice,
    place,
    railShown,
    native,
    present,
    searching,
    radius: labWindow.radius,
  };

  const sync = React.useCallback(() => {
    const shell = shellRef.current;
    const card = cardRef.current;
    if (!shell || !card) return;
    const { choice, place, railShown, native, present, searching, radius } =
      stateRef.current;
    const above = choice.direction === "above";
    const measure =
      (origin: DOMRect) =>
      (element: Element | null | undefined): Rect | null => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return null;
        return {
          x: rect.left - origin.left,
          y: rect.top - origin.top,
          w: rect.width,
          h: rect.height,
        };
      };
    const origin = shell.getBoundingClientRect();
    const box = measure(origin);
    const talking = place === "conversations";

    const marks = marksRef.current;
    const railLayer = railLayerRef.current;
    const cardBox = box(card);
    if (marks && railLayer) {
      // On the frame: the chosen place. Above, where you are is set into the
      // glass itself (natively, or by the page's stand-in).
      marks.places.show(
        above ? null : place,
        above ? null : box(shell.querySelector(`[data-place="${place}"]`)),
      );
      // The open tab is the card's surface rising into the lip: from the
      // tab's top down to the card's edge, a pixel past it so the card's lit
      // edge doesn't run across its foot.
      const tab =
        choice.tabs && talking && !above
          ? shell.querySelector('[data-tab][data-selected="true"]')
          : null;
      const tabBox = box(tab);
      marks.tab.show(
        tab?.getAttribute("data-tab") ?? null,
        tabBox && cardBox ? { ...tabBox, h: cardBox.y - tabBox.y + 1 } : null,
      );
      // On the rail's card, in its own coordinates: the mark scrolls with
      // the rows and the card clips it.
      const inRail = measure(railLayer.getBoundingClientRect());
      const row =
        talking && railShown
          ? railLayer.parentElement?.querySelector(
              '[data-rail-row][data-active="true"]',
            )
          : null;
      marks.rail.show(row?.getAttribute("data-home") ?? null, inRail(row));
    }
    if (present && above) {
      // Nothing native beneath the page: the window is clear, the page's
      // ground fills it to its rounded corners, and the glass is above.
      reportFrame({
        card: null,
        floor: "none",
        row: null,
        clip: null,
        sheet: null,
      });
      const bar = BARS[choice.bar];
      const y = bar.centre - bar.h / 2;
      const items = chromeRef.current;
      const tabs = items.tabs ? box(shell.querySelector(".shell-tabs")) : null;
      const pane = box(shell.querySelector(".shell-places"));
      const surface = getComputedStyle(shell)
        .getPropertyValue("--mn-surface")
        .trim();
      if (surface !== cardHexRef.current.surface)
        cardHexRef.current = {
          surface,
          hex: cssHex(shell, "hsl(var(--mn-surface))"),
        };
      reportChrome(
        pane
          ? {
              on: true,
              variant: choice.variant,
              h: bar.h,
              r: bar.r,
              card: cardHexRef.current.hex,
              modal: searching,
              lead: {
                x: bar.left + LIGHTS_SPAN + LEAD_AFTER,
                y,
                items: items.lead,
              },
              tabs:
                items.tabs && tabs
                  ? {
                      x: tabs.x,
                      y,
                      maxW: origin.width - EDGE - tabs.x,
                      items: items.tabs,
                    }
                  : null,
              // 6 from the window's edges: concentric with its corner.
              places: { ...pane, r: radius - EDGE, items: items.places },
            }
          : { on: false },
      );
      return;
    }
    if (present) reportChrome({ on: false });
    if (!native) return;
    reportFrame({
      card: cardBox ? { ...cardBox, r: CARD_RADIUS } : null,
      floor: choice.direction === "black" ? "#000000" : "none",
      row: null,
      clip: null,
      sheet:
        choice.direction === "black"
          ? null
          : {
              x: 0,
              y: 0,
              w: origin.width,
              h: origin.height,
              r: WINDOW_RADIUS,
              ...frameMaterialFor(choice),
            },
    });
  }, []);

  /** Following the card while it slides, frame by frame. */
  const follow = React.useCallback(
    (ms: number) => {
      const until = performance.now() + ms;
      const step = () => {
        sync();
        if (performance.now() < until) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
    [sync],
  );

  // Where you are is solid: the card's own black, or a plate of light ink,
  // whichever the surface beneath it lets read. On the glass frame, the
  // card's black; on the black frame, the plate. On the rail's card, the
  // plate on the card's own tone, the card's black on the lighter one.
  const frameMark = choice.direction === "glass" ? "card" : "plate";
  const railMark = choice.tone === "lighter" ? "card" : "plate";
  React.useLayoutEffect(() => {
    const frameLayer = frameLayerRef.current;
    const tabLayer = tabLayerRef.current;
    const railLayer = railLayerRef.current;
    if (!frameLayer || !tabLayer || !railLayer) return;
    const frame = new MarkEngine(frameLayer);
    const tabs = new MarkEngine(tabLayer);
    const rail = new MarkEngine(railLayer);
    marksRef.current = {
      places: frame.group(
        `shell-mark shell-mark--${frameMark} shell-mark--place`,
      ),
      tab: tabs.group("shell-mark shell-mark--tabcard", "base"),
      rail: rail.group(`shell-mark shell-mark--${railMark} shell-mark--row`),
    };
    sync();
    return () => {
      frame.stop();
      tabs.stop();
      rail.stop();
      marksRef.current = null;
    };
  }, [frameMark, railMark, sync]);

  // The lab's real traffic lights sit on the lip's line; above, where Apple
  // puts them for the chosen bar.
  React.useEffect(() => {
    if (!titled) return;
    if (above) placeLabLights(bar.left, bar.centre);
    else placeLabLights(LIGHTS_LEFT, LIP_LINE);
  }, [titled, above, bar.left, bar.centre]);

  // A press on the glass above is a click on the page's own button for it.
  useChromeActions((action) => {
    shellRef.current
      ?.querySelector<HTMLElement>(`[data-chrome="${action}"]`)
      ?.click();
  });

  // Above, Apple's glass adapts to Reduce Transparency itself: the lab stays.
  const glassOn = above ? present : native;
  React.useEffect(() => {
    if (!glassOn) return;
    startGlass();
    sync();
    // The page is clear where the glass shows.
    const root = document.documentElement.style;
    const body = document.body.style;
    root.setProperty("background", "transparent", "important");
    body.setProperty("background", "transparent", "important");
    return () => {
      stopGlass();
      reportChrome({ on: false });
      root.removeProperty("background");
      body.removeProperty("background");
    };
  }, [glassOn, sync]);

  // Every change of state moves something: report after the page lays out.
  React.useLayoutEffect(() => {
    sync();
  });

  React.useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const observer = new ResizeObserver(() => sync());
    observer.observe(shell);
    const scrolled = () => sync();
    // Anything that slides (the tabs, the rail, the conversation's column,
    // when the rail or the frame changes) is followed to where it stops.
    const sliding = (event: TransitionEvent) => {
      if (["left", "width", "padding-left"].includes(event.propertyName))
        follow(SLIDE_MS + 120);
    };
    window.addEventListener("resize", scrolled);
    shell.addEventListener("scroll", scrolled, true);
    shell.addEventListener("transitionstart", sliding, true);
    shell.addEventListener("transitionend", scrolled, true);
    void document.fonts.ready.then(() => sync());
    // The theme lands on the root after the first render (and changes with
    // the lab's theme switch): the chips' colour follows it.
    const theme = new MutationObserver(() => sync());
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "class", "data-luca-theme"],
    });
    return () => {
      theme.disconnect();
      observer.disconnect();
      window.removeEventListener("resize", scrolled);
      shell.removeEventListener("scroll", scrolled, true);
      shell.removeEventListener("transitionstart", sliding, true);
      shell.removeEventListener("transitionend", scrolled, true);
    };
  }, [sync, follow]);

  // ── what the lip says ─────────────────────────────────────────────
  const placeTitle =
    place === "conversations" ? null : PLACE_PAGES[place].title;
  const railWidth = choice.rail ? RAIL_WIDTH : 0;
  // Above, the conversation's column starts right of the places pane and the
  // rail's card, each 6 from the next.
  const cardLeft = above
    ? EDGE + PANE + EDGE + (choice.rail ? RAIL_WIDTH + EDGE : 0)
    : PLACES_WIDTH + (choice.rail ? RAIL_WIDTH + CARD_GAP : 0);
  const leadX = bar.left + LIGHTS_SPAN + LEAD_AFTER;

  const tabTitle = (key: string) => {
    const { home, session } = openOf(key);
    const owner = homes.find((each) => each.id === home);
    if (!owner) return key;
    return (
      owner.sessions.find((each) => each.id === session)?.title ?? owner.name
    );
  };

  const railLabel = choice.rail
    ? "Close the conversations rail"
    : "Open the conversations rail";
  chromeRef.current = {
    lead: [
      {
        id: "toggle",
        kind: "button",
        symbol: "sidebar.leading",
        label: railLabel,
      },
      {
        id: "back",
        kind: "button",
        symbol: "chevron.backward",
        label: "Back",
        disabled: nav.index === 0,
      },
      {
        id: "forward",
        kind: "button",
        symbol: "chevron.forward",
        label: "Forward",
        disabled: nav.index >= nav.stack.length - 1,
      },
    ],
    // With every tab closed there is no tabs piece: the title shows instead.
    tabs:
      choice.tabs && tabs.length > 0
        ? tabs.map(
            (key): ChromeItem => ({
              id: `tab:${key}`,
              kind: "tab",
              label: tabTitle(key),
              title: tabTitle(key),
              selected: place === "conversations" && key === keyOf(open),
            }),
          )
        : null,
    places: [
      {
        id: "new",
        kind: "button",
        symbol: "square.and.pencil",
        label: "New conversation",
      },
      {
        id: "search",
        kind: "button",
        symbol: "magnifyingglass",
        label: "Search",
        title: "Search  ⌘K",
      },
      { id: "gap", kind: "gap", label: "" },
      ...PLACES.map(
        ({ id, label, symbol }): ChromeItem => ({
          id: `place:${id}`,
          kind: "place",
          symbol,
          label,
          selected: place === id,
        }),
      ),
      { id: "flex", kind: "flex", label: "" },
      {
        id: "place:settings",
        kind: "place",
        symbol: "gearshape",
        label: "Settings",
        selected: place === "settings",
      },
      {
        id: "avatar",
        kind: "avatar",
        label: `${OWNER}, personal workspace`,
        title: OWNER[0],
      },
    ],
  };

  return (
    <div
      className="shell"
      data-bar={above ? choice.bar : undefined}
      data-chrome-native={chromeNative ? "true" : undefined}
      data-direction={choice.direction}
      data-key={labWindow.key ? undefined : "false"}
      data-material={frameMaterialFor(choice).style}
      data-native={native ? "true" : undefined}
      data-rail={choice.rail ? "open" : "closed"}
      data-tabs={choice.tabs ? "on" : undefined}
      data-tone={choice.tone}
      data-veil={choice.veil}
      ref={shellRef}
      style={
        {
          "--card-left": `${cardLeft}px`,
          "--rail-now": `${railWidth}px`,
          "--band": `${bar.band}px`,
          "--band-centre": `${bar.centre}px`,
          "--lights-left": `${bar.left}px`,
          "--piece-y": `${bar.centre - bar.h / 2}px`,
          "--piece-h": `${bar.h}px`,
          "--piece-r": `${bar.r}px`,
          // The pane and the rail start 6 below the top pieces.
          "--pane-top": `${bar.centre + bar.h / 2 + EDGE}px`,
          "--lead-x": `${leadX}px`,
          "--lead-right": `${leadX + LEAD_WIDTH}px`,
          "--window-radius": `${labWindow.radius}px`,
        } as React.CSSProperties
      }
    >
      {native ? null : <div aria-hidden="true" className="shell-desktop" />}
      {native ? null : <div aria-hidden="true" className="shell-frame" />}
      <div aria-hidden="true" className="shell-veil" />
      {above ? <div aria-hidden="true" className="shell-edge" /> : null}
      <div aria-hidden="true" className="shell-marks" ref={frameLayerRef} />
      <div aria-hidden="true" className="shell-tabcards" ref={tabLayerRef} />

      {/* biome-ignore lint/a11y/noStaticElementInteractions: the lip is the window's title bar; pressing its empty part moves the window, as a title bar does. */}
      <header
        className="shell-lip"
        onMouseDown={(event) => {
          if (!(event.target as Element).closest("button")) dragWindow();
        }}
      >
        {titled ? null : (
          <span aria-hidden="true" className="shell-lights">
            <span />
            <span />
            <span />
          </span>
        )}
        <LipButton
          chrome="toggle"
          className="shell-toggle"
          label={railLabel}
          onClick={() => choose("rail", !choice.rail)}
        >
          <PanelLeft />
        </LipButton>
        <div className="shell-lip-card">
          <div className="shell-history">
            <LipButton
              chrome="back"
              disabled={nav.index === 0}
              label="Back"
              onClick={() => dispatch({ type: "back" })}
            >
              <ChevronLeft />
            </LipButton>
            <LipButton
              chrome="forward"
              disabled={nav.index >= nav.stack.length - 1}
              label="Forward"
              onClick={() => dispatch({ type: "forward" })}
            >
              <ChevronRight />
            </LipButton>
          </div>
          {choice.tabs && tabs.length > 0 ? (
            <div
              aria-label="Open conversations"
              className="shell-tabs"
              role="tablist"
            >
              {tabs.map((key) => {
                const selected =
                  place === "conversations" && key === keyOf(open);
                return (
                  <div
                    className="shell-tab"
                    data-selected={selected ? "true" : undefined}
                    data-tab={key}
                    key={key}
                  >
                    <button
                      aria-selected={selected}
                      className="shell-tab-open"
                      data-chrome={`tab:${key}`}
                      onClick={() => goTo(openOf(key))}
                      role="tab"
                      type="button"
                    >
                      {tabTitle(key)}
                    </button>
                    <button
                      aria-label={`Close ${tabTitle(key)}`}
                      className="shell-tab-close"
                      data-chrome={`close:${key}`}
                      onClick={() => closeTab(key)}
                      type="button"
                    >
                      <X />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <h1 className="shell-title">
              {placeTitle ??
                (openSession ? (
                  <>
                    <span className="shell-title-home">{openHome.name}</span>
                    <span aria-hidden="true" className="shell-title-rule">
                      /
                    </span>
                    <span>{openSession.title}</span>
                  </>
                ) : (
                  <span>{openHome.name}</span>
                ))}
            </h1>
          )}
        </div>
      </header>

      <nav aria-label="Places" className="shell-places">
        <div className="shell-places-group">
          <PlaceButton
            chrome="new"
            label="New conversation"
            onClick={() => addSession(homes[0])}
          >
            <SquarePen />
          </PlaceButton>
          <PlaceButton
            chrome="search"
            label="Search  ⌘K"
            onClick={() => setSearching(true)}
          >
            <Search />
          </PlaceButton>
        </div>
        <div className="shell-places-group">
          {PLACES.map(({ id, label, icon: Icon }) => (
            <PlaceButton
              chrome={`place:${id}`}
              current={place === id}
              key={id}
              label={label}
              onClick={() =>
                dispatch({ type: "go", view: { place: id, open } })
              }
              place={id}
            >
              <Icon />
            </PlaceButton>
          ))}
        </div>
        <div className="shell-places-group shell-places-end">
          <PlaceButton
            chrome="place:settings"
            current={place === "settings"}
            label="Settings"
            onClick={() =>
              dispatch({ type: "go", view: { place: "settings", open } })
            }
            place="settings"
          >
            <Settings />
          </PlaceButton>
          <span
            aria-label={`${OWNER}, personal workspace`}
            className="shell-avatar"
            role="img"
          >
            {OWNER[0]}
          </span>
        </div>
      </nav>

      <nav
        aria-label="Conversations"
        className="shell-rail"
        data-luca-card
        inert={choice.rail ? undefined : true}
      >
        <div className="shell-rail-scroll">
          <div className="shell-rail-content">
            <div
              aria-hidden="true"
              className="shell-rail-marks"
              ref={railLayerRef}
            />
            <Rail
              active={place === "conversations" ? open : null}
              expanded={expanded}
              homes={homes}
              onAdd={addSession}
              onNote={setNote}
              onOpen={openHomeRow}
              onSession={(home, session) => goTo({ home: home.id, session })}
              onToggle={toggle}
            />
          </div>
        </div>
      </nav>

      <main
        aria-label="Conversation"
        className="shell-card"
        // Above, the conversation is the window's ground, not a card on it.
        data-luca-card={above ? undefined : ""}
        ref={cardRef}
      >
        {place === "conversations" ? (
          <Conversation
            key={keyOf(open)}
            messages={openSession?.messages ?? openHome.main ?? []}
            to={openHome.name}
          />
        ) : (
          <PlacePage place={place} />
        )}
        <LabPanel
          choice={choice}
          choose={choose}
          native={native}
          note={note}
          present={present}
        />
      </main>

      {searching ? (
        <SearchPalette
          homes={homes}
          onClose={() => setSearching(false)}
          onOpen={(next) => {
            setSearching(false);
            goTo(next);
          }}
        />
      ) : null}
    </div>
  );
}

// ── the lip and the places ──────────────────────────────────────────

function LipButton({
  children,
  chrome,
  className,
  disabled,
  label,
  onClick,
}: {
  children: React.ReactNode;
  /** The id of its twin in the glass above, whose press clicks this. */
  chrome: string;
  className?: string;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className={`shell-lip-button ${className ?? ""}`}
      data-chrome={chrome}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

function PlaceButton({
  children,
  chrome,
  current,
  label,
  onClick,
  place,
}: {
  children: React.ReactNode;
  /** The id of its twin in the glass above, whose press clicks this. */
  chrome: string;
  current?: boolean;
  label: string;
  onClick: () => void;
  place?: PlaceId;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-current={current ? "page" : undefined}
          aria-label={label.replace(/\s+⌘K$/, "")}
          className="shell-place"
          data-chrome={chrome}
          data-current={current ? "true" : undefined}
          data-place={place}
          onClick={onClick}
          type="button"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

// ── the conversations rail ──────────────────────────────────────────

function Rail({
  active,
  expanded,
  homes,
  onAdd,
  onNote,
  onOpen,
  onSession,
  onToggle,
}: {
  active: Open | null;
  expanded: Set<string>;
  homes: Home[];
  onAdd: (home: Home) => void;
  onNote: (note: string) => void;
  onOpen: (home: Home) => void;
  onSession: (home: Home, session: string) => void;
  onToggle: (home: Home) => void;
}) {
  const row = (home: Home) => (
    <HomeRow
      active={active?.home === home.id}
      current={active?.home === home.id ? active.session : null}
      expanded={expanded.has(home.id)}
      home={home}
      key={home.id}
      onAdd={onAdd}
      onOpen={onOpen}
      onSession={onSession}
      onToggle={onToggle}
    />
  );
  const luca = homes.find((home) => home.kind === "luca");
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: arrow keys move between the rail's rows, as the app's rail does (AgentRail.tsx).
    <div className="shell-rail-list" onKeyDown={railKeys}>
      {luca ? row(luca) : null}
      {SECTIONS.map((section) => (
        <section
          aria-label={section.title}
          className="shell-section"
          key={section.kind}
        >
          <div className="shell-section-head type-eyebrow">
            <span>{section.title}</span>
            <button
              aria-label={section.add}
              className="shell-add"
              onClick={() =>
                onNote(`${section.add}: sample only, nothing is created.`)
              }
              title={section.add}
              type="button"
            >
              <Plus />
            </button>
          </div>
          {homes.filter((home) => home.kind === section.kind).map(row)}
        </section>
      ))}
    </div>
  );
}

/** Up and down between visible rows; right opens a home or steps into it;
 *  left closes it or steps back out to it. */
function railKeys(event: React.KeyboardEvent<HTMLDivElement>) {
  const rows = [
    ...event.currentTarget.querySelectorAll<HTMLElement>("[data-rail-focus]"),
  ];
  const index = rows.indexOf(document.activeElement as HTMLElement);
  if (index < 0) return;
  const focused = rows[index];
  const move = (to: number) => {
    event.preventDefault();
    rows[Math.max(0, Math.min(rows.length - 1, to))]?.focus();
  };
  if (event.key === "ArrowDown") move(index + 1);
  else if (event.key === "ArrowUp") move(index - 1);
  else if (event.key === "ArrowRight" && focused.dataset.railFocus === "home") {
    const chevron =
      focused.parentElement?.querySelector<HTMLElement>("[data-chevron]");
    if (chevron?.getAttribute("aria-expanded") === "false") {
      event.preventDefault();
      chevron.click();
    } else move(index + 1);
  } else if (event.key === "ArrowLeft") {
    if (focused.dataset.railFocus === "session") {
      event.preventDefault();
      focused
        .closest("[data-home-group]")
        ?.querySelector<HTMLElement>('[data-rail-focus="home"]')
        ?.focus();
      return;
    }
    const chevron =
      focused.parentElement?.querySelector<HTMLElement>("[data-chevron]");
    if (chevron?.getAttribute("aria-expanded") === "true") {
      event.preventDefault();
      chevron.click();
    }
  }
}

function HomeRow({
  active,
  current,
  expanded,
  home,
  onAdd,
  onOpen,
  onSession,
  onToggle,
}: {
  active: boolean;
  current: string | null;
  expanded: boolean;
  home: Home;
  onAdd: (home: Home) => void;
  onOpen: (home: Home) => void;
  onSession: (home: Home, session: string) => void;
  onToggle: (home: Home) => void;
}) {
  const nested = home.sessions.length > 0;
  const signal = home.working ? (
    <span className="shell-working">working</span>
  ) : home.unread ? (
    <span
      aria-label="Unread"
      className="shell-dot luca-signal-dot"
      role="img"
    />
  ) : null;
  return (
    <div className="shell-home" data-home-group={home.id}>
      <div
        className="shell-row"
        data-active={active ? "true" : undefined}
        data-home={home.id}
        data-rail-row
      >
        <button
          aria-current={active && current === null ? "page" : undefined}
          className="shell-row-hit"
          data-rail-focus="home"
          onClick={() => onOpen(home)}
          type="button"
        >
          <span className="sr-only">{home.name}</span>
        </button>
        <span aria-hidden="true" className="shell-row-name">
          {home.name}
        </span>
        {nested ? (
          <button
            aria-expanded={expanded}
            aria-label={`${expanded ? "Hide" : "Show"} ${home.name}'s sessions`}
            className="shell-chevron"
            data-chevron
            onClick={() => onToggle(home)}
            tabIndex={-1}
            type="button"
          >
            <ChevronRight />
          </button>
        ) : null}
        <span className="shell-row-end">
          {signal ? <span className="shell-signal">{signal}</span> : null}
          <button
            aria-label={addLabel(home)}
            className="shell-add shell-row-add"
            onClick={() => onAdd(home)}
            title={addLabel(home)}
            type="button"
          >
            <Plus />
          </button>
        </span>
      </div>
      {nested && expanded ? (
        <fieldset
          aria-label={`${home.name}'s sessions`}
          className="shell-sessions"
        >
          {home.sessions.map((session) => {
            const open = active && current === session.id;
            return (
              <button
                aria-current={open ? "page" : undefined}
                className="shell-session"
                data-current={open ? "true" : undefined}
                data-rail-focus="session"
                key={session.id}
                onClick={() => onSession(home, session.id)}
                title={session.title}
                type="button"
              >
                <span className="shell-session-title">{session.title}</span>
                {session.working ? (
                  <span className="shell-working">working</span>
                ) : session.unread ? (
                  <span
                    aria-label="Unread"
                    className="shell-dot luca-signal-dot"
                    role="img"
                  />
                ) : null}
              </button>
            );
          })}
        </fieldset>
      ) : null}
    </div>
  );
}

// ── the card ────────────────────────────────────────────────────────

const messageKey = (message: Message) =>
  `${message.from}-${message.at}-${message.text.slice(0, 32)}`;

function Conversation({ messages, to }: { messages: Message[]; to: string }) {
  return (
    <div className="shell-conversation">
      <div className="shell-reading">
        {messages.length > 0 ? (
          <div className="shell-day">
            <span className="type-eyebrow">Today</span>
          </div>
        ) : (
          <p className="shell-empty">
            A new session with {to}. Say what it's for.
          </p>
        )}
        {messages.map((message) =>
          message.from === OWNER ? (
            <div className="shell-mine" key={messageKey(message)}>
              <p>{message.text}</p>
            </div>
          ) : (
            <article className="shell-message" key={messageKey(message)}>
              <header>
                <span className="shell-author">{message.from}</span>
                <time>{message.at}</time>
              </header>
              <p>{message.text}</p>
            </article>
          ),
        )}
      </div>
      <form
        className="shell-composer"
        onSubmit={(event) => event.preventDefault()}
      >
        <button aria-label="Add" className="shell-composer-add" type="button">
          <Plus />
        </button>
        <input aria-label={`Message ${to}`} placeholder={`Message ${to}…`} />
        <button aria-label="Send" className="shell-send" type="submit">
          <ArrowUp />
        </button>
      </form>
    </div>
  );
}

function PlacePage({ place }: { place: Exclude<PlaceId, "conversations"> }) {
  const page = PLACE_PAGES[place];
  return (
    <div className="shell-page">
      {page.groups.map((group) => (
        <section
          aria-label={group.label}
          className="shell-page-group"
          key={group.label}
        >
          <h2 className="type-eyebrow">{group.label}</h2>
          <ul>
            {group.rows.map((row) => (
              <li key={row.title}>
                <span className="shell-page-title">{row.title}</span>
                <span className="shell-page-detail">{row.detail}</span>
                {row.note ? (
                  <span className="shell-page-note">{row.note}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ── search ──────────────────────────────────────────────────────────

function SearchPalette({
  homes,
  onClose,
  onOpen,
}: {
  homes: Home[];
  onClose: () => void;
  onOpen: (open: Open) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [index, setIndex] = React.useState(0);
  const all = homes.flatMap((home) => [
    ...(home.main
      ? [{ label: home.name, open: { home: home.id, session: null } }]
      : []),
    ...home.sessions.map((session) => ({
      label: `${home.name} / ${session.title}`,
      open: { home: home.id, session: session.id },
    })),
  ]);
  const found = all
    .filter((item) =>
      item.label.toLowerCase().includes(query.trim().toLowerCase()),
    )
    .slice(0, 8);
  const chosen = Math.min(index, Math.max(found.length - 1, 0));
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: the scrim is for the pointer; Escape closes the palette from its field.
    <div className="shell-search-scrim" onClick={onClose}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: only stops the scrim's click; keys go to the field inside. */}
      <div
        aria-label="Search everything"
        className="shell-search"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <input
          aria-label="Search everything"
          // biome-ignore lint/a11y/noAutofocus: the palette exists to be typed into.
          autoFocus
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setIndex(Math.min(chosen + 1, found.length - 1));
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setIndex(Math.max(chosen - 1, 0));
            }
            if (event.key === "Enter" && found[chosen])
              onOpen(found[chosen].open);
          }}
          placeholder="Search everything"
          value={query}
        />
        <ul>
          {found.map((item, at) => (
            <li key={item.label}>
              <button
                data-chosen={at === chosen ? "true" : undefined}
                onClick={() => onOpen(item.open)}
                onMouseEnter={() => setIndex(at)}
                type="button"
              >
                {item.label}
              </button>
            </li>
          ))}
          {found.length === 0 ? (
            <li className="shell-search-none">Nothing by that name.</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}

// ── the lab's own controls ──────────────────────────────────────────

function LabPanel({
  choice,
  choose,
  native,
  note,
  present,
}: {
  choice: Choice;
  choose: <K extends keyof Choice>(key: K, value: Choice[K]) => void;
  native: boolean;
  note: string;
  /** Whether the glass lab is around the page at all. */
  present: boolean;
}) {
  if (!choice.panel) {
    return (
      <button
        className="shell-lab-pill"
        onClick={() => choose("panel", true)}
        type="button"
      >
        Lab
      </button>
    );
  }
  const glass = choice.direction === "glass";
  const above = choice.direction === "above";
  return (
    <aside aria-label="Shell study controls" className="shell-lab">
      <div className="shell-lab-head">
        <span className="type-eyebrow">Shell study</span>
        <button
          aria-label="Hide the lab's controls"
          className="shell-lab-hide"
          onClick={() => choose("panel", false)}
          type="button"
        >
          <X />
        </button>
      </div>
      <Segment
        label="Frame"
        onChange={(value) => choose("direction", value)}
        options={[
          ["black", "Black"],
          ["glass", "Glass"],
          ["above", "Above"],
        ]}
        value={choice.direction}
      />
      {above ? (
        <>
          <Segment
            label="Bar"
            onChange={(value) => choose("bar", value)}
            options={[
              ["compact", "Compact"],
              ["titlebar", "Title bar"],
            ]}
            value={choice.bar}
          />
          <Segment
            label="Glass"
            onChange={(value) => choose("variant", value)}
            options={[
              ["regular", "Regular"],
              ["clear", "Clear"],
            ]}
            value={choice.variant}
          />
        </>
      ) : null}
      <Segment
        label="Rail"
        onChange={(value) => choose("rail", value === "open")}
        options={[
          ["open", "Open"],
          ["closed", "Closed"],
        ]}
        value={choice.rail ? "open" : "closed"}
      />
      <Segment
        label="Rail tone"
        onChange={(value) => choose("tone", value)}
        options={[
          ["same", "Same"],
          ["lighter", "Lighter"],
        ]}
        value={choice.tone}
      />
      <Segment
        label="Tabs"
        onChange={(value) => choose("tabs", value === "on")}
        options={[
          ["off", "Off"],
          ["on", "On"],
        ]}
        value={choice.tabs ? "on" : "off"}
      />
      {glass ? (
        <>
          <label className="shell-lab-row">
            <span>Material</span>
            <select
              className="shell-select"
              onChange={(event) => choose("material", event.target.value)}
              value={choice.material}
            >
              {MATERIALS.map((group) => (
                <optgroup key={group.group} label={group.group}>
                  {group.items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          {frameMaterialFor(choice).style === "frosted" ? (
            <Segment
              label="Look"
              onChange={(value) => choose("held", value === "held")}
              options={[
                ["held", "In use"],
                ["follows", "Follows"],
              ]}
              value={choice.held ? "held" : "follows"}
            />
          ) : null}
          <Segment
            label="Veil"
            onChange={(value) => choose("veil", value)}
            options={[
              ["none", "None"],
              ["soft", "Soft"],
              ["deep", "Deep"],
            ]}
            value={choice.veil}
          />
        </>
      ) : null}
      <p className="shell-lab-note" role="status">
        {note ||
          (above
            ? present
              ? "The conversation is the window; Apple's Liquid Glass floats above it in three pieces, their symbols and words inside the glass."
              : "A browser can't draw Apple's glass: these pieces are our stand-in. Judge them in the glass lab."
            : native
              ? glass
                ? frameMaterialFor(choice).style === "frosted"
                  ? "The frame is Apple's frosted material; the rail and the conversation are cards on it."
                  : "The frame is Apple's Liquid Glass; the rail and the conversation are cards on it."
                : "The frame is black; the rail and the conversation are cards on it."
              : "A browser can't draw Apple's glass: this is our stand-in. Judge the glass in the glass lab.")}
      </p>
    </aside>
  );
}

function Segment<T extends string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: T) => void;
  options: [T, string][];
  value: T;
}) {
  return (
    <div className="shell-lab-row">
      <span>{label}</span>
      {/* biome-ignore lint/a11y/useSemanticElements: a pressed-button group, not a form field. */}
      <div aria-label={label} className="shell-segment" role="group">
        {options.map(([option, text]) => (
          <button
            aria-pressed={option === value}
            key={option}
            onClick={() => onChange(option)}
            type="button"
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
