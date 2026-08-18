import * as React from "react";

import {
  type DirectMessageIntro,
  getDmParticipantPreview,
} from "@/features/channels/lib/dmParticipantDisplay";
import { useKnownAgentPubkeys } from "@/features/agents/useKnownAgentPubkeys";
import { normalizePubkey } from "@/shared/lib/pubkey";
import {
  ConversationIntro,
  type ConversationIntroMark,
} from "./ConversationIntro";

/**
 * The threshold of a direct conversation: the same intro a room gets — who
 * is on the other side, in a breath — with residents in their glyph and
 * people in their disc. No boilerplate about beginnings; the first words are
 * the beginning.
 */
export function DirectMessageIntroBlock({
  className,
  intro,
}: {
  className?: string;
  intro: DirectMessageIntro;
}) {
  const knownAgentPubkeys = useKnownAgentPubkeys();
  const { hiddenCount, marks } = React.useMemo(() => {
    const preview = getDmParticipantPreview(intro.participants);
    return {
      hiddenCount: preview.hiddenCount,
      marks: preview.visibleParticipants.map(
        (participant): ConversationIntroMark =>
          knownAgentPubkeys.has(normalizePubkey(participant.pubkey))
            ? {
                kind: "glyph",
                key: participant.pubkey,
                seed: participant.pubkey,
                label: participant.displayName,
              }
            : {
                kind: "person",
                key: participant.pubkey,
                displayName: participant.displayName,
                avatarUrl: participant.avatarUrl,
              },
      ),
    };
  }, [intro.participants, knownAgentPubkeys]);
  return (
    <ConversationIntro
      className={className}
      hiddenCount={hiddenCount}
      marks={marks}
      marksTestId="message-dm-intro-avatar-stack"
      subtitle={intro.role}
      testId="message-dm-intro"
      title={intro.displayName}
    />
  );
}
