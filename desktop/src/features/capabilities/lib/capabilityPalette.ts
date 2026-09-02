export type CapabilityPaletteSearchable = {
  name: string;
  description: string;
};

export function filterCapabilityPaletteItems<
  T extends CapabilityPaletteSearchable,
>(items: T[], query: string): T[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return items;
  return items.filter((item) =>
    `${item.name} ${item.description}`.toLocaleLowerCase().includes(needle),
  );
}

export function nextCapabilityPaletteIndex(
  current: number,
  enabledCount: number,
  direction: -1 | 1,
): number {
  if (enabledCount <= 0) return 0;
  return Math.max(0, Math.min(current + direction, enabledCount - 1));
}
