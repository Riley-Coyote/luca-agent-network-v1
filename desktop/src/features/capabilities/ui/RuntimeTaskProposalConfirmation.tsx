import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";
import {
  PlaceAskLink,
  PlaceAskRow,
  PlaceQuietButton,
} from "@/app/shell/placeRails/PlaceAskRow";
import { runtimeLabel } from "@/features/exchange/sideConversations";
import { useShellFrameEnabled } from "@/shared/features/useShellFrameEnabled";
import { listRuntimeConnectionStatus } from "@/shared/api/tauriMcp";
import {
  resolveRuntimeTaskProjectFolder,
  respondRuntimeTaskProposal,
  type RuntimeTaskProposal,
} from "@/shared/api/tauriRuntimeTasks";
import { isExistingRuntimeTask } from "../lib/runtimeTaskPresentation";
import { useRuntimeTasks } from "../useRuntimeTasks";
import {
  RuntimeTaskConfirmationCard,
  type RuntimeTaskDraft,
} from "./RuntimeTaskConfirmationCard";

/**
 * The task a proposal asks for, with the details its card opens on: the
 * project's folder, or the folder this conversation's last task ran in, or
 * the existing session's own. Shared by the card and by Activity's Needs you
 * (WP-14), whose row runs it with these defaults.
 */
export function useProposalDraft(
  proposal: RuntimeTaskProposal | undefined,
  projectSourceIds: string[],
  residentNames: ReadonlyMap<string, string>,
): RuntimeTaskDraft | null {
  const existingSession = isExistingRuntimeTask(proposal?.operation);
  const hasProjectSources = projectSourceIds.length > 0;
  const projectFolderQuery = useQuery({
    queryKey: ["runtime-task-project-folder", projectSourceIds],
    queryFn: () => resolveRuntimeTaskProjectFolder(projectSourceIds),
    enabled: Boolean(proposal) && hasProjectSources && !existingSession,
    retry: false,
    staleTime: 10_000,
  });
  // A plain DM carries no project, so nothing resolves a working folder and
  // Run would sit disabled with no way to see why. Fall back to the folder
  // the last task in this conversation ran in — the picker still overrides
  // it, and when there is no prior task the field stays empty.
  const priorTasksQuery = useRuntimeTasks(
    !existingSession && !hasProjectSources
      ? (proposal?.conversationId ?? null)
      : null,
  );
  if (!proposal) return null;
  const lastUsedFolder =
    (priorTasksQuery.data ?? [])
      .slice()
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .find((task) => Boolean(task.workingFolder))?.workingFolder ?? null;
  return {
    conversationId: proposal.conversationId,
    residentPubkey: proposal.residentPubkey,
    residentName: residentNames.get(proposal.residentPubkey) ?? "Your resident",
    runtimeFamily: proposal.runtimeFamily,
    summary: proposal.summary,
    prompt: proposal.summary,
    workingFolder: existingSession
      ? proposal.targetWorkingFolder
      : (projectFolderQuery.data ?? lastUsedFolder),
    operation: proposal.operation,
    sourceId: proposal.sourceId,
    sessionId: proposal.sessionId,
    targetLabel: proposal.targetLabel,
    targetWorkingFolder: proposal.targetWorkingFolder,
  };
}

/** A proposal's card in its conversation. Under the frame, the one drawing
 *  every ask has (SHELL_BUILD.md WP-16, Decided 2): Needs you's row, Run ·
 *  Not now with its defaults, Change… opening the card under it, as one item
 *  (`li`) of the room's one list of asks (WP-23, ChannelPane.tsx). */
export function RuntimeTaskProposalConfirmation({
  proposals,
  projectSourceIds,
  residentNames,
}: {
  proposals: RuntimeTaskProposal[];
  projectSourceIds: string[];
  residentNames: ReadonlyMap<string, string>;
}) {
  const shellFrame = useShellFrameEnabled();
  const proposal = proposals[0];
  if (shellFrame) {
    if (!proposal) return null;
    const who = residentNames.get(proposal.residentPubkey) ?? "Your resident";
    return (
      <ProposalAsk
        common={{
          "data-proposal-id": proposal.proposalId,
          "data-testid": "runtime-task-proposal-row",
        }}
        key={proposal.proposalId}
        projectSourceIds={projectSourceIds}
        proposal={proposal}
        summary={`${who} asks`}
        who={who}
      />
    );
  }
  return (
    <RuntimeTaskProposalForm
      projectSourceIds={projectSourceIds}
      proposal={proposal}
      residentNames={residentNames}
    />
  );
}

/** The card itself: every detail of the task, confirmed as it stands. */
function RuntimeTaskProposalForm({
  proposal,
  projectSourceIds,
  residentNames,
}: {
  proposal: RuntimeTaskProposal | undefined;
  projectSourceIds: string[];
  residentNames: ReadonlyMap<string, string>;
}) {
  const draft = useProposalDraft(proposal, projectSourceIds, residentNames);
  if (!proposal || !draft) return null;

  return (
    <RuntimeTaskConfirmationCard
      draft={draft}
      key={proposal.proposalId}
      onCancel={() => {
        void respondRuntimeTaskProposal({
          proposalId: proposal.proposalId,
          approved: false,
        });
      }}
      onConfirm={(details) =>
        respondRuntimeTaskProposal({
          proposalId: proposal.proposalId,
          approved: true,
          runtimeFamily: details.runtimeFamily,
          workingFolder: details.workingFolder,
          permissionMode: details.permissionMode,
        })
      }
      onConfirmed={() => {}}
    />
  );
}

/** What a proposal's row carries besides its ask (ManagedAsks.tsx,
 *  `AskCommon`): the attributes its list finds it by, and in a list its time
 *  and its open. */
type ProposalCommon = {
  "data-testid": string;
  /** Who asks, on a page\'s plate (WP-33, Decided 6). */
  face?: React.ReactNode;
  note?: string;
  onOpen?: () => void;
  openTestId?: string;
} & { [attribute: `data-${string}`]: string };

/** Luca's proposal to run Codex or Claude Code, as one ask row: Run · Not
 *  now, its defaults in one faint line, and Change… opening the card under
 *  the row. The same in Needs you and in the conversation. */
export function ProposalAsk({
  common,
  projectSourceIds,
  proposal,
  summary,
  who,
}: {
  common: ProposalCommon;
  projectSourceIds: string[];
  proposal: RuntimeTaskProposal;
  summary: string;
  who: string;
}) {
  const residentNames = React.useMemo(
    () => new Map([[proposal.residentPubkey, who]]),
    [proposal.residentPubkey, who],
  );
  const draft = useProposalDraft(proposal, projectSourceIds, residentNames);
  const targets = useQuery({
    queryKey: ["runtime-task-targets"],
    queryFn: listRuntimeConnectionStatus,
    retry: false,
    staleTime: 10_000,
  });
  const [busy, setBusy] = React.useState(false);
  const [change, setChange] = React.useState(false);
  const existing = isExistingRuntimeTask(proposal.operation);
  const folder = existing
    ? (proposal.targetWorkingFolder ?? null)
    : (draft?.workingFolder ?? null);
  const ready =
    existing ||
    (targets.data ?? []).some(
      (runtime) =>
        runtime.runtimeId === proposal.runtimeFamily &&
        runtime.readiness === "ready" &&
        runtime.authentication === "ready",
    );
  const canRun = Boolean(folder) && ready;
  const respond = async (approved: boolean) => {
    setBusy(true);
    try {
      await respondRuntimeTaskProposal(
        approved && folder
          ? {
              approved: true,
              permissionMode: "normal",
              proposalId: proposal.proposalId,
              runtimeFamily: proposal.runtimeFamily,
              workingFolder: folder,
            }
          : { approved: false, proposalId: proposal.proposalId },
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "This runtime task proposal is no longer open.",
      );
      setBusy(false);
    }
  };
  const defaults = [
    runtimeLabel(proposal.runtimeFamily),
    existing ? "its own permissions" : "ask when needed",
    folder ? folderName(folder) : "no folder yet",
  ].join(" · ");
  return (
    <PlaceAskRow
      {...common}
      answers={
        <>
          <PlaceQuietButton
            data-testid="needs-you-proposal-run"
            disabled={busy || !canRun}
            onClick={() => void respond(true)}
            title={canRun ? undefined : "Choose its details with Change…"}
          >
            Run
          </PlaceQuietButton>
          <PlaceQuietButton
            data-testid="needs-you-proposal-not-now"
            disabled={busy}
            onClick={() => void respond(false)}
          >
            Not now
          </PlaceQuietButton>
        </>
      }
      extra={
        <>
          <span className="luca-ask-defaults" data-testid="needs-you-defaults">
            {defaults}
          </span>
          <PlaceAskLink
            aria-expanded={change}
            data-testid="needs-you-proposal-change"
            onClick={() => setChange((open) => !open)}
          >
            {change ? "Close" : "Change…"}
          </PlaceAskLink>
        </>
      }
      openLabel={`${proposal.summary}, ${summary}. Open the conversation`}
      panel={
        change ? (
          <RuntimeTaskProposalForm
            projectSourceIds={projectSourceIds}
            proposal={proposal}
            residentNames={residentNames}
          />
        ) : null
      }
      summary={summary}
      title={proposal.summary}
    />
  );
}

/** The folder's own name, as the defaults line says it. */
function folderName(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
