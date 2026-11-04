import type { RelaySubscriptionFilter } from "@/shared/api/relayClientShared";
import type { RelayEvent } from "@/shared/api/types";
import {
  KIND_LUCA_EXCHANGE,
  KIND_STREAM_MESSAGE,
  KIND_STREAM_MESSAGE_V2,
  KIND_STREAM_MESSAGE_EDIT,
} from "@/shared/constants/kinds";

type LiveClient = {
  subscribeLive(
    filter: RelaySubscriptionFilter,
    onEvent: (event: RelayEvent) => void,
  ): Promise<() => Promise<void>>;
  subscribeToReconnects(onReconnect: () => void): () => void;
};

/** Relay events are freshness hints only; native canonical reads remain authority. */
export async function subscribeCorrespondenceUpdates(
  client: LiveClient,
  owner: string,
  members: readonly string[],
  sourceIds: readonly string[],
  invalidate: () => void | Promise<void>,
) {
  let disposed = false;
  let pending = false;
  let reading = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const disposers: Array<() => void | Promise<void>> = [];
  const changed = () => {
    if (disposed) return;
    pending = true;
    if (timer || reading) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (disposed) return;
      pending = false;
      reading = true;
      void Promise.resolve()
        .then(invalidate)
        .catch((error) =>
          console.warn("Correspondence refresh unavailable", error),
        )
        .finally(() => {
          reading = false;
          if (pending) changed();
        });
    }, 100);
  };
  const since = Math.floor(Date.now() / 1000) - 30;
  const filters: Array<[RelaySubscriptionFilter, (event: RelayEvent) => void]> =
    [
      [
        {
          kinds: [KIND_LUCA_EXCHANGE],
          authors: [owner],
          "#p": [...members],
          since,
          limit: 100,
        },
        (event) => {
          if (
            event.pubkey === owner &&
            members.every((member) =>
              event.tags.some((tag) => tag[0] === "p" && tag[1] === member),
            )
          )
            changed();
        },
      ],
    ];
  if (sourceIds.length)
    filters.push([
      {
        kinds: [
          KIND_STREAM_MESSAGE,
          KIND_STREAM_MESSAGE_V2,
          KIND_STREAM_MESSAGE_EDIT,
        ],
        authors: [...members, owner],
        "#h": [...sourceIds],
        since,
        limit: 100,
      },
      (event) => {
        if (
          [...members, owner].includes(event.pubkey) &&
          event.tags.some(
            (tag) => tag[0] === "h" && sourceIds.includes(tag[1]),
          ) &&
          event.tags.some(
            (tag) =>
              (tag[0] === "exchange" || tag[0] === "luca-task-reply") && tag[1],
          )
        )
          changed();
      },
    ]);
  try {
    for (const [filter, handler] of filters)
      disposers.push(await client.subscribeLive(filter, handler));
    disposers.push(client.subscribeToReconnects(changed));
  } catch (error) {
    disposed = true;
    await Promise.allSettled(disposers.map((dispose) => dispose()));
    throw error;
  }
  return async () => {
    disposed = true;
    if (timer) clearTimeout(timer);
    await Promise.allSettled(disposers.map((dispose) => dispose()));
  };
}
