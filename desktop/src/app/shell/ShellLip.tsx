import * as React from "react";
import { useRouterState } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, PanelLeft } from "lucide-react";

import { getChannelDescription } from "@/features/channels/lib/channelDescription";
import { useActiveChannelHeader } from "@/features/channels/useActiveChannelHeader";
import {
  useConversationWorkspace,
  workspaceSlot,
} from "@/features/conversation-workspace";
import { useOpenSideId } from "@/features/exchange/openSide";
import { useRailWork } from "@/features/sidebar/lib/useRailWork";
import type { Channel } from "@/shared/api/types";
import { setShellLipActionsSlot } from "@/app/shell/lipActionsSlot";
import { setShellLipPresenceSlot } from "@/app/shell/lipPresenceSlot";
import { SHELL_FRAME_RAIL_WIDTH, shellShortcuts } from "@/app/shell/shellFrame";
import { cn } from "@/shared/lib/cn";
import { useNativeMacChrome } from "@/shared/lib/useNativeMacChrome";
import { useOptionalSidebar } from "@/shared/ui/sidebar";

/**
 * THE LIP (docs/luca/rail-system/SHELL_SPEC.md, "The frame, as decided"):
 * the window's top 36, on the floor. The rail's toggle at 78; back and forward
 * riding with the conversation card at max(card's left + 6, 112); and, until
 * the tabs come, the open page's name centred on the conversation card's axis.
 * Both live in the lip's part over the card, which moves with the card; so
 * does the slot at its right end for the open conversation's actions (WP-04).
 * Its empty part is the window's title bar (useTauriWindowDrag).
 *
 * Fixed points on purpose, as the top chrome was: it sits beside the native
 * traffic lights, which ignore the app's text zoom.
 */

/** The lip's measures, in points (shell-frame.css holds the rest). */
const PLACES_WIDTH = 44;
const CARD_GAP = 4;
const WINDOW_EDGE = 6;
/** The conversation card's left and right, on the root, for what stands on
 *  its axis outside the lip (the companion's badge, shell-edges.css). */
const CARD_LEFT_PROPERTY = "--luca-frame-card-left";
const CARD_RIGHT_PROPERTY = "--luca-frame-card-right";
/** The name keeps this much clear of the lip's part on each side, more when
 *  the actions' slot is wider (its width, its 8 from the edge and a 12 gap),
 *  so it stays on its axis without running into them (shell-header.css). */
const NAME_ROOM_MIN = 100;
const NAME_ROOM_PAST_SLOT = 8 + 12;

/** Where what the rail opens begins: the places' edge, past the rail while
 *  it is open, at its hairline (one card, WP-12: nothing between them). The
 *  lip takes it from the rail's own state, not from a measurement, so its
 *  part over the card glides there on the rail's own curve in the same
 *  frames as the conversation's edge (shell-frame.css), instead of trailing
 *  it by a frame. */
export function shellFrameCardLeft({
  railOpen,
  besideRail = 0,
}: {
  railOpen: boolean;
  /** The width of the card standing between the rail and the
   *  conversation's (the runtime sessions card, WP-08c), at rest; 0 when
   *  none is open. It keeps 4 from the conversation's card, and 4 from the
   *  places column while the rail is closed (shell-runtime.css). */
  besideRail?: number;
}): number {
  const beside =
    besideRail > 0 ? besideRail + CARD_GAP + (railOpen ? 0 : CARD_GAP) : 0;
  return PLACES_WIDTH + (railOpen ? SHELL_FRAME_RAIL_WIDTH : 0) + beside;
}

/** The lip's part over the card: its left from the rail's state (above);
 *  its right measured, because a right card narrows the conversation card.
 *  The right edge is written to the element inside the ResizeObserver's
 *  callback, which runs after layout and before paint, so it lands in the
 *  same frame as the card it follows. Also reports the width of the card
 *  standing beside the rail (the runtime sessions card) at rest: its body's
 *  width while it is open, 0 from the moment it starts to close, so the
 *  lip's part glides with the card on its own transition. */
function useLipCardSpan(
  lipCard: React.RefObject<HTMLDivElement | null>,
  lipSlot: React.RefObject<HTMLDivElement | null>,
  railOpen: React.RefObject<boolean>,
) {
  const [besideRail, setBesideRail] = React.useState(0);
  React.useLayoutEffect(() => {
    // The runtime sessions card opens and closes on the rail's slide
    // (shell-runtime.css). Its resting width is written straight to the
    // lip from the mutation's own callback, before the next frame is drawn,
    // so the lip's part starts its glide on the card's first frame instead
    // of a frame or more behind it; the state then agrees with it. Its body
    // holds the card's 22 rem through the slide, so it changes size only
    // when the text does (⌘+ and ⌘−): it is watched for that too.
    let beside: HTMLElement | null = null;
    let besideWidth = 0;
    const besideSize = new ResizeObserver(() => syncBeside());
    const syncBeside = () => {
      const found = document.querySelector<HTMLElement>(
        '[data-luca-frame-row] > [data-luca-runtime-card="open"] > [data-luca-runtime-card-body]',
      );
      if (found !== beside) {
        if (beside) besideSize.unobserve(beside);
        if (found) besideSize.observe(found);
        beside = found;
      }
      const width = found ? found.getBoundingClientRect().width : 0;
      if (width === besideWidth) return;
      besideWidth = width;
      const left = shellFrameCardLeft({
        railOpen: railOpen.current,
        besideRail: width,
      });
      lipCard.current?.parentElement?.style.setProperty(
        "--card-left",
        `${left}px`,
      );
      setBesideRail(width);
    };
    let card: Element | null = null;
    let pane: Element | null = null;
    let slot: Element | null = null;
    let observer: ResizeObserver | null = null;
    const place = () => {
      const element = lipCard.current;
      if (!element) return;
      const lip = element.offsetParent ?? document.documentElement;
      // The card's edge. A clear plane holding the cards keeps a point of
      // padding for their edge light, so its card ends at its content edge;
      // a surface that is itself the card (Library, Agents, …) ends at its
      // outer edge, its point of padding inside it (shell-frame.css).
      const plane =
        card?.matches("[data-buzz-content-plane]") ||
        card?.querySelector("[data-luca-workspace-floor]") != null;
      const cardRect = card?.getBoundingClientRect();
      const cardStyle = card && plane ? getComputedStyle(card) : null;
      const contentLeft = cardRect
        ? cardRect.left + Number.parseFloat(cardStyle?.paddingLeft || "0")
        : 0;
      const contentRight = cardRect
        ? cardRect.right - Number.parseFloat(cardStyle?.paddingRight || "0")
        : 0;
      const right = cardRect
        ? lip.getBoundingClientRect().right - contentRight
        : WINDOW_EDGE;
      element.style.right = `${Math.max(0, right)}px`;
      // Published for what stands on the card's axis outside the lip: the
      // companion's badge (shell-edges.css).
      document.documentElement.style.setProperty(
        CARD_RIGHT_PROPERTY,
        `${Math.max(0, right)}px`,
      );
      // Panes side by side: the name and the actions are the focused pane's
      // (SHELL_SPEC.md, Decided 5), so they stand over it, the actions 8
      // from its own right edge. Taken from the card, which the lip's part
      // mirrors, so it holds through the rail's slide.
      const paneRect = pane?.getBoundingClientRect();
      const paneLeft =
        cardRect && paneRect ? Math.max(0, paneRect.left - contentLeft) : 0;
      const paneRight =
        cardRect && paneRect ? Math.max(0, contentRight - paneRect.right) : 0;
      element.style.setProperty("--lip-pane-left", `${paneLeft}px`);
      element.style.setProperty("--lip-pane-right", `${paneRight}px`);
      const slotWidth = slot ? (slot as HTMLElement).offsetWidth : 0;
      const room = Math.max(
        NAME_ROOM_MIN,
        slotWidth > 0 ? slotWidth + NAME_ROOM_PAST_SLOT : 0,
      );
      element.style.setProperty("--lip-name-room", `${room}px`);
    };
    const look = () => {
      const found = document.querySelector(
        "[data-buzz-content-surface], [data-buzz-content-plane]",
      );
      // The focused pane, only while more than one is shown.
      const panes = document.querySelectorAll(
        '[data-testid="conversation-workspace-grid"] > [data-luca-card]',
      );
      const focusedPane =
        panes.length > 1
          ? (Array.from(panes).find(
              (candidate) => candidate.getAttribute("data-focused") === "true",
            ) ?? null)
          : null;
      const foundSlot = lipSlot.current;
      if (found !== card || focusedPane !== pane || foundSlot !== slot) {
        observer?.disconnect();
        card = found;
        pane = focusedPane;
        slot = foundSlot;
        observer = new ResizeObserver(place);
        for (const target of [card, pane, slot]) {
          if (target) observer.observe(target);
        }
      }
      place();
      syncBeside();
    };
    look();
    // The card is remounted across some route changes; look again whenever
    // the shell's subtree changes shape, cheaply, on the next frame.
    let frame = 0;
    const mutations = new MutationObserver(() => {
      syncBeside();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(look);
    });
    mutations.observe(document.body, {
      attributeFilter: ["data-focused", "data-luca-runtime-card"],
      childList: true,
      subtree: true,
    });
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(frame);
      mutations.disconnect();
      besideSize.disconnect();
      observer?.disconnect();
      window.removeEventListener("resize", place);
      document.documentElement.style.removeProperty(CARD_RIGHT_PROPERTY);
    };
  }, [lipCard, lipSlot, railOpen]);
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
  home,
  onGoBack,
  onGoForward,
  pageName,
  railName = "chats rail",
}: {
  canGoBack: boolean;
  canGoForward: boolean;
  /** The open conversation, when one is open. */
  channel: Channel | null;
  currentPubkey?: string;
  /** The open conversation's project, when it has one: the lip names it
   *  before the room, "Tidepool / general", as the study names a session
   *  under its home (WP-09b, Decided 3). */
  home?: string;
  onGoBack: () => void;
  onGoForward: () => void;
  /** The page's own name when no conversation is open: on a place with its
   *  own rail, the picked row's name (PlaceLipName). */
  pageName: React.ReactNode;
  /** What the toggle opens and closes, in its words: the place's rail, or
   *  Settings' section list (WP-04b). */
  railName?: string;
}) {
  const sidebar = useOptionalSidebar();
  const lipCard = React.useRef<HTMLDivElement>(null);
  const lipSlot = React.useRef<HTMLDivElement | null>(null);
  const setLipSlot = React.useCallback((element: HTMLDivElement | null) => {
    lipSlot.current = element;
    setShellLipActionsSlot(element);
  }, []);
  // Panes side by side with the focused one empty: the lip names nothing,
  // so no other pane's quiet name is doubled here, and its slot holds only
  // the workspace's layout menu, which the empty pane sends up
  // (ConversationWorkspaceFrame), no conversation's actions (WP-04b).
  const workspace = useConversationWorkspace();
  const focusedPaneEmpty =
    channel !== null &&
    workspace !== null &&
    workspace.layout.preset !== "single" &&
    !workspaceSlot(workspace.layout, workspace.layout.focusedSlotId).activeTab;
  const named = focusedPaneEmpty ? null : channel;
  // The agent of a one-agent conversation rises into the lip with one pane
  // open; with panes side by side the lip names the focused one, as before.
  const presenceShown =
    named !== null &&
    (workspace === null || workspace.layout.preset === "single");
  // A side conversation open is named under its home, as the Chats rail
  // lights it there: "Atlas / Luca · general" (WP-25, Decided 2; WP-34).
  const side = useOpenSideName(named?.id ?? null);
  // Under 768 the rail is a sheet: the toggle says the sheet's state.
  const railOpen = sidebar
    ? sidebar.isMobile
      ? sidebar.openMobile
      : sidebar.open
    : true;
  const railBesideCards = railOpen && !sidebar?.isMobile;
  const railBesideCardsRef = React.useRef(railBesideCards);
  railBesideCardsRef.current = railBesideCards;
  const besideRail = useLipCardSpan(lipCard, lipSlot, railBesideCardsRef);
  const shortcuts = shellShortcuts();
  // The Mac's lights on the lip: the toggle sits past them at 78. Without
  // them (another platform, a browser, full screen) it stands where the first
  // light was, on the places' axis (22; shell-edges.css).
  const nativeLights = useNativeMacChrome();
  const cardLeft = shellFrameCardLeft({
    railOpen: railBesideCards,
    besideRail,
  });

  React.useLayoutEffect(() => {
    document.documentElement.style.setProperty(
      CARD_LEFT_PROPERTY,
      `${cardLeft}px`,
    );
  }, [cardLeft]);
  React.useLayoutEffect(
    () => () => {
      document.documentElement.style.removeProperty(CARD_LEFT_PROPERTY);
    },
    [],
  );

  return (
    <header
      className="luca-lip"
      data-lights={nativeLights ? "native" : "none"}
      data-testid="shell-lip"
      style={{ "--card-left": `${cardLeft}px` } as React.CSSProperties}
    >
      <LipButton
        aria-expanded={railOpen}
        className="luca-lip-toggle"
        data-sidebar="trigger"
        disabled={!sidebar}
        label={`${railOpen ? "Close" : "Open"} the ${railName} (${shortcuts.key}S)`}
        onClick={() => sidebar?.toggleSidebar()}
        testId="shell-lip-toggle"
      >
        <PanelLeft />
      </LipButton>
      <div className="luca-lip-card" ref={lipCard}>
        <div className="luca-lip-history">
          <LipButton
            disabled={!canGoBack}
            label={`Go back (${shortcuts.back})`}
            onClick={onGoBack}
            testId="global-back"
          >
            <ChevronLeft />
          </LipButton>
          <LipButton
            disabled={!canGoForward}
            label={`Go forward (${shortcuts.forward})`}
            onClick={onGoForward}
            testId="global-forward"
          >
            <ChevronRight />
          </LipButton>
        </div>
        <h1
          className="luca-lip-name text-lip"
          data-testid="shell-lip-name"
          // The conversation's description, as its header's title had it.
          title={named ? getChannelDescription(named) : undefined}
        >
          <span className="luca-lip-name__text">
            {named && side ? (
              <>
                <span className="luca-lip-home">{side.home}</span>
                <span aria-hidden className="luca-lip-rule">
                  /
                </span>
                {side.name}
              </>
            ) : named ? (
              <>
                {home ? (
                  <>
                    <span className="luca-lip-home">{home}</span>
                    <span aria-hidden className="luca-lip-rule">
                      /
                    </span>
                  </>
                ) : null}
                <ConversationName
                  channel={named}
                  currentPubkey={currentPubkey}
                />
              </>
            ) : focusedPaneEmpty ? null : (
              pageName
            )}
          </span>
        </h1>
        {/* The agent of a one-agent conversation, on the card's axis: the
            conversation portals them in (lipPresenceSlot.ts). Before the
            actions, so Tab meets their page after back and forward. */}
        {presenceShown ? (
          <div
            className="luca-lip-agent"
            data-testid="shell-lip-agent"
            ref={setShellLipPresenceSlot}
          />
        ) : null}
        {/* The open conversation's actions, at the lip's right end: the
            conversation portals them in (lipActionsSlot.ts, shell-header.css).
            After the name, so Tab meets them after back and forward. */}
        <div
          className="luca-lip-actions"
          data-testid="shell-lip-actions"
          ref={setLipSlot}
        />
      </div>
    </header>
  );
}

/**
 * The side conversation open in `channelId`, named as the Chats rail names
 * its row (ShellRail.tsx; SPEC.md, "Selection"): the name of whoever does
 * the work for the home, and the row's own words ("Luca · general", a
 * task's summary) for the session. Null when what is open is the room
 * itself.
 */
function useOpenSideName(
  channelId: string | null,
): { home: string; name: string } | null {
  // The work under whoever does it (WP-34): an exchange under the agent it
  // asks, a task under its app, as the Chats rail lists them.
  const work = useRailWork();
  const threadTarget = useRouterState({
    select: (state) => {
      const search = state.location.search as Record<string, unknown>;
      const target = search.thread ?? search.threadRootId ?? search.messageId;
      return typeof target === "string" && target.length > 0 ? target : null;
    },
  });
  const openId = useOpenSideId(channelId, threadTarget, work.rows);
  const row = openId ? work.rows.find((each) => each.id === openId) : undefined;
  const home = row ? work.homeName(row.id) : null;
  if (!row || !home) return null;
  return { home, name: row.label };
}
