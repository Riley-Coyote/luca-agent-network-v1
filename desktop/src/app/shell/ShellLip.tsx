import * as React from "react";
import { ChevronLeft, ChevronRight, PanelLeft } from "lucide-react";

import { useActiveChannelHeader } from "@/features/channels/useActiveChannelHeader";
import type { Channel } from "@/shared/api/types";
import { SHELL_FRAME_RAIL_WIDTH } from "@/app/shell/shellFrame";
import { cn } from "@/shared/lib/cn";
import { isMacPlatform } from "@/shared/lib/platform";
import { useOptionalSidebar } from "@/shared/ui/sidebar";

/**
 * THE LIP (docs/luca/rail-system/SHELL_SPEC.md, "The frame, as decided"):
 * the window's top 36, on the floor. The rail's toggle at 78; back and forward
 * riding with the conversation card at max(card's left + 6, 112); and, until
 * the tabs come, the open page's name centred on the conversation card's axis.
 * Both live in the lip's part over the card, which moves with the card.
 * Its empty part is the window's title bar (useTauriWindowDrag).
 *
 * Fixed points on purpose, as the top chrome was: it sits beside the native
 * traffic lights, which ignore the app's text zoom.
 */

/** The lip's measures, in points (shell-frame.css holds the rest). */
const PLACES_WIDTH = 44;
const CARD_GAP = 4;
const WINDOW_EDGE = 6;

/** Where the conversation card's left edge comes to rest: the places' edge,
 *  past the rail's card and its gap while the rail is open. The lip takes it
 *  from the rail's own state, not from a measurement, so its part over the
 *  card glides there on the rail's own curve in the same frames as the card
 *  (shell-frame.css), instead of trailing the card by a frame. */
export function shellFrameCardLeft({
  railOpen,
  besideRail = 0,
}: {
  railOpen: boolean;
  /** Anything else standing between the rail and the card (the runtime
   *  sessions column), at rest. */
  besideRail?: number;
}): number {
  return (
    PLACES_WIDTH +
    (railOpen ? SHELL_FRAME_RAIL_WIDTH + CARD_GAP : 0) +
    Math.max(0, besideRail)
  );
}

/** The lip's part over the card: its left from the rail's state (above);
 *  its right measured, because a right card narrows the conversation card.
 *  The right edge is written to the element inside the ResizeObserver's
 *  callback, which runs after layout and before paint, so it lands in the
 *  same frame as the card it follows. Also reports what stands beside the
 *  rail (the runtime sessions column), which never animates. */
function useLipCardSpan(lipCard: React.RefObject<HTMLDivElement | null>) {
  const [besideRail, setBesideRail] = React.useState(0);
  React.useLayoutEffect(() => {
    let card: Element | null = null;
    let observer: ResizeObserver | null = null;
    const place = () => {
      const element = lipCard.current;
      if (!element) return;
      const lip = element.offsetParent ?? document.documentElement;
      // The card's content edge: a clear plane holding the cards keeps a
      // point of padding for their edge light (shell-frame.css).
      const right = card
        ? lip.getBoundingClientRect().right -
          (card.getBoundingClientRect().right -
            Number.parseFloat(getComputedStyle(card).paddingRight || "0"))
        : WINDOW_EDGE;
      element.style.right = `${Math.max(0, right)}px`;
    };
    const look = () => {
      const found = document.querySelector(
        "[data-buzz-content-surface], [data-buzz-content-plane]",
      );
      if (found !== card) {
        observer?.disconnect();
        card = found;
        if (card) {
          observer = new ResizeObserver(place);
          observer.observe(card);
        }
      }
      place();
      const beside = document.querySelector<HTMLElement>(
        '[data-luca-frame-row] > [data-testid="runtime-sessions-panel"]',
      );
      setBesideRail(beside?.offsetWidth ?? 0);
    };
    look();
    // The card is remounted across some route changes; look again whenever
    // the shell's subtree changes shape, cheaply, on the next frame.
    let frame = 0;
    const mutations = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(look);
    });
    mutations.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(frame);
      mutations.disconnect();
      observer?.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [lipCard]);
  return besideRail;
}

function LipButton({
  children,
  className,
  disabled,
  label,
  onClick,
  testId,
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  testId?: string;
} & Omit<React.ComponentProps<"button">, "onClick">) {
  return (
    <button
      aria-label={label}
      className={cn("luca-lip-button", className)}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
      {...rest}
    >
      {children}
    </button>
  );
}

/** A conversation's name, from the same source as its header's title. */
function ConversationName({
  channel,
  currentPubkey,
}: {
  channel: Channel;
  currentPubkey?: string;
}) {
  const { activeChannelTitle } = useActiveChannelHeader(channel, currentPubkey);
  return <>{activeChannelTitle}</>;
}

export function ShellLip({
  canGoBack,
  canGoForward,
  channel,
  currentPubkey,
  onGoBack,
  onGoForward,
  pageName,
}: {
  canGoBack: boolean;
  canGoForward: boolean;
  /** The open conversation, when one is open. */
  channel: Channel | null;
  currentPubkey?: string;
  onGoBack: () => void;
  onGoForward: () => void;
  /** The page's own name when no conversation is open. */
  pageName: string;
}) {
  const sidebar = useOptionalSidebar();
  const lipCard = React.useRef<HTMLDivElement>(null);
  const besideRail = useLipCardSpan(lipCard);
  const railOpen = sidebar ? sidebar.open : true;
  const key = isMacPlatform() ? "⌘" : "Ctrl+";
  const cardLeft = shellFrameCardLeft({
    railOpen: railOpen && !sidebar?.isMobile,
    besideRail,
  });

  return (
    <header
      className="luca-lip"
      data-testid="shell-lip"
      style={{ "--card-left": `${cardLeft}px` } as React.CSSProperties}
    >
      <LipButton
        aria-expanded={railOpen}
        className="luca-lip-toggle"
        data-sidebar="trigger"
        disabled={!sidebar}
        label={`${railOpen ? "Close" : "Open"} the conversations rail (${key}S)`}
        onClick={() => sidebar?.toggleSidebar()}
        testId="shell-lip-toggle"
      >
        <PanelLeft />
      </LipButton>
      <div className="luca-lip-card" ref={lipCard}>
        <div className="luca-lip-history">
          <LipButton
            disabled={!canGoBack}
            label={`Go back (${key}[)`}
            onClick={onGoBack}
            testId="global-back"
          >
            <ChevronLeft />
          </LipButton>
          <LipButton
            disabled={!canGoForward}
            label={`Go forward (${key}])`}
            onClick={onGoForward}
            testId="global-forward"
          >
            <ChevronRight />
          </LipButton>
        </div>
        <h1 className="luca-lip-name text-lip" data-testid="shell-lip-name">
          <span className="luca-lip-name__text">
            {channel ? (
              <ConversationName
                channel={channel}
                currentPubkey={currentPubkey}
              />
            ) : (
              pageName
            )}
          </span>
        </h1>
      </div>
    </header>
  );
}
