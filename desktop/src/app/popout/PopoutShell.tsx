import { isTauri } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useLocation } from "@tanstack/react-router";
import { ExternalLink, Minus, Pin, X } from "lucide-react";
import * as React from "react";

import { PopoutConversationPicker } from "@/app/popout/PopoutConversationPicker";
import { POPOUT_OPEN_IN_MAIN_EVENT } from "@/app/popout/popoutMode";
import { usePopoutConversations } from "@/app/popout/usePopoutConversations";
import { useWebviewZoomShortcuts } from "@/app/useWebviewZoomShortcuts";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { ResidentHarnessProvider } from "@/features/agents/ResidentHarnessContext";
import { ArtifactCanvasProvider } from "@/features/artifacts/ArtifactCanvasProvider";
import { useWebviewScrollBoundaryLock } from "@/shared/hooks/useWebviewScrollBoundaryLock";
import {
  chromeCssVarDefaults,
  chromeCssVars,
} from "@/shared/layout/chromeLayout";
import { MainInsetProvider } from "@/shared/layout/MainInsetContext";
import { RightCardsSlotProvider } from "@/shared/layout/RightCardsSlot";
import { performTitleBarDoubleClickAction } from "@/shared/lib/titleBarActions";
import { Button } from "@/shared/ui/button";

const INTERACTIVE_SELECTOR =
  'button, a, input, textarea, select, label, summary, [role="button"], [role="link"], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

/**
 * What the conversation owes the bar above it.
 *
 * In the main window this variable carries the height of the OVERLAID channel
 * header, measured, because the timeline scrolls underneath it. A pop-out has
 * no overlay: the bar sits in flow, so the only thing the timeline owes it is
 * air. 12px of it — the seed AND the steady-state value, so nothing jumps on
 * first paint. (The main window's 5.75rem seed here is 92px of clearance for
 * chrome this window does not render.)
 */
const POPOUT_CONTENT_TOP_PADDING = "12px";

const popoutChromeCssVars = {
  ...chromeCssVarDefaults,
  [chromeCssVars.channelContentTopPadding]: POPOUT_CONTENT_TOP_PADDING,
} as const;

/** How long the "could not reach the main window" line stays in the bar. */
const DOCK_NOTICE_MS = 5_000;

function channelIdFromPathname(pathname: string): string | null {
  const match = /^\/channels\/([^/]+)$/.exec(pathname);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function isStripDragEvent(event: MouseEvent | PointerEvent): boolean {
  const target = event.target;
  return !(
    target instanceof Element && target.closest(INTERACTIVE_SELECTOR) !== null
  );
}

/**
 * Keep this window above other apps for as long as the owner wants it there.
 *
 * Default off: a chat that will not get out of the way is a chat you close.
 */
function usePopoutPin(): { isPinned: boolean; togglePin: () => void } {
  const [isPinned, setIsPinned] = React.useState(false);

  const togglePin = React.useCallback(() => {
    const next = !isPinned;
    setIsPinned(next);
    if (!isTauri()) {
      return;
    }
    void getCurrentWindow()
      .setAlwaysOnTop(next)
      .catch((error) => {
        console.warn("pop-out pin unavailable", error);
        setIsPinned((current) => (current === next ? !next : current));
      });
  }, [isPinned]);

  return { isPinned, togglePin };
}

/**
 * Make the bar behave like a title bar: press-and-move drags the window,
 * double-click runs whatever macOS is set to do on a title-bar double-click.
 *
 * The listeners are attached to the element rather than declared as JSX props
 * because the bar is not a control — it has no role, takes no focus, and
 * answers no keyboard. Same construction as the main window's drag region.
 * Every control the bar carries, the conversation picker included, is a real
 * button, and {@link isStripDragEvent} excludes it from the drag.
 */
function useWindowDragStrip(stripRef: React.RefObject<HTMLElement | null>) {
  React.useEffect(() => {
    const strip = stripRef.current;
    if (!strip || !isTauri()) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (event.button !== 0 || event.detail > 1 || !isStripDragEvent(event)) {
        return;
      }
      void getCurrentWindow().startDragging();
    }

    function handleDoubleClick(event: MouseEvent) {
      if (event.button !== 0 || !isStripDragEvent(event)) {
        return;
      }
      event.preventDefault();
      void performTitleBarDoubleClickAction();
    }

    strip.addEventListener("pointerdown", handlePointerDown);
    strip.addEventListener("dblclick", handleDoubleClick);
    return () => {
      strip.removeEventListener("pointerdown", handlePointerDown);
      strip.removeEventListener("dblclick", handleDoubleClick);
    };
  }, [stripRef]);
}

/**
 * The window chrome around a popped-out conversation.
 *
 * ONE bar, 36px, where a title bar would be: the conversation's own name on
 * the left — a picker, so this window can reach every other conversation
 * without a sidebar — and the four window controls on the right. The native
 * traffic lights are hidden (`hide_popout_traffic_lights` in
 * `popout_window.rs`), because a stoplight cluster and a web-drawn close
 * button in the same 36px band are two answers to the same question.
 *
 * There is no second header beneath this one. The conversation header the main
 * window draws carries actions a pop-out does not have and a title this bar
 * already states; stacked, the two spent ~92px of a 560px window before the
 * first message.
 */
export function PopoutShell({ children }: { children: React.ReactNode }) {
  // The two webview manners the main window also keeps: ⌘+/− scales the text,
  // and a wheel that reaches the end of the conversation stops there instead
  // of rubber-banding the whole window.
  useWebviewZoomShortcuts();
  useWebviewScrollBoundaryLock();
  const { isPinned, togglePin } = usePopoutPin();
  const location = useLocation();
  const { goChannel } = useAppNavigation();
  const channelId = channelIdFromPathname(location.pathname);
  // The SAME resolved label the bar's picker shows. Reading `channel.name`
  // here instead titled every direct-message window "DM" the moment the
  // channel list loaded, overwriting the display name `open_channel_popout`
  // had been handed — and that title is what ⌘-tab, Mission Control and the
  // Window menu read.
  const { selected } = usePopoutConversations(channelId);
  const channelTitle = selected?.label ?? "Conversation";
  const stripRef = React.useRef<HTMLDivElement>(null);
  const insetRef = React.useRef<HTMLDivElement>(null);
  const [dockFailed, setDockFailed] = React.useState(false);
  useWindowDragStrip(stripRef);

  React.useEffect(() => {
    if (!channelId) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("channel") !== channelId) {
      url.searchParams.set("channel", channelId);
      window.history.replaceState(window.history.state, "", url);
    }
    document.title = channelTitle;
    if (isTauri()) {
      void getCurrentWindow()
        .setTitle(channelTitle)
        .catch((error) => {
          console.warn("pop-out title unavailable", error);
        });
    }
  }, [channelId, channelTitle]);

  React.useEffect(() => {
    if (!dockFailed) return;
    const timer = window.setTimeout(() => setDockFailed(false), DOCK_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [dockFailed]);

  const handleSelectChannel = React.useCallback(
    (nextChannelId: string) => {
      void goChannel(nextChannelId);
    },
    [goChannel],
  );

  /**
   * "Open in Polyphonic" — the main window comes forward on this conversation
   * and this window steps out of the way.
   *
   * BROADCAST, NOT ADDRESSED, AND THAT IS THE FIX. This was `emitTo("main",
   * …)`, and it was a silent no-op for the life of the feature. Tauri resolves
   * an addressed emit through `filter_target` (tauri 2.11, `manager/mod.rs`):
   * `EventTarget::AnyLabel { label: "main" }` matches only listeners
   * registered as `Window` / `Webview` / `WebviewWindow` / `AnyLabel` carrying
   * that same label — and `listen()` from `@tauri-apps/api/event`, which is
   * what `usePopoutRequests` uses, registers `EventTarget::Any`. `Any` is not
   * in that match arm, so Rust dropped the event and still returned Ok: the
   * `.catch()` never fired and nothing was ever logged. A plain `emit` takes
   * the unfiltered path and reaches every webview. Only the main window acts
   * on it — `usePopoutRequests` returns early inside a pop-out — so the
   * broadcast costs one ignored message per open pop-out and nothing else.
   */
  const handleDock = React.useCallback(() => {
    if (!isTauri() || !channelId) {
      return;
    }
    void emit(POPOUT_OPEN_IN_MAIN_EVENT, { channelId })
      .then(() => {
        setDockFailed(false);
        // The main window raises itself and navigates; this one is done.
        return getCurrentWindow().close();
      })
      .catch((error) => {
        console.warn("Open in Polyphonic unavailable", error);
        setDockFailed(true);
      });
  }, [channelId]);

  const handleMinimize = React.useCallback(() => {
    if (!isTauri()) return;
    void getCurrentWindow()
      .minimize()
      .catch((error) => {
        console.warn("pop-out minimize unavailable", error);
      });
  }, []);

  const handleClose = React.useCallback(() => {
    if (!isTauri()) return;
    void getCurrentWindow()
      .close()
      .catch((error) => {
        console.warn("pop-out close unavailable", error);
      });
  }, []);

  return (
    <MainInsetProvider mainInsetRef={insetRef}>
      <div
        className="luca-popout"
        data-testid="popout-shell"
        ref={insetRef}
        style={popoutChromeCssVars as React.CSSProperties}
      >
        {/* The bar is a window drag region that carries controls, not a
            toolbar: the pointer gestures on the run between the name and the
            controls move the window itself, and every control on it opts out
            of the drag by being a real button. */}
        <div
          className="luca-popout__strip"
          data-testid="popout-drag-strip"
          ref={stripRef}
        >
          {dockFailed ? (
            <p
              className="luca-popout__notice"
              data-testid="popout-dock-error"
              role="status"
            >
              Couldn&rsquo;t reach the main window
            </p>
          ) : (
            <PopoutConversationPicker
              channelId={channelId}
              onSelectChannel={handleSelectChannel}
            />
          )}
          <div className="luca-popout__controls" data-testid="popout-controls">
            {/* One glyph, two states. A slashed pin for "not pinned" would
                read as "pinning unavailable"; the state lives in the
                control's own ink, the way a pressed toggle should. */}
            <Button
              aria-label="Keep on top"
              aria-pressed={isPinned}
              className="luca-popout__control"
              data-testid="popout-pin"
              onClick={togglePin}
              size="icon-xs"
              title="Keep on top"
              type="button"
              variant="ghost"
            >
              <Pin />
            </Button>
            <Button
              aria-label="Open in Polyphonic"
              className="luca-popout__control"
              data-testid="popout-dock"
              onClick={handleDock}
              size="icon-xs"
              title="Open in Polyphonic"
              type="button"
              variant="ghost"
            >
              <ExternalLink />
            </Button>
            <Button
              aria-label="Minimize"
              className="luca-popout__control"
              data-testid="popout-minimize"
              onClick={handleMinimize}
              size="icon-xs"
              title="Minimize"
              type="button"
              variant="ghost"
            >
              <Minus />
            </Button>
            <Button
              aria-label="Close"
              className="luca-popout__control"
              data-testid="popout-close"
              onClick={handleClose}
              size="icon-xs"
              title="Close"
              type="button"
              variant="ghost"
            >
              <X />
            </Button>
          </div>
        </div>
        {/* The routed-tree providers the conversation expects, in AppShell's
            own order. The artifact canvas reads the router's location, so it
            has to live inside the router — same as it does there. */}
        <RightCardsSlotProvider>
          <ArtifactCanvasProvider>
            <ResidentHarnessProvider>
              <div className="luca-popout__content">{children}</div>
            </ResidentHarnessProvider>
          </ArtifactCanvasProvider>
        </RightCardsSlotProvider>
      </div>
    </MainInsetProvider>
  );
}
