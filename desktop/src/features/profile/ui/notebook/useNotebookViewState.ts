import * as React from "react";

import { useCommunities } from "@/features/communities/useCommunities";
import { useIdentityQuery } from "@/shared/api/hooks";

import {
  EMPTY_NOTEBOOK_VIEW_STATE,
  notebookViewStorageKey,
  readNotebookViewState,
  writeNotebookViewState,
  type NotebookView,
  type NotebookViewScope,
  type NotebookViewState,
} from "./notebookViewState";

function scopedState(scope: NotebookViewScope | null): NotebookViewState {
  return (
    readNotebookViewState(scope) ?? {
      ...EMPTY_NOTEBOOK_VIEW_STATE,
      updatedAt: 0,
    }
  );
}

/** Owner-local notebook navigation. This intentionally has no document bodies. */
export function useNotebookViewState(residentPubkey: string) {
  const { activeCommunity } = useCommunities();
  const identityQuery = useIdentityQuery();
  const scope = React.useMemo<NotebookViewScope | null>(() => {
    const ownerPubkey = identityQuery.data?.pubkey?.trim();
    const workspaceId = activeCommunity?.id?.trim();
    const stableResidentPubkey = residentPubkey.trim();
    return ownerPubkey && workspaceId && stableResidentPubkey
      ? { ownerPubkey, workspaceId, residentPubkey: stableResidentPubkey }
      : null;
  }, [activeCommunity?.id, identityQuery.data?.pubkey, residentPubkey]);
  const scopeKey = React.useMemo(
    () => (scope ? notebookViewStorageKey(scope) : null),
    [scope],
  );
  const [state, setState] = React.useState<NotebookViewState>(() =>
    scopedState(scope),
  );

  React.useEffect(() => {
    setState(scopedState(scope));
  }, [scope]);

  const update = React.useCallback(
    (change: Partial<Omit<NotebookViewState, "version" | "updatedAt">>) => {
      setState((current) => {
        const next = { ...current, ...change, version: 1 as const };
        writeNotebookViewState(scope, next);
        return next;
      });
    },
    [scope],
  );

  const selectItem = React.useCallback(
    (itemId: string, revision: number | null, listAnchor = itemId) =>
      update({ selected: { itemId, revision }, listAnchor }),
    [update],
  );
  const clearSelection = React.useCallback(
    () => update({ selected: null }),
    [update],
  );
  const setView = React.useCallback(
    (view: NotebookView) => update({ view }),
    [update],
  );
  const setDetailAnchor = React.useCallback(
    (detailAnchor: NotebookViewState["detailAnchor"]) =>
      update({ detailAnchor }),
    [update],
  );
  const setListAnchor = React.useCallback(
    (listAnchor: string | null) => update({ listAnchor }),
    [update],
  );

  return {
    clearSelection,
    scopeKey,
    selectItem,
    setDetailAnchor,
    setListAnchor,
    setView,
    state,
  };
}
