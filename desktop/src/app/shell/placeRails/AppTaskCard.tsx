import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleX,
  RotateCcw,
} from "lucide-react";
import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import "@/app/shell/shell-app-task.css";
import "@/app/shell/shell-mind-space.css";
import {
  taskAppName,
  taskCanOpenNative,
  taskIsLive,
  folderName,
  projectOfFolder,
  stepStateLabel,
  taskStateLine,
} from "@/app/shell/placeRails/appTask";
import {
  PlaceList,
  PlaceListRow,
  PlacePage,
  PlaceSectionLabel,
  placeNoteTime,
} from "@/app/shell/placeRails/PlacePage";
import { PlacePageHead } from "@/app/shell/placeRails/PlacePageHead";
import { HarnessFace } from "@/app/shell/placeRails/placeFaces";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useRoomProjectCatalog } from "@/features/channels/lib/roomProjects";
import { runtimeTaskAction } from "@/features/capabilities/lib/runtimeTaskPresentation";
import { mergeRuntimeTasks } from "@/features/capabilities/lib/runtimeTaskPresentation";
import {
  ALL_RUNTIME_TASKS_KEY,
  useAllRuntimeTasks,
} from "@/features/capabilities/useAllRuntimeTasks";
import { useCommunities } from "@/features/communities/useCommunities";
import { useSideConversations } from "@/features/exchange/useSideConversations";
import { runtimeRailFamilyFromRuntimeId } from "@/features/runtime-sessions/runtimeRailPreferences";
import { useIdentityQuery } from "@/shared/api/hooks";
import {
  getRuntimeTaskResult,
  openRuntimeTaskSession,
  resolveRuntimeTaskProjectFolder,
  retryRuntimeTask,
  type RuntimeTaskProjection,
  type RuntimeTaskStep,
} from "@/shared/api/tauriRuntimeTasks";
import { AgentMark } from "@/shared/ui/AgentMark";
import { Markdown } from "@/shared/ui/markdown";
import { WorkPlan } from "@/shared/ui/WorkPlan";

/**
 * An app's task, as the work (BETA14_RELEASE.md WP-35; the lab's
 * `TaskView`): a task row under Apps in the Chats rail opens it in the
 * card. The head says what it is, for whom, where and how it stands, with
 * the app's own session to open where the task carries one; then what it
 * is doing now, what it has done, what came back, and what passed between
 * whoever sent it and the app. It follows the task live, from the same list
 * the rail reads, and moves on to its finished state without a reload.
 */
export function AppTaskCard({ taskId }: { taskId: string }) {
  const tasks = useAllRuntimeTasks();
  const task = tasks.find((each) => each.taskId === taskId) ?? null;
  // The list is still arriving (or the task is no longer on this Mac): the
  // page waits, empty, as a place's card does before its rows arrive.
  if (!task) return <PlacePage testId="app-task-card">{null}</PlacePage>;
  return <TaskPage key={task.taskId} task={task} />;
}

const STEP_GLYPHS: Record<RuntimeTaskStep["state"], typeof CircleCheck> = {
  active: CircleDot,
  done: CircleCheck,
  failed: CircleX,
  queued: CircleDashed,
};

function TaskPage({ task }: { task: RuntimeTaskProjection }) {
  const side = useSideConversations();
  const forName = side.nameOf(task.residentPubkey);
  const appName = taskAppName(task);
  const workingPlace = useTaskWhere(task.workingFolder);
  const where = task.options?.purpose === "ask" ? "Quick answer" : workingPlace;
  const live = taskIsLive(task);
  const result = useTaskResult(task);
  const handoff = useNativeHandoff(task);
  const retry = useRetry(task);
  const canRetry = runtimeTaskAction(task) === "retry";
  const cameBack = task.state === "succeeded" ? result : task.error;

  return (
    <PlacePage testId="app-task-card">
      <PlacePageHead
        action={
          taskCanOpenNative(task) ? (
            <button
              className="luca-mind-talk"
              data-testid="app-task-open-native"
              disabled={handoff.opening}
              onClick={handoff.open}
              type="button"
            >
              {handoff.opening ? "Opening…" : `Open in ${appName}`}
            </button>
          ) : undefined
        }
        eyebrow={appName}
        face={<HarnessFace runtimeId={task.runtimeFamily} />}
        state={
          <span title={task.workingFolder || undefined}>
            {taskStateLine(task, {
              forName,
              timeOf: placeNoteTime,
              where,
            })}
          </span>
        }
        title={
          task.summary.length > 96
            ? `${task.summary.slice(0, 93).trimEnd()}…`
            : task.summary
        }
      />
      {handoff.error ? (
        <p className="luca-app-task-alert" role="alert">
          {handoff.error}
        </p>
      ) : null}

      {live && task.currentStep ? (
        <section
          aria-label="Now"
          className="luca-place-group"
          data-testid="app-task-now"
        >
          <PlaceSectionLabel label="Now" />
          <div className="luca-place-plate">
            <p className="luca-app-task-now" data-live="">
              {task.currentStep}
            </p>
          </div>
        </section>
      ) : null}

      <WorkPlan plan={task.plan} />
      {task.options?.purpose !== "ask" &&
      !task.plan?.steps.length &&
      task.steps.length > 0 ? (
        <PlaceList
          count={task.steps.length}
          label="What it has done"
          testId="app-task-steps"
          thread
        >
          {task.steps.map((step, index) => {
            const Glyph = STEP_GLYPHS[step.state];
            return (
              <PlaceListRow
                data-step-state={step.state}
                face={
                  <Glyph aria-label={stepStateLabel(step.state)} role="img" />
                }
                // Steps carry no id of their own: their order is theirs.
                // biome-ignore lint/suspicious/noArrayIndexKey: steps are an ordered log with no id.
                key={index}
                title={step.label}
              />
            );
          })}
        </PlaceList>
      ) : null}

      {cameBack ? (
        <section
          aria-label="What came back"
          className="luca-place-group"
          data-testid="app-task-came-back"
        >
          <PlaceSectionLabel label="What came back" />
          <div className="luca-place-plate">
            <div
              className="luca-app-task-came-back"
              data-failed={task.state === "succeeded" ? undefined : ""}
            >
              <Markdown
                className="luca-app-task-came-back-text"
                content={cameBack}
              />
              {canRetry ? (
                <button
                  className="luca-app-task-retry"
                  data-testid="app-task-retry"
                  disabled={retry.retrying}
                  onClick={retry.run}
                  type="button"
                >
                  <RotateCcw aria-hidden />
                  {retry.retrying ? "Trying again…" : "Try again"}
                </button>
              ) : null}
            </div>
          </div>
          {retry.error ? (
            <p className="luca-app-task-alert" role="alert">
              {retry.error}
            </p>
          ) : null}
        </section>
      ) : null}

      <PlaceList
        label={`Between ${forName} and ${appName}`}
        testId="app-task-between"
      >
        <PlaceListRow
          detail={forName}
          face={<AgentMark />}
          note={placeNoteTime(task.startedAt)}
          testId="app-task-between-brief"
          title={task.summary}
        />
      </PlaceList>
    </PlacePage>
  );
}

/**
 * Where the task works: the project its folder belongs to, by each
 * project's own folder (`resolve_runtime_task_project_folder`, the lookup a
 * task's folder came from), else the folder itself, by its own name.
 */
function useTaskWhere(folder: string): string | null {
  const channels = useChannelsQuery().data;
  const { activeCommunity } = useCommunities();
  const ownerPubkey = useIdentityQuery().data?.pubkey;
  const projects = useRoomProjectCatalog(
    channels ?? NO_CHANNELS,
    ownerPubkey,
    activeCommunity?.relayUrl,
  );
  const withSources = projects.filter(
    (project) => (project.sourceIds?.length ?? 0) > 0,
  );
  const folders = useQueries({
    queries: withSources.map((project) => ({
      queryFn: () => resolveRuntimeTaskProjectFolder(project.sourceIds ?? []),
      queryKey: ["runtime-task-project-folder", project.sourceIds ?? []],
      retry: false,
      staleTime: 10_000,
    })),
  });
  if (!folder) return null;
  const project = projectOfFolder(
    folder,
    withSources.map((each, index) => ({
      folder: folders[index]?.data ?? null,
      label: each.label,
    })),
  );
  return project ?? folderName(folder);
}

const NO_CHANNELS: never[] = [];

/** What came back from a finished task, verified as the receipt verifies
 *  it: Polyphonic's own runs only (a native handoff keeps none here). */
function useTaskResult(task: RuntimeTaskProjection): string | null {
  const enabled =
    task.state === "succeeded" && task.controlOwner !== "native_app";
  const query = useQuery({
    enabled,
    queryFn: async () => {
      const payload = await getRuntimeTaskResult(task.taskId);
      if (payload.taskId !== task.taskId || payload.state !== "succeeded")
        throw new Error("The task result could not be verified.");
      return payload.result;
    },
    queryKey: ["runtime-task-result", task.taskId],
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  return enabled ? (query.data ?? null) : null;
}

/** The app's own session, through the existing handoff. */
function useNativeHandoff(task: RuntimeTaskProjection) {
  const [opening, setOpening] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const open = React.useCallback(() => {
    setOpening(true);
    setError(null);
    void openRuntimeTaskSession(task.taskId)
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "The native session could not be opened.",
        ),
      )
      .finally(() => setOpening(false));
  }, [task.taskId]);
  return { error, open, opening };
}

/**
 * Try again, through the existing retry: it starts the task over as a new
 * one, which the page then follows, in place of the failed one.
 */
function useRetry(task: RuntimeTaskProjection) {
  const queryClient = useQueryClient();
  const { goAppTask } = useAppNavigation();
  const [retrying, setRetrying] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const run = React.useCallback(() => {
    setRetrying(true);
    setError(null);
    void retryRuntimeTask(task.taskId)
      .then((next) => {
        // The reply is the record even if the event has not arrived yet.
        queryClient.setQueryData<RuntimeTaskProjection[]>(
          ALL_RUNTIME_TASKS_KEY,
          (current = []) => mergeRuntimeTasks(current, [next]),
        );
        const family = runtimeRailFamilyFromRuntimeId(next.runtimeFamily);
        if (next.taskId !== task.taskId && family)
          void goAppTask(family, next.taskId, { replace: true });
      })
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "The task could not be tried again.",
        ),
      )
      .finally(() => setRetrying(false));
  }, [goAppTask, queryClient, task.taskId]);
  return { error, retrying, run };
}
