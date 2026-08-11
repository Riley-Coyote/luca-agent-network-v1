import * as React from "react";

import { useManagedPresentationActivitySnapshot } from "@/features/messages/managedPresentationActivityStore";
import {
  ensureManagedPresentationListener,
  getManagedPresentationSnapshot,
  getManagedPresentationTurn,
  getManagedPresentationTurnKeysSnapshot,
  getManagedResponseSlotsSnapshot,
  subscribeManagedPresentationLegacy,
  subscribeManagedPresentationTopology,
  subscribeManagedPresentationTurn,
} from "@/features/messages/managedPresentationStore";
import type {
  ManagedPresentationRow,
  ManagedPresentationTurn,
  ManagedResponseSlot,
} from "@/features/messages/managedPresentationTypes";

const EMPTY_KEYS: readonly string[] = [];
const EMPTY_SLOTS: readonly ManagedResponseSlot[] = [];
const EMPTY_LEGACY: readonly ManagedPresentationRow[] = [];

function useManagedPresentationListener(): void {
  React.useEffect(() => {
    void ensureManagedPresentationListener();
  }, []);
}

export function useManagedPresentationTurnKeys(
  conversationId: string | null,
): readonly string[] {
  useManagedPresentationListener();
  const subscribe = React.useCallback(
    (listener: () => void) =>
      conversationId
        ? subscribeManagedPresentationTopology(conversationId, listener)
        : () => undefined,
    [conversationId],
  );
  const getSnapshot = React.useCallback(
    () =>
      conversationId
        ? getManagedPresentationTurnKeysSnapshot(conversationId)
        : EMPTY_KEYS,
    [conversationId],
  );
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useManagedResponseSlots(
  conversationId: string | null,
): readonly ManagedResponseSlot[] {
  useManagedPresentationListener();
  const subscribe = React.useCallback(
    (listener: () => void) =>
      conversationId
        ? subscribeManagedPresentationTopology(conversationId, listener)
        : () => undefined,
    [conversationId],
  );
  const getSnapshot = React.useCallback(
    () =>
      conversationId
        ? getManagedResponseSlotsSnapshot(conversationId)
        : EMPTY_SLOTS,
    [conversationId],
  );
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useManagedPresentationTurn(
  uiKey: string,
): ManagedPresentationTurn | null {
  const subscribe = React.useCallback(
    (listener: () => void) => subscribeManagedPresentationTurn(uiKey, listener),
    [uiKey],
  );
  const getSnapshot = React.useCallback(
    () => getManagedPresentationTurn(uiKey),
    [uiKey],
  );
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useManagedPresentationActivity(conversationId: string | null) {
  useManagedPresentationListener();
  return useManagedPresentationActivitySnapshot(conversationId);
}

export function useManagedPresentations(
  conversationId: string | null,
): readonly ManagedPresentationRow[] {
  useManagedPresentationListener();
  const subscribe = React.useCallback(
    (listener: () => void) =>
      conversationId
        ? subscribeManagedPresentationLegacy(conversationId, listener)
        : () => undefined,
    [conversationId],
  );
  const getSnapshot = React.useCallback(
    () =>
      conversationId
        ? getManagedPresentationSnapshot(conversationId)
        : EMPTY_LEGACY,
    [conversationId],
  );
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
