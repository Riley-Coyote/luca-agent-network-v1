import * as React from "react";

import {
  applyExchangeSnapshot,
  removeExchange,
  upsertExchangeRecord,
} from "@/features/exchange/exchangeStore";
import { exchangeIdFromTags } from "@/features/exchange/exchangeTags";
import {
  getExchange,
  listenForExchangeUpdates,
  parseExchangeRecordContent,
} from "@/shared/api/exchanges";
import { relayClient } from "@/shared/api/relayClient";
import type { RelayEvent } from "@/shared/api/types";
import {
  KIND_LUCA_EXCHANGE,
  KIND_STREAM_MESSAGE,
} from "@/shared/constants/kinds";

const EXCHANGE_SYNC_KINDS = [KIND_LUCA_EXCHANGE];
const EXCHANGE_BACKFILL_LIMIT = 200;

/**
 * Re-read one exchange from the backend, which asks the RELAY for the head and
 * the spent set. `spent` never comes from counting loaded messages — a device
 * that just opened the room has to show the same number as the one that
 * watched the turns arrive.
 */
export async function refreshExchange(exchangeId: string): Promise<void> {
  try {
    const snapshot = await getExchange(exchangeId);
    if (snapshot) applyExchangeSnapshot(snapshot);
    else removeExchange(exchangeId);
  } catch (error) {
    console.warn("[useExchangeSync] get_exchange failed:", error);
  }
}

/**
 * Start the exchange-record sync for `pubkey` (the owner — the only author the
 * relay accepts for kind 30178): a one-shot backfill of existing heads, then a
 * live subscription, plus the backend's own `exchange-updated` signal. Returns
 * a disposer. Extracted from the hook so the wiring is unit-testable without a
 * React renderer (see `useExchangeSync.test.mjs`).
 */
export function startExchangeSync(
  pubkey: string,
  onCancelled: () => boolean,
): () => Promise<void> {
  const reconcile = (event: RelayEvent, liveObservation: boolean) => {
    if (event.pubkey !== pubkey) return;
    const record = parseExchangeRecordContent(event.content);
    if (!record) return;
    // Render the head immediately, then let the relay settle `spent`.
    upsertExchangeRecord(record, { liveObservation });
    void refreshExchange(record.exchangeId);
  };

  // One-shot backfill of existing heads (closes the fresh-start gap that
  // live-only subscription + reconnect-replay cannot recover: replay only
  // resumes from a since-cursor that is undefined until the first live event).
  void relayClient
    .fetchEvents({
      kinds: EXCHANGE_SYNC_KINDS,
      authors: [pubkey],
      limit: EXCHANGE_BACKFILL_LIMIT,
    })
    .then((events) => {
      if (onCancelled()) return;
      for (const event of events) reconcile(event, false);
    })
    .catch((error) => {
      console.warn("[useExchangeSync] backfill failed:", error);
    });

  let unsub: (() => Promise<void>) | null = null;
  void relayClient
    .subscribeLive(
      { kinds: EXCHANGE_SYNC_KINDS, authors: [pubkey], limit: 0 },
      (event) => reconcile(event, true),
    )
    .then((dispose) => {
      if (onCancelled()) void dispose();
      else unsub = dispose;
    });

  // A paused exchange writes no new head. Watch turn-tagged messages across
  // every room so a background room is re-read as soon as its bucket fills.
  const pendingTurnRefreshes = new Map<string, Promise<void>>();
  const dirtyTurnRefreshes = new Set<string>();
  const refreshFromTurn = (exchangeId: string) => {
    if (pendingTurnRefreshes.has(exchangeId)) {
      dirtyTurnRefreshes.add(exchangeId);
      return;
    }

    const pending = (async () => {
      do {
        dirtyTurnRefreshes.delete(exchangeId);
        await refreshExchange(exchangeId);
      } while (dirtyTurnRefreshes.has(exchangeId));
    })().finally(() => pendingTurnRefreshes.delete(exchangeId));
    pendingTurnRefreshes.set(exchangeId, pending);
  };
  let unsubTurns: (() => Promise<void>) | null = null;
  void relayClient
    .subscribeLive({ kinds: [KIND_STREAM_MESSAGE], limit: 0 }, (event) => {
      const exchangeId = exchangeIdFromTags(event.tags);
      if (exchangeId) refreshFromTurn(exchangeId);
    })
    .then((dispose) => {
      if (onCancelled()) void dispose();
      else unsubTurns = dispose;
    });

  // Stop and Go re-sign the head locally; the backend hands back the settled
  // snapshot on the same event, so the strip does not wait for the relay echo.
  let unlistenUpdates: (() => void) | null = null;
  void listenForExchangeUpdates(({ exchangeId, snapshot }) => {
    if (snapshot) applyExchangeSnapshot(snapshot);
    else void refreshExchange(exchangeId);
  })
    .then((unlisten) => {
      if (onCancelled()) unlisten();
      else unlistenUpdates = unlisten;
    })
    .catch((error) => {
      console.warn("[useExchangeSync] exchange-updated listen failed:", error);
    });

  return async () => {
    unlistenUpdates?.();
    await Promise.all([
      unsub?.(),
      unsubTurns?.(),
      ...pendingTurnRefreshes.values(),
    ]);
  };
}

/**
 * Subscribes to this owner's exchange records and keeps `exchangeStore` in
 * sync. Keyed on the active pubkey, like `usePersonaSync`: an identity switch
 * re-runs the effect, whose cleanup closes the old subscription before a new
 * one opens.
 */
export function useExchangeSync(pubkey: string | undefined): void {
  React.useEffect(() => {
    if (!pubkey) return;
    let cancelled = false;
    const dispose = startExchangeSync(pubkey, () => cancelled);
    return () => {
      cancelled = true;
      void dispose();
    };
  }, [pubkey]);
}

/**
 * Re-read the exchanges a room's messages belong to whenever a new turn lands.
 * The tag is the only thing a message carries; the count itself stays the
 * relay's answer, so this triggers a `get_exchange` rather than incrementing.
 */
export function useExchangeTurnRefresh(
  messages: readonly { id: string; tags?: string[][] }[],
): void {
  const signature = React.useMemo(() => {
    const seen = new Set<string>();
    for (const message of messages) {
      const exchangeId = exchangeIdFromTags(message.tags);
      if (exchangeId) seen.add(`${exchangeId}:${message.id}`);
    }
    return [...seen].sort().join("|");
  }, [messages]);

  React.useEffect(() => {
    if (!signature) return;
    const exchangeIds = new Set(
      signature.split("|").map((entry) => entry.split(":")[0] ?? ""),
    );
    for (const exchangeId of exchangeIds) {
      if (exchangeId) void refreshExchange(exchangeId);
    }
  }, [signature]);
}
