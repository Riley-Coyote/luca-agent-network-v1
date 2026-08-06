/**
 * Scroll a message into view and flash it.
 *
 * This is the other half of the quote-reply model, and it is not optional: a
 * quote that cannot take you to its source is a dead end. Every messenger that
 * ships quote-reply — WhatsApp, Telegram, Signal, iMessage — makes the quote
 * tappable for exactly this reason.
 *
 * The flash matters as much as the scroll. Landing mid-transcript with no
 * confirmation of WHICH message you arrived at is disorienting, so the target
 * announces itself and then fades back into the room.
 */

/** Matches the `route-target-highlight-fade` keyframe duration. */
const FLASH_MS = 2000;

const FLASH_CLASSES = [
  "before:absolute",
  "before:-inset-y-1.5",
  "before:inset-x-0",
  "before:animate-[route-target-highlight-fade_2s_ease-out_forwards]",
  "before:bg-primary/10",
  "before:content-['']",
  "motion-reduce:before:animate-none",
];

export function jumpToMessage(messageId: string): boolean {
  if (typeof document === "undefined") return false;

  const target = document.querySelector<HTMLElement>(
    `[data-message-id="${CSS.escape(messageId)}"]`,
  );
  // The parent can legitimately be outside the loaded window; callers should
  // already have disabled the affordance, but scrollback can unload it later.
  if (!target) return false;

  target.scrollIntoView({
    behavior: prefersReducedMotion() ? "auto" : "smooth",
    block: "center",
  });

  const host = target.closest<HTMLElement>(".group\\/message") ?? target;
  host.classList.add("relative", ...FLASH_CLASSES);
  window.setTimeout(() => {
    host.classList.remove(...FLASH_CLASSES);
  }, FLASH_MS);

  return true;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
