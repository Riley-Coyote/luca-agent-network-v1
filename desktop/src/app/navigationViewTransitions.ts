type TransitionHost = Pick<Document, "startViewTransition"> &
  Partial<Pick<Document, "visibilityState">>;
type StartViewTransition = TransitionHost["startViewTransition"];

const installations = new WeakMap<
  TransitionHost,
  { start: StartViewTransition; restore: () => void }
>();

/**
 * Superseded or hidden-window animations may reject ready while navigation
 * still succeeds. Hidden documents use InvalidStateError in the native API.
 * Keep actual callback failures and visible-document readiness failures
 * observable; the native lifecycle promises stay intact.
 */
export async function observeNavigationTransitionReady(
  transition: Pick<ViewTransition, "ready" | "updateCallbackDone">,
  wasHidden: () => boolean = () => false,
): Promise<void> {
  try {
    await transition.ready;
  } catch (error) {
    if (
      !(error instanceof DOMException) ||
      (error.name !== "AbortError" &&
        !(error.name === "InvalidStateError" && wasHidden()))
    ) {
      throw error;
    }
    await transition.updateCallbackDone;
  }
}

/**
 * Own readiness where the router creates native transitions, without replacing
 * router option handling, animations, callbacks, or the native return object.
 * The returned cleanup restores only this installation, including on hot reload.
 */
export function installNavigationViewTransitions(
  target: TransitionHost | undefined = typeof document === "undefined"
    ? undefined
    : document,
): () => void {
  if (!target || typeof target.startViewTransition !== "function") {
    return () => {};
  }
  const existing = installations.get(target);
  if (existing && target.startViewTransition === existing.start) {
    return existing.restore;
  }

  const original = target.startViewTransition;
  const descriptor = Object.getOwnPropertyDescriptor(
    target,
    "startViewTransition",
  );
  const start: StartViewTransition = function (
    this: Document,
    ...args: Parameters<StartViewTransition>
  ) {
    const isHidden = () => this.visibilityState === "hidden";
    const hiddenAtStart = isHidden();
    const transition = original.apply(this, args);
    // Unexpected failures remain rejected and reach the normal browser error
    // surface. Only a skipped ready with a successful update is consumed.
    void observeNavigationTransitionReady(
      transition,
      () => hiddenAtStart || isHidden(),
    );
    return transition;
  };
  const restore = () => {
    if (target.startViewTransition === start) {
      if (descriptor) {
        Object.defineProperty(target, "startViewTransition", descriptor);
      } else {
        Reflect.deleteProperty(target, "startViewTransition");
      }
    }
    if (installations.get(target)?.start === start) {
      installations.delete(target);
    }
  };
  target.startViewTransition = start;
  installations.set(target, { start, restore });
  return restore;
}
