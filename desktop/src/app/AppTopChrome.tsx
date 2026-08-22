import * as React from "react";
import { isTauri } from "@tauri-apps/api/core";
import {
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

import { isMacPlatform } from "@/shared/lib/platform";
import { useIsFullscreen } from "@/shared/lib/useIsFullscreen";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";
import { topChromeBackdrop } from "@/shared/layout/chromeLayout";
import { useOptionalSidebar } from "@/shared/ui/sidebar";

type AppTopChromeProps = {
  canGoBack: boolean;
  canGoForward: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
  hasCommunityRail?: boolean;
};

// Fixed px on purpose (button box + glyph): these controls sit beside the
// native macOS traffic lights, which ignore the app's Cmd +/- text zoom, so
// the row must not grow or shrink with the rem scale. Deliberate exception
// to the rem-first rule.
const TOP_CHROME_ICON_BUTTON_CLASS =
  "h-[24px] w-[24px] rounded-[4px] text-ink-muted hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&_svg]:size-[15px]";
const HISTORY_ICON_BUTTON_CLASS =
  "h-[24px] w-[22px] rounded-[4px] text-ink-muted hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&_svg]:size-[15px]";

function preventTopChromeWheel(event: WheelEvent) {
  event.preventDefault();
}

function TopChromeSidebarTrigger() {
  const sidebar = useOptionalSidebar();

  return (
    <Button
      aria-label="Toggle Sidebar"
      className={TOP_CHROME_ICON_BUTTON_CLASS}
      data-sidebar="trigger"
      disabled={!sidebar}
      onClick={() => {
        sidebar?.toggleSidebar();
      }}
      size="icon"
      type="button"
      variant="ghost"
    >
      {sidebar?.open ? <PanelLeftClose /> : <PanelLeftOpen />}
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  );
}

export function AppTopChrome({
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
  hasCommunityRail = false,
}: AppTopChromeProps) {
  const topChromeRef = React.useRef<HTMLDivElement>(null);
  const isFullscreen = useIsFullscreen();
  // On macOS the traffic-light buttons overlay the chrome (see
  // `trafficLightPosition` in `tauri.conf.json`), so the nav row clears their
  // x-position. When the community rail is present it already occupies the far
  // left, so the nav row only needs to clear the lights past the rail edge
  // rather than the full offset. In fullscreen those buttons hide.
  //
  // Fixed px on purpose: the native traffic lights do not scale with the app's
  // Cmd +/- text zoom (rem), so rem-based clearance shrinks under them when
  // zoomed out. This is a deliberate exception to the rem-first rule.
  // Reserve room for the macOS traffic lights — but only where they EXIST.
  // This used to gate on isMacPlatform(), which is a platform check, not a
  // native-window one: a browser on a Mac reserved 80px for lights that were
  // never drawn, leaving the controls stranded in the middle of the rail's top
  // area with an empty hole beside them. `isTauri()` is the real question.
  const macChrome = isMacPlatform() && isTauri() && !isFullscreen;
  const navRowPaddingClass = macChrome
    ? hasCommunityRail
      ? "pl-[32px]"
      : "pl-[80px]"
    : "pl-3";
  // No vertical nudge: this strip is pinned to the card's header row and the
  // lights are centred on that same row (`trafficLightPosition.y` = 28 =
  // lip 8 + (header 52 - lights 12) / 2), so `items-center` lines them up.
  const navRowAlignmentClass = null;

  React.useEffect(() => {
    const topChrome = topChromeRef.current;
    if (!topChrome) {
      return;
    }

    const options = { capture: true, passive: false };
    topChrome.addEventListener("wheel", preventTopChromeWheel, options);
    return () => {
      topChrome.removeEventListener("wheel", preventTopChromeWheel, options);
    };
  }, []);

  return (
    <div
      ref={topChromeRef}
      className={cn(
        // OVERLAY, not a band. In flow this strip ate 32px across the whole
        // window, which is why the card could never reach the top and its lip
        // was 40px on top against 8px elsewhere. Floating it lets the content
        // row start at y=0 so all four lips are equal.
        //
        // pointer-events-none so it cannot swallow the card header's controls
        // underneath it; the control cluster re-enables them for itself. The
        // window-drag region moves to the channel header, which now sits under
        // this strip — see ChannelScreenHeader.
        "pointer-events-none absolute inset-x-0 top-0 z-45 flex cursor-default select-none items-center bg-transparent pr-3 text-sidebar-foreground",
        topChromeBackdrop.height,
        navRowPaddingClass,
      )}
      data-testid="app-top-chrome"
    >
      <div
        className={cn(
          "pointer-events-auto flex items-center gap-0.5",
          navRowAlignmentClass,
        )}
        data-tauri-drag-region
      >
        <TopChromeSidebarTrigger />
        <Button
          aria-label="Go back"
          className={HISTORY_ICON_BUTTON_CLASS}
          data-testid="global-back"
          disabled={!canGoBack}
          onClick={onGoBack}
          size="icon"
          variant="ghost"
        >
          <ChevronLeft />
        </Button>
        <Button
          aria-label="Go forward"
          className={HISTORY_ICON_BUTTON_CLASS}
          data-testid="global-forward"
          disabled={!canGoForward}
          onClick={onGoForward}
          size="icon"
          variant="ghost"
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
