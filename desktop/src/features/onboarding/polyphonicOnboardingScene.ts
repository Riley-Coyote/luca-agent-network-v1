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
  /** The card is done and the conversation is mounting beneath: the shell
   *  grows into the window, the field dissolves and the glyph travels to the
   *  sidebar's own mark. Nothing is thrown away and nothing is veiled. */
  | "becoming"
  /** Where the glyph publishes from once the application is up. Never a
   *  stage the layer enters; see usePublishFieldAnchor. */
  | "app";

export interface PolyphonicSceneAnchor {
  /** Centre of the field, viewport px. */
  x: number;
  y: number;
  /** Width the field should occupy, viewport px. */
  width: number;
}

export interface PolyphonicScene {
  stage: Exclude<PolyphonicSceneStage, "app">;
  anchor: PolyphonicSceneAnchor | null;
  /** Where the glyph lands when the card becomes the app: the rect of the
   *  sidebar's own Luca mark, published by the sidebar once it renders. */
  landing: PolyphonicSceneAnchor | null;
  /** True while Luca is being made ready: the field quiets, the mark leads. */
  resolving: boolean;
}

const OFF: PolyphonicScene = {
  stage: "off",
  anchor: null,
  landing: null,
  resolving: false,
};

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

function sameAnchor(
  a: PolyphonicSceneAnchor | null,
  b: PolyphonicSceneAnchor | null,
) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.width === b.width;
}

export function setPolyphonicScene(patch: Partial<PolyphonicScene>) {
  const next = { ...scene, ...patch };
  if (
    next.stage === scene.stage &&
    next.resolving === scene.resolving &&
    sameAnchor(next.anchor, scene.anchor) &&
    sameAnchor(next.landing, scene.landing)
  ) {
    return;
  }
  scene = next;
  emit();
}

/**
 * The sidebar's own Luca mark, once the application is up. It is published
 * independently of `stage` so the mark can be found while the card is still
 * the only thing on screen; it never moves the field on its own.
 */
export function setPolyphonicLanding(landing: PolyphonicSceneAnchor | null) {
  setPolyphonicScene({ landing });
}

/** The door or the card is gone without a passage in flight: put the field away. */
export function releasePolyphonicScene(from: PolyphonicSceneStage) {
  if (scene.stage === from)
    setPolyphonicScene({ ...OFF, landing: scene.landing });
}

/** Test seam. */
export function resetPolyphonicScene() {
  scene = OFF;
  emit();
}
