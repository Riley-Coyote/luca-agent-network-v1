import * as React from "react";

import {
  useManagedAgentsQuery,
  useRelayAgentsQuery,
} from "@/features/agents/hooks";
import { useChannelsQuery } from "@/features/channels/hooks";
import type { ArtifactProvenance } from "@/features/artifacts/types";

export function useArtifactProvenanceLabels() {
  const { conversationNames, residentNames } = useArtifactLabelMaps();

  return React.useCallback(
    (provenance: ArtifactProvenance) => ({
      resident: residentLabel(residentNames, provenance.residentPubkey),
      conversation: provenance.conversationId
        ? (conversationNames.get(provenance.conversationId) ??
          `Conversation ${compactId(provenance.conversationId)}`)
        : null,
    }),
    [conversationNames, residentNames],
  );
}

export function useArtifactResidentLabel(residentPubkey: string | null) {
  const { residentNames } = useArtifactLabelMaps();
  return residentLabel(residentNames, residentPubkey);
}

function useArtifactLabelMaps() {
  const managedAgents = useManagedAgentsQuery();
  const relayAgents = useRelayAgentsQuery();
  const channels = useChannelsQuery();

  const residentNames = React.useMemo(() => {
    const names = new Map<string, string>();
    for (const resident of relayAgents.data ?? []) {
      names.set(resident.pubkey.toLowerCase(), resident.name);
    }
    for (const resident of managedAgents.data ?? []) {
      names.set(resident.pubkey.toLowerCase(), resident.name);
    }
    return names;
  }, [managedAgents.data, relayAgents.data]);

  const conversationNames = React.useMemo(
    () =>
      new Map(
        (channels.data ?? []).map((channel) => [channel.id, channel.name]),
      ),
    [channels.data],
  );

  return { conversationNames, residentNames };
}

function residentLabel(
  residentNames: ReadonlyMap<string, string>,
  residentPubkey: string | null,
) {
  return residentPubkey
    ? (residentNames.get(residentPubkey.toLowerCase()) ??
        `Resident ${compactId(residentPubkey)}`)
    : "Resident";
}

function compactId(value: string) {
  return value.length > 10 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}
