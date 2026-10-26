import type * as React from "react";

import "@/app/shell/shell-activity.css";
import "@/app/shell/shell-place-rails.css";
import { cn } from "@/shared/lib/cn";

/**
 * A question waiting on you, as one flat row of a place's list (SHELL_BUILD.md
 * WP-14, review fix 6): WP-10's row (PlacePage.tsx, `.luca-place-row`), with
 * its answers always in view.
 *
 * - The title is the ask in its own words; under it, who asks and where. The
 *   title opens the conversation, and so does the rest of the row.
 * - The answers are quiet hairline buttons in the row's middle column, above
 *   the row's own click.
 * - One faint line may follow (a proposal's defaults, a disclosure), and the
 *   long form, when one is opened, lies under the row, never in it.
 * - The time sits in the 84 column; "now" when the ask carries none.
 *
 * Built for every place that asks: Activity's Needs you, and a mind's space,
 * which asks the same questions.
 */
export function PlaceAskRow({
  answers,
  className,
  extra,
  note,
  onOpen,
  openLabel,
  openTestId,
  panel,
  summary,
  title,
  ...rest
}: {
  answers?: React.ReactNode;
  className?: string;
  /** One faint line under who asks: details, defaults, a way to change them. */
  extra?: React.ReactNode;
  note: React.ReactNode;
  onOpen: () => void;
  openLabel: string;
  openTestId?: string;
  /** The long form, opened in place under the row. */
  panel?: React.ReactNode;
  summary: React.ReactNode;
  title: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLLIElement>, "title">) {
  return (
    <li className={cn("luca-ask", className)} {...rest}>
      <div className="luca-place-row luca-ask-row">
        <button
          aria-label={openLabel}
          className="luca-place-row-what luca-place-row-open"
          data-testid={openTestId}
          onClick={onOpen}
          title={typeof title === "string" ? title : undefined}
          type="button"
        >
          <span className="luca-place-row-title">{title}</span>
          <span className="luca-place-row-summary">{summary}</span>
        </button>
        <span className="luca-place-row-middle luca-ask-answers">
          {answers}
        </span>
        <span className="luca-place-row-note">{note}</span>
        {extra ? <div className="luca-ask-extra">{extra}</div> : null}
      </div>
      {panel ? <div className="luca-ask-panel">{panel}</div> : null}
    </li>
  );
}

/** An answer: a hairline button, no fill and no accent (the paused
 *  exchange's, which is the model). `pressed` marks a chosen option. */
export function PlaceQuietButton({
  children,
  pressed,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { pressed?: boolean }) {
  return (
    <button
      aria-pressed={pressed}
      className="luca-quiet-button"
      type="button"
      {...rest}
    >
      {children}
    </button>
  );
}

/** A faint link-like control inside an ask's extra line ("Details",
 *  "Change…"). */
export function PlaceAskLink({
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className="luca-ask-link" type="button" {...rest}>
      {children}
    </button>
  );
}
