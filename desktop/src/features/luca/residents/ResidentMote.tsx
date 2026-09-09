import * as React from "react";

import { useDeferredLoad } from "@/shared/hooks/useDeferredStartup";
import "@/shared/ui/mote3d.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import "./residentMote.css";

const RESIDENT_MOTE_TINT = "#c96442";
const RESIDENT_MOTE_SIZE_KEY = "luca.resident-mote-size.v1";
// Scheduling budgets, not motion durations: how long the companion may wait
// for an idle moment before it mounts anyway, and how long the app may wait
// before warming a renderer.
const RESIDENT_MOTE_ARRIVAL_TIMEOUT_MS = 240;
const RESIDENT_MOTE_WARMUP_TIMEOUT_MS = 4_000;

const MOTE_SIZES = {
  small: { height: 42, unitWidth: 30 },
  medium: { height: 58, unitWidth: 38 },
  large: { height: 76, unitWidth: 48 },
  extraLarge: { height: 112, unitWidth: 68 },
  display: { height: 164, unitWidth: 92 },
} as const;

type ResidentMoteSize = keyof typeof MOTE_SIZES;

let currentMoteSize: ResidentMoteSize | null = null;
const moteSizeListeners = new Set<() => void>();

function parseMoteSize(value: string | null): ResidentMoteSize {
  return value === "small" ||
    value === "medium" ||
    value === "large" ||
    value === "extraLarge" ||
    value === "display"
    ? value
    : "large";
}

function getMoteSize() {
  if (currentMoteSize) return currentMoteSize;
  currentMoteSize = parseMoteSize(
    typeof window === "undefined"
      ? null
      : window.localStorage.getItem(RESIDENT_MOTE_SIZE_KEY),
  );
  return currentMoteSize;
}

function handleMoteSizeStorage(event: StorageEvent) {
  if (event.key !== RESIDENT_MOTE_SIZE_KEY) return;
  currentMoteSize = parseMoteSize(event.newValue);
  for (const listener of moteSizeListeners) listener();
}

function subscribeToMoteSize(listener: () => void) {
  if (moteSizeListeners.size === 0) {
    window.addEventListener("storage", handleMoteSizeStorage);
  }
  moteSizeListeners.add(listener);
  return () => {
    moteSizeListeners.delete(listener);
    if (moteSizeListeners.size === 0) {
      window.removeEventListener("storage", handleMoteSizeStorage);
    }
  };
}

function setMoteSize(size: ResidentMoteSize) {
  currentMoteSize = size;
  window.localStorage.setItem(RESIDENT_MOTE_SIZE_KEY, size);
  for (const listener of moteSizeListeners) listener();
}

type Mote3DConstructor = CustomElementConstructor & {
  warm?: (size: { width: number; height: number }) => Promise<void>;
};

/**
 * Warm a companion renderer at idle, so the first thread with a resident
 * opens on compiled shaders and an allocated drawing buffer instead of
 * paying for a WebGL context, a compile and a resize on the click. The
 * element keeps a document-wide renderer pool; this only asks it to fill
 * the first slot early, at the box a single companion will use.
 */
export function useResidentMoteWarmup(enabled: boolean) {
  const ready = useDeferredLoad({ timeoutMs: RESIDENT_MOTE_WARMUP_TIMEOUT_MS });
  React.useEffect(() => {
    if (!enabled || !ready) return;
    const element = customElements.get("mote-3d") as
      | Mote3DConstructor
      | undefined;
    const { height } = MOTE_SIZES[getMoteSize()];
    void element?.warm?.({ width: height, height });
  }, [enabled, ready]);
}

type ResidentMoteProps = {
  count: number;
};

export function ResidentMote({ count }: ResidentMoteProps) {
  const residentCount = Math.min(4, Math.max(0, count));
  const size = React.useSyncExternalStore<ResidentMoteSize>(
    subscribeToMoteSize,
    getMoteSize,
    () => "large",
  );
  // The conversation lands first. The frame reserves the companion's box at
  // once; the element itself mounts when the thread is idle and fades in.
  const arrived = useDeferredLoad({
    timeoutMs: RESIDENT_MOTE_ARRIVAL_TIMEOUT_MS,
  });
  if (residentCount === 0) return null;

  const dimensions = MOTE_SIZES[size];
  const width = Math.min(
    440,
    dimensions.height + (residentCount - 1) * dimensions.unitWidth,
  );
  const crew = Array.from({ length: residentCount }, () => RESIDENT_MOTE_TINT);
  const attributes = {
    "aria-hidden": true,
    className: "luca-resident-mote",
    crew: residentCount > 1 ? crew.join(",") : undefined,
    "data-count": residentCount,
    "data-size": size,
    "data-testid": "resident-header-mote",
    expression: "ambient",
    key: `resident-mote-${residentCount}`,
    species: "mote",
    style: { height: dimensions.height, width },
    tint: residentCount === 1 ? RESIDENT_MOTE_TINT : undefined,
  };
  const companionLabel = `${residentCount} resident ${residentCount === 1 ? "companion" : "companions"}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`${companionLabel}. Change companion size.`}
          className="luca-resident-mote-frame"
          data-size={size}
          style={{ height: dimensions.height, width }}
          title={`${companionLabel} · ${size} size`}
          type="button"
        >
          {arrived ? React.createElement("mote-3d", attributes) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-36">
        <DropdownMenuLabel>Companion size</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          onValueChange={(value) => setMoteSize(parseMoteSize(value))}
          value={size}
        >
          <DropdownMenuRadioItem value="small">Small</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="medium">Medium</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="large">Large</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="extraLarge">
            Extra large
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="display">Display</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
