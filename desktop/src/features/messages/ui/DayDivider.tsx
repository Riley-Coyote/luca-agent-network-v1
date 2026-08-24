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
      className="pointer-events-none sticky top-[var(--buzz-day-pill-sticky-top,var(--buzz-channel-content-top-padding,5.75rem))] z-20 flex justify-center"
      data-testid="message-timeline-day-divider"
      data-day-label={label}
    >
      <p className="relative z-10 shrink-0 rounded-full border border-border/70 bg-background px-2.5 py-1 text-2xs font-medium tracking-caps text-ink-faint">
        {label}
      </p>
    </section>
  );
}
