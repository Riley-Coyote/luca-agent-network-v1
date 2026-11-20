import { X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import "./project-proposal.css";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import {
  PlaceAskLink,
  PlaceAskRow,
  PlaceQuietButton,
} from "@/app/shell/placeRails/PlaceAskRow";
import { useRoomProjectCatalog } from "@/features/channels/lib/roomProjects";
import {
  type ProjectCreationCheckpoint,
  ProjectCreationFailure,
} from "@/features/projects/lib/projectCreationTransaction";
import {
  projectProposalDuplicate,
  projectProposalLine,
  projectProposalTitle,
  projectSettledLine,
} from "@/features/projects/lib/projectProposalWords";
import {
  type SettledProjectProposal,
  useRememberSettledProject,
} from "@/features/projects/useProjectProposals";
import {
  useProjectCreationScope,
  useRoomProjectCreation,
} from "@/features/projects/useRoomProjectCreation";
import {
  authorizeProjectProposal,
  finishProjectProposal,
  type ProjectProposalV1,
} from "@/shared/api/tauriProjectProposals";

const NO_CHANNELS: { id: string; name: string }[] = [];

/** What a card's row carries besides its ask: as ManagedAsks' `AskCommon`. */
type ProjectAskCommon = {
  "data-testid"?: string;
  face?: React.ReactNode;
  note?: string;
  onOpen?: () => void;
  openTestId?: string;
} & { [attribute: `data-${string}`]: string };

function messageOf(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : typeof error === "string" && error.trim()
      ? error
      : fallback;
}

/**
 * A resident's ask to start a project, as one ask row in its conversation and
 * in Needs you: "Start a project called “Ghost app”?", who asks, one faint
 * line (the purpose and who joins its first chat), and Create · Not now.
 * Create runs the + dialog's own creation without leaving the conversation,
 * then hands the resident the result; a part-made project can be tried again
 * or left as it is, and the resident hears exactly which.
 */
export function ProjectProposalAsk({
  common,
  nameOf,
  proposal,
  summary,
}: {
  common?: ProjectAskCommon;
  nameOf: (pubkey: string) => string;
  proposal: ProjectProposalV1;
  summary: string;
}) {
  const { ownerPubkey, relayUrl } = useProjectCreationScope();
  const catalog = useRoomProjectCatalog(NO_CHANNELS, ownerPubkey, relayUrl);
  const create = useRoomProjectCreation({ navigate: false });
  const remember = useRememberSettledProject();
  const [busy, setBusy] = React.useState<"create" | "decline" | null>(null);
  const [checkpoint, setCheckpoint] =
    React.useState<ProjectCreationCheckpoint | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);

  const names = proposal.residentPubkeys.map(nameOf);
  const duplicate = projectProposalDuplicate(
    proposal.projectName,
    catalog.map((project) => project.label),
  );
  const title = projectProposalTitle(proposal.projectName);

  const onCreate = async () => {
    setBusy("create");
    setProblem(null);
    let made = false;
    try {
      await authorizeProjectProposal(proposal.requestId);
      const reached = await create(
        {
          label: proposal.projectName,
          roomName: proposal.chatName,
          sourceIds: [],
          residents: { mode: "existing", pubkeys: proposal.residentPubkeys },
          roomDescription: proposal.purpose,
        },
        checkpoint,
      );
      setCheckpoint(reached);
      if (!reached.projectId || !reached.channelId)
        throw new Error("The project was saved without its first chat.");
      remember({
        chatId: reached.channelId,
        conversationId: proposal.conversationId,
        projectId: reached.projectId,
        projectName: proposal.projectName,
        requestId: proposal.requestId,
      });
      made = true;
      await finishProjectProposal(proposal.requestId, {
        chatId: reached.channelId,
        outcome: "created",
        projectId: reached.projectId,
      });
    } catch (error) {
      if (error instanceof ProjectCreationFailure)
        setCheckpoint(error.checkpoint);
      if (made) {
        // Made in full but not handed back: the line stays; say why.
        toast.error(messageOf(error, "The resident could not be told."));
      } else {
        setProblem(messageOf(error, "The project could not be made."));
      }
      setBusy(null);
    }
  };

  const onDecline = async () => {
    setBusy("decline");
    try {
      await finishProjectProposal(
        proposal.requestId,
        checkpoint?.projectId
          ? {
              chatId: checkpoint.channelId,
              outcome: "partial",
              problem: problem ?? "it was only partly made",
              projectId: checkpoint.projectId,
            }
          : { outcome: "declined" },
      );
    } catch (error) {
      toast.error(messageOf(error, "This request is no longer waiting."));
      setBusy(null);
    }
  };

  return (
    <PlaceAskRow
      {...common}
      answers={
        <>
          <PlaceQuietButton
            data-testid="project-proposal-create"
            disabled={busy !== null}
            onClick={() => void onCreate()}
          >
            {busy === "create" ? "Creating…" : problem ? "Try again" : "Create"}
          </PlaceQuietButton>
          <PlaceQuietButton
            data-testid="project-proposal-not-now"
            disabled={busy !== null}
            onClick={() => void onDecline()}
          >
            Not now
          </PlaceQuietButton>
        </>
      }
      data-project-request={proposal.requestId}
      extra={
        <span className="luca-ask-defaults" data-testid="project-proposal-line">
          {projectProposalLine(proposal.purpose, names, proposal.chatName)}
        </span>
      }
      openLabel={`${title}, ${summary}. Open the conversation`}
      panel={
        duplicate || problem ? (
          <div className="luca-project-ask-notes">
            {duplicate ? (
              <p data-testid="project-proposal-duplicate">{duplicate}</p>
            ) : null}
            {problem ? (
              <p data-testid="project-proposal-problem" role="alert">
                {problem}
              </p>
            ) : null}
          </div>
        ) : null
      }
      summary={summary}
      title={title}
    />
  );
}

/** The one quiet line a created project leaves: where it is, and a way in. */
export function ProjectProposalSettled({
  line,
  onDismiss,
}: {
  line: SettledProjectProposal;
  onDismiss: () => void;
}) {
  const { goChannel } = useAppNavigation();
  return (
    <section
      aria-label="Project created"
      className="luca-task-notice luca-measure luca-project-settled"
      data-testid="project-proposal-settled"
    >
      <div className="luca-task-notice__row">
        <span className="luca-project-settled__words" role="status">
          {projectSettledLine(line.projectName)}
        </span>
        <PlaceAskLink
          data-testid="project-proposal-open"
          onClick={() => void goChannel(line.chatId)}
        >
          Open {line.projectName}
        </PlaceAskLink>
        <button
          aria-label="Dismiss"
          className="luca-task-notice__dismiss"
          onClick={onDismiss}
          type="button"
        >
          <X aria-hidden />
        </button>
      </div>
    </section>
  );
}
