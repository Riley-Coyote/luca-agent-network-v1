import { isTauri } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PanelsTopLeft, Pin } from "lucide-react";
import * as React from "react";

import {
  POPOUT_OPEN_IN_MAIN_EVENT,
  popoutChannelId,
} from "@/app/popout/popoutMode";
import { useWebviewZoomShortcuts } from "@/app/useWebviewZoomShortcuts";
import { ResidentHarnessProvider } from "@/features/agents/ResidentHarnessContext";
import { ArtifactCanvasProvider } from "@/features/artifacts/ArtifactCanvasProvider";
import { useWebviewScrollBoundaryLock } from "@/shared/hooks/useWebviewScrollBoundaryLock";
import { chromeCssVarDefaults } from "@/shared/layout/chromeLayout";
import { MainInsetProvider } from "@/shared/layout/MainInsetContext";
import {
  RightCardsSlot,
  RightCardsSlotProvider,
} from "@/shared/layout/RightCardsSlot";
import { performTitleBarDoubleClickAction } from "@/shared/lib/titleBarActions";
import { Button } from "@/shared/ui/button";

const INTERACTIVE_SELECTOR =
  'button, a, input, textarea, select, label, summary, [role="button"], [role="link"], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

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
 * Make the strip behave like a title bar: press-and-move drags the window,
 * double-click runs whatever macOS is set to do on a title-bar double-click.
 *
 * The listeners are attached to the element rather than declared as JSX props
 * because the strip is not a control — it has no role, takes no focus, and
 * answers no keyboard. Same construction as the main window's drag region.
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
 * Native close, minimize and ⌘W come free from the window's own traffic
 * lights; what the web side owes the window is a drag region where the title
 * bar would be, and the two controls that have no native equivalent — the pin,
 * and the way back into the full app.
 *
 * The strip carries NO title. The conversation header sits directly beneath it
 * and already names the conversation, in the app's own voice, with its icon and
 * its presence line; a second copy 40px above it was the same word twice. The
 * native window title is still set — that is what the Window menu, Mission
 * Control and ⌘-tab read — it just is not repeated inside the glass.
 */
export function PopoutShell({ children }: { children: React.ReactNode }) {
  // The two webview manners the main window also keeps: ⌘+/− scales the text,
  // and a wheel that reaches the end of the conversation stops there instead
  // of rubber-banding the whole window.
  useWebviewZoomShortcuts();
  useWebviewScrollBoundaryLock();
  const { isPinned, togglePin } = usePopoutPin();
  const channelId = popoutChannelId();
  const stripRef = React.useRef<HTMLDivElement>(null);
  const insetRef = React.useRef<HTMLDivElement>(null);
  useWindowDragStrip(stripRef);

  const handleOpenInLuca = React.useCallback(() => {
    if (!isTauri() || !channelId) {
      return;
    }
    // The main window raises itself and navigates: focus belongs to the window
    // taking it, and the conversation route is its business, not ours.
    void emitTo("main", POPOUT_OPEN_IN_MAIN_EVENT, { channelId }).catch(
      (error) => {
        console.warn("open in Luca unavailable", error);
      },
    );
  }, [channelId]);

  return (
    <MainInsetProvider mainInsetRef={insetRef}>
      <div
        className="luca-popout"
        data-testid="popout-shell"
        ref={insetRef}
        style={chromeCssVarDefaults as React.CSSProperties}
      >
        {/* The strip is a window drag region, not a control: the pointer gestures
          on it move the window itself. Every control it carries is a real
          button, and those opt out of the drag. The empty run between the
          traffic lights and the controls is the drag surface — most of the
          strip is meant to be nothing. */}
        <div
          className="luca-popout__strip"
          data-testid="popout-drag-strip"
          ref={stripRef}
        >
          <div className="luca-popout__controls">
            {/* One glyph, two states. A slashed pin for "not pinned" would
                read as "pinning unavailable"; the state lives in the
                control's own ink, the way a pressed toggle should. */}
            <Button
              aria-label="Keep above other windows"
              aria-pressed={isPinned}
              className="luca-popout__pin"
              data-testid="popout-pin"
              onClick={togglePin}
              size="icon-xs"
              title="Keep above other windows"
              type="button"
              variant="ghost"
            >
              <Pin />
            </Button>
            <Button
              aria-label="Open in Luca"
              data-testid="popout-open-in-luca"
              onClick={handleOpenInLuca}
              size="icon-xs"
              title="Open in Luca"
              type="button"
              variant="ghost"
            >
              <PanelsTopLeft />
            </Button>
          </div>
        </div>
        {/* The routed-tree providers the conversation expects, in AppShell's
            own order. The artifact canvas reads the router's location, so it
            has to live inside the router — same as it does there. */}
        <RightCardsSlotProvider>
          <ArtifactCanvasProvider>
            <ResidentHarnessProvider>
              <div className="luca-popout__body">
                <div className="luca-popout__content">{children}</div>
                <RightCardsSlot />
              </div>
            </ResidentHarnessProvider>
          </ArtifactCanvasProvider>
        </RightCardsSlotProvider>
      </div>
    </MainInsetProvider>
  );
}
