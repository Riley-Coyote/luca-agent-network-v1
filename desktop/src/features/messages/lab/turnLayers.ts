import fixture from "@/features/messages/lab/fixtures/real-turn-2026-09-11.json";
import {
  activityLabel,
  deriveActivity,
  type AgentActivity,
} from "@/features/agents/lib/activityPhase";
import type { ObserverEvent } from "@/features/agents/ui/agentSessionTypes";

/**
 * WP-LAB2 · the three layers of a working turn, derived from real frames.
 *
 * Nothing here writes a phrase. Every string that reaches the screen is
 * either (a) produced by the app's own `deriveActivity` / `activityLabel`,
 * or (b) lifted verbatim out of a captured ACP frame — a tool call's `title`
 * or `locations[].path`, a thought chunk's text, a message chunk's text.
 * Anything a real frame cannot supply is not shown; where an OPTION proposes
 * a derivation the app does not have yet, it is marked `speculative` and the
 * lab labels it on screen.
 *
 * The fixture is `fixtures/real-turn-2026-09-11.json` — one resident turn
 * Luca actually ran, captured by `desktop/scripts/capture-acp-turn.mjs`.
 */

export type CapturedFrame = {
  kind: string;
  at: string;
  payload: unknown;
};

export type CapturedTurn = {
  capturedFrom: string;
  sessionId: string;
  originator: string | null;
  cwd: string | null;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  frameCount: number;
  note: string;
  frames: CapturedFrame[];
};

export const CAPTURED_TURN = fixture as unknown as CapturedTurn;

/** How a phrase on screen came to exist. The lab prints this. */
export type PhraseSource =
  /** `activityLabel(deriveActivity(frame))` — production, unchanged. */
  | "activityLabel"
  /** A field read straight off the frame (title / locations / content). */
  | "frame"
  /** A derivation this lab proposes and the app does not have yet. */
  | "speculative";

export type TurnStep = {
  at: number;
  /** ms from the first frame of the turn. */
  offsetMs: number;
  activity: AgentActivity;
  /** Layer 1 in a shared room: the app's phrase today. Object-free. */
  roomStatus: string;
  /** Layer 1 in a private conversation: the same phrase, with its object. */
  privateStatus: string;
  privateStatusSource: PhraseSource;
  /** The object itself, when the frame carried one. */
  object: string | null;
  toolKind: string | null;
};

export type TurnNarration = {
  at: number;
  offsetMs: number;
  text: string;
  /** `agent_message_chunk` is the resident's prose; `agent_thought_chunk`
   *  on the Codex runtime is a bold summary header, not a sentence. */
  from: "agent_message_chunk" | "agent_thought_chunk";
};

export type ReplayedTurn = {
  steps: TurnStep[];
  narration: TurnNarration[];
  /** Every layer-1/2 event in one ordered list — layer 3's expanded record.
   *  `seq` is assigned after the sort so the record has a stable identity per
   *  entry; several frames share a millisecond. */
  timeline: (
    | ({ type: "step"; seq: number } & TurnStep)
    | ({ type: "narration"; seq: number } & TurnNarration)
  )[];
  startedAt: number;
  endedAt: number;
  durationMs: number;
  stepCount: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function updateOf(frame: CapturedFrame): Record<string, unknown> {
  const payload = asRecord(frame.payload);
  return asRecord(asRecord(payload.params).update);
}

/** The last path segment — a name a person reads, not a path they parse. */
export function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const cut = trimmed.lastIndexOf("/");
  return cut === -1 ? trimmed : trimmed.slice(cut + 1);
}

/**
 * LAYER 1, PRIVATE. The object of the action, taken off the frame.
 *
 * `activityPhase.ts:13-16` deliberately keeps raw arguments out of a shared
 * room, and that decision stands — this is the same phrase with the object
 * added back, for a private conversation with your own resident only.
 *
 * `read` and `search` frames carry `locations[].path`, so their object is a
 * real file name. An `execute` frame carries only the command line in
 * `title`: there is no object to name without guessing, so the lab shows the
 * command's first word and marks the phrase speculative rather than
 * inventing a nicer noun for it.
 */
export function privateStatusFor(update: Record<string, unknown>): {
  label: string;
  object: string | null;
  source: PhraseSource;
} {
  const kind = asString(update.kind);
  const title = asString(update.title);
  const locations = Array.isArray(update.locations) ? update.locations : [];
  const firstPath = asString(asRecord(locations[0]).path);

  if (kind === "read" && firstPath) {
    return {
      label: `Reading ${basename(firstPath)}`,
      object: firstPath,
      source: "frame",
    };
  }
  if (kind === "search") {
    // The adapter writes `Search for '<query>' in <path>`; the query is the
    // object and it is already in the frame, quoted.
    const quoted = title?.match(/'([^']*)'/)?.[1] ?? null;
    if (quoted) {
      return { label: `Searching for ${quoted}`, object: quoted, source: "frame" };
    }
  }
  if (kind === "execute" && title) {
    const program = title.trim().split(/\s+/)[0] ?? title;
    return {
      label: `Running ${program}`,
      object: title,
      // The frame has no object field for a shell command; naming the program
      // is this lab's guess at a readable phrase, not something the app derives.
      source: "speculative",
    };
  }
  if (title) return { label: title, object: title, source: "frame" };
  return { label: "", object: null, source: "frame" };
}

/** Capitalised for a status line that begins a sentence. */
function sentenceCase(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

export function replayTurn(turn: CapturedTurn = CAPTURED_TURN): ReplayedTurn {
  const startedAt = Date.parse(turn.startedAt);
  const steps: TurnStep[] = [];
  const narration: TurnNarration[] = [];

  for (const [index, frame] of turn.frames.entries()) {
    const at = Date.parse(frame.at);
    const offsetMs = at - startedAt;
    const update = updateOf(frame);
    const kind = asString(update.sessionUpdate);

    // The production derivation, given the frame exactly as the app sees it.
    const event: ObserverEvent = {
      seq: index,
      timestamp: frame.at,
      kind: frame.kind,
      agentIndex: null,
      channelId: null,
      sessionId: turn.sessionId,
      turnId: null,
      payload: frame.payload,
    };
    const activity = deriveActivity(event);

    if (kind === "agent_thought_chunk" || kind === "agent_message_chunk") {
      const text = asString(asRecord(update.content).text)?.trim() ?? "";
      if (text) {
        narration.push({
          at,
          offsetMs,
          text,
          from:
            kind === "agent_message_chunk"
              ? "agent_message_chunk"
              : "agent_thought_chunk",
        });
      }
    }

    if (!activity) continue;
    if (kind === "tool_call_update") continue; // completion, not a new step

    const roomWord = activityLabel(activity);
    const priv =
      activity.phase === "working"
        ? privateStatusFor(update)
        : { label: sentenceCase(roomWord), object: null, source: "activityLabel" as const };

    steps.push({
      at,
      offsetMs,
      activity,
      roomStatus: sentenceCase(roomWord),
      privateStatus: priv.label || sentenceCase(roomWord),
      privateStatusSource: priv.source,
      object: priv.object,
      toolKind: activity.toolKind,
    });
  }

  const timeline = [
    ...steps.map((step) => ({ type: "step" as const, seq: 0, ...step })),
    ...narration.map((line) => ({
      type: "narration" as const,
      seq: 0,
      ...line,
    })),
  ]
    .sort((a, b) => a.at - b.at)
    .map((entry, index) => ({ ...entry, seq: index }));

  const endedAt = Date.parse(turn.endedAt);
  return {
    steps,
    narration,
    timeline,
    startedAt,
    endedAt,
    durationMs: endedAt - startedAt,
    stepCount: steps.length,
  };
}

/** LAYER 3. "Luca worked for 8m · 65 steps" — both numbers counted, not written. */
export function traceSummary(
  name: string,
  replay: ReplayedTurn,
): { line: string; elapsed: string; steps: number } {
  const seconds = Math.round(replay.durationMs / 1_000);
  const elapsed =
    seconds < 60
      ? `${seconds}s`
      : seconds % 60 === 0
        ? `${Math.floor(seconds / 60)}m`
        : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return {
    line: `${name} worked for ${elapsed} · ${replay.stepCount} steps`,
    elapsed,
    steps: replay.stepCount,
  };
}

/**
 * One line of the resident's own words, ready to read.
 *
 * Two liberties, both formatting and neither of them invention: the bold
 * markers Codex wraps a summary header in are stripped, and only the LAST
 * line of a multi-line frame is shown, because layer 2 is one sentence at a
 * time replacing itself, not a wall. The words are the frame's own.
 */
export function narrationText(line: TurnNarration): string {
  const lines = line.text
    .split("\n")
    .map((part) => part.replace(/\*\*/g, "").trim())
    .filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

/** The state of the turn at a given point on its own clock. */
export function stateAt(replay: ReplayedTurn, offsetMs: number) {
  let step: TurnStep | null = null;
  for (const candidate of replay.steps) {
    if (candidate.offsetMs > offsetMs) break;
    step = candidate;
  }
  let line: TurnNarration | null = null;
  let prose: TurnNarration | null = null;
  for (const candidate of replay.narration) {
    if (candidate.offsetMs > offsetMs) break;
    line = candidate;
    if (candidate.from === "agent_message_chunk") prose = candidate;
  }
  const stepsSoFar = replay.steps.filter((s) => s.offsetMs <= offsetMs);
  // LAYER 2 SHOWS `prose`. The brief names `agent_thought_chunk` as the
  // source; the capture says that on the Codex runtime those frames are bold
  // summary headers ("**Inspecting HTML structure**"), not sentences in the
  // resident's voice. The sentences are in `agent_message_chunk` frames of the
  // commentary phase. `narration` is kept beside it so the lab can show the
  // difference rather than assert it.
  return { step, narration: line, prose, stepsSoFar };
}
