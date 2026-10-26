import type * as React from "react";

import "@/app/shell/shell-place-rails.css";
import { cn } from "@/shared/lib/cn";

/**
 * The page a place's rail opens (the study's `.shell-page`; SHELL_BUILD.md
 * WP-10): one wrapper for every card this package adds, so the head sits in
 * the same place in each, 30 below the card's top and 28 in, and the head
 * and its lists share one axis, 640 wide, centred on the card.
 */
export function PlacePage({
  children,
  testId,
}: {
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="luca-place-page" data-testid={testId}>
      <div className="luca-place-page-axis">{children}</div>
    </div>
  );
}

/** A list on the page's axis, under its eyebrow (`.shell-page-group`). */
export function PlaceList({
  children,
  label,
  testId,
}: {
  children: React.ReactNode;
  label?: string;
  testId?: string;
}) {
  return (
    <section
      aria-label={label}
      className="luca-place-group"
      data-testid={testId}
    >
      {label ? <h2 className="type-eyebrow">{label}</h2> : null}
      <ul>{children}</ul>
    </section>
  );
}

/**
 * A row of a place's list (`.shell-page-group li`): what it is, at full ink,
 * with a quiet line under it; a quiet word or action beside it; and the
 * quiet note at the end, in its 84 column. An action shows on hover and on
 * focus, and is always in the Tab order.
 */
export function PlaceListRow({
  action,
  as: Tag = "li",
  className,
  detail,
  note,
  onOpen,
  openLabel,
  summary,
  testId,
  title,
  ...rest
}: {
  action?: React.ReactNode;
  /** A row in a list (`li`), or standing alone in a stream (`div`). */
  as?: "li" | "div";
  className?: string;
  detail?: React.ReactNode;
  note?: React.ReactNode;
  onOpen?: () => void;
  openLabel?: string;
  summary?: React.ReactNode;
  testId?: string;
  title: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, "title">) {
  const what = (
    <>
      <span className="luca-place-row-title">{title}</span>
      {summary ? (
        <span className="luca-place-row-summary">{summary}</span>
      ) : null}
    </>
  );
  return (
    <Tag
      className={cn("luca-place-row", className)}
      data-testid={testId}
      {...rest}
    >
      {onOpen ? (
        <button
          aria-label={openLabel}
          className="luca-place-row-what luca-place-row-open"
          onClick={onOpen}
          type="button"
        >
          {what}
        </button>
      ) : (
        <span className="luca-place-row-what">{what}</span>
      )}
      <span className="luca-place-row-middle">
        {detail ? (
          <span className="luca-place-row-detail">{detail}</span>
        ) : null}
        {action ? (
          <span className="luca-place-row-action">{action}</span>
        ) : null}
      </span>
      <span className="luca-place-row-note">{note}</span>
    </Tag>
  );
}

/** When, short, as the study's row notes say it: a time today, a day this
 *  year, a day and year before that. Empty when there is no time. */
export function placeNoteTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const today = new Date();
  return new Intl.DateTimeFormat(
    undefined,
    at.toDateString() === today.toDateString()
      ? { hour: "numeric", minute: "2-digit" }
      : at.getFullYear() === today.getFullYear()
        ? { day: "numeric", month: "short" }
        : { day: "numeric", month: "short", year: "numeric" },
  ).format(at);
}
