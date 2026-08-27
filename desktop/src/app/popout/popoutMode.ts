/**
 * Which window this document is.
 *
 * The pop-out chat window loads the SAME bundle as the main window —
 * `index.html?window=popout&channel=<id>#/channels/<id>` — so a handful of
 * places have to know they are running inside one: the bootstrap picks a
 * different root, the root route mounts a different shell, and the theme layer
 * keeps its hands off the native window material.
 *
 * The answer never changes for the life of a document, so it is read from the
 * URL once and cached. Nothing here touches Tauri: a pop-out is identified by
 * how it was loaded, which also lets Playwright boot the shell as a plain page.
 */

const POPOUT_WINDOW_PARAM = "window";
const POPOUT_WINDOW_VALUE = "popout";
const POPOUT_CHANNEL_PARAM = "channel";

/**
 * The event a pop-out emits to the main window when a conversation has been
 * read inside it.
 *
 * Read markers are NIP-RS events published by the single ReadStateManager the
 * main window mounts. A pop-out publishing its own would race that one for the
 * same slot, so it asks instead.
 */
export const POPOUT_READ_EVENT = "luca://popout-read";

/** One conversation-read request travelling from a pop-out to the main window. */
export type PopoutReadRequest = {
  channelId: string;
  /** ISO timestamp to advance the marker to, or null for "now". */
  readAt: string | null;
  topLevelOnly: boolean;
};

/**
 * The event behind "Open in Luca": the pop-out asks the main window to come
 * forward on this conversation.
 *
 * The main window raises itself and navigates — a window takes its own focus,
 * and the conversation route is the main shell's business.
 */
export const POPOUT_OPEN_IN_MAIN_EVENT = "luca://popout-open-in-main";

/** One "show me this in the full app" request from a pop-out. */
export type PopoutOpenInMainRequest = {
  channelId: string;
};

/**
 * The once-event a pop-out emits after React commits its first frame.
 *
 * Scoped by window label so two pop-outs opening at once cannot reveal each
 * other early. The Rust side builds the same string.
 */
export function popoutRenderReadyEvent(label: string): string {
  return `popout-render-ready:${label}`;
}

type PopoutMode = {
  channelId: string | null;
  isPopout: boolean;
};

const NOT_A_POPOUT: PopoutMode = { channelId: null, isPopout: false };

let cachedMode: PopoutMode | null = null;

function readPopoutMode(): PopoutMode {
  if (cachedMode) {
    return cachedMode;
  }
  if (typeof window === "undefined") {
    return NOT_A_POPOUT;
  }

  let mode = NOT_A_POPOUT;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get(POPOUT_WINDOW_PARAM) === POPOUT_WINDOW_VALUE) {
      mode = {
        channelId: params.get(POPOUT_CHANNEL_PARAM) || null,
        isPopout: true,
      };
    }
  } catch {
    // A URL we cannot parse is not a pop-out. The main shell is the safe
    // answer: it is the one that can navigate anywhere.
  }

  cachedMode = mode;
  return mode;
}

/** Whether this document is a pop-out chat window. */
export function isPopoutWindow(): boolean {
  return readPopoutMode().isPopout;
}

/**
 * The conversation this pop-out was opened for, or null in the main window.
 *
 * The route hash carries the same id and is what actually renders the
 * conversation; this is the window's own identity, used for chrome (title) and
 * for the read delegation.
 */
export function popoutChannelId(): string | null {
  return readPopoutMode().channelId;
}
