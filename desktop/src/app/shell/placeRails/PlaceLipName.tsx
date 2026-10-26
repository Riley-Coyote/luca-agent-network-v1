import type * as React from "react";

import "@/app/shell/shell-place-rails.css";

import type { AppView } from "@/app/AppShell.helpers";
import type { RailPlace } from "@/app/shell/placeRails/placePicks";
import { shellFramePageName } from "@/app/shell/shellFrame";
import {
  PLACE_RAIL_HOOKS,
  pickedRow,
  usePlacePick,
} from "@/app/shell/placeRails/usePlaceRails";

/**
 * The lip's name on a place with its own rail: the picked row's name
 * (SHELL_BUILD.md WP-10, Decided 8). Off the place's own route (Brain,
 * under Agents), or before its rows arrive, the page's own name.
 */
export function PlaceLipName({
  fallback,
  place,
}: {
  fallback: string;
  place: RailPlace;
}) {
  return <PickName fallback={fallback} key={place} place={place} />;
}

function PickName({ fallback, place }: { fallback: string; place: RailPlace }) {
  const { sections } = PLACE_RAIL_HOOKS[place]();
  const { pick } = usePlacePick(place);
  const picked = pickedRow(sections, pick);
  if (!picked) return <>{fallback}</>;
  // A skill runtime reads under its section, as a session under its home:
  // "Skills / Claude Code" (SHELL_SPEC.md, "Tabs"). Made's kinds keep their
  // own name alone.
  if (picked.section.key === "skills" && picked.section.title)
    return (
      <>
        <span className="luca-lip-home">{picked.section.title}</span>
        <span className="luca-lip-sep">{" / "}</span>
        {picked.row.title}
      </>
    );
  return <>{picked.row.title}</>;
}

const RAIL_PLACE_OF_VIEW: Partial<Record<AppView, RailPlace>> = {
  agents: "agents",
  artifacts: "library",
  pulse: "activity",
};

/** What the lip says for a view: the pick's name on a place with its own
 *  rail, the page's own name elsewhere. */
export function shellFrameLipName(view: AppView): React.ReactNode {
  const place = RAIL_PLACE_OF_VIEW[view];
  const name = shellFramePageName(view);
  return place ? <PlaceLipName fallback={name} place={place} /> : name;
}
