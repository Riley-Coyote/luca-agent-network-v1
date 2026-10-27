import type * as React from "react";

import "@/app/shell/shell-place-rails.css";

/** The places' own names (SHELL_SPEC.md, "The places column"). */
const PLACE_NAMES = new Set(["Chats", "Agents", "Activity", "Library"]);

/**
 * The head of a card a place's rail opens (SHELL_BUILD.md WP-10, Decided 8;
 * BETA14_RELEASE.md WP-33, Decided 1; the lab's `PageHead`): the page names
 * what it is. Its face on a tile (the rail row's own face, grown), a quiet
 * line saying the section, the name, one line of how it is now, and the
 * page's one action at the end, where it has one.
 *
 * The quiet line goes when it would only repeat the place's own name
 * ("Activity" over Now, "Library" over Recently deleted), as the study's head
 * goes without one; it stays when it says something else ("Group",
 * "Signed record", "Connected · on this Mac") (WP-19).
 */
export function PlacePageHead({
  action,
  eyebrow,
  face,
  state,
  title,
}: {
  /** The page's one action, at the head's end. */
  action?: React.ReactNode;
  eyebrow?: string;
  /** The rail row's own face: a line drawing, the agent mark, a maker's
   *  mark. Drawn on the head's tile at 22. */
  face?: React.ReactNode;
  /** One line of how it is now, from real data only. */
  state?: React.ReactNode;
  title: string;
}) {
  const said = eyebrow && !PLACE_NAMES.has(eyebrow) ? eyebrow : null;
  return (
    <header
      className="luca-place-page-head"
      data-faced={face ? "" : undefined}
      data-testid="place-page-head"
    >
      {face ? (
        <span
          aria-hidden="true"
          className="luca-place-page-face"
          data-testid="place-page-face"
        >
          <span className="luca-place-face">{face}</span>
        </span>
      ) : null}
      <div className="luca-place-page-who">
        {said ? <p className="luca-place-page-eyebrow">{said}</p> : null}
        <h1 className="luca-place-page-name">{title}</h1>
        {state ? (
          <p className="luca-place-page-state" data-testid="place-page-state">
            {state}
          </p>
        ) : null}
      </div>
      {action ? <div className="luca-place-page-action">{action}</div> : null}
    </header>
  );
}
