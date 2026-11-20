import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { isMnemosRoom } from "@/app/shell/placeRails/placePicks";

const MnemosScreen = React.lazy(async () => {
  const module = await import("@/features/mnemos/MnemosScreen");
  return { default: module.MnemosScreen };
});

/** The Mnemos place's address (WP-45): the mind in view, its room, and the
 *  thing opened there. Each is an opaque word the place checks again. */
type MnemosRouteSearch = {
  mind?: string;
  room?: string;
  item?: string;
};

/** The longest word the address keeps (the place's own id limit). */
const LONGEST = 128;

const word = (value: unknown) =>
  typeof value === "string" && value.length > 0 && value.length <= LONGEST
    ? value
    : undefined;

function validateMnemosSearch(
  search: Record<string, unknown>,
): MnemosRouteSearch {
  const out: MnemosRouteSearch = {};
  const mind = word(search.mind);
  if (mind) out.mind = mind;
  if (isMnemosRoom(search.room)) out.room = search.room;
  const item = word(search.item);
  if (item) out.item = item;
  return out;
}

export const Route = createFileRoute("/mnemos")({
  validateSearch: validateMnemosSearch,
  component: MnemosRouteComponent,
});

function MnemosRouteComponent() {
  return (
    <React.Suspense fallback={null}>
      <MnemosScreen />
    </React.Suspense>
  );
}
