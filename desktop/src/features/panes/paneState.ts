import * as React from "react";

import { resolveEnabled, useFeatureSnapshot } from "@/shared/features";

/**
 * Module state for the pane deck.
 *
 * The deck lives inside the right auxiliary drawer, and that drawer remounts
 * whenever the routed tree around it changes (channel → home, panel → panel).
 * Keeping "is the deck open, and how tall is the widget" in React state would
 * therefore close the deck every time the user changed rooms, so it lives here
 * — module-level, subscribed to with `useSyncExternalStore`, and reset on a
 * community switch like every other community-scoped singleton.
 *
 * Session-local by design: nothing here is persisted to localStorage in v1.
 */

/**
 * The preview-feature id that gates the entire deck.
 *
 * NOTE ON THE READ PATH: `useFeatureEnabled` fails OPEN for ids that are not in
 * `preview-features.json` — an unknown id resolves to `true` so a stale
 * `<FeatureGate>` can never hide shipped UI. That default is exactly wrong for
 * a dev-only surface, and the manifest lives outside this feature's owned
 * paths, so the deck reads the same override store directly and resolves it
 * against an explicit `false`. Same store, same single-name lookup, same
 * cross-window reactivity — but absent an override the answer is "off", which
 * is what keeps this invisible for real users.
 */
export const WIDGET_PANE_FEATURE_ID = "glass-widget-sample";

/** Widget region bounds, in CSS px. */
export const WIDGET_MIN_HEIGHT_PX = 170;
export const WIDGET_MAX_HEIGHT_PX = 640;
/** The drawer's own content never gets squeezed below this. */
export const DRAWER_MIN_HEIGHT_PX = 170;
export const WIDGET_DEFAULT_HEIGHT_PX = 260;
/** One arrow-key press on the lip. */
export const LIP_STEP_PX = 16;
/** Interactive height of the lip: the hairline plus 4px of grab either side. */
export const LIP_HEIGHT_PX = 9;
/**
 * `transitionend` never fires when the collapse has no duration (reduced
 * motion, a hidden tab). The widget content still has to come down, so the
 * deck arms this fallback alongside the listener.
 */
export const DECK_COLLAPSE_FALLBACK_MS = 300;

type PaneState = {
  /**
   * The element inside the widget region that the widget's DOM is parked in
   * while docked. Registered by the deck; the floating layer moves the widget
   * container between this and itself.
   */
  dockedSlot: HTMLElement | null;
  /**
   * Whether the widget region is present in the DOM. Stays true through the
   * whole collapse so the closing animation has something to animate; the deck
   * clears it once the transition has actually ended.
   */
  isDeckMounted: boolean;
  /** The intent — what the user asked for. Drives the open/closed geometry. */
  isDeckOpen: boolean;
  /**
   * Whether the widget is currently floating over the app instead of sitting
   * in the deck. The deck stays open underneath while it is, so there is
   * always a slot to dock back into.
   */
  isLifted: boolean;
  widgetHeightPx: number;
};

const INITIAL_STATE: PaneState = {
  dockedSlot: null,
  isDeckMounted: false,
  isDeckOpen: false,
  isLifted: false,
  widgetHeightPx: WIDGET_DEFAULT_HEIGHT_PX,
};

let state: PaneState = INITIAL_STATE;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function setState(next: Partial<PaneState>): void {
  const merged = { ...state, ...next };
  if (
    merged.dockedSlot === state.dockedSlot &&
    merged.isDeckMounted === state.isDeckMounted &&
    merged.isDeckOpen === state.isDeckOpen &&
    merged.isLifted === state.isLifted &&
    merged.widgetHeightPx === state.widgetHeightPx
  ) {
    return;
  }
  state = merged;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): PaneState {
  return state;
}

/** Clamp a widget height to the fixed bounds. */
export function clampWidgetHeight(px: number): number {
  return Math.min(WIDGET_MAX_HEIGHT_PX, Math.max(WIDGET_MIN_HEIGHT_PX, px));
}

/**
 * Clamp against the deck's live height as well, so growing the widget can
 * never starve the drawer content above it.
 */
export function clampWidgetHeightWithin(
  px: number,
  deckHeightPx: number,
): number {
  const roomForWidget = deckHeightPx - LIP_HEIGHT_PX - DRAWER_MIN_HEIGHT_PX;
  const ceiling = Math.min(WIDGET_MAX_HEIGHT_PX, roomForWidget);
  // A deck shorter than both minimums cannot honour the floor and the ceiling
  // at once; the floor wins, because a widget below it is not usable at all.
  if (ceiling <= WIDGET_MIN_HEIGHT_PX) return WIDGET_MIN_HEIGHT_PX;
  return Math.min(ceiling, Math.max(WIDGET_MIN_HEIGHT_PX, px));
}

export function usePaneState(): PaneState {
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function setDeckOpen(open: boolean): void {
  setState(
    open
      ? { isDeckMounted: true, isDeckOpen: true }
      : // Closing the deck brings a floating widget home first: the pane was
        // lifted OUT of this deck, and leaving it hovering over a drawer that
        // no longer has a slot for it would strand it.
        { isDeckOpen: false, isLifted: false },
  );
}

export function setLifted(lifted: boolean): void {
  setState({ isLifted: lifted });
}

export function toggleDeck(): void {
  setDeckOpen(!state.isDeckOpen);
}

/**
 * Called by the deck once the collapse transition has ended. Guarded on the
 * intent so a re-open that lands mid-collapse is not undone by the trailing
 * `transitionend` of the collapse it interrupted.
 */
export function finishDeckCollapse(): void {
  if (state.isDeckOpen) return;
  setState({ isDeckMounted: false });
}

export function setWidgetHeightPx(px: number): void {
  setState({ widgetHeightPx: clampWidgetHeight(px) });
}

/** The deck registers the element the docked widget parks in. */
export function setDockedSlot(element: HTMLElement | null): void {
  setState({ dockedSlot: element });
}

/** Community-scoped reset — see `resetCommunityState`. */
export function resetPaneState(): void {
  state = INITIAL_STATE;
  emit();
}

/** Whether the dev-only widget surface is switched on for this user. */
export function useWidgetPaneEnabled(): boolean {
  const overrides = useFeatureSnapshot();
  return resolveEnabled(WIDGET_PANE_FEATURE_ID, overrides, false);
}

/**
 * Whether the deck is currently a two-card stack. False means the drawer is
 * the single card it has always been, and the deck costs nothing.
 */
export function useDeckActive(): boolean {
  const enabled = useWidgetPaneEnabled();
  const { isDeckMounted } = usePaneState();
  return enabled && isDeckMounted;
}
