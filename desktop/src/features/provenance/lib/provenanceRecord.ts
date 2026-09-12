/**
 * Provenance records — the signed, *stored* trail an agent leaves behind.
 *
 * This reads the relay's own event log. Every row here is an event the agent
 * signed with its own key, which the relay persisted and can hand back. There
 * is no new storage behind this feature and no new relay surface: it is a
 * `REQ` with `authors: [agentPubkey]`, the same call the sidebar sync paths
 * already make.
 *
 * What it deliberately cannot show: the agent's *process* — tool calls, file
 * edits, shell commands. Those travel as kind 24200, which sits in the
 * ephemeral range (20000–29999) and is never written down. The view says so
 * out loud rather than letting the gap read as inactivity.
 */

import {
  KIND_DELETION,
  KIND_FORUM_COMMENT,
  KIND_FORUM_POST,
  KIND_GIT_ISSUE,
  KIND_GIT_PATCH,
  KIND_GIT_PULL_REQUEST,
  KIND_GIT_STATUS_CLOSED,
  KIND_GIT_STATUS_MERGED,
  KIND_GIT_STATUS_OPEN,
  KIND_JOB_ACCEPTED,
  KIND_JOB_ERROR,
  KIND_JOB_RESULT,
  KIND_REACTION,
  KIND_STREAM_MESSAGE,
  KIND_STREAM_MESSAGE_EDIT,
  KIND_STREAM_MESSAGE_V2,
} from "@/shared/constants/kinds";
import type { VerificationStatus } from "@/features/provenance/lib/verifyProvenance";
import type { RelayEvent } from "@/shared/api/types";

/**
 * The kinds a provenance query asks for.
 *
 * The relay closes any REQ that omits `kinds` (the p-gate), so this list is
 * load-bearing, not a convenience. Ephemeral kinds are excluded on purpose:
 * asking for them would return nothing and imply the trail is thinner than it
 * is.
 */
export const PROVENANCE_KINDS: number[] = [
  KIND_STREAM_MESSAGE,
  KIND_STREAM_MESSAGE_V2,
  KIND_STREAM_MESSAGE_EDIT,
  KIND_REACTION,
  KIND_DELETION,
  KIND_FORUM_POST,
  KIND_FORUM_COMMENT,
  KIND_GIT_PATCH,
  KIND_GIT_PULL_REQUEST,
  KIND_GIT_ISSUE,
  KIND_GIT_STATUS_OPEN,
  KIND_GIT_STATUS_MERGED,
  KIND_GIT_STATUS_CLOSED,
  KIND_JOB_ACCEPTED,
  KIND_JOB_RESULT,
  KIND_JOB_ERROR,
];

/**
 * How consequential a record is. Drives weight and ordering emphasis, never
 * decoration: `consequence` rows are the ones a reviewer must not scroll past.
 */
export type ProvenanceWeight = "consequence" | "substantive" | "ambient";

/** Coarse grouping used by the filter control and the row glyph. */
export type ProvenanceFamily = "speech" | "code" | "work" | "signal";

export type ProvenanceRecord = {
  /** The signed event this row is a view of. Never synthesised. */
  event: RelayEvent;
  /**
   * Result of actually checking the signature. Filled off the render path —
   * see `useAgentProvenance` — because schnorr verification is too slow to do
   * inside a render pass.
   */
  verification: VerificationStatus;
  family: ProvenanceFamily;
  weight: ProvenanceWeight;
  /** Past-tense verb: what the agent did. */
  verb: string;
  /** What it did it to, already resolved to a name where one exists. */
  object: string | null;
  /** The result, when the event carries one. */
  outcome: string | null;
  /** Channel uuid from the `h` tag, when the event is channel-scoped. */
  channelId: string | null;
  createdAt: number;
};

function tagValue(event: RelayEvent, name: string): string | null {
  for (const tag of event.tags) {
    if (tag[0] === name && typeof tag[1] === "string" && tag[1].length > 0) {
      return tag[1];
    }
  }
  return null;
}

function firstLine(content: string, max = 96): string {
  const line = content.replace(/\s+/g, " ").trim();
  if (line.length <= max) return line;
  return `${line.slice(0, max - 1)}…`;
}

type Shape = {
  family: ProvenanceFamily;
  weight: ProvenanceWeight;
  verb: string;
  object: (event: RelayEvent) => string | null;
  outcome?: (event: RelayEvent) => string | null;
};

const SHAPES: Record<number, Shape> = {
  [KIND_STREAM_MESSAGE]: {
    family: "speech",
    weight: "substantive",
    verb: "Posted a message",
    object: (event) => firstLine(event.content),
  },
  [KIND_STREAM_MESSAGE_V2]: {
    family: "speech",
    weight: "substantive",
    verb: "Posted a message",
    object: (event) => firstLine(event.content),
  },
  [KIND_STREAM_MESSAGE_EDIT]: {
    family: "speech",
    weight: "substantive",
    verb: "Edited a message",
    object: (event) => firstLine(event.content),
  },
  [KIND_REACTION]: {
    family: "signal",
    weight: "ambient",
    verb: "Reacted",
    object: (event) => (event.content.trim().length > 0 ? event.content : "+"),
  },
  [KIND_DELETION]: {
    family: "signal",
    weight: "consequence",
    verb: "Deleted an event",
    object: (event) => tagValue(event, "e"),
  },
  [KIND_FORUM_POST]: {
    family: "speech",
    weight: "substantive",
    verb: "Opened a forum post",
    object: (event) => tagValue(event, "subject") ?? firstLine(event.content),
  },
  [KIND_FORUM_COMMENT]: {
    family: "speech",
    weight: "ambient",
    verb: "Commented on a post",
    object: (event) => firstLine(event.content),
  },
  [KIND_GIT_PATCH]: {
    family: "code",
    weight: "consequence",
    verb: "Submitted a patch",
    object: (event) => tagValue(event, "subject") ?? firstLine(event.content),
  },
  [KIND_GIT_PULL_REQUEST]: {
    family: "code",
    weight: "consequence",
    verb: "Opened a pull request",
    object: (event) => tagValue(event, "subject") ?? firstLine(event.content),
  },
  [KIND_GIT_ISSUE]: {
    family: "code",
    weight: "substantive",
    verb: "Filed an issue",
    object: (event) => tagValue(event, "subject") ?? firstLine(event.content),
  },
  [KIND_GIT_STATUS_OPEN]: {
    family: "code",
    weight: "substantive",
    verb: "Reopened",
    object: (event) => tagValue(event, "e"),
    outcome: () => "open",
  },
  [KIND_GIT_STATUS_MERGED]: {
    family: "code",
    weight: "consequence",
    verb: "Merged",
    object: (event) => tagValue(event, "e"),
    outcome: () => "merged",
  },
  [KIND_GIT_STATUS_CLOSED]: {
    family: "code",
    weight: "substantive",
    verb: "Closed",
    object: (event) => tagValue(event, "e"),
    outcome: () => "closed",
  },
  [KIND_JOB_ACCEPTED]: {
    family: "work",
    weight: "ambient",
    verb: "Accepted a job",
    object: (event) => tagValue(event, "e"),
  },
  [KIND_JOB_RESULT]: {
    family: "work",
    weight: "substantive",
    verb: "Returned a job result",
    object: (event) => firstLine(event.content),
    outcome: () => "succeeded",
  },
  [KIND_JOB_ERROR]: {
    family: "work",
    weight: "consequence",
    verb: "Failed a job",
    object: (event) => firstLine(event.content),
    outcome: (event) => tagValue(event, "reason") ?? "failed",
  },
};

/**
 * Turn a signed event into one readable sentence.
 *
 * Unknown kinds are not dropped and not guessed at — they degrade to an honest
 * row naming the kind number, so the trail never silently loses a link.
 */
export function toProvenanceRecord(event: RelayEvent): ProvenanceRecord {
  const shape = SHAPES[event.kind];
  if (!shape) {
    return {
      event,
      verification: "unverifiable",
      family: "signal",
      weight: "ambient",
      verb: `Signed a kind ${event.kind} event`,
      object: event.content.length > 0 ? firstLine(event.content) : null,
      outcome: null,
      channelId: tagValue(event, "h"),
      createdAt: event.created_at,
    };
  }

  return {
    event,
    verification: "unverifiable",
    family: shape.family,
    weight: shape.weight,
    verb: shape.verb,
    object: shape.object(event),
    outcome: shape.outcome?.(event) ?? null,
    channelId: tagValue(event, "h"),
    createdAt: event.created_at,
  };
}

/** Newest first, with event id as a stable tiebreak for same-second events. */
export function sortProvenanceRecords(
  records: ProvenanceRecord[],
): ProvenanceRecord[] {
  return [...records].sort((left, right) => {
    if (right.createdAt !== left.createdAt) {
      return right.createdAt - left.createdAt;
    }
    return right.event.id.localeCompare(left.event.id);
  });
}

/** Local calendar day key, used to break the trail into dated sections. */
export function provenanceDayKey(createdAt: number): string {
  const date = new Date(createdAt * 1_000);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
