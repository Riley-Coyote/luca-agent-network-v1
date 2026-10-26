import * as React from "react";

import {
  ROOM_STACK_EDGE_FADE,
  type RoomStackMode,
  roomStackFit,
  roomStackFolded,
  roomStackReach,
  roomStackScrollDelta,
  roomStackTooSmall,
  roomStackWhole,
} from "./conversationAgentActivityShelf";

/** A form an ask opens under its row: a question's fields, a proposal's
 *  details (PlaceAskRow's panel). A permission's Details is not a form. */
const FORM_SELECTOR =
  '.luca-ask-panel :is(.luca-ask-form, [data-testid="runtime-task-confirmation"])';

/**
 * A room's asks and its current work, as one stack in the page between the
 * timeline and the message box (SHELL_BUILD.md WP-23). It lives in the
 * composer's overlay, so the timeline's measured padding ends above it and
 * the newest message stays in view as it comes, goes and grows.
 *
 * - Every item is a flat row on the card, as Needs you draws it; one label,
 *   "Needs you" while it holds asks, "Current work" while it holds only work
 *   (shown only when the work rows are there; conversationAgentActivityShelf
 *   .css).
 * - At rest it takes at most 40% of the conversation and scrolls inside;
 *   where that can't hold one whole ask, or while one exchange is focused
 *   (`held`), it folds to one line, "Needs you · 2 · Show". Shown again
 *   where 40% can't hold an ask, it takes just its label and that one ask.
 * - While a form is open it may take the whole height above the message box,
 *   and the form is brought into view.
 *
 * Shell frame only; with the flag off ChannelPane draws its cards as before.
 */
export function ConversationRoomStack({
  askCount,
  asks,
  children,
  held,
  onShow,
  resetKey,
}: {
  askCount: number;
  /** The ask rows (`li`s), in the order they were asked. */
  asks: React.ReactNode;
  /** The work rows: the activity strip and the finished-work receipt. */
  children: React.ReactNode;
  /** One exchange is focused: the asks hold to their one line. */
  held: boolean;
  /** The owner asked to see the held asks. */
  onShow: () => void;
  /** The conversation: a new one starts the stack at rest. */
  resetKey: string | null;
}) {
  const stackRef = React.useRef<HTMLElement>(null);
  const headRef = React.useRef<HTMLDivElement>(null);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const [mode, setMode] = React.useState<RoomStackMode>("rest");
  const [modeFor, setModeFor] = React.useState(resetKey);
  if (modeFor !== resetKey) {
    setModeFor(resetKey);
    setMode("rest");
  }
  const [reach, setReach] = React.useState<{
    rest: number;
    whole: number;
  } | null>(null);
  const [label, setLabel] = React.useState(0);
  const [firstAsk, setFirstAsk] = React.useState(0);
  const [formOpen, setFormOpen] = React.useState(false);

  const tooSmall = reach
    ? roomStackTooSmall({ firstAsk, label, rest: reach.rest })
    : false;
  const folded = roomStackFolded({ askCount, held, mode, tooSmall });
  const whole = !folded && roomStackWhole({ formOpen });
  const fit = !folded && roomStackFit({ formOpen, mode, tooSmall });

  React.useLayoutEffect(() => {
    const stack = stackRef.current;
    const parent = stack?.parentElement;
    const section = stack?.closest<HTMLElement>(
      '[data-testid="channel-drop-zone"]',
    );
    if (!stack || !parent || !section) return;
    const measure = () => {
      const composer = section.querySelector<HTMLElement>(
        '[data-testid="message-composer"]',
      );
      const sectionBox = section.getBoundingClientRect();
      const stackBox = stack.getBoundingClientRect();
      const next = roomStackReach({
        above: stackBox.top - parent.getBoundingClientRect().top,
        conversation:
          (composer?.getBoundingClientRect().top ?? sectionBox.bottom) -
          sectionBox.top,
        stackBottom: stackBox.bottom - sectionBox.top,
      });
      setReach((previous) =>
        previous && previous.rest === next.rest && previous.whole === next.whole
          ? previous
          : next,
      );
      const head = headRef.current;
      if (head && head.offsetParent !== null) setLabel(head.offsetHeight);
      // The first ask's own row, without a form it may have open: what the
      // rest height has to hold. Kept from its last measure while folded.
      const row = bodyRef.current?.querySelector<HTMLElement>(
        ".luca-room-stack__asks > .luca-ask > .luca-ask-row",
      );
      if (row && row.offsetParent !== null) setFirstAsk(row.offsetHeight);
      else if (askCount === 0) setFirstAsk(0);
      setFormOpen(Boolean(stack.querySelector(FORM_SELECTOR)));
      edges();
    };
    // Where the body scrolls, its edge fades on the side with more to read,
    // so a row is never cut by a hard line. Written straight to the DOM: a
    // scroll never re-renders the stack.
    const edges = () => {
      const body = bodyRef.current;
      if (!body) return;
      const above = body.scrollTop > 1;
      const below = body.scrollTop + body.clientHeight < body.scrollHeight - 1;
      body.toggleAttribute("data-more-above", above);
      body.toggleAttribute("data-more-below", below);
    };
    measure();
    const resize = new ResizeObserver(measure);
    for (const each of [section, stack, parent]) resize.observe(each);
    const composer = section.querySelector('[data-testid="message-composer"]');
    if (composer) resize.observe(composer);
    const mutations = new MutationObserver(measure);
    mutations.observe(stack, { childList: true, subtree: true });
    const body = bodyRef.current;
    body?.addEventListener("scroll", edges, { passive: true });
    return () => {
      resize.disconnect();
      mutations.disconnect();
      body?.removeEventListener("scroll", edges);
    };
  }, [askCount]);

  // Opening a form brings it, with its ask, into view inside the stack.
  React.useEffect(() => {
    if (!formOpen || folded) return;
    const frame = window.requestAnimationFrame(() => {
      const body = bodyRef.current;
      const item = body
        ?.querySelector(FORM_SELECTOR)
        ?.closest<HTMLElement>(".luca-ask");
      if (!body || !item) return;
      body.scrollTop += roomStackScrollDelta(
        item.getBoundingClientRect(),
        body.getBoundingClientRect(),
      );
    });
    return () => window.cancelAnimationFrame(frame);
  }, [folded, formOpen]);

  const show = () => {
    setMode("shown");
    onShow();
  };

  return (
    <section
      aria-label={askCount > 0 ? "Needs you" : "Current work"}
      className="luca-measure pointer-events-auto luca-room-stack"
      data-folded={folded ? "" : undefined}
      data-fit={fit ? "" : undefined}
      data-testid="room-stack"
      data-whole={whole ? "" : undefined}
      ref={stackRef}
      style={
        reach
          ? ({
              "--luca-room-stack-fit": `${Math.min(reach.whole, label + firstAsk + ROOM_STACK_EDGE_FADE)}px`,
              "--luca-room-stack-rest": `${reach.rest}px`,
              "--luca-room-stack-whole": `${reach.whole}px`,
            } as React.CSSProperties)
          : undefined
      }
    >
      <div
        className="luca-room-stack__head"
        data-kind={askCount > 0 ? "asks" : "work"}
        ref={headRef}
      >
        {folded ? (
          <button
            aria-expanded={false}
            className="luca-room-stack__fold"
            data-testid="pending-held"
            onClick={show}
            type="button"
          >
            <span className="type-eyebrow">Needs you · {askCount} · </span>
            <span className="luca-room-stack__fold-show">Show</span>
          </button>
        ) : (
          <>
            <h2 className="type-eyebrow">
              {askCount > 0 ? "Needs you" : "Current work"}
            </h2>
            {askCount > 0 ? (
              <button
                aria-expanded
                className="luca-room-stack__hide"
                data-testid="room-stack-hide"
                onClick={() => setMode("hidden")}
                type="button"
              >
                Hide
              </button>
            ) : null}
          </>
        )}
      </div>
      <div className="luca-room-stack__body" hidden={folded} ref={bodyRef}>
        {askCount > 0 ? (
          <ul className="luca-ask-list luca-room-stack__asks">{asks}</ul>
        ) : null}
        {children}
      </div>
    </section>
  );
}
