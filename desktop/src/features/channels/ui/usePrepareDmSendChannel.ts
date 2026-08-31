import * as React from "react";

import { useAddChannelMembersMutation } from "@/features/channels/hooks";
import type { Channel } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";

export function usePrepareDmSendChannel(
  activeChannel: Channel | null,
  currentPubkey?: string,
) {
  const addMembersMutation = useAddChannelMembersMutation(
    activeChannel?.id ?? null,
  );

  return React.useCallback(
    async (additionalParticipantPubkeys: string[] = []) => {
      if (activeChannel?.channelType !== "dm") {
        return activeChannel?.id ?? null;
      }

      const currentParticipantPubkeys = new Set(
        activeChannel.participantPubkeys.map(normalizePubkey),
      );
      const currentNormalizedPubkey = currentPubkey
        ? normalizePubkey(currentPubkey)
        : null;
      const pubkeys = [
        ...new Set(additionalParticipantPubkeys.map(normalizePubkey)),
      ].filter(
        (pubkey) =>
          pubkey &&
          pubkey !== currentNormalizedPubkey &&
          !currentParticipantPubkeys.has(pubkey),
      );
      if (pubkeys.length === 0) {
        return activeChannel.id;
      }

      const result = await addMembersMutation.mutateAsync({
        channelId: activeChannel.id,
        pubkeys,
        role: "member",
      });
      if (result.errors.length > 0) {
        throw new Error(
          result.errors
            .map(({ pubkey, error }) => `${pubkey}: ${error}`)
            .join("; "),
        );
      }
      return activeChannel.id;
    },
    [activeChannel, addMembersMutation.mutateAsync, currentPubkey],
  );
}
