/** Properties that can move a card's measured box or corner, never its paint. */
export function isFrameGeometryProperty(property: string) {
  return /^(?:(?:min-|max-)?(?:width|height|inline-size|block-size)|top|right|bottom|left|inset(?:-.+)?|margin(?:-.+)?|padding(?:-.+)?|gap|row-gap|column-gap|flex(?:-.+)?|grid-template-.+|transform|translate|scale|rotate|border(?:-.+)?-(?:width|radius)|border-radius|--luca-huddle-band)$/.test(
    property,
  );
}

const FOLLOW_MS = 520;

/** One reference-counted observer and frame loop. `read` runs once before all
 * consumers write; callers share the same snapshot, not just the same clock. */
export function createFrameLayoutWatcher<T>({
  read,
  watched,
  motionTarget,
  ignoreMutation,
}: {
  read: () => T;
  watched: (snapshot: T) => readonly Element[];
  motionTarget: (target: Element) => boolean;
  ignoreMutation: (record: MutationRecord) => boolean;
}) {
  const consumers = new Set<(snapshot: T) => void>();
  let dispose: (() => void) | undefined;
  let request: (() => void) | undefined;

  const start = () => {
    let stopped = false;
    let pending = 0;
    let until = 0;
    let observed = new Set<Element>();
    const root = document.documentElement;
    const schedule = () => {
      if (stopped || document.hidden || pending) return;
      pending = requestAnimationFrame(step);
    };
    const resizes = new ResizeObserver(schedule);
    resizes.observe(root);
    const step = () => {
      pending = 0;
      if (stopped || document.hidden) return;
      const snapshot = read();
      const next = new Set(watched(snapshot));
      next.delete(root);
      for (const element of observed) {
        if (!next.has(element)) resizes.unobserve(element);
      }
      for (const element of next) {
        if (!observed.has(element)) resizes.observe(element);
      }
      observed = next;
      // Every geometry read is done before either native posting or shadow DOM
      // writes. A consumer may detach itself during delivery.
      for (const consumer of [...consumers]) {
        if (consumers.has(consumer)) consumer(snapshot);
      }
      if (performance.now() < until) schedule();
    };
    const follow = (event: Event) => {
      if (stopped || document.hidden) return;
      const target = event.target;
      if (!(target instanceof Element) || !motionTarget(target)) return;
      if (event.type.startsWith("transition")) {
        if (!isFrameGeometryProperty((event as TransitionEvent).propertyName))
          return;
      } else {
        // Ignore a card's paint-only animation too. Older engines without the
        // animation inspection API keep the bounded, frame-scoped fallback.
        const animations = target
          .getAnimations?.()
          .filter(
            (animation) =>
              "animationName" in animation &&
              animation.animationName ===
                (event as AnimationEvent).animationName,
          );
        if (
          animations?.length &&
          !animations.some((animation) =>
            (animation.effect as KeyframeEffect | null)
              ?.getKeyframes?.()
              .some((frame) =>
                Object.keys(frame).some((property) =>
                  isFrameGeometryProperty(
                    property.replace(
                      /[A-Z]/g,
                      (letter) => `-${letter.toLowerCase()}`,
                    ),
                  ),
                ),
              ),
          )
        )
          return;
      }
      if (event.type === "transitionrun" || event.type === "animationstart") {
        until = Math.max(until, performance.now() + FOLLOW_MS);
      }
      // End/cancel also gets a final sample, including a delayed transition
      // whose end falls outside the rail's bounded follow window.
      schedule();
    };
    const visibility = () => {
      if (document.hidden) {
        if (pending) cancelAnimationFrame(pending);
        pending = 0;
        until = 0;
      } else {
        // A rail/pane may still be settling when the window comes back.
        until = performance.now() + FOLLOW_MS;
        schedule();
      }
    };
    const mutations = new MutationObserver((records) => {
      if (!records.every(ignoreMutation)) schedule();
    });
    // Presence attributes also matter under Reduce Motion, when no geometry
    // transition event can announce the handoff. Never watch shadow style writes.
    mutations.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-panel-open"],
    });
    window.addEventListener("resize", schedule);
    document.addEventListener("visibilitychange", visibility);
    const events = [
      "transitionrun",
      "transitionend",
      "transitioncancel",
      "animationstart",
      "animationend",
      "animationcancel",
    ];
    for (const event of events) document.addEventListener(event, follow, true);
    void document.fonts?.ready.then(schedule);
    request = schedule;
    schedule();
    dispose = () => {
      stopped = true;
      mutations.disconnect();
      resizes.disconnect();
      window.removeEventListener("resize", schedule);
      document.removeEventListener("visibilitychange", visibility);
      for (const event of events)
        document.removeEventListener(event, follow, true);
      if (pending) cancelAnimationFrame(pending);
      pending = 0;
      request = undefined;
      dispose = undefined;
    };
  };
  return {
    invalidate() {
      request?.();
    },
    subscribe(consumer: (snapshot: T) => void) {
      consumers.add(consumer);
      if (!dispose) start();
      else request?.();
      return () => {
        consumers.delete(consumer);
        if (!consumers.size) dispose?.();
      };
    },
  };
}
