import * as React from "react";

import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { useLucaResidentsQuery } from "@/features/luca/residents/hooks";
import type { TimelineMessage } from "@/features/messages/types";
import { discoverNativeResidents } from "@/shared/api/tauri";
import { hasManagedAgentChannelMessageMarker } from "@/shared/api/tauriManagedAgentMessageMarkers";
import { sendManagedAgentChannelMessage } from "@/shared/api/tauriManagedAgentMessages";
import type { Channel, RuntimeBinding } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";

import { canonicalLucaResidentPubkey } from "./canonicalLucaResident";

const GREETING_MARKER = "polyphonic-onboarding.luca-greeting.v1";
export const NATIVE_AGENT_NOTICE_MARKER = "polyphonic-native-agent-notice.v1";
const NATIVE_AGENT_NOTICE_COPY =
  "I found agents already on this Mac. If you’d like, you can review them—nothing will be imported unless you choose it.";

function hasClientMarker(message: TimelineMessage, marker: string) {
  return message.tags?.some((tag) => tag[0] === "client" && tag[1] === marker);
}

function nativeBindingIdentity(binding: RuntimeBinding): string {
  return binding.kind === "hermes"
    ? `hermes:${binding.hermesHome}:${binding.profileName.trim()}`
    : `openclaw:${binding.gatewayIdentity.trim()}:${binding.agentId.trim()}`;
}

function isCanonicalLucaDm(
  channel: Channel | null,
  ownerPubkey: string | undefined,
  lucaPubkey: string,
) {
  if (channel?.channelType !== "dm" || !ownerPubkey) return false;
  const participants = new Set(
    channel.participantPubkeys.map((pubkey) => normalizePubkey(pubkey)),
  );
  return (
    participants.size === 2 &&
    participants.has(normalizePubkey(ownerPubkey)) &&
    participants.has(lucaPubkey)
  );
}

function firstCompletedTaskResponse(
  messages: readonly TimelineMessage[],
  ownerPubkey: string,
  lucaPubkey: string,
): TimelineMessage | null {
  const hasCanonicalGreeting = messages.some(
    (message) =>
      message.depth === 0 &&
      normalizePubkey(message.signerPubkey ?? "") === lucaPubkey &&
      hasClientMarker(message, GREETING_MARKER),
  );
  if (!hasCanonicalGreeting) return null;

  const hasOwnerMessage = messages.some(
    (message) =>
      message.depth === 0 &&
      !message.pending &&
      normalizePubkey(message.pubkey ?? "") === ownerPubkey,
  );
  if (!hasOwnerMessage) return null;

  return (
    messages.find(
      (message) =>
        message.depth === 0 &&
        !message.pending &&
        message.body.trim().length > 0 &&
        normalizePubkey(message.signerPubkey ?? "") === lucaPubkey &&
        !hasClientMarker(message, GREETING_MARKER) &&
        !hasClientMarker(message, NATIVE_AGENT_NOTICE_MARKER),
    ) ?? null
  );
}

/** Publish the optional native-agent cue after Luca's first ordinary reply. */
export function useNativeAgentNotice({
  activeChannel,
  currentPubkey,
  messages,
}: {
  activeChannel: Channel | null;
  currentPubkey: string | undefined;
  messages: readonly TimelineMessage[];
}) {
  const residentsQuery = useLucaResidentsQuery();
  const managedAgentsQuery = useManagedAgentsQuery();
  const attemptedResponsesRef = React.useRef(new Set<string>());
  const lucaPubkey = canonicalLucaResidentPubkey(
    residentsQuery.data?.residents,
  );
  const ownerPubkey = currentPubkey ? normalizePubkey(currentPubkey) : null;
  const response =
    lucaPubkey &&
    ownerPubkey &&
    isCanonicalLucaDm(activeChannel, ownerPubkey, lucaPubkey)
      ? firstCompletedTaskResponse(messages, ownerPubkey, lucaPubkey)
      : null;

  React.useEffect(() => {
    if (
      !activeChannel ||
      !lucaPubkey ||
      !response ||
      !managedAgentsQuery.data
    ) {
      return;
    }
    const channelId = activeChannel.id;
    const canonicalLucaPubkey = lucaPubkey;
    const managedAgents = managedAgentsQuery.data;
    const attemptKey = `${channelId}:${response.id}`;
    if (attemptedResponsesRef.current.has(attemptKey)) return;
    attemptedResponsesRef.current.add(attemptKey);

    let cancelled = false;
    async function publishIfUseful() {
      try {
        const alreadyPublished = await hasManagedAgentChannelMessageMarker({
          agentPubkey: canonicalLucaPubkey,
          channelId,
          marker: NATIVE_AGENT_NOTICE_MARKER,
          markerScope: "agent",
        });
        if (cancelled || alreadyPublished) return;

        const discovery = await discoverNativeResidents();
        if (cancelled) return;
        const imported = new Set(
          managedAgents
            .map((resident) => resident.nativeRuntimeBinding)
            .filter((binding): binding is RuntimeBinding => binding !== null)
            .map(nativeBindingIdentity),
        );
        const hasUnimportedCandidate = discovery.runtimes.some((runtime) =>
          runtime.candidates.some(
            (candidate) => !imported.has(candidate.semanticId),
          ),
        );
        if (!hasUnimportedCandidate) return;

        await sendManagedAgentChannelMessage({
          agentPubkey: canonicalLucaPubkey,
          channelId,
          content: NATIVE_AGENT_NOTICE_COPY,
          marker: NATIVE_AGENT_NOTICE_MARKER,
          markerScope: "agent",
        });
      } catch {
        // Fail quiet. Without a signed marker a later mount may safely retry.
      }
    }
    void publishIfUseful();
    return () => {
      cancelled = true;
    };
  }, [activeChannel, lucaPubkey, managedAgentsQuery.data, response]);
}
