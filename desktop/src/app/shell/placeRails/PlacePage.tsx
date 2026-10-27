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

/**
 * A section of the page (BETA14_RELEASE.md WP-33, Decided 2): its label in
 * sentence case and its count, 8 above one plate that holds its rows
 * (Decided 3). A thread (Decided 5) is a list in time order: no hairlines,
 * a line under the faces from one to the next.
 */
export function PlaceList({
  children,
  count,
  label,
  testId,
  thread,
}: {
  children: React.ReactNode;
  /** How many rows the section holds, beside its label. */
  count?: number;
  label?: string;
  testId?: string;
  thread?: boolean;
}) {
  return (
    <section
      aria-label={label}
      className="luca-place-group"
      data-testid={testId}
    >
      {label ? <PlaceSectionLabel count={count} label={label} /> : null}
      <ul
        className="luca-place-plate"
        data-thread={thread ? "true" : undefined}
      >
        {children}
      </ul>
    </section>
  );
}

/** A section's label and its count (Decided 2): 12.5 at 600 in the muted
 *  ink, the count at 12, faint, in tabular figures. */
export function PlaceSectionLabel({
  count,
  label,
}: {
  count?: number;
  label: string;
}) {
  return (
    <h2 className="luca-place-section-label">
      <span>{label}</span>
      {count === undefined ? null : (
        <span className="luca-place-section-count">{count}</span>
      )}
    </h2>
  );
}

/** A row's face (Decided 4): the rail row's own drawing at 20. */
export function PlaceRowFace({
  children,
  label,
}: {
  children: React.ReactNode;
  /** Said when the face carries meaning the row's words don't (a kind). */
  label?: string;
}) {
  const className = "luca-place-face luca-place-row-face";
  return label ? (
    <span aria-label={label} className={className} role="img">
      {children}
    </span>
  ) : (
    <span aria-hidden="true" className={className}>
      {children}
    </span>
  );
}

/**
 * A row of a place's list (`.shell-page-group li`; WP-33, Decided 4): its
 * face, what it is, with a quiet line under it; a quiet word or action
 * beside it; and the quiet note at the end, in its 84 column. An action shows on hover and on
 * focus, and is always in the Tab order.
 */
export function PlaceListRow({
  action,
  as: Tag = "li",
  className,
  detail,
  face,
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
  /** Who or what the row is, at 20 before its words (on a plate). */
  face?: React.ReactNode;
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
      {face ? <PlaceRowFace>{face}</PlaceRowFace> : null}
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
