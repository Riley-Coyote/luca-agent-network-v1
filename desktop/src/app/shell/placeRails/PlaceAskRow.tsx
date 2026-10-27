import type * as React from "react";

import "@/app/shell/shell-activity.css";
import "@/app/shell/shell-place-rails.css";
import { PlaceRowFace } from "@/app/shell/placeRails/PlacePage";
import { cn } from "@/shared/lib/cn";

/**
 * A question waiting on you, as one flat row of a place's list (SHELL_BUILD.md
 * WP-14, review fix 6): WP-10's row (PlacePage.tsx, `.luca-place-row`), with
 * its answers always in view. One drawing everywhere an ask is put to you
 * (WP-16, Decided 2): Activity's Needs you, a mind's Notebook, and a
 * conversation's own pending stack.
 *
 * - The title is the ask in its own words; under it, who asks and where. In a
 *   list the title opens the conversation, and so does the rest of the row; in
 *   the conversation itself (no `onOpen`) it is only words.
 * - One faint line may follow (a proposal's defaults, a disclosure).
 * - The answers sit under the ask's text at every width, never beside it, so
 *   the ask is never squeezed: the study's answers, a plain tint of the ink,
 *   above the row's own click.
 * - The long form, when one is opened, lies under the row, never in it.
 * - The time, when the list keeps one, sits in the 84 column; "now" when the
 *   ask carries none.
 * - On a page it sits on a plate, led by the asker's face, its words at
 *   15/21 (BETA14_RELEASE.md WP-33, Decided 6); in the conversation it has
 *   no face and keeps its own size.
 */
export function PlaceAskRow({
  answers,
  className,
  extra,
  face,
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
  /** Who asks, at 20 before the words (on a page's plate). */
  face?: React.ReactNode;
  /** The time, in its column; none in the conversation the ask is in. */
  note?: React.ReactNode;
  /** Opens the conversation; none in the conversation the ask is in. */
  onOpen?: () => void;
  openLabel?: string;
  openTestId?: string;
  /** The long form, opened in place under the row. */
  panel?: React.ReactNode;
  summary: React.ReactNode;
  title: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLLIElement>, "title">) {
  return (
    <li className={cn("luca-ask", className)} {...rest}>
      <div
        className="luca-place-row luca-ask-row"
        data-faced={face ? "" : undefined}
        data-noted={note === undefined ? undefined : ""}
      >
        {face ? <PlaceRowFace>{face}</PlaceRowFace> : null}
        {onOpen ? (
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
        ) : (
          <div className="luca-place-row-what">
            <span className="luca-place-row-title">{title}</span>
            <span className="luca-place-row-summary">{summary}</span>
          </div>
        )}
        {note === undefined ? null : (
          <span className="luca-place-row-note">{note}</span>
        )}
        {extra ? <div className="luca-ask-extra">{extra}</div> : null}
        <span className="luca-place-row-middle luca-ask-answers">
          {answers}
        </span>
      </div>
      {panel ? <div className="luca-ask-panel">{panel}</div> : null}
    </li>
  );
}

/** An answer: the study's answer (shellStudy.css, `.shell-mind-answer`), a
 *  plain tint of the ink, no outline and no accent. `pressed` marks a chosen
 *  option. */
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
