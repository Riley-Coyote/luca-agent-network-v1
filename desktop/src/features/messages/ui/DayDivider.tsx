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
      className="pointer-events-none sticky top-[var(--buzz-day-pill-sticky-top,var(--buzz-channel-content-top-padding,5.75rem))] z-20 flex items-center gap-2.5 px-6"
      data-testid="message-timeline-day-divider"
      data-day-label={label}
    >
      {/* The same furniture as a visit threshold — a hairline with a word on
          it — so the timeline has one kind of divider, not two. The label
          keeps a sliver of floor behind it so the rule does not run through
          the letters when it parks under the header. */}
      <span aria-hidden className="luca-visit-threshold__rule" />
      <p className="relative z-10 shrink-0 bg-background px-2.5 text-2xs tracking-caps text-ink-faint">
        {label}
      </p>
      <span aria-hidden className="luca-visit-threshold__rule" />
    </section>
  );
}
