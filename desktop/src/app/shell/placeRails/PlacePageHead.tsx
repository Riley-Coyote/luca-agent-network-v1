import "@/app/shell/shell-place-rails.css";

/** The places' own names (SHELL_SPEC.md, "The places column"). */
const PLACE_NAMES = new Set(["Chats", "Agents", "Activity", "Library"]);

/**
 * The head of a card a place's rail opens (SHELL_BUILD.md WP-10, Decided 8;
 * the study's `PlacePage`): a quiet line saying the section, over the picked
 * row's name. A mind's own detail keeps its own head until WP-13.
 *
 * The quiet line goes when it would only repeat the place's own name
 * ("Activity" over Now, "Library" over Recently deleted), as the study's head
 * goes without one; it stays when it says something else ("Group",
 * "Signed record", "Connected · on this Mac") (WP-19).
 */
export function PlacePageHead({
  eyebrow,
  title,
}: {
  eyebrow?: string;
  title: string;
}) {
  const said = eyebrow && !PLACE_NAMES.has(eyebrow) ? eyebrow : null;
  return (
    <header className="luca-place-page-head" data-testid="place-page-head">
      {said ? <p className="luca-place-page-eyebrow">{said}</p> : null}
      <h1 className="luca-place-page-name">{title}</h1>
    </header>
  );
}
