import * as React from "react";

import { useManagedPresentationTurn } from "@/features/messages/managedPresentationHooks";
import { acknowledgeManagedPresentationReconciliation } from "@/features/messages/managedPresentationStore";
import { managedHandoffTargetName } from "@/features/messages/lib/managedOperationalStatus";
import type {
  ManagedFinalReconciliation,
  ManagedPresentationTurn,
} from "@/features/messages/managedPresentationTypes";
import type { TimelineMessage } from "@/features/messages/types";
import { MessageRow } from "./MessageRow";
import "./managedResponseRow.css";

type ManagedResponseRowProps = Omit<
  React.ComponentProps<typeof MessageRow>,
  "collapseLongBody" | "message" | "playEntrance"
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
  // A signed final can arrive before the reveal scheduler's first paint. Its
  // signature settles the turn, but it must not make the renderer jump ahead
  // of already-authenticated graphemes waiting in the display queue.
  if (turn.bufferedText.length > 0) return turn.visibleText;
  if (
    turn.finalMessageId !== null &&
    turn.signedText !== null &&
    turn.bufferedText.length === 0
  ) {
    return turn.signedText;
  }
  if (turn.visibleText.length > 0) return turn.visibleText;
  return turn.finalMessageId ? (turn.signedText ?? fallbackBody) : "";
}

function hydrateManagedMessage(
  message: TimelineMessage,
  turn: ManagedPresentationTurn,
  visibleReconciliation: ManagedFinalReconciliation | null,
): TimelineMessage {
  const handoffTargetName =
    turn.failure === "publication"
      ? managedHandoffTargetName(turn.visibleText)
      : null;
  const streaming =
    turn.finalMessageId === null || turn.bufferedText.length > 0;
  return {
    ...message,
    id: turn.finalMessageId ?? message.id,
    body: handoffTargetName
      ? `Couldn’t reach ${handoffTargetName}.`
      : reconciledBody(
          turn,
          message.body,
          message.managedPresentation?.canonicalPresent ?? false,
        ),
    managedPresentation: {
      canonicalPresent: message.managedPresentation?.canonicalPresent ?? false,
      failure: turn.failure,
      handoffTargetName,
      finalMessageId: turn.finalMessageId,
      finalReconciliation: visibleReconciliation,
      phase: turn.phase,
      streaming,
      uiKey: turn.uiKey,
      workDurationMs:
        turn.finalMessageId === null
          ? undefined
          : Math.max(0, turn.lastFrameAt - turn.startedAt),
    },
  };
}

function SubscribedManagedResponseRow({
  message,
  uiKey,
  ...rowProps
}: ManagedResponseRowProps & { uiKey: string }) {
  const turn = useManagedPresentationTurn(uiKey);
  const [visibleReconciliation, setVisibleReconciliation] =
    React.useState<ManagedFinalReconciliation | null>(null);
  const reconciliationTimer = React.useRef<number | null>(null);
  const reconciliationIdentity = turn?.finalMessageId
    ? `${turn.finalMessageId}:${turn.finalReconciliation ?? ""}`
    : null;

  React.useLayoutEffect(() => {
    if (
      !turn?.finalMessageId ||
      !turn.finalReconciliation ||
      !reconciliationIdentity
    ) {
      return;
    }
    if (reconciliationTimer.current !== null) {
      window.clearTimeout(reconciliationTimer.current);
      reconciliationTimer.current = null;
    }
    const animated =
      turn.finalReconciliation === "divergent" ||
      turn.finalReconciliation === "stream_extends_signed";
    setVisibleReconciliation(animated ? turn.finalReconciliation : null);
    acknowledgeManagedPresentationReconciliation(
      turn.uiKey,
      turn.finalMessageId,
    );
    if (animated) {
      reconciliationTimer.current = window.setTimeout(() => {
        reconciliationTimer.current = null;
        setVisibleReconciliation(null);
      }, 160);
    }
  }, [reconciliationIdentity, turn]);

  React.useEffect(
    () => () => {
      if (reconciliationTimer.current !== null) {
        window.clearTimeout(reconciliationTimer.current);
      }
    },
    [],
  );
  const hydratedMessage = React.useMemo(
    () =>
      turn
        ? hydrateManagedMessage(message, turn, visibleReconciliation)
        : message,
    [message, turn, visibleReconciliation],
  );

  return (
    <MessageRow
      {...rowProps}
      collapseLongBody={false}
      message={hydratedMessage}
      playEntrance={false}
    />
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
    return (
      <MessageRow
        {...rowProps}
        collapseLongBody={false}
        message={message}
        playEntrance={false}
      />
    );
  }
  return (
    <SubscribedManagedResponseRow
      {...rowProps}
      message={message}
      uiKey={uiKey}
    />
  );
});
