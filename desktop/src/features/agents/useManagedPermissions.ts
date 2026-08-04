import * as React from "react";

import {
  listPendingManagedPermissions,
  listenForManagedPermissionChanges,
} from "@/shared/api/managedPermissions";
import type { PendingManagedPermission } from "@/shared/api/types";

export function useManagedPermissions(): PendingManagedPermission[] {
  const [pending, setPending] = React.useState<PendingManagedPermission[]>([]);

  React.useEffect(() => {
    let active = true;
    let stop: (() => void) | undefined;

    const refresh = async () => {
      try {
        const next = await listPendingManagedPermissions();
        if (active) setPending(next);
      } catch {
        if (active) setPending([]);
      }
    };

    void (async () => {
      try {
        const unlisten = await listenForManagedPermissionChanges(
          () => void refresh(),
        );
        if (!active) {
          unlisten();
          return;
        }
        stop = unlisten;
        await refresh();
      } catch {
        if (active) setPending([]);
      }
    })();

    return () => {
      active = false;
      stop?.();
    };
  }, []);

  return pending;
}
