import * as React from "react";
import { ArrowUpRight } from "lucide-react";
import { toast } from "sonner";

import "@/app/shell/shell-activity.css";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import {
  type NeedsYouEntry,
  orderNeedsYou,
} from "@/app/shell/placeRails/needsYou";
import { PlacePage, placeNoteTime } from "@/app/shell/placeRails/PlacePage";
import { PlacePageHead } from "@/app/shell/placeRails/PlacePageHead";
import { useNeedsYou } from "@/app/shell/placeRails/useNeedsYou";
import { ManagedPermissionCard } from "@/features/agents/ui/ManagedPermissionCard";
import { ManagedInputCard } from "@/features/capabilities/ui/ManagedInputCard";
import { RuntimeTaskProposalConfirmation } from "@/features/capabilities/ui/RuntimeTaskProposalConfirmation";
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
import type { RuntimeTaskProposal } from "@/shared/api/tauriRuntimeTasks";
import type { PendingManagedPermission } from "@/shared/api/types";
import { EXCHANGE_BUCKET_CEILING } from "@/shared/constants/kinds";
import { normalizePubkey } from "@/shared/lib/pubkey";

/**
 * Needs you (NAVIGATION.md, "Activity"; SHELL_BUILD.md WP-14, Decided 3):
 * everything waiting on you, newest first, each answerable where it stands
 * with the card its conversation shows (a permission, a question, Luca's
 * proposal to run Codex or Claude Code), or, for an exchange paused for
 * your word, Stop here and Let them go on. Each says who's asking and where,
 * and opens its conversation. The same list Ghost shows on the phone.
 */

type Item =
  | (NeedsYouEntry<PendingManagedPermission> & { kind: "permission" })
  | (NeedsYouEntry<PendingManagedInput> & { kind: "question" })
  | (NeedsYouEntry<RuntimeTaskProposal> & { kind: "proposal" })
  | (NeedsYouEntry<ExchangeEntry> & { kind: "exchange" });

/** An item's controls, in order: its Open, then its answer's. */
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
            className="luca-needs-list"
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
  const ask =
    item.kind === "exchange"
      ? `${namesAsList(item.value.record.members.map(nameOf))} are waiting for you`
      : item.kind === "proposal"
        ? `${who} asks to run ${runtimeLabel(item.value.runtimeFamily)}`
        : item.kind === "question"
          ? `${who} asks you`
          : `${who} asks permission`;
  return (
    <li
      className="luca-needs-item"
      data-needs-key={item.key}
      data-needs-kind={item.kind}
      data-testid={`needs-you-${item.key}`}
    >
      <div className="luca-needs-head">
        <span className="luca-needs-ask">
          <span className="luca-needs-who">{ask}</span>
          {room ? <span className="luca-needs-where"> · {room}</span> : null}
        </span>
        <span className="luca-needs-when">
          {item.at ? placeNoteTime(new Date(item.at).toISOString()) : ""}
        </span>
        <button
          aria-label={`Open ${room || "the conversation"}`}
          className="luca-needs-open"
          data-testid="needs-you-open"
          onClick={onOpen}
          type="button"
        >
          Open
          <ArrowUpRight aria-hidden />
        </button>
      </div>
      <div className="luca-needs-answer">
        {item.kind === "permission" ? (
          <ManagedPermissionCard compact pending={item.value} />
        ) : item.kind === "question" ? (
          <ManagedInputCard compact pending={item.value} />
        ) : item.kind === "proposal" ? (
          <RuntimeTaskProposalConfirmation
            projectSourceIds={projectSourceIds}
            proposals={[item.value]}
            residentNames={new Map([[item.askedBy, who]])}
          />
        ) : (
          <PausedExchange entry={item.value} />
        )}
      </div>
    </li>
  );
}

/** A paused exchange's two decisions, as its room's strip offers them. */
function PausedExchange({ entry }: { entry: ExchangeEntry }) {
  const [resolving, setResolving] = React.useState<"stop" | "go" | null>(null);
  const atCeiling = entry.record.bucket >= EXCHANGE_BUCKET_CEILING;
  async function decide(action: "stop" | "go") {
    setResolving(action);
    try {
      const snapshot = await resolveExchange(entry.record.exchangeId, action);
      // The head the relay kept, not the one this desktop hoped for.
      if (snapshot) applyExchangeSnapshot(snapshot);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "That exchange could not be resolved.",
      );
    } finally {
      setResolving(null);
    }
  }
  return (
    <div className="luca-needs-exchange" data-testid="needs-you-exchange">
      <span className="luca-needs-exchange-line">
        {atCeiling
          ? "They reached the conversation's limit."
          : `They used the ${entry.record.bucket} turns you gave them.`}
      </span>
      <span className="luca-needs-exchange-actions">
        <button
          data-testid="needs-you-exchange-stop"
          disabled={resolving !== null}
          onClick={() => void decide("stop")}
          type="button"
        >
          Stop here
        </button>
        <button
          data-testid="needs-you-exchange-go"
          disabled={resolving !== null || atCeiling}
          onClick={() => void decide("go")}
          title={atCeiling ? "Conversation limit reached" : undefined}
          type="button"
        >
          Let them go on
        </button>
      </span>
    </div>
  );
}
