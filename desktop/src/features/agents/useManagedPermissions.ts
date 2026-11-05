import * as React from "react";

import {
  listPendingManagedPermissions,
  listenForManagedPermissionChanges,
} from "@/shared/api/managedPermissions";
import type { PendingManagedPermission } from "@/shared/api/types";

export function createManagedPermissionRefresh(
  load: () => Promise<PendingManagedPermission[]>,
  commit: (pending: PendingManagedPermission[]) => void,
) {
  let active = true;
  let revision = 0;
  return {
    async refresh() {
      const requested = ++revision;
      try {
        const next = await load();
        if (active && requested === revision) commit(next);
      } catch {
        if (active && requested === revision) commit([]);
      }
    },
    dispose() {
      active = false;
      revision += 1;
    },
  };
}

export function useManagedPermissions(): PendingManagedPermission[] {
  const [pending, setPending] = React.useState<PendingManagedPermission[]>([]);

  React.useEffect(() => {
    let active = true;
    let stop: (() => void) | undefined;
    // Mount and pending/resolved events can overlap. An older empty list
    // must not hide a new approval (or resurrect one already answered).
    const snapshot = createManagedPermissionRefresh(
      listPendingManagedPermissions,
      setPending,
    );

    void (async () => {
      try {
        const unlisten = await listenForManagedPermissionChanges(
          () => void snapshot.refresh(),
        );
        if (!active) {
          unlisten();
          return;
        }
        stop = unlisten;
        await snapshot.refresh();
      } catch {
        if (active) setPending([]);
      }
    })();

    return () => {
      active = false;
      snapshot.dispose();
      stop?.();
    };
  }, []);

  return pending;
}
