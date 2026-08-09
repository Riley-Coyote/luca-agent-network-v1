export const SIDEBAR_WIDTH_STORAGE_KEY = "luca-conversation-sidebar-width";
export const SIDEBAR_WIDTH_DEFAULT = 264;
export const SIDEBAR_WIDTH_MOBILE = "288px";
export const SIDEBAR_WIDTH_ICON = "48px";

const SIDEBAR_WIDTH_DEFAULT_HAPTIC_THRESHOLD = 2;
const SIDEBAR_WIDTH_DEFAULT_SNAP_DISTANCE = 8;
const SIDEBAR_WIDTH_DEFAULT_MAGNET_DISTANCE = 28;
const SIDEBAR_WIDTH_MIN = 220;
const SIDEBAR_WIDTH_MAX = 420;

export function clampSidebarWidth(width: number) {
  return Math.min(
    SIDEBAR_WIDTH_MAX,
    Math.max(SIDEBAR_WIDTH_MIN, Math.round(width)),
  );
}

export function isSidebarWidthNearDefault(width: number) {
  return (
    Math.abs(width - SIDEBAR_WIDTH_DEFAULT) <=
    SIDEBAR_WIDTH_DEFAULT_HAPTIC_THRESHOLD
  );
}

export function magnetizeSidebarWidth(width: number) {
  const offset = width - SIDEBAR_WIDTH_DEFAULT;
  const distance = Math.abs(offset);

  if (distance <= SIDEBAR_WIDTH_DEFAULT_SNAP_DISTANCE) {
    return SIDEBAR_WIDTH_DEFAULT;
  }

  if (distance >= SIDEBAR_WIDTH_DEFAULT_MAGNET_DISTANCE) {
    return clampSidebarWidth(width);
  }

  const progress =
    (distance - SIDEBAR_WIDTH_DEFAULT_SNAP_DISTANCE) /
    (SIDEBAR_WIDTH_DEFAULT_MAGNET_DISTANCE -
      SIDEBAR_WIDTH_DEFAULT_SNAP_DISTANCE);
  const easedDistance =
    SIDEBAR_WIDTH_DEFAULT_MAGNET_DISTANCE * progress * progress;

  return clampSidebarWidth(
    SIDEBAR_WIDTH_DEFAULT + Math.sign(offset) * easedDistance,
  );
}

export function hasReachedSidebarDefaultWidth(
  previousWidth: number,
  nextWidth: number,
) {
  return (
    isSidebarWidthNearDefault(nextWidth) ||
    (previousWidth < SIDEBAR_WIDTH_DEFAULT &&
      nextWidth > SIDEBAR_WIDTH_DEFAULT) ||
    (previousWidth > SIDEBAR_WIDTH_DEFAULT && nextWidth < SIDEBAR_WIDTH_DEFAULT)
  );
}

export function readSidebarWidth() {
  if (typeof window === "undefined") {
    return SIDEBAR_WIDTH_DEFAULT;
  }

  const storedWidth = Number.parseInt(
    window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY) ?? "",
    10,
  );

  return Number.isFinite(storedWidth)
    ? clampSidebarWidth(storedWidth)
    : SIDEBAR_WIDTH_DEFAULT;
}
