import * as React from "react";
import { CorrespondenceWindow } from "./CorrespondenceWindow";
import "./task-chat.css";
import type { CorrespondenceSearch } from "../correspondenceNavigation";
import {
  clearCorrespondenceTitle,
  publishCorrespondenceTitle,
  useCorrespondenceScope,
} from "../correspondencePageTitle";

export function CorrespondencePage({
  correspondenceId,
  seed,
  task,
  recipient,
  reply,
  invalid,
}: CorrespondenceSearch & { correspondenceId: string }) {
  const scope = useCorrespondenceScope();
  React.useEffect(
    () => () => clearCorrespondenceTitle(scope, correspondenceId),
    [scope, correspondenceId],
  );
  const onTitle = React.useCallback(
    (title: string) =>
      publishCorrespondenceTitle(scope, correspondenceId, title),
    [scope, correspondenceId],
  );
  if (
    invalid ||
    !/^correspondence-v1-[a-f0-9]{64}$/.test(correspondenceId) ||
    !(task ?? seed)
  ) {
    return (
      <p className="luca-measure py-4 text-sm" role="alert">
        This conversation link is incomplete. Open it from the agent’s inbox.
      </p>
    );
  }
  return (
    <CorrespondenceWindow
      key={`${scope}:${correspondenceId}`}
      correspondenceId={correspondenceId}
      initialTaskId={task ?? seed}
      initialIntent={task ? "reply" : "new-message"}
      initialRecipient={recipient}
      initialReplyEventId={reply}
      primary
      onTitleChange={onTitle}
    />
  );
}
