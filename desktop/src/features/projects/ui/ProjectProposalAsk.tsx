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
  onAnswered,
  proposal,
  summary,
}: {
  common?: ProjectAskCommon;
  /** In the conversation itself: after Create, focus its "Open …" link. */
  focusLineOnCreate?: boolean;
  nameOf: (pubkey: string) => string;
  /** The owner's answer left a line (Create, or Leave it): where to show it. */
  onAnswered?: (requestId: string) => void;
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
    onAnswered?.(proposal.requestId);
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
    if (!projectId) return;
    remember({
      chatId: checkpoint?.channelId,
      conversationId: proposal.conversationId,
      projectId,
      projectName: proposal.projectName,
      requestId: proposal.requestId,
      words: projectLeftLine(proposal.projectName, made),
    });
    onAnswered?.(proposal.requestId);
  };

  return (
    <ProjectProposalCard
      busy={busy}
      common={common}
      duplicate={duplicate}
      joins={projectProposalJoins(names, proposal.chatName)}
      leaving={leaving}
      onCreate={() => void onCreate()}
      onDecline={() => void onDecline()}
      partly={partly}
      purpose={proposal.purpose}
      requestId={proposal.requestId}
      stopped={stopped}
      summary={summary}
      title={title}
    />
  );
}

/**
 * The card as drawn, from what its ask knows. Top to bottom: the question,
 * who asks, then either the purpose and who joins its first chat or, once a
 * Create has stopped part-way, the one sentence of what exists; then the
 * answers; under them only the note about a project already so named. Read
 * the situation, then act.
 */
export function ProjectProposalCard({
  busy,
  common,
  duplicate,
  joins,
  leaving,
  onCreate,
  onDecline,
  partly,
  purpose,
  requestId,
  stopped,
  summary,
  title,
}: {
  busy: "create" | "decline" | null;
  common?: ProjectAskCommon;
  duplicate: string | null;
  joins: string;
  /** Something was made, so declining keeps it: "Leave it". */
  leaving: boolean;
  onCreate: () => void;
  onDecline: () => void;
  /** What a stopped Create left, in one sentence. */
  partly: string | null;
  purpose: string;
  requestId: string;
  stopped: boolean;
  summary: string;
  title: string;
}) {
  return (
    <PlaceAskRow
      {...common}
      answers={
        <>
          <PlaceQuietButton
            data-testid="project-proposal-create"
            disabled={busy !== null}
            onClick={onCreate}
          >
            {busy === "create" ? "Creating…" : stopped ? "Try again" : "Create"}
          </PlaceQuietButton>
          <PlaceQuietButton
            data-testid="project-proposal-not-now"
            disabled={busy !== null}
            onClick={onDecline}
          >
            {leaving ? "Leave it" : "Not now"}
          </PlaceQuietButton>
        </>
      }
      className="luca-project-ask"
      data-project-request={requestId}
      extra={
        <span
          className="luca-project-ask__lines"
          data-testid="project-proposal-line"
        >
          {partly ? (
            <span
              className="luca-project-ask__problem"
              data-testid="project-proposal-problem"
              role="alert"
            >
              {partly}
            </span>
          ) : (
            <>
              <span
                className="luca-project-ask__purpose"
                data-testid="project-proposal-purpose"
                title={purpose}
              >
                {purpose}
              </span>
              <span
                className="luca-project-ask__joins"
                data-testid="project-proposal-joins"
              >
                {joins}
              </span>
            </>
          )}
        </span>
      }
      openLabel={`${title}, ${summary}. Open the conversation`}
      panel={
        duplicate ? (
          <div className="luca-project-ask-notes">
            <p data-testid="project-proposal-duplicate">{duplicate}</p>
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
  onPage = false,
}: {
  line: SettledProjectProposal;
  onDismiss: () => void;
  /** The line took focus once; it does not take it again. */
  onFocused?: () => void;
  /** Drawn on a page (Needs you) rather than above a composer: it sits on
   *  the page's axis and takes focus when it appears. */
  onPage?: boolean;
}) {
  const { goChannel } = useAppNavigation();
  const section = React.useRef<HTMLElement>(null);
  const takeFocus = onPage || Boolean(line.focus);
  // Before the list hands a vanished item's focus on: the way in, or the
  // dismiss when there is no chat to open.
  React.useLayoutEffect(() => {
    if (!takeFocus) return;
    const place = section.current;
    (
      place?.querySelector<HTMLElement>(
        '[data-testid="project-proposal-open"]',
      ) ??
      place?.querySelector<HTMLElement>(
        '[data-testid="project-proposal-dismiss"]',
      )
    )?.focus({ preventScroll: true });
    onFocused?.();
  }, [takeFocus, onFocused]);
  const chatId = line.chatId;
  return (
    <section
      aria-label="New project"
      className={
        onPage
          ? "luca-project-settled luca-project-settled--page"
          : "luca-task-notice luca-measure luca-project-settled"
      }
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
          data-testid="project-proposal-dismiss"
          onClick={onDismiss}
          type="button"
        >
          <X aria-hidden />
        </button>
      </div>
    </section>
  );
}
