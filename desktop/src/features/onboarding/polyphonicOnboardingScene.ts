import { useSyncExternalStore } from "react";

/**
 * Where the onboarding field lives right now.
 *
 * The dendrite that grows on the door is the one object of onboarding, and it
 * must survive the boundary between the machine gate (a React tree that
 * unmounts on Begin) and the personal-home flow (a different tree that mounts
 * after several loading gates). So it is not rendered by either: the door and
 * the card only *publish* where the field should be, and a single layer
 * mounted at the top of the app draws it there. Loading gates read `stage`
 * and stay quiet while a passage is in flight, so the field is the loader.
 */
export type PolyphonicSceneStage =
  | "off"
  | "door"
  | "opening"
  | "card"
  /** The card is done and the conversation is mounting beneath: the layer
   *  holds a canvas veil over the seam, then fades veil and field together. */
  | "leaving"
  /** The veil is exiting; the conversation is exposed when that exit ends. */
  | "fading";

export interface PolyphonicSceneAnchor {
  /** Centre of the field, viewport px. */
  x: number;
  y: number;
  /** Width the field should occupy, viewport px. */
  width: number;
}

export interface PolyphonicScene {
  stage: PolyphonicSceneStage;
  anchor: PolyphonicSceneAnchor | null;
  /** True while Luca is being made ready: the field quiets, the mark leads. */
  resolving: boolean;
}

const OFF: PolyphonicScene = { stage: "off", anchor: null, resolving: false };

let scene: PolyphonicScene = OFF;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readPolyphonicScene(): PolyphonicScene {
  return scene;
}

export function usePolyphonicScene(): PolyphonicScene {
  return useSyncExternalStore(subscribe, readPolyphonicScene, () => OFF);
}

export function setPolyphonicScene(patch: Partial<PolyphonicScene>) {
  const next = { ...scene, ...patch };
  if (
    next.stage === scene.stage &&
    next.resolving === scene.resolving &&
    next.anchor?.x === scene.anchor?.x &&
    next.anchor?.y === scene.anchor?.y &&
    next.anchor?.width === scene.anchor?.width
  ) {
    return;
  }
  scene = next;
  emit();
}

/** The door or the card is gone without a passage in flight: put the field away. */
export function releasePolyphonicScene(from: PolyphonicSceneStage) {
  if (scene.stage === from) setPolyphonicScene({ ...OFF });
}

/** Test seam. */
export function resetPolyphonicScene() {
  scene = OFF;
  emit();
}
