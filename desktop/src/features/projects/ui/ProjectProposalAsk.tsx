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
  type ProjectMadeSoFar,
  projectLeftLine,
  projectPartlyMade,
  projectProposalDuplicate,
  projectProposalJoins,
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
/** Telling the resident a project was made: tries, and the wait between. */
const HAND_BACK_ATTEMPTS = 3;
const HAND_BACK_RETRY_MS = 1_000;

/** What a card's row carries besides its ask: as ManagedAsks' `AskCommon`. */
type ProjectAskCommon = {
  "data-testid"?: string;
  face?: React.ReactNode;
  note?: string;
  onOpen?: () => void;
  openTestId?: string;
} & { [attribute: `data-${string}`]: string };

/** What a stopped Create left, read from the creation's own checkpoint. */
function madeSoFar(
  checkpoint: ProjectCreationCheckpoint | null,
  nameOf: (pubkey: string) => string,
): ProjectMadeSoFar {
  return {
    project: Boolean(checkpoint?.projectId),
    chat: Boolean(checkpoint?.channelId),
    inProject: Boolean(checkpoint?.roomAssigned),
    missing: (checkpoint?.pendingResidentPubkeys ?? []).map(nameOf),
  };
}

/**
 * A resident's ask to start a project, as one ask row in its conversation and
 * in Needs you: "Start a project called “Ghost app”?", who asks, the purpose,
 * who joins its first chat, and Create · Not now. Create runs the + dialog's
 * own creation without leaving the conversation, then hands the resident the
 * result. When Create stops part-way the card says in one sentence what exists,
 * and offers Try again or Leave it; leaving it tells the resident and leaves
 * the owner a line saying what is there. Nothing is ever deleted.
 */
export function ProjectProposalAsk({
  common,
  focusLineOnCreate = false,
  nameOf,
  proposal,
  summary,
}: {
  common?: ProjectAskCommon;
  /** In the conversation itself: after Create, focus its "Open …" link. */
  focusLineOnCreate?: boolean;
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
  const [stopped, setStopped] = React.useState(false);

  const names = proposal.residentPubkeys.map(nameOf);
  // The project this request already half-made is not "one you already have".
  const duplicate = projectProposalDuplicate(
    proposal.projectName,
    catalog
      .filter((project) => project.id !== checkpoint?.projectId)
      .map((project) => project.label),
  );
  const title = projectProposalTitle(proposal.projectName);
  const made = madeSoFar(checkpoint, nameOf);
  const partly = stopped ? projectPartlyMade(proposal.projectName, made) : null;
  const leaving = stopped && made.project;

  const onCreate = async () => {
    setBusy("create");
    setStopped(false);
    let reached: ProjectCreationCheckpoint | null = checkpoint;
    try {
      await authorizeProjectProposal(proposal.requestId);
      reached = await create(
        {
          label: proposal.projectName,
          roomName: proposal.chatName,
          sourceIds: [],
          residents: { mode: "existing", pubkeys: proposal.residentPubkeys },
          roomDescription: proposal.purpose,
        },
        checkpoint,
      );
    } catch (error) {
      if (error instanceof ProjectCreationFailure) reached = error.checkpoint;
      setCheckpoint(reached);
      setStopped(true);
      setBusy(null);
      return;
    }
    setCheckpoint(reached);
    const { channelId, projectId } = reached;
    if (!projectId || !channelId) {
      setStopped(true);
      setBusy(null);
      return;
    }
    // The owner's part is done: the line replaces the card from here on,
    // whether or not the resident can be told right now.
    remember({
      chatId: channelId,
      conversationId: proposal.conversationId,
      focus: focusLineOnCreate,
      projectId,
      projectName: proposal.projectName,
      requestId: proposal.requestId,
      words: projectSettledLine(proposal.projectName),
    });
    // The line already stands; telling the resident is tried a few times,
    // quietly, so a passing hiccup still reaches it.
    for (let attempt = 0; attempt < HAND_BACK_ATTEMPTS; attempt += 1) {
      if (attempt > 0)
        await new Promise((resolve) => setTimeout(resolve, HAND_BACK_RETRY_MS));
      const told = await finishProjectProposal(proposal.requestId, {
        chatId: channelId,
        outcome: "created",
        projectId,
      }).then(
        () => true,
        () => false,
      );
      if (told) return;
    }
  };

  const onDecline = async () => {
    setBusy("decline");
    const projectId = checkpoint?.projectId;
    try {
      await finishProjectProposal(
        proposal.requestId,
        projectId
          ? {
              chatId: checkpoint?.channelId,
              outcome: "partial",
              problem: projectPartlyMade(proposal.projectName, made),
              projectId,
            }
          : { outcome: "declined" },
      );
    } catch {
      toast.error("This request has already ended.");
      setBusy(null);
      return;
    }
    if (projectId)
      remember({
        chatId: checkpoint?.channelId,
        conversationId: proposal.conversationId,
        projectId,
        projectName: proposal.projectName,
        requestId: proposal.requestId,
        words: projectLeftLine(proposal.projectName, made),
      });
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
            {busy === "create" ? "Creating…" : stopped ? "Try again" : "Create"}
          </PlaceQuietButton>
          <PlaceQuietButton
            data-testid="project-proposal-not-now"
            disabled={busy !== null}
            onClick={() => void onDecline()}
          >
            {leaving ? "Leave it" : "Not now"}
          </PlaceQuietButton>
        </>
      }
      className="luca-project-ask"
      data-project-request={proposal.requestId}
      extra={
        <span
          className="luca-project-ask__lines"
          data-testid="project-proposal-line"
        >
          <span
            className="luca-project-ask__purpose"
            data-testid="project-proposal-purpose"
            title={proposal.purpose}
          >
            {proposal.purpose}
          </span>
          <span
            className="luca-project-ask__joins"
            data-testid="project-proposal-joins"
          >
            {projectProposalJoins(names, proposal.chatName)}
          </span>
        </span>
      }
      openLabel={`${title}, ${summary}. Open the conversation`}
      panel={
        duplicate || partly ? (
          <div className="luca-project-ask-notes">
            {duplicate ? (
              <p data-testid="project-proposal-duplicate">{duplicate}</p>
            ) : null}
            {partly ? (
              <p data-testid="project-proposal-problem" role="alert">
                {partly}
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

/** The one quiet line a project made from a card leaves: what is there, and
 *  a way in when its chat exists. */
export function ProjectProposalSettled({
  line,
  onDismiss,
  onFocused,
}: {
  line: SettledProjectProposal;
  onDismiss: () => void;
  /** The line took focus once; it does not take it again. */
  onFocused?: () => void;
}) {
  const { goChannel } = useAppNavigation();
  const section = React.useRef<HTMLElement>(null);
  const takeFocus = Boolean(line.focus && line.chatId);
  React.useEffect(() => {
    if (!takeFocus) return;
    section.current
      ?.querySelector<HTMLElement>('[data-testid="project-proposal-open"]')
      ?.focus({ preventScroll: true });
    onFocused?.();
  }, [takeFocus, onFocused]);
  const chatId = line.chatId;
  return (
    <section
      aria-label="New project"
      className="luca-task-notice luca-measure luca-project-settled"
      data-testid="project-proposal-settled"
      ref={section}
    >
      <div className="luca-task-notice__row">
        <span className="luca-project-settled__words" role="status">
          {line.words}
        </span>
        {chatId ? (
          <PlaceAskLink
            data-testid="project-proposal-open"
            onClick={() => void goChannel(chatId)}
          >
            Open {line.projectName}
          </PlaceAskLink>
        ) : null}
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
