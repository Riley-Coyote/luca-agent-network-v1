import * as React from "react";
import {
  listPendingManagedInputs,
  listenForManagedInputChanges,
  type PendingManagedInput,
  MANAGED_INPUT_REFRESH_EVENT,
} from "@/shared/api/managedInputs";

export function useManagedInputs(): PendingManagedInput[] {
  const [pending, setPending] = React.useState<PendingManagedInput[]>([]);
  React.useEffect(() => {
    let active = true;
    let generation = 0;
    let stop: (() => void) | undefined;
    const resolvedIds = new Set<string>();
    const refresh = async () => {
      const own = ++generation;
      try {
        const next = await listPendingManagedInputs();
        if (active && own === generation)
          setPending(next.filter((item) => !resolvedIds.has(item.pendingId)));
      } catch {
        // A temporary IPC failure is not proof that a question was resolved.
      }
    };
    const reconcile = (resolvedId?: string) => {
      if (!active) return;
      if (resolvedId) {
        resolvedIds.add(resolvedId);
        setPending((current) =>
          current.filter((item) => item.pendingId !== resolvedId),
        );
      }
      void refresh();
    };
    const onFocus = () => reconcile();
    const onDecision = (event: Event) => {
      const id = (event as CustomEvent<{ pendingId?: unknown }>).detail
        ?.pendingId;
      reconcile(typeof id === "string" ? id : undefined);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") reconcile();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener(MANAGED_INPUT_REFRESH_EVENT, onDecision);
    document.addEventListener("visibilitychange", onVisible);
    // Listing must not depend on event registration succeeding. Reconcile
    // again after registration to close the subscribe/snapshot race.
    void refresh();
    void listenForManagedInputChanges(reconcile)
      .then((dispose) => {
        if (!active) {
          dispose();
          return;
        }
        stop = dispose;
        void refresh();
      })
      .catch(() => {
        if (active) void refresh();
      });
    return () => {
      active = false;
      generation += 1;
      stop?.();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(MANAGED_INPUT_REFRESH_EVENT, onDecision);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return pending;
}
