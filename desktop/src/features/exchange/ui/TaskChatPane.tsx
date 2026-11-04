import * as React from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCommunities } from "@/features/communities/useCommunities";
import { OPEN_TASK_CHAT } from "@/features/exchange/openTaskWindow";
import { validateCorrespondenceRead } from "@/features/exchange/correspondenceView";
import { useTaskChatWindowSpace } from "@/features/exchange/useTaskChatWindowSpace";
import { readAgentInboxTask } from "@/shared/api/agentInbox";
import { useIdentityQuery } from "@/shared/api/hooks";
import { useRightCardsSlot } from "@/shared/layout/RightCardsSlot";
import { CorrespondenceWindow } from "./CorrespondenceWindow";
import "./task-chat.css";

/** A second conversation in the same shell, using the existing task transcript and send path. */
export function TaskChatPane() {
  const slot = useRightCardsSlot();
  const { activeCommunity, reinitKey } = useCommunities();
  const owner = useIdentityQuery().data?.pubkey?.toLowerCase() ?? "";
  const scope = `${activeCommunity?.id}:${reinitKey}:${owner}`;
  const [request, setRequest] = React.useState<{
    scope: string;
    id: string;
  } | null>(null);
  const [overlay, setOverlay] = React.useState(false);
  const trigger = React.useRef<HTMLElement | null>(null);
  const pane = React.useRef<HTMLElement | null>(null);
  const taskId = request?.scope === scope ? request.id : null;
  React.useEffect(() => {
    setRequest((current) => (current?.scope === scope ? current : null));
  }, [scope]);
  const close = React.useCallback(() => {
    setRequest(null);
    if (trigger.current?.isConnected) trigger.current.focus();
  }, []);
  React.useEffect(() => {
    const open = (event: Event) => {
      const id: unknown = (event as CustomEvent).detail;
      if (typeof id !== "string" || !/^[a-f0-9]{64}$/i.test(id)) return;
      trigger.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setRequest({ scope, id });
    };
    window.addEventListener(OPEN_TASK_CHAT, open);
    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (isTauri())
      void listen<string>(OPEN_TASK_CHAT, ({ payload }) =>
        open(new CustomEvent(OPEN_TASK_CHAT, { detail: payload })),
      )
        .then((cleanup) => {
          if (disposed) cleanup();
          else unlisten = cleanup;
        })
        .catch((error) =>
          console.warn("Task chat focus listener unavailable", error),
        );
    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener(OPEN_TASK_CHAT, open);
    };
  }, [scope]);
  React.useEffect(() => {
    const host = slot?.parentElement;
    if (!host) return;
    const observer = new ResizeObserver(() =>
      setOverlay(host.clientWidth < 900),
    );
    setOverlay(host.clientWidth < 900);
    observer.observe(host);
    return () => observer.disconnect();
  }, [slot]);
  React.useEffect(() => {
    if (taskId) pane.current?.focus();
  }, [taskId]);
  useTaskChatWindowSpace(Boolean(taskId));
  const read = useQuery({
    queryKey: ["task-chat-target", scope, taskId],
    enabled: Boolean(owner && taskId),
    retry: false,
    queryFn: async () => {
      const result = await readAgentInboxTask(taskId ?? "");
      if (!result.task.correspondenceId)
        throw new Error("This task has no agent correspondence.");
      return validateCorrespondenceRead(
        result,
        result.task.correspondenceId,
        taskId ?? "",
        owner,
      );
    },
  });
  if (!slot || !taskId) return null;
  return createPortal(
    <aside
      aria-label="Task conversation"
      className="luca-task-chat"
      data-luca-card
      data-overlay={overlay || undefined}
      data-testid="task-chat-pane"
      tabIndex={-1}
      ref={pane}
    >
      {read.data ? (
        <CorrespondenceWindow
          key={`${scope}:${read.data.task.correspondenceId}`}
          correspondenceId={read.data.task.correspondenceId ?? ""}
          initialTaskId={taskId}
          embedded
          onClose={close}
        />
      ) : (
        <div className="flex items-center justify-between gap-3 p-4 text-sm">
          <p role={read.error ? "alert" : "status"}>
            {read.error
              ? `Couldn’t open this task: ${read.error.message}`
              : "Opening conversation…"}
          </p>
          <button
            type="button"
            aria-label="Close task conversation"
            onClick={close}
          >
            <X className="size-4" />
          </button>
        </div>
      )}
    </aside>,
    slot,
  );
}
