import * as React from "react";

import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { useLucaResidentsQuery } from "@/features/luca/residents/hooks";
import type { TimelineMessage } from "@/features/messages/types";
import { discoverNativeResidents } from "@/shared/api/tauri";
import { hasManagedAgentChannelMessageMarker } from "@/shared/api/tauriManagedAgentMessageMarkers";
import { sendManagedAgentChannelMessage } from "@/shared/api/tauriManagedAgentMessages";
import type { Channel, RuntimeBinding } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";

import {
  canonicalLucaResidentPubkey,
  hasClientMarker,
  isCanonicalLucaDm,
  isFirstMeetingTimelineRow,
  LUCA_GREETING_MARKER as GREETING_MARKER,
  ownerHasSpoken,
} from "./canonicalLucaResident";

export const NATIVE_AGENT_NOTICE_MARKER = "polyphonic-native-agent-notice.v1";
const NATIVE_AGENT_NOTICE_COPY =
  "I found agents already on this Mac. If you’d like, you can review them—nothing will be imported unless you choose it.";

function nativeBindingIdentity(binding: RuntimeBinding): string {
  return binding.kind === "hermes"
    ? `hermes:${binding.hermesHome}:${binding.profileName.trim()}`
    : `openclaw:${binding.gatewayIdentity.trim()}:${binding.agentId.trim()}`;
}

/**
 * The cue is offered after Luca has actually done something for the owner —
 * never off the back of the opener.
 *
 * The opener used to be a greeting the desktop published on Luca's behalf,
 * carrying `GREETING_MARKER`, and this gate looked for that marker. Luca now
 * opens the conversation itself through the first meeting and signs nothing
 * special, so the gate is stated the way it was always meant: Luca has
 * spoken, the owner has answered, and then Luca has spoken again. Older
 * conversations still carrying the marker read identically — their greeting
 * is simply the first Luca row.
 */
function firstCompletedTaskResponse(
  messages: readonly TimelineMessage[],
  ownerPubkey: string,
  lucaPubkey: string,
): TimelineMessage | null {
  // The opener is a reply to the owner's kickoff row, so it is not depth 0;
  // `isFirstMeetingTimelineRow` is the same predicate the first-meeting
  // surfaces use to count it as part of the conversation.
  const lucaRows = messages.filter(
    (message) =>
      isFirstMeetingTimelineRow(message) &&
      !message.pending &&
      normalizePubkey(message.signerPubkey ?? "") === lucaPubkey &&
      !hasClientMarker(message, NATIVE_AGENT_NOTICE_MARKER),
  );
  const opener = lucaRows[0];
  if (!opener) return null;
  if (!ownerHasSpoken(messages, ownerPubkey)) return null;

  return (
    lucaRows.find(
      (message) =>
        message.id !== opener.id &&
        message.body.trim().length > 0 &&
        !hasClientMarker(message, GREETING_MARKER),
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
