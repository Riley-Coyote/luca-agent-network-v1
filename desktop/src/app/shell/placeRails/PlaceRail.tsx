import type * as React from "react";
import { Plus } from "lucide-react";
import { useNavigate, useRouterState } from "@tanstack/react-router";

import "@/app/shell/shell-rail.css";
import "@/app/shell/shell-place-rails.css";
import {
  type RailPlace,
  searchForPick,
} from "@/app/shell/placeRails/placePicks";
import {
  PLACE_RAIL_HOOKS,
  type PlaceRailAdd,
  type PlaceRailRow,
  type PlaceRailSection,
  usePlacePick,
} from "@/app/shell/placeRails/usePlaceRails";

/**
 * Every place's own rail but Chats' (NAVIGATION.md, "The screen's rule";
 * SHELL_BUILD.md WP-10): the icons pick the place, this lists what's in it,
 * and the card shows the row picked. Its rows are Chats' rows (the same
 * classes, shell-rail.css): the same type, sizes, tones, 8-point corners,
 * eyebrows and `+`, the marks following the picked one
 * (`data-sidebar="menu-button" data-home data-active`). A quiet word at a
 * row's end is the lab's `.shell-row-note` (shell-place-rails.css).
 *
 * The pick is in the address (placePicks.ts): a row is a link to its place
 * with its words set, so Back and Forward step through picks.
 */

export const PLACE_ROUTE: Record<
  RailPlace,
  "/agents" | "/pulse" | "/artifacts"
> = {
  agents: "/agents",
  activity: "/pulse",
  library: "/artifacts",
};

/** Words a new pick in Agents starts without: the open tab, a profile
 *  panel's view, a request already answered. */
const AGENTS_CLEARED = [
  "profileTab",
  "profileView",
  "review",
  "section",
  "add",
] as const;

/** What a section's `+` asks of its card, by the address (consumed there
 *  with replace, as `review=native` is): Add agent and New group open the
 *  Agents page's own dialogs; Import, the Library's file picker. */
const ADD_SEARCH: Record<
  PlaceRailAdd,
  { to: "/agents" | "/artifacts"; word: string; value: string }
> = {
  "add-agent": { to: "/agents", word: "add", value: "agent" },
  "new-group": { to: "/agents", word: "add", value: "group" },
  import: { to: "/artifacts", word: "import", value: "file" },
};

/** Up and Down between the rail's rows. */
function railKeys(event: React.KeyboardEvent<HTMLDivElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const rows = [
    ...event.currentTarget.querySelectorAll<HTMLElement>("[data-rail-focus]"),
  ];
  const index = rows.indexOf(document.activeElement as HTMLElement);
  if (index < 0) return;
  event.preventDefault();
  const to = event.key === "ArrowDown" ? index + 1 : index - 1;
  rows[Math.max(0, Math.min(rows.length - 1, to))]?.focus();
}

export function PlaceRail({
  onPicked,
  place,
}: {
  /** After a row is picked: the narrow window's sheet closes. */
  onPicked?: () => void;
  place: RailPlace;
}) {
  // Keyed by place, so the rail hook below never changes under it.
  return <PlaceRailBody key={place} onPicked={onPicked} place={place} />;
}

function PlaceRailBody({
  onPicked,
  place,
}: {
  onPicked?: () => void;
  place: RailPlace;
}) {
  const { sections } = PLACE_RAIL_HOOKS[place]();
  const { pick } = usePlacePick(place);
  const navigate = useNavigate();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  const choose = (id: string) => {
    if (id === pick && pathname === PLACE_ROUTE[place]) {
      onPicked?.();
      return;
    }
    const sameRoute = pathname === PLACE_ROUTE[place];
    void navigate({
      to: PLACE_ROUTE[place],
      search: (previous: Record<string, unknown>) =>
        searchForPick(
          place,
          sameRoute ? previous : {},
          id,
          place === "agents" ? AGENTS_CLEARED : [],
        ),
      resetScroll: false,
      // A pick swaps the card in place; only a change of route drifts.
      viewTransition: !sameRoute,
    } as never);
    onPicked?.();
  };

  const add = (action: PlaceRailAdd) => {
    const target = ADD_SEARCH[action];
    const sameRoute = pathname === target.to;
    void navigate({
      to: target.to,
      search: (previous: Record<string, unknown>) => ({
        ...(sameRoute ? previous : {}),
        [target.word]: target.value,
      }),
      resetScroll: false,
      viewTransition: !sameRoute,
    } as never);
    onPicked?.();
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: arrow keys move between the rail's rows, as the Chats rail's do (ShellRail.tsx).
    <div
      className="luca-shell-rail luca-place-rail"
      data-place-rail={place}
      data-shell-rail=""
      data-testid={`place-rail-${place}`}
      onKeyDown={railKeys}
    >
      {sections.map((section) => (
        <RailSection
          key={section.key}
          onAdd={add}
          onPick={choose}
          pick={pick}
          place={place}
          section={section}
        />
      ))}
    </div>
  );
}

function RailSection({
  onAdd,
  onPick,
  pick,
  place,
  section,
}: {
  onAdd: (action: PlaceRailAdd) => void;
  onPick: (id: string) => void;
  pick: string | null;
  place: RailPlace;
  section: PlaceRailSection;
}) {
  return (
    <section
      aria-label={section.title ?? section.rows[0]?.title}
      className="luca-rail-section"
      data-place-section={section.key}
      data-testid={`place-section-${place}-${section.key}`}
    >
      {section.title ? (
        <div className="luca-rail-section-head type-eyebrow">
          <span>{section.title}</span>
          {section.add ? (
            <button
              aria-label={section.add.label}
              className="luca-rail-add"
              data-testid={`place-add-${section.add.action}`}
              onClick={() => onAdd(section.add?.action ?? "add-agent")}
              title={section.add.label}
              type="button"
            >
              <Plus aria-hidden />
            </button>
          ) : null}
        </div>
      ) : null}
      {section.rows.map((row) => (
        <Row
          key={row.id}
          onPick={onPick}
          picked={row.id === pick}
          place={place}
          row={row}
        />
      ))}
    </section>
  );
}

function Row({
  onPick,
  picked,
  place,
  row,
}: {
  onPick: (id: string) => void;
  picked: boolean;
  place: RailPlace;
  row: PlaceRailRow;
}) {
  return (
    <div
      className="luca-rail-row"
      data-active={picked ? "true" : undefined}
      data-home={`${place}:${row.id}`}
      data-main={row.main ? "true" : undefined}
      data-sidebar="menu-button"
      data-testid={`place-row-${row.id}`}
    >
      <button
        aria-current={picked ? "page" : undefined}
        aria-label={row.note ? `${row.title}, ${row.note}` : row.title}
        className="luca-rail-row-hit"
        data-rail-focus="home"
        onClick={() => onPick(row.id)}
        title={row.title}
        type="button"
      />
      <span aria-hidden className="luca-rail-row-name text-sm">
        {row.title}
      </span>
      {row.note ? (
        <span aria-hidden className="luca-rail-note text-2xs">
          {row.note}
        </span>
      ) : null}
    </div>
  );
}
