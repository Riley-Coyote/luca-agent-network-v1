import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import "@/app/shell/shell-activity.css";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import {
  type NeedsYouEntry,
  orderNeedsYou,
} from "@/app/shell/placeRails/needsYou";
import {
  type AskCommon,
  failed,
  PermissionAsk,
  QuestionAsk,
  useAskFocusHandoff,
} from "@/app/shell/placeRails/ManagedAsks";
import {
  PlaceAskLink,
  PlaceAskRow,
  PlaceQuietButton,
} from "@/app/shell/placeRails/PlaceAskRow";
import { PlacePage, placeNoteTime } from "@/app/shell/placeRails/PlacePage";
import { PlacePageHead } from "@/app/shell/placeRails/PlacePageHead";
import { useNeedsYou } from "@/app/shell/placeRails/useNeedsYou";
import { isExistingRuntimeTask } from "@/features/capabilities/lib/runtimeTaskPresentation";
import {
  RuntimeTaskProposalConfirmation,
  useProposalDraft,
} from "@/features/capabilities/ui/RuntimeTaskProposalConfirmation";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useRoomProjects } from "@/features/channels/lib/roomProjects";
import { useCommunities } from "@/features/communities/useCommunities";
import {
  applyExchangeSnapshot,
  type ExchangeEntry,
} from "@/features/exchange/exchangeStore";
import {
  exchangeSide,
  namesAsList,
  runtimeLabel,
  shownAt,
} from "@/features/exchange/sideConversations";
import { useSideConversations } from "@/features/exchange/useSideConversations";
import type { PendingManagedInput } from "@/shared/api/managedInputs";
import { resolveExchange } from "@/shared/api/exchanges";
import { useIdentityQuery } from "@/shared/api/hooks";
import { listRuntimeConnectionStatus } from "@/shared/api/tauriMcp";
import {
  respondRuntimeTaskProposal,
  type RuntimeTaskProposal,
} from "@/shared/api/tauriRuntimeTasks";
import type { PendingManagedPermission } from "@/shared/api/types";
import { EXCHANGE_BUCKET_CEILING } from "@/shared/constants/kinds";
import { normalizePubkey } from "@/shared/lib/pubkey";

/**
 * Needs you (NAVIGATION.md, "Activity"; SHELL_BUILD.md WP-14, Decided 3 and
 * review fix 6): everything waiting on you, newest first, one flat row each
 * (PlaceAskRow): the ask in its own words, who asks and where, its answers
 * as quiet buttons in the row, and the long form only when asked for. The
 * row opens its conversation. The same list Ghost shows on the phone.
 */

type Item =
  | (NeedsYouEntry<PendingManagedPermission> & { kind: "permission" })
  | (NeedsYouEntry<PendingManagedInput> & { kind: "question" })
  | (NeedsYouEntry<RuntimeTaskProposal> & { kind: "proposal" })
  | (NeedsYouEntry<ExchangeEntry> & { kind: "exchange" });

function ms(iso: string) {
  const at = Date.parse(iso);
  return Number.isFinite(at) ? at : null;
}

export function NeedsYouCard() {
  const needs = useNeedsYou();
  const side = useSideConversations();
  const { goChannel } = useAppNavigation();

  // A proposal is answered as in its room: its project's sources name the
  // working folder.
  const channels = useChannelsQuery().data;
  const { activeCommunity } = useCommunities();
  const owner = useIdentityQuery().data?.pubkey;
  const projects = useRoomProjects(
    channels ?? [],
    owner,
    activeCommunity?.relayUrl,
  );

  const items = React.useMemo(() => {
    const entries: Item[] = [
      ...needs.permissions.map(
        (pending): Item => ({
          askedBy: normalizePubkey(pending.request.residentPubkey),
          at: null,
          conversationId: pending.request.conversationId,
          key: `permission:${pending.pendingId}`,
          kind: "permission",
          value: pending,
        }),
      ),
      ...needs.questions.map(
        (pending): Item => ({
          askedBy: normalizePubkey(pending.request.residentPubkey),
          at: null,
          conversationId: pending.request.conversationId,
          key: `question:${pending.pendingId}`,
          kind: "question",
          value: pending,
        }),
      ),
      ...needs.proposals.map(
        (proposal): Item => ({
          askedBy: normalizePubkey(proposal.residentPubkey),
          at: ms(proposal.createdAt),
          conversationId: proposal.conversationId,
          key: `proposal:${proposal.proposalId}`,
          kind: "proposal",
          value: proposal,
        }),
      ),
      ...needs.paused.map((entry): Item => {
        // When it paused: its latest turn, as the side conversations know it.
        const known =
          side.items.find(
            (item) =>
              item.kind === "exchange" && item.id === entry.record.exchangeId,
          ) ?? exchangeSide(entry, undefined);
        return {
          askedBy: entry.record.openedBy.toLowerCase(),
          at: shownAt(known),
          conversationId: entry.record.conversationId,
          key: `exchange:${entry.record.exchangeId}`,
          kind: "exchange",
          value: entry,
        };
      }),
    ];
    return orderNeedsYou(entries);
  }, [needs, side.items]);

  // An answered item leaves while it holds focus: focus moves on to the
  // next item's first control, or after the last to the empty line.
  const emptyRef = React.useRef<HTMLParagraphElement>(null);
  const keys = React.useMemo(() => items.map((item) => item.key), [items]);
  const { listRef, onFocus } = useAskFocusHandoff(keys, emptyRef);

  return (
    <PlacePage testId="needs-you-card">
      <PlacePageHead eyebrow="Activity" title="Needs you" />
      {items.length === 0 ? (
        <p
          className="luca-place-page-line"
          data-testid="needs-you-empty"
          ref={emptyRef}
          tabIndex={-1}
        >
          Nothing is waiting on you.
        </p>
      ) : (
        <section aria-label="Waiting on you" className="luca-place-group">
          <h2 className="type-eyebrow">Waiting on you</h2>
          <ul className="luca-ask-list" onFocus={onFocus} ref={listRef}>
            {items.map((item) => (
              <NeedsYouItem
                item={item}
                key={item.key}
                nameOf={side.nameOf}
                onOpen={() =>
                  void goChannel(
                    item.conversationId,
                    item.kind === "exchange"
                      ? { messageId: item.value.record.rootEventId }
                      : undefined,
                  )
                }
                projectSourceIds={
                  projects.get(item.conversationId)?.sourceIds ?? []
                }
                roomOf={side.roomOf}
              />
            ))}
          </ul>
        </section>
      )}
    </PlacePage>
  );
}

function NeedsYouItem({
  item,
  nameOf,
  onOpen,
  projectSourceIds,
  roomOf,
}: {
  item: Item;
  nameOf: (pubkey: string) => string;
  onOpen: () => void;
  projectSourceIds: string[];
  roomOf: (conversationId: string) => string;
}) {
  const who = nameOf(item.askedBy);
  const room = roomOf(item.conversationId);
  const where = (asking: string) => (room ? `${asking} · ${room}` : asking);
  const common: AskCommon = {
    "data-ask-key": item.key,
    "data-needs-key": item.key,
    "data-needs-kind": item.kind,
    "data-testid": `needs-you-${item.key}`,
    note: item.at ? placeNoteTime(new Date(item.at).toISOString()) : "now",
    onOpen,
    openTestId: "needs-you-open",
  };
  if (item.kind === "permission")
    return (
      <PermissionAsk
        common={common}
        pending={item.value}
        summary={where(`${who} asks`)}
      />
    );
  if (item.kind === "question")
    return (
      <QuestionAsk
        common={common}
        pending={item.value}
        summary={where(`${who} asks`)}
      />
    );
  if (item.kind === "proposal")
    return (
      <ProposalAsk
        common={common}
        projectSourceIds={projectSourceIds}
        proposal={item.value}
        summary={where(`${who} asks`)}
        who={who}
      />
    );
  const names = namesAsList(item.value.record.members.map(nameOf));
  return (
    <PausedExchangeAsk
      common={common}
      entry={item.value}
      names={names}
      summary={where("Waiting for you")}
    />
  );
}

/** Luca's proposal to run Codex or Claude Code: Run · Not now, its defaults
 *  in one faint line, and Change… opening today's form under the row. */
function ProposalAsk({
  common,
  projectSourceIds,
  proposal,
  summary,
  who,
}: {
  common: AskCommon;
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
      failed(error, "This runtime task proposal is no longer open.");
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
          <RuntimeTaskProposalConfirmation
            projectSourceIds={projectSourceIds}
            proposals={[proposal]}
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

/** A paused exchange's two decisions, as its room's strip offers them. */
function PausedExchangeAsk({
  common,
  entry,
  names,
  summary,
}: {
  common: AskCommon;
  entry: ExchangeEntry;
  names: string;
  summary: string;
}) {
  const [resolving, setResolving] = React.useState<"stop" | "go" | null>(null);
  const atCeiling = entry.record.bucket >= EXCHANGE_BUCKET_CEILING;
  async function decide(action: "stop" | "go") {
    setResolving(action);
    try {
      const snapshot = await resolveExchange(entry.record.exchangeId, action);
      // The head the relay kept, not the one this desktop hoped for.
      if (snapshot) applyExchangeSnapshot(snapshot);
    } catch (error) {
      failed(error, "That exchange could not be resolved.");
    } finally {
      setResolving(null);
    }
  }
  const title = atCeiling
    ? `${names} reached the conversation's limit`
    : `${names} used the ${entry.record.bucket} turns you gave them`;
  return (
    <PlaceAskRow
      {...common}
      answers={
        <>
          <PlaceQuietButton
            data-testid="needs-you-exchange-stop"
            disabled={resolving !== null}
            onClick={() => void decide("stop")}
          >
            Stop here
          </PlaceQuietButton>
          <PlaceQuietButton
            data-testid="needs-you-exchange-go"
            disabled={resolving !== null || atCeiling}
            onClick={() => void decide("go")}
            title={atCeiling ? "Conversation limit reached" : undefined}
          >
            Let them go on
          </PlaceQuietButton>
        </>
      }
      openLabel={`${title}, ${summary}. Open the conversation`}
      summary={summary}
      title={title}
    />
  );
}
