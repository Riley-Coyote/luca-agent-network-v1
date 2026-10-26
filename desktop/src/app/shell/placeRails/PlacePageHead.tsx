import "@/app/shell/shell-place-rails.css";

/**
 * The head of a card a place's rail opens (SHELL_BUILD.md WP-10, Decided 8;
 * the study's `PlacePage`): a quiet line saying the section, over the picked
 * row's name. A mind's own detail keeps its own head until WP-13.
 */
export function PlacePageHead({
  eyebrow,
  title,
}: {
  eyebrow: string;
  title: string;
}) {
  return (
    <header className="luca-place-page-head" data-testid="place-page-head">
      <p className="luca-place-page-eyebrow">{eyebrow}</p>
      <h1 className="luca-place-page-name">{title}</h1>
    </header>
  );
}
