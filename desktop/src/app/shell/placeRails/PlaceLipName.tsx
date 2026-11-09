import type * as React from "react";
import { useRouterState } from "@tanstack/react-router";

import "@/app/shell/shell-place-rails.css";

import type { AppView } from "@/app/AppShell.helpers";
import type { RailPlace } from "@/app/shell/placeRails/placePicks";
import { appPathOf } from "@/app/shell/placeRails/appTask";
import { shellFramePageName } from "@/app/shell/shellFrame";
import { useMindPageTitle } from "@/features/agents/space/mindPageTitle";
import { correspondencePathId } from "@/features/exchange/correspondenceNavigation";
import { useCorrespondenceTitle } from "@/features/exchange/correspondencePageTitle";
import { useAllRuntimeTasks } from "@/features/capabilities/useAllRuntimeTasks";
import { useRuntimeRailConnections } from "@/features/runtime-sessions/RuntimeRailSection";
import { runtimeRailFamilyFromRuntimeId } from "@/features/runtime-sessions/runtimeRailPreferences";
import {
  PLACE_RAIL_HOOKS,
  pickedRow,
  usePlacePick,
} from "@/app/shell/placeRails/usePlaceRails";

/**
 * The lip's name on a place with its own rail: the picked row's name
 * (SHELL_BUILD.md WP-10, Decided 8). Off the place's own route, or before
 * its rows arrive, the page's own name. Brain's lip says "Brain" whichever
 * view is picked (BETA14_RELEASE.md WP-38, Decided 2), so it isn't here.
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
  // A page pushed over a mind's own page: "Luca · Settings" (WP-43).
  const pushed = useMindPageTitle(
    place === "agents" && pick?.startsWith("mind:") ? pick.slice(5) : null,
  );
  if (!picked) return <>{fallback}</>;
  if (pushed)
    return (
      <>
        {picked.row.title}
        <span className="luca-lip-sep">{" · "}</span>
        <span data-testid="shell-lip-page">{pushed}</span>
      </>
    );
  // A skill runtime reads under its section, as a session under its home:
  // "Skills / Claude Code" (SHELL_SPEC.md, "Tabs"). So does a pick whose name
  // alone could be another's (WP-19): "Made / All" beside "Skills / All", and
  // a mind's record, "Signed record / Luca", not Luca herself. Made's other
  // kinds keep their own name alone.
  if (picked.section.title && namesAmbiguously(sections, picked))
    return (
      <>
        <span className="luca-lip-home">{picked.section.title}</span>
        <span className="luca-lip-sep">{" / "}</span>
        {picked.row.title}
      </>
    );
  return <>{picked.row.title}</>;
}

/** Sections whose rows are always said under the section's name. */
const SAID_UNDER_SECTION = new Set(["skills", "record"]);

/** Whether the picked row's name alone would be ambiguous in the lip. */
export function namesAmbiguously(
  sections: readonly { key: string; rows: readonly { title: string }[] }[],
  picked: { row: { title: string }; section: { key: string } },
): boolean {
  if (SAID_UNDER_SECTION.has(picked.section.key)) return true;
  // "All" says nothing until it says all of what, other sections or none.
  if (picked.row.title === "All") return true;
  return sections.some(
    (section) =>
      section.key !== picked.section.key &&
      section.rows.some((row) => row.title === picked.row.title),
  );
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
  if (view === "app") return <AppLipName fallback={name} />;
  if (view === "correspondence") return <CorrespondenceLipName />;
  return place ? <PlaceLipName fallback={name} place={place} /> : name;
}

function CorrespondenceLipName() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  return <>{useCorrespondenceTitle(correspondencePathId(pathname))}</>;
}

/** A connected app's page (WP-34): the app's own name, as its row in the
 *  Chats rail says it; one of its tasks (WP-35) under it, as a session is
 *  named under its home: "Claude Code / Fix the failing build". */
function AppLipName({ fallback }: { fallback: string }) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const { runtimes } = useRuntimeRailConnections();
  const path = appPathOf(pathname);
  const runtime = runtimes.find(
    (each) => runtimeRailFamilyFromRuntimeId(each.runtimeId) === path?.family,
  );
  const name = runtime?.label ?? fallback;
  if (path?.taskId)
    return <AppTaskLipName appName={name} taskId={path.taskId} />;
  return <>{name}</>;
}

function AppTaskLipName({
  appName,
  taskId,
}: {
  appName: string;
  taskId: string;
}) {
  const task = useAllRuntimeTasks().find((each) => each.taskId === taskId);
  if (!task) return <>{appName}</>;
  return (
    <>
      <span className="luca-lip-home">{appName}</span>
      <span aria-hidden className="luca-lip-rule">
        /
      </span>
      {task.summary}
    </>
  );
}
