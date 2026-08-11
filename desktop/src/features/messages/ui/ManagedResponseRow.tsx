import * as React from "react";

import { useManagedPresentationTurn } from "@/features/messages/managedPresentationStore";
import type { ManagedPresentationTurn } from "@/features/messages/managedPresentationTypes";
import type { TimelineMessage } from "@/features/messages/types";
import { MessageRow } from "./MessageRow";
import "./managedResponseRow.css";

type ManagedResponseRowProps = Omit<
  React.ComponentProps<typeof MessageRow>,
  "message" | "playEntrance"
> & {
  message: TimelineMessage;
};

function reconciledBody(
  turn: ManagedPresentationTurn,
  fallbackBody: string,
  canonicalPresent: boolean,
): string {
  // Once the durable event has been edited, its formatted body supersedes the
  // original signed-final snapshot retained by this mounted response slot.
  if (
    canonicalPresent &&
    turn.finalMessageId !== null &&
    turn.signedText !== null &&
    fallbackBody !== turn.signedText
  ) {
    return fallbackBody;
  }
  if (
    turn.signedText !== null &&
    (turn.finalReconciliation === "stream_extends_signed" ||
      turn.finalReconciliation === "divergent")
  ) {
    return turn.signedText;
  }
  if (turn.visibleText.length > 0) return turn.visibleText;
  return turn.finalMessageId ? (turn.signedText ?? fallbackBody) : "";
}

function hydrateManagedMessage(
  message: TimelineMessage,
  turn: ManagedPresentationTurn,
): TimelineMessage {
  const streaming =
    turn.finalMessageId === null || turn.bufferedText.length > 0;
  return {
    ...message,
    id: turn.finalMessageId ?? message.id,
    body: reconciledBody(
      turn,
      message.body,
      message.managedPresentation?.canonicalPresent ?? false,
    ),
    managedPresentation: {
      canonicalPresent: message.managedPresentation?.canonicalPresent ?? false,
      failure: turn.failure,
      finalMessageId: turn.finalMessageId,
      finalReconciliation: turn.finalReconciliation,
      phase: turn.phase,
      streaming,
      uiKey: turn.uiKey,
    },
  };
}

function SubscribedManagedResponseRow({
  message,
  uiKey,
  ...rowProps
}: ManagedResponseRowProps & { uiKey: string }) {
  const turn = useManagedPresentationTurn(uiKey);
  const hydratedMessage = React.useMemo(
    () => (turn ? hydrateManagedMessage(message, turn) : message),
    [message, turn],
  );

  return (
    <MessageRow {...rowProps} message={hydratedMessage} playEntrance={false} />
  );
}

/**
 * Subscribes only the active response row to public-text paints. Timeline
 * topology and settled messages stay reference-stable while this body grows.
 */
export const ManagedResponseRow = React.memo(function ManagedResponseRow({
  message,
  ...rowProps
}: ManagedResponseRowProps) {
  const uiKey = message.managedPresentation?.uiKey;
  if (!uiKey) {
    return <MessageRow {...rowProps} message={message} playEntrance={false} />;
  }
  return (
    <SubscribedManagedResponseRow
      {...rowProps}
      message={message}
      uiKey={uiKey}
    />
  );
});
