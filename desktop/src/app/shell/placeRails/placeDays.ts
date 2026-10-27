/**
 * A day's name, on every page that groups by day (BETA14_RELEASE.md WP-37,
 * Decided 4): the Notebook, All activity and the signed record say a day the
 * same way. "Today", "Yesterday", then the weekday and the date ("Friday,
 * Oct 23"), with the year when it isn't this year ("Friday, Oct 23, 2025").
 * The conversation's own date pill keeps its form.
 *
 * Kept pure (no React, no styles), so the lib-level `*.test.mjs` suite and
 * the pure stream builders can use it.
 */
export function placeDayLabel(
  at: number | Date,
  now: number | Date = Date.now(),
  locale?: string,
): string {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (day.getTime() === today.getTime()) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (day.getTime() === yesterday.getTime()) return "Yesterday";
  return new Intl.DateTimeFormat(
    locale,
    day.getFullYear() === today.getFullYear()
      ? { weekday: "long", month: "short", day: "numeric" }
      : { weekday: "long", month: "short", day: "numeric", year: "numeric" },
  ).format(day);
}
