import type { StartRuntimeTaskInput } from "@/shared/api/tauriRuntimeTasks";

/** One gate per mounted reader; late responses can never populate a new target. */
export function createHarnessRequestGate() {
  let revision = 0;
  let active = true;
  let key = "";
  return {
    begin(requestKey = "") {
      key = requestKey;
      const requestRevision = ++revision;
      return () => active && revision === requestRevision && key === requestKey;
    },
    invalidate() {
      revision += 1;
    },
    dispose() {
      active = false;
      revision += 1;
    },
  };
}

export type HarnessSnapshot<T> = {
  key: string;
  value: T | null;
  error: string | null;
  loading: boolean;
};

/** Rendering also checks scope, including the frame before effect cleanup. */
export function harnessSnapshotForKey<T>(
  snapshot: HarnessSnapshot<T>,
  key: string,
): HarnessSnapshot<T> {
  return snapshot.key === key
    ? snapshot
    : { key, value: null, error: null, loading: true };
}

/** Mutations capture this at submission; later selection changes only affect UI. */
export function isHarnessSelectionCurrent(
  expected: string,
  current: string,
  mounted: boolean,
): boolean {
  return mounted && expected === current;
}
/** Flat dispatch fields are copied before any provider/native await. */
export function captureHarnessDispatch(
  input: StartRuntimeTaskInput,
): Readonly<StartRuntimeTaskInput> {
  return Object.freeze({ ...input });
}
