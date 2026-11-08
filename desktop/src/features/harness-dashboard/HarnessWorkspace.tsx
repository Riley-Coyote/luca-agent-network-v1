import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowUpRight, Plus, X } from "lucide-react";

import { PlacePageHead } from "@/app/shell/placeRails/PlacePageHead";
import { HarnessFace } from "@/app/shell/placeRails/placeFaces";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useManagedPermissions } from "@/features/agents/useManagedPermissions";
import {
  ALL_RUNTIME_TASKS_KEY,
  useAllRuntimeTasks,
} from "@/features/capabilities/useAllRuntimeTasks";
import { mergeRuntimeTasks } from "@/features/capabilities/lib/runtimeTaskPresentation";
import type { HarnessRuntimeFamily } from "@/shared/api/tauriHarnessDashboard";
import {
  cancelRuntimeTask,
  listAllRuntimeTasks,
  pickRuntimeTaskFolder,
  startRuntimeTask,
  type RuntimeTaskProjection,
  type StartRuntimeTaskInput,
} from "@/shared/api/tauriRuntimeTasks";
import { HarnessConnection, HarnessUsage } from "./HarnessInformation";
import { HarnessSessions } from "./HarnessSessions";
import { HarnessSessionDetail } from "./HarnessSessionDetail";
import { useHarnessTranscript, useHarnessWorkspaceData } from "./hooks";
import {
  findInitialHarnessRow,
  canStopHarnessTask,
  projectHarnessRows,
  reconcileHarnessSelection,
  type HarnessRow,
} from "./model";
import {
  captureHarnessDispatch,
  isHarnessSelectionCurrent,
} from "./requestGuard";
import "./harnessWorkspace.css";

export type HarnessWorkspaceContext = {
  title: string;
  runtimeFamily: HarnessRuntimeFamily;
  sessionId?: string;
  taskId?: string;
};

export type HarnessWorkspaceProps = {
  runtimeFamily: HarnessRuntimeFamily;
  conversationId: string | null;
  residentPubkey: string | null;
  ownerScope?: string;
  initialTaskId?: string;
  initialSessionId?: string;
  onAskLuca?: (context: HarnessWorkspaceContext) => void;
};

/** The approved harness workspace, backed only by native sessions and real tasks. */
export function HarnessWorkspace(props: HarnessWorkspaceProps) {
  // A runtime or home-context switch has its own UI state, never a reused send target.
  return (
    <HarnessWorkspaceScope
      key={JSON.stringify([
        props.ownerScope,
        props.runtimeFamily,
        props.conversationId,
        props.residentPubkey,
      ])}
      {...props}
    />
  );
}

function HarnessWorkspaceScope({
  runtimeFamily,
  conversationId,
  residentPubkey,
  ownerScope = "",
  initialTaskId,
  initialSessionId,
  onAskLuca,
}: HarnessWorkspaceProps) {
  const name = runtimeFamily === "codex" ? "Codex" : "Claude Code";
  const queryClient = useQueryClient();
  const navigation = useAppNavigation();
  const reduced = useReducedMotion();
  const tasks = useAllRuntimeTasks();
  const taskSnapshot = useQuery({
    queryKey: ALL_RUNTIME_TASKS_KEY,
    queryFn: listAllRuntimeTasks,
    enabled: false,
  });
  const allPending = useManagedPermissions();
  const data = useHarnessWorkspaceData({
    runtimeFamily,
    conversationId,
    residentPubkey,
    ownerScope,
  });
  const [view, setView] = React.useState<"Sessions" | "Usage" | "Connection">(
    "Sessions",
  );
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [newTask, setNewTask] = React.useState(false);
  const [folder, setFolder] = React.useState("");
  const [pickingFolder, setPickingFolder] = React.useState(false);
  const [mobileDetail, setMobileDetail] = React.useState(
    Boolean(initialTaskId || initialSessionId),
  );
  const [notice, setNotice] = React.useState("");
  const [sendingKeys, setSendingKeys] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const sendingRef = React.useRef(new Set<string>());
  const mounted = React.useRef(true);
  const selectionRef = React.useRef("none");
  const previousSelection = React.useRef<HarnessRow | null>(null);
  const deepLink = JSON.stringify([initialTaskId, initialSessionId]);
  const appliedDeepLink = React.useRef<string | null>(null);
  const rows = React.useMemo(
    () => projectHarnessRows(runtimeFamily, data.catalogue.value, tasks),
    [runtimeFamily, data.catalogue.value, tasks],
  );
  const current = reconcileHarnessSelection(
    rows,
    selectedId,
    previousSelection.current,
  );
  if (current && !newTask && current.id === selectedId)
    previousSelection.current = current;
  const currentSelection = newTask
    ? "new"
    : (current?.id ?? selectedId ?? "none");
  selectionRef.current = currentSelection;
  const runtimeTasks = React.useMemo(
    () => tasks.filter((task) => task.runtimeFamily === runtimeFamily),
    [runtimeFamily, tasks],
  );
  const connections = data.connections.value ?? [];
  const ready = connections.some(
    (runtime) =>
      runtime.runtimeId === runtimeFamily &&
      runtime.readiness === "ready" &&
      runtime.authentication === "ready",
  );
  const homeReady = Boolean(conversationId && residentPubkey);
  const canStart = ready && homeReady && !data.connections.error;
  const targetFresh =
    homeReady && !data.catalogue.error && !data.catalogue.loading;
  const pending = allPending.filter(
    (item) =>
      item.request.conversationId === conversationId &&
      item.request.residentPubkey.toLowerCase() ===
        residentPubkey?.toLowerCase(),
  );
  const transcript = useHarnessTranscript({
    runtimeFamily,
    conversationId,
    residentPubkey,
    sourceId: data.catalogue.value?.sourceId ?? null,
    session: !newTask ? (current?.session ?? null) : null,
    visible: data.visible && view === "Sessions",
    revision: data.revision,
    ownerScope,
  });

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  React.useEffect(() => {
    if (
      appliedDeepLink.current === deepLink ||
      (!initialTaskId && !initialSessionId)
    )
      return;
    const selected = findInitialHarnessRow(
      rows,
      initialTaskId,
      initialSessionId,
    );
    if (!selected) return;
    appliedDeepLink.current = deepLink;
    selectionRef.current = selected.id;
    previousSelection.current = selected;
    setSelectedId(selected.id);
    setNewTask(false);
    setMobileDetail(true);
    setView("Sessions");
  }, [deepLink, initialTaskId, initialSessionId, rows]);
  React.useEffect(() => {
    if (!newTask && current && current.id !== selectedId)
      setSelectedId(current.id);
  }, [current, newTask, selectedId]);

  const selectSession = (id: string) => {
    selectionRef.current = id;
    previousSelection.current = rows.find((row) => row.id === id) ?? null;
    setSelectedId(id);
    setNewTask(false);
    setMobileDetail(true);
  };
  const startNew = () => {
    selectionRef.current = "new";
    setView("Sessions");
    setNewTask(true);
    setMobileDetail(true);
  };
  const cacheTask = React.useCallback(
    (task: RuntimeTaskProjection) => {
      queryClient.setQueryData<RuntimeTaskProjection[]>(
        ALL_RUNTIME_TASKS_KEY,
        (currentTasks = []) => mergeRuntimeTasks(currentTasks, [task]),
      );
    },
    [queryClient],
  );
  const dispatch = async (input: StartRuntimeTaskInput) => {
    const expected = currentSelection;
    if (
      !isHarnessSelectionCurrent(
        expected,
        selectionRef.current,
        mounted.current,
      )
    )
      throw new Error(
        "The selection changed before sending. Return to the original draft; nothing was sent.",
      );
    if (
      input.conversationId !== conversationId ||
      input.residentPubkey !== residentPubkey ||
      input.runtimeFamily !== runtimeFamily
    )
      throw new Error("Luca’s conversation changed. Nothing was sent.");
    if (sendingRef.current.has(expected))
      throw new Error("This selection is already sending.");
    sendingRef.current.add(expected);
    setSendingKeys(new Set(sendingRef.current));
    try {
      // Every field belongs to this captured target. No await can retarget it.
      const task = await startRuntimeTask(captureHarnessDispatch(input));
      if (mounted.current) cacheTask(task);
      if (
        isHarnessSelectionCurrent(
          expected,
          selectionRef.current,
          mounted.current,
        )
      ) {
        if (input.operation === "new_task") {
          const id = `task:${task.taskId}`;
          selectionRef.current = id;
          setSelectedId(id);
          previousSelection.current =
            projectHarnessRows(runtimeFamily, null, [task])[0] ?? null;
          setNewTask(false);
        }
        setNotice(
          input.operation === "send_message"
            ? "Follow-up queued for this exact native session. Delivery is not work completion."
            : "Task started. Switching views will not stop it.",
        );
        data.refresh();
      }
    } catch (error) {
      if (
        isHarnessSelectionCurrent(
          expected,
          selectionRef.current,
          mounted.current,
        )
      )
        setNotice(
          error instanceof Error
            ? error.message
            : typeof error === "string"
              ? error
              : "The task could not start. Your draft is preserved.",
        );
      throw error;
    } finally {
      sendingRef.current.delete(expected);
      if (mounted.current) setSendingKeys(new Set(sendingRef.current));
    }
  };
  const chooseFolder = async () => {
    const expected = currentSelection;
    if (
      !isHarnessSelectionCurrent(
        expected,
        selectionRef.current,
        mounted.current,
      )
    )
      return;
    setPickingFolder(true);
    try {
      const chosen = await pickRuntimeTaskFolder();
      if (
        chosen &&
        isHarnessSelectionCurrent(
          expected,
          selectionRef.current,
          mounted.current,
        )
      )
        setFolder(chosen);
    } catch (error) {
      if (mounted.current)
        setNotice(
          error instanceof Error
            ? error.message
            : "The folder picker could not open.",
        );
    } finally {
      if (mounted.current) setPickingFolder(false);
    }
  };
  const stopSelected = async () => {
    const task = current?.task;
    const expected = currentSelection;
    if (
      !task ||
      !canStopHarnessTask(task) ||
      sendingRef.current.has(expected) ||
      !isHarnessSelectionCurrent(
        expected,
        selectionRef.current,
        mounted.current,
      )
    )
      return;
    sendingRef.current.add(expected);
    setSendingKeys(new Set(sendingRef.current));
    try {
      const stopped = await cancelRuntimeTask(task.taskId);
      if (mounted.current) cacheTask(stopped);
      if (
        isHarnessSelectionCurrent(
          expected,
          selectionRef.current,
          mounted.current,
        )
      )
        setNotice("Stop requested for this task only.");
    } catch (error) {
      if (mounted.current)
        setNotice(
          error instanceof Error
            ? error.message
            : "This task could not be stopped.",
        );
    } finally {
      sendingRef.current.delete(expected);
      if (mounted.current) setSendingKeys(new Set(sendingRef.current));
    }
  };
  const connectionState =
    data.connections.loading && !connections.length
      ? "Checking connection…"
      : data.connections.error
        ? "Connection could not be verified"
        : ready
          ? "On this Mac · Ready for new tasks"
          : "Connection needs attention";

  return (
    <section
      className="hws"
      data-detail={mobileDetail || newTask || undefined}
      aria-label={`${name} workspace`}
      data-testid="harness-workspace"
    >
      <div className="hws-heading">
        <PlacePageHead
          face={<HarnessFace runtimeId={runtimeFamily} />}
          title={name}
          state={connectionState}
          action={
            <button
              className="hws-primary"
              type="button"
              onClick={startNew}
              disabled={!canStart}
            >
              <Plus size={15} aria-hidden />
              New task
            </button>
          }
        />
      </div>
      <div className="hws-navigation">
        <nav aria-label="Harness sections">
          {(["Sessions", "Usage", "Connection"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setView(tab)}
              aria-current={view === tab ? "page" : undefined}
            >
              {tab}
            </button>
          ))}
        </nav>
        <button
          className="hws-account"
          type="button"
          onClick={() => setView("Usage")}
        >
          Local usage · account allowance unavailable
        </button>
      </div>
      {!homeReady ? (
        <div className="hws-connection-warning" role="status">
          Luca’s conversation is loading. Existing tasks continue; new work is
          unavailable until its exact conversation is ready.
        </div>
      ) : !ready && !data.connections.loading ? (
        <div className="hws-connection-warning">
          <span>{name} needs attention. Saved sessions stay here.</span>
          <button type="button" onClick={() => setView("Connection")}>
            Review connection <ArrowUpRight size={13} aria-hidden />
          </button>
        </div>
      ) : null}
      {view === "Sessions" ? (
        <div className="hws-workspace">
          <HarnessSessions
            rows={rows}
            selectedId={newTask ? null : (current?.id ?? selectedId)}
            loading={data.catalogue.loading}
            error={data.catalogue.error}
            truncated={data.catalogue.value?.truncated ?? false}
            notice={data.catalogue.value?.notice ?? null}
            canStart={canStart}
            onSelect={selectSession}
            onStart={startNew}
            onRefresh={data.refresh}
          />
          <section
            className="hws-session-detail"
            aria-label={newTask ? "New task" : "Selected session"}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                className="hws-detail-inner"
                key={currentSelection}
                initial={{ opacity: reduced ? 1 : 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: reduced ? 1 : 0 }}
                transition={{ duration: reduced ? 0 : 0.12 }}
              >
                <HarnessSessionDetail
                  runtimeFamily={runtimeFamily}
                  row={current}
                  sourceId={data.catalogue.value?.sourceId ?? null}
                  newTask={newTask}
                  folder={folder}
                  pickingFolder={pickingFolder}
                  conversationId={conversationId}
                  residentPubkey={residentPubkey}
                  ownerScope={ownerScope}
                  transcript={transcript}
                  visible={data.visible}
                  revision={data.revision}
                  canStart={canStart}
                  targetFresh={targetFresh}
                  sending={sendingKeys.has(currentSelection)}
                  pending={pending}
                  onPickFolder={() => void chooseFolder()}
                  onBack={() => setMobileDetail(false)}
                  onStart={startNew}
                  onRefresh={data.refresh}
                  onAskLuca={
                    onAskLuca && current
                      ? () =>
                          onAskLuca({
                            title: current.title,
                            runtimeFamily,
                            ...(current.session
                              ? { sessionId: current.session.sessionId }
                              : {}),
                            ...(current.task
                              ? { taskId: current.task.taskId }
                              : {}),
                          })
                      : undefined
                  }
                  onDispatch={dispatch}
                  onStop={() => void stopSelected()}
                  onNotice={setNotice}
                />
              </motion.div>
            </AnimatePresence>
          </section>
        </div>
      ) : view === "Usage" ? (
        <HarnessUsage
          tasks={runtimeTasks}
          status={
            taskSnapshot.isError
              ? "error"
              : taskSnapshot.isPending
                ? "loading"
                : "ready"
          }
          selectedUsage={transcript.value?.usage ?? null}
        />
      ) : (
        <HarnessConnection
          runtimeFamily={runtimeFamily}
          connections={connections}
          loading={data.connections.loading}
          error={data.connections.error}
          apiConnected={
            data.api.error ? null : (data.api.value?.connected ?? null)
          }
          onRefresh={data.refresh}
          onSettings={() => void navigation.goSettings("mcp")}
        />
      )}
      {notice ? (
        <div className="hws-notice" role="status">
          <span>{notice}</span>
          <button
            type="button"
            aria-label="Dismiss notice"
            onClick={() => setNotice("")}
          >
            <X size={14} aria-hidden />
          </button>
        </div>
      ) : null}
    </section>
  );
}
