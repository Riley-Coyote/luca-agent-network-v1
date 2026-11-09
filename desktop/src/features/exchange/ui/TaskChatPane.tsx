import * as React from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { correspondencePathId } from "../correspondenceNavigation";
import { X } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCommunities } from "@/features/communities/useCommunities";
import { OPEN_TASK_CHAT } from "@/features/exchange/openTaskWindow";
import { validateCorrespondenceRead } from "@/features/exchange/correspondenceView";
import { useTaskChatWindowSpace } from "@/features/exchange/useTaskChatWindowSpace";
import { readAgentInboxTask } from "@/shared/api/agentInbox";
import { useIdentityQuery } from "@/shared/api/hooks";
import { useRightCardsSlot } from "@/shared/layout/RightCardsSlot";
import { PanelPresence, usePanelPresence } from "@/shared/layout/PanelPresence";
import { CorrespondenceWindow } from "./CorrespondenceWindow";
import { obscureTaskChatInspectors } from "./taskChatInspector";
import "./task-chat.css";

/** A second conversation in the same shell, using the existing task transcript and send path. */
export function TaskChatPane() {
  const slot = useRightCardsSlot();
  const { activeCommunity, reinitKey } = useCommunities();
  const owner = useIdentityQuery().data?.pubkey?.toLowerCase() ?? "";
  const scope = `${activeCommunity?.id}:${reinitKey}:${owner}`;
  const location = useRouterState({ select: (state) => state.location.href });
  const previousLocation = React.useRef(location);
  const [request, setRequest] = React.useState<{
    scope: string;
    id: string;
  } | null>(null);
  const trigger = React.useRef<HTMLElement | null>(null);
  const returnFocus = React.useRef(false);
  const currentScope = React.useRef(scope);
  currentScope.current = scope;
  const taskId = request?.scope === scope ? request.id : null;
  React.useLayoutEffect(() => {
    if (previousLocation.current !== location) {
      previousLocation.current = location;
      returnFocus.current = false;
      setRequest(null);
    }
  }, [location]);
  React.useEffect(() => {
    setRequest((current) => (current?.scope === scope ? current : null));
  }, [scope]);
  const close = React.useCallback(() => {
    setRequest(null);
    returnFocus.current = true;
    if (trigger.current?.isConnected && !trigger.current.closest("[inert]")) {
      trigger.current.focus({ preventScroll: true });
      returnFocus.current = false;
    }
  }, []);
  const releaseInspector = React.useCallback(() => {
    if (currentScope.current !== scope || !returnFocus.current) return;
    returnFocus.current = false;
    if (
      trigger.current?.isConnected &&
      document.activeElement === document.body
    )
      trigger.current.focus({ preventScroll: true });
  }, [scope]);
  React.useEffect(() => {
    const open = (event: Event) => {
      const id: unknown = (event as CustomEvent).detail;
      if (typeof id !== "string" || !/^[a-f0-9]{64}$/i.test(id)) return;
      returnFocus.current = false;
      if (!document.activeElement?.closest(".luca-task-chat"))
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
      void listen<string>(OPEN_TASK_CHAT, ({ payload }) => {
        open(new CustomEvent(OPEN_TASK_CHAT, { detail: payload }));
        // The main window already owns these capabilities; detached windows don't.
        const main = getCurrentWindow();
        void main
          .unminimize()
          .then(() => main.setFocus())
          .catch((error) =>
            console.warn(
              "Task is open; main window could not be focused",
              error,
            ),
          );
      })
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
  useTaskChatWindowSpace(Boolean(taskId));
  return (
    <PanelPresence key={scope}>
      {slot && taskId
        ? createPortal(
            <TaskChatCard
              scope={scope}
              owner={owner}
              taskId={taskId}
              slot={slot}
              onClose={close}
              onRelease={releaseInspector}
            />,
            slot,
          )
        : null}
    </PanelPresence>
  );
}

function TaskChatCard({
  scope,
  owner,
  taskId,
  slot,
  onClose,
  onRelease,
}: {
  scope: string;
  owner: string;
  taskId: string;
  slot: HTMLElement;
  onClose: () => void;
  onRelease: () => void;
}) {
  const active = usePanelPresence() === true;
  const { goCorrespondence } = useAppNavigation();
  const mainPair = useRouterState({
    select: (state) => correspondencePathId(state.location.pathname),
  });
  const pane = React.useRef<HTMLElement | null>(null);
  const [overlay, setOverlay] = React.useState(
    () => (slot.parentElement?.clientWidth ?? 900) < 900,
  );
  React.useLayoutEffect(() => {
    const host = slot.parentElement;
    if (!host) return;
    const observer = new ResizeObserver(() =>
      setOverlay(host.clientWidth < 900),
    );
    setOverlay(host.clientWidth < 900);
    observer.observe(host);
    return () => observer.disconnect();
  }, [slot]);
  React.useLayoutEffect(() => {
    if (active) pane.current?.focus({ preventScroll: true });
  }, [active]);
  React.useLayoutEffect(() => {
    if (!pane.current) return;
    const restore = obscureTaskChatInspectors(slot, pane.current);
    return () => {
      restore();
      onRelease();
    };
  }, [slot, onRelease]);
  const read = useQuery({
    queryKey: ["task-chat-target", scope, taskId],
    enabled: Boolean(active && owner && taskId),
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
  // An in-flight initial read may finish during exit. Never mount a new live
  // transcript just to animate it away; retain only what was already visible.
  const visibleRead = React.useRef(read);
  if (active) visibleRead.current = read;
  const displayed = active ? read : visibleRead.current;
  const samePair = Boolean(
    displayed.data && mainPair === displayed.data.task.correspondenceId,
  );
  React.useEffect(() => {
    if (!active || !samePair || !displayed.data) return;
    // An explicit beside request for the conversation already in front focuses
    // that task there; never mount a duplicate transcript or composer.
    void goCorrespondence(displayed.data.task.correspondenceId ?? "", {
      task: taskId,
    });
    onClose();
  }, [active, samePair, displayed.data, goCorrespondence, onClose, taskId]);
  return (
    <aside
      aria-label="Task conversation"
      aria-hidden={!active || undefined}
      className="luca-task-chat luca-panel-overlay"
      data-luca-card
      data-panel-open={active}
      data-overlay={overlay || undefined}
      data-testid="task-chat-pane"
      tabIndex={-1}
      inert={!active}
      ref={pane}
    >
      {displayed.data && !samePair ? (
        <CorrespondenceWindow
          key={`${scope}:${displayed.data.task.correspondenceId}`}
          correspondenceId={displayed.data.task.correspondenceId ?? ""}
          initialTaskId={taskId}
          embedded
          active={active}
          onClose={onClose}
          onOpenMain={(id, recipient, intent, reply) => {
            void goCorrespondence(displayed.data?.task.correspondenceId ?? "", {
              ...(intent === "reply" ? { task: id, reply } : { seed: id }),
              recipient,
            });
            onClose();
          }}
        />
      ) : (
        <div className="flex items-center justify-between gap-3 p-4 text-sm">
          <p role={displayed.error ? "alert" : "status"}>
            {displayed.error
              ? `Couldn’t open this task: ${displayed.error.message}`
              : "Opening conversation…"}
          </p>
          <button
            type="button"
            aria-label="Close task conversation"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>
      )}
    </aside>
  );
}
