import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";

import "@/app/shell/shell-activity.css";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import {
  type NeedsYouEntry,
  orderNeedsYou,
} from "@/app/shell/placeRails/needsYou";
import {
  PlaceAskLink,
  PlaceAskRow,
  PlaceQuietButton,
} from "@/app/shell/placeRails/PlaceAskRow";
import { PlacePage, placeNoteTime } from "@/app/shell/placeRails/PlacePage";
import { PlacePageHead } from "@/app/shell/placeRails/PlacePageHead";
import { useNeedsYou } from "@/app/shell/placeRails/useNeedsYou";
import {
  canRememberCapabilityPermission,
  PERMISSION_TENSE_WIRE_VALUE,
  runtimePermissionOffer,
  visiblePermissionTenses,
  type VisiblePermissionTense,
} from "@/features/agents/managedPermissionPolicy";
import { isExistingRuntimeTask } from "@/features/capabilities/lib/runtimeTaskPresentation";
import { ManagedInputCard } from "@/features/capabilities/ui/ManagedInputCard";
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
import {
  type PendingManagedInput,
  resolveManagedInput,
} from "@/shared/api/managedInputs";
import { resolveManagedPermission } from "@/shared/api/managedPermissions";
import { resolveExchange } from "@/shared/api/exchanges";
import { useIdentityQuery } from "@/shared/api/hooks";
import { listRuntimeConnectionStatus } from "@/shared/api/tauriMcp";
import {
  respondRuntimeTaskProposal,
  type RuntimeTaskProposal,
} from "@/shared/api/tauriRuntimeTasks";
import type {
  ManagedPermissionTense,
  PendingManagedPermission,
} from "@/shared/api/types";
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

/** The answers a permission card offers, in its words. */
const PERMISSION_TENSE_LABEL: Record<VisiblePermissionTense, string> = {
  always: "Always",
  deny: "Deny",
  once: "Once",
};

/** An item's controls, in order: its title (which opens it), then its
 *  answers. */
const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  // next item's first control, or after the last to the empty line, so the
  // next Tab carries on from here rather than from the top of the page.
  const listRef = React.useRef<HTMLUListElement>(null);
  const emptyRef = React.useRef<HTMLParagraphElement>(null);
  const focusedKey = React.useRef<string | null>(null);
  const shownKeys = React.useRef<string[]>([]);
  React.useLayoutEffect(() => {
    const keys = items.map((item) => item.key);
    const before = shownKeys.current;
    shownKeys.current = keys;
    const held = focusedKey.current;
    if (!held || keys.includes(held)) return;
    focusedKey.current = null;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const next =
      keys[Math.min(Math.max(0, before.indexOf(held)), keys.length - 1)];
    if (!next) {
      emptyRef.current?.focus();
      return;
    }
    listRef.current
      ?.querySelector(`[data-needs-key="${CSS.escape(next)}"]`)
      ?.querySelector<HTMLElement>(FOCUSABLE)
      ?.focus();
  }, [items]);

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
          <ul
            className="luca-ask-list"
            onFocus={(event) => {
              const item = (event.target as HTMLElement).closest<HTMLElement>(
                "[data-needs-key]",
              );
              focusedKey.current = item?.dataset.needsKey ?? null;
            }}
            ref={listRef}
          >
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
  const common = {
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

type Common = {
  "data-needs-key": string;
  "data-needs-kind": Item["kind"];
  "data-testid": string;
  note: string;
  onOpen: () => void;
  openTestId: string;
};

function failed(error: unknown, fallback: string) {
  toast.error(error instanceof Error ? error.message : fallback);
}

/** A permission: Deny · Once (and Always, where the desktop offers it), its
 *  action preview behind Details. */
function PermissionAsk({
  common,
  pending,
  summary,
}: {
  common: Common;
  pending: PendingManagedPermission;
  summary: string;
}) {
  const [busy, setBusy] = React.useState(false);
  const [details, setDetails] = React.useState(false);
  const request = pending.request;
  const structured = request.protocol === "luca.managed.permission.v2";
  const offer = runtimePermissionOffer(pending);
  const title = structured
    ? request.operation
    : request.title || "An agent is waiting for your decision.";
  const answer = async (optionId?: string, tense?: ManagedPermissionTense) => {
    setBusy(true);
    try {
      await resolveManagedPermission(pending.pendingId, optionId, tense);
    } catch (error) {
      failed(error, "This permission request is no longer active.");
      setBusy(false);
    }
  };
  const answers = structured
    ? [
        { key: "deny", label: "Deny", run: () => answer() },
        { key: "once", label: "Once", run: () => answer("allow_once") },
        ...(canRememberCapabilityPermission(request)
          ? [
              {
                key: "always",
                label: "Always here",
                run: () => answer("always_allow"),
              },
            ]
          : []),
      ]
    : visiblePermissionTenses(offer).map((tense) => ({
        key: tense,
        label: PERMISSION_TENSE_LABEL[tense],
        run: () => answer(undefined, PERMISSION_TENSE_WIRE_VALUE[tense]),
      }));
  const preview = structured
    ? request.resource.displayName
    : (request.actionPreview ?? request.toolCallId);
  const whereLine = structured
    ? null
    : offer.projectLabel
      ? `In ${offer.projectLabel}`
      : "Outside your projects";
  return (
    <PlaceAskRow
      {...common}
      answers={answers.map((each) => (
        <PlaceQuietButton
          data-testid={`needs-you-permission-${each.key}`}
          disabled={busy}
          key={each.key}
          onClick={() => void each.run()}
        >
          {each.label}
        </PlaceQuietButton>
      ))}
      extra={
        preview || whereLine || offer.note ? (
          <PlaceAskLink
            aria-expanded={details}
            onClick={() => setDetails((open) => !open)}
          >
            {details ? "Hide details" : "Details"}
          </PlaceAskLink>
        ) : null
      }
      openLabel={`${title}, ${summary}. Open the conversation`}
      panel={
        details ? (
          <div className="luca-ask-details" data-testid="needs-you-details">
            {whereLine ? <p>{whereLine}</p> : null}
            {preview ? <pre>{preview}</pre> : null}
            {offer.note ? <p>{offer.note}</p> : null}
          </div>
        ) : null
      }
      summary={summary}
      title={title}
    />
  );
}

/** A question: with one choice field, its choices then Send and Skip;
 *  otherwise Answer, which opens today's form under the row. */
function QuestionAsk({
  common,
  pending,
  summary,
}: {
  common: Common;
  pending: PendingManagedInput;
  summary: string;
}) {
  const [busy, setBusy] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [choice, setChoice] = React.useState<string | null>(null);
  const fields = pending.request.fields;
  const only =
    fields.length === 1 && fields[0].kind === "single" ? fields[0] : null;
  const send = async (action: "answered" | "declined") => {
    setBusy(true);
    try {
      await resolveManagedInput(
        pending.pendingId,
        action,
        action === "answered" && only && choice ? { [only.key]: choice } : {},
      );
    } catch (error) {
      failed(error, "This question is no longer waiting.");
      setBusy(false);
    }
  };
  return (
    <PlaceAskRow
      {...common}
      answers={
        only ? (
          <>
            <fieldset aria-label={only.label} className="luca-ask-choices">
              {only.options.map((option) => (
                <PlaceQuietButton
                  disabled={busy}
                  key={option.value}
                  onClick={() => setChoice(option.value)}
                  pressed={choice === option.value}
                  title={option.description ?? undefined}
                >
                  {option.label}
                </PlaceQuietButton>
              ))}
            </fieldset>
            <PlaceQuietButton
              data-testid="needs-you-question-send"
              disabled={busy || !choice}
              onClick={() => void send("answered")}
            >
              Send
            </PlaceQuietButton>
            <PlaceQuietButton
              data-testid="needs-you-question-skip"
              disabled={busy}
              onClick={() => void send("declined")}
            >
              Skip
            </PlaceQuietButton>
          </>
        ) : (
          <PlaceQuietButton
            aria-expanded={open}
            data-testid="needs-you-question-answer"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "Close" : "Answer"}
          </PlaceQuietButton>
        )
      }
      openLabel={`${pending.request.message}, ${summary}. Open the conversation`}
      panel={
        !only && open ? <ManagedInputCard compact pending={pending} /> : null
      }
      summary={summary}
      title={pending.request.message}
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
  common: Common;
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
  common: Common;
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
