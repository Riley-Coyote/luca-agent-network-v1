import * as React from "react";
import { ChevronLeft, ChevronRight, PanelLeft } from "lucide-react";

import { useActiveChannelHeader } from "@/features/channels/useActiveChannelHeader";
import type { Channel } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { isMacPlatform } from "@/shared/lib/platform";
import { useOptionalSidebar } from "@/shared/ui/sidebar";

/**
 * THE LIP (docs/luca/rail-system/SHELL_SPEC.md, "The frame, as decided"):
 * the window's top 36, on the floor. The rail's toggle at 78; back and forward
 * riding with the conversation card at max(card's left + 6, 112); and, until
 * the tabs come, the open page's name centred on the conversation card's axis.
 * Its empty part is the window's title bar (useTauriWindowDrag).
 *
 * Fixed points on purpose, as the top chrome was: it sits beside the native
 * traffic lights, which ignore the app's text zoom.
 */

/** The lip's measures, in points (shell-frame.css holds the rest). */
const HISTORY_MIN_LEFT = 112;
const HISTORY_CARD_INSET = 6;
/** The name is no wider than the card less this. */
const NAME_CLEARANCE = 200;

type CardSpan = { left: number; right: number };

/** The conversation card's span, measured: the routed content's card, which
 *  narrows when a right card opens and follows the rail as it slides. */
function useConversationCardSpan(): CardSpan | null {
  const [span, setSpan] = React.useState<CardSpan | null>(null);
  React.useLayoutEffect(() => {
    let card: Element | null = null;
    let observer: ResizeObserver | null = null;
    const measure = () => {
      const found = document.querySelector(
        "[data-buzz-content-surface], [data-buzz-content-plane]",
      );
      if (found !== card) {
        observer?.disconnect();
        card = found;
        if (card) {
          observer = new ResizeObserver(measure);
          observer.observe(card);
        }
      }
      if (!card) return;
      const rect = card.getBoundingClientRect();
      setSpan((current) =>
        current && current.left === rect.left && current.right === rect.right
          ? current
          : { left: rect.left, right: rect.right },
      );
    };
    measure();
    // The card is remounted across some route changes; look again whenever
    // the shell's subtree changes shape, cheaply, on the next frame.
    let frame = 0;
    const mutations = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    mutations.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      mutations.disconnect();
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return span;
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
  const span = useConversationCardSpan();
  const railOpen = sidebar ? sidebar.open : true;
  const key = isMacPlatform() ? "⌘" : "Ctrl+";
  const historyLeft = span
    ? Math.max(span.left + HISTORY_CARD_INSET, HISTORY_MIN_LEFT)
    : HISTORY_MIN_LEFT;
  const nameStyle: React.CSSProperties | undefined = span
    ? {
        left: (span.left + span.right) / 2,
        maxWidth: Math.max(0, span.right - span.left - NAME_CLEARANCE),
      }
    : undefined;

  return (
    <header className="luca-lip" data-testid="shell-lip">
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
      <div className="luca-lip-history" style={{ left: historyLeft }}>
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
      <h1
        className="luca-lip-name text-lip"
        data-testid="shell-lip-name"
        style={nameStyle}
      >
        <span className="luca-lip-name__text">
          {channel ? (
            <ConversationName channel={channel} currentPubkey={currentPubkey} />
          ) : (
            pageName
          )}
        </span>
      </h1>
    </header>
  );
}
