export function DayDivider({ label }: { label: string }) {
  return (
    <section
      aria-label={label}
      // `position: sticky` resolves `top` against the scrollport's PADDING
      // edge, so what parks this pill on the header's bottom edge depends on
      // top padding only the scroll container knows it has. Each timeline
      // scroller therefore publishes `--buzz-day-pill-sticky-top`; the
      // fallback is the measured header height, correct for a scroller that
      // pads itself by nothing.
      // Under the shell, a pill gone up past the card's top hides: the
      // timeline's stuck pill stands in for it there (MessageTimeline, WP-29).
      className="pointer-events-none sticky top-[var(--buzz-day-pill-sticky-top,var(--buzz-channel-content-top-padding,5.75rem))] z-20 flex justify-center [&[data-day-passed]>p]:invisible"
      data-testid="message-timeline-day-divider"
      data-day-label={label}
    >
      <p className="luca-day-label relative z-10 shrink-0">{label}</p>
    </section>
  );
}
