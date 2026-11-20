import type * as React from "react";

import { PlaceList, PlaceListRow } from "@/app/shell/placeRails/PlacePage";
import { NeedsNewer, PlaceLine, RoomFrame } from "./MnemosParts";
import { type RoomProps, useAddressItem } from "./roomKit";

/** One row of a notebook section, and what it opens. */
export type Item = {
  /** The engine's own id, or `#…` for a thing it gives no id (a belief, a
   *  note carried forward): those open by their place in the list. */
  key: string;
  title: string;
  note?: React.ReactNode;
  summary?: React.ReactNode;
  opened: () => React.ReactNode;
};

/** A section's rows, in groups each with its label (or none). */
export type ItemGroup = { label?: string; items: Item[] };

/**
 * A section of a newer Mnemos's notebook: its rows beside the thing opened,
 * the thing opened named in the address (so another section can open it,
 * as the Log does), and one plain line where an older Mnemos can't feed it.
 */
export function ItemsRoom({
  backLabel,
  empty,
  groups,
  needs,
  props,
  testId,
}: {
  backLabel: string;
  empty: string;
  /** The rows, from the notebook; null while it has none to give. */
  groups: ItemGroup[] | null;
  /** What the section is, for the older Mnemos's line ("Hours"). */
  needs: string;
  props: RoomProps;
  testId: string;
}) {
  const { item, mind, notebook, openItem } = props;
  const all = (groups ?? []).flatMap((g) => g.items);
  const has = (key: string) => all.some((each) => each.key === key);
  // An engine id is checked with the engine; a `#…` key only with the list.
  const local = item?.startsWith("#") ?? false;
  const checked = useAddressItem(
    mind.id,
    local ? null : item,
    has,
    groups !== null,
    openItem,
  );
  const opened = local ? (item && has(item) ? item : null) : checked;
  const current = all.find((each) => each.key === opened) ?? null;
  if (!notebook) return <NeedsNewer what={needs} />;
  return (
    <RoomFrame
      addressed={item}
      backLabel={backLabel}
      first={all[0]?.key ?? null}
      list={
        groups === null ? null : all.length === 0 ? (
          <PlaceLine>{empty}</PlaceLine>
        ) : (
          groups
            .filter((g) => g.items.length)
            .map((g) => (
              <PlaceList
                count={g.label ? g.items.length : undefined}
                key={g.label ?? "all"}
                label={g.label}
                testId={`${testId}-list`}
              >
                {g.items.map((each) => (
                  <PlaceListRow
                    aria-current={each.key === opened ? "true" : undefined}
                    key={each.key}
                    note={each.note}
                    onOpen={() => openItem(each.key)}
                    summary={each.summary}
                    testId={`${testId}-row-${each.key}`}
                    title={each.title}
                  />
                ))}
              </PlaceList>
            ))
        )
      }
      onBack={() => openItem(null)}
      onOpenFirst={(key) => openItem(key, { replace: true })}
      opened={current ? current.opened() : null}
      openedKey={current ? current.key : null}
      testId={testId}
    />
  );
}
