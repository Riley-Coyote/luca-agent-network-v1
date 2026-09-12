import * as React from "react";

import { cn } from "@/shared/lib/cn";
import { IdentityMark } from "@/shared/ui/dot-display/identity/IdentityMark";
import { SandpileActivityIndicator } from "@/shared/ui/SandpileActivityIndicator";
import {
  CAPTURED_TURN,
  replayTurn,
  narrationText,
  stateAt,
  traceSummary,
  type ReplayedTurn,
  type TurnStep,
} from "@/features/messages/lab/turnLayers";

/**
 * WP-LAB2 · THE THREE LAYERS OF A WORKING TURN. Preview only — nothing here
 * is imported by the app.
 *
 * 1 STATUS   one line, present tense, replaced in place, naming the action
 *            AND its object.
 * 2 VOICE    the resident's own words as they work, one sentence at a time.
 * 3 TRACE    when the turn ends it collapses in place into one quiet line
 *            that expands to the ordered record and stays in the thread.
 *
 * Three options put those layers together three ways. All four states of each
 * are on the page at once so they can be compared, not remembered.
 *
 * EVERY PHRASE COMES FROM A REAL CAPTURED TURN. See `turnLayers.ts`; the
 * fixture is one turn Luca ran on 2026-09-11, 168 frames over 8m19s. Where a
 * phrase needed a derivation the app does not have, it is marked with a
 * degree sign and listed as speculative under the option.
 *
 * THE TWO FAULTS RILEY NAMED, FIXED HERE ONLY:
 *  · the mark is VERTICALLY CENTRED on the name's line box (production
 *    `MessageRow.tsx:1284` top-aligns it with `mt-0.5` inside a baseline row);
 *  · the verb sits on a FIXED COLUMN, the same x on every row, instead of
 *    flowing after a name whose width differs per resident.
 */

// The row's own geometry, from WP-STRIP1 (`MessageRow.tsx`): a 21px mark
// slot, a 16px header line box, the body one line below in chat type.
const MARK = 21;
const HEADER_LINE = 16;
const GUTTER = 12; // mark slot → text column
/** The fixed column the verb starts on, measured from the text column. */
const VERB_COLUMN = 116;
/**
 * The app's real floor TODAY: `--mn-floor: 210 7.143% 5.49%` in
 * `shared/styles/globals/conversation-shell.css:52` — #0d0e0f. Riley's
 * settled baseline is #060608, and WP-BASE1 is the package that moves the
 * token; until it lands this lab paints what the app actually paints, so a
 * judgement made here is a judgement about the app.
 */
const FLOOR = "#0d0e0f";

const RESIDENTS = [
  { name: "Luca", seed: "63dbe15bb4cf4a6b01df77d99fe30969707d758020057045f5b04763571aa77d" },
  { name: "Sol", seed: "89dd30c3b083e63043a8010e969b16deafe5c59e35301384e728fb554c121aab" },
] as const;

function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return seconds % 60 === 0 ? `${minutes}m` : `${minutes}m ${seconds % 60}s`;
}

// ---------------------------------------------------------------------------
// Row chrome — the real geometry, both faults corrected.
// ---------------------------------------------------------------------------

function MarkSlot({ live, seed }: { live: boolean; seed: string }) {
  return (
    <span
      // FAULT 1 FIXED. The slot is exactly the header's line box tall and
      // centres its content on it, so the mark's optical centre sits on the
      // name's, not two pixels above it.
      className="flex shrink-0 items-center justify-center"
      data-lab-mark-slot
      style={{ width: MARK, height: HEADER_LINE }}
    >
      {live ? (
        <SandpileActivityIndicator seed={`${seed}:activity`} size={MARK} />
      ) : (
        <IdentityMark accessibleName="" seed={seed} size={MARK} />
      )}
    </span>
  );
}

function RowShell({
  children,
  live,
  name,
  seed,
  tail,
  verb,
}: {
  children?: React.ReactNode;
  live: boolean;
  name: string;
  seed: string;
  tail?: React.ReactNode;
  verb?: React.ReactNode;
}) {
  return (
    <div className="group/row flex min-w-0 items-start" data-lab-row>
      <MarkSlot live={live} seed={seed} />
      <div className="min-w-0 flex-1" style={{ marginLeft: GUTTER }}>
        <div
          className="flex min-w-0 items-center"
          style={{ height: HEADER_LINE }}
        >
          {/* FAULT 2 FIXED. The name occupies a column of its own fixed
              width, so the verb beside it starts at the same x on every row
              however long the resident's name is. Production lets the verb
              flow after the name (`MessageRow.tsx` inlineMetadataNode), which
              is why three working residents read as three ragged sentences
              instead of a column. A name longer than the column truncates
              rather than pushing the verb. */}
          <span
            className="shrink-0 truncate pr-3 text-sm leading-none text-white/[0.86]"
            data-lab-name
            style={{ width: VERB_COLUMN }}
          >
            {name}
          </span>
          {verb ? (
            <span className="min-w-0 flex-1" data-lab-verb>
              {verb}
            </span>
          ) : null}
          {tail ? (
            <span className="ml-auto shrink-0 pl-3">{tail}</span>
          ) : null}
        </div>
        {children}
      </div>
    </div>
  );
}

/** The row's Stop, exactly as WP-STRIP1 built it: a text button, revealed on
 *  hover or focus of its own row, focus brightening its own border in place. */
function StopButton() {
  return (
    <span className="flex h-4 items-center opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 group-focus-within/row:opacity-100">
      <button
        className={cn(
          "inline-flex h-4 select-none items-center rounded-[4px] border px-1.5",
          "text-xs leading-none",
          "transition-[color,background-color,border-color] duration-150",
          "border-white/[0.09] bg-white/[0.028] text-white/[0.62]",
          "shadow-[inset_0_1px_0_rgba(255,255,255,0.055),0_1px_2px_rgba(0,0,0,0.35)]",
          "hover:border-white/[0.17] hover:bg-white/[0.052] hover:text-white/[0.88]",
          "active:bg-white/[0.018] active:text-white/[0.7]",
          "focus-visible:border-white/50 focus-visible:!outline-none",
        )}
        type="button"
      >
        Stop
      </button>
    </span>
  );
}

function Elapsed({ ms }: { ms: number }) {
  return (
    <span className="shrink-0 text-xs leading-none tabular-nums text-white/[0.3]">
      {elapsed(ms)}
    </span>
  );
}

function StatusText({
  speculative,
  text,
}: {
  speculative?: boolean;
  text: string;
}) {
  return (
    <span className="block truncate text-xs leading-none text-white/[0.5]">
      {text}
      {speculative ? (
        <span className="pl-1 text-white/[0.28]" title="speculative — see note">
          °
        </span>
      ) : null}
    </span>
  );
}

function Narration({ text }: { text: string }) {
  return (
    // One line, dim, replaced in place — never a wall. A sentence longer than
    // the row is cut here rather than allowed to grow the thread.
    <div className="mt-1 truncate text-chat leading-[1.5] text-white/[0.42]">
      {text}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

type OptionState = "working" | "narrating" | "settled" | "expanded";

/**
 * Two instants on the real turn's own clock, chosen because of what the
 * frames at them are — not for how they look.
 *
 * `working`  4m 41s in: a `read` frame whose `locations[0].path` is
 *            `.scratch/mnemos-current.html`. The last thing the resident said
 *            was 77s earlier, so the status line is carrying the turn alone.
 * `narrating` 8m 15s in: a `search` frame, 7s after a prose frame — layer 1
 *            and layer 2 both fresh.
 */
const STATE_AT_MS: Record<Exclude<OptionState, "settled" | "expanded">, number> =
  {
    working: 141_027,
    narrating: 254_703,
  };

/**
 * Three instants whose frames each carry a different kind of object — a file
 * read, a shell command, a search — so the room/private difference can be
 * read three ways rather than asserted once.
 */
const OBJECT_INSTANTS = [5_983, 141_027, 254_703] as const;

function useReplay(): ReplayedTurn {
  return React.useMemo(() => replayTurn(), []);
}

function stepFor(replay: ReplayedTurn, ms: number): TurnStep | null {
  return stateAt(replay, ms).step;
}

function TraceLine({
  expanded,
  onToggle,
  replay,
  room,
}: {
  expanded: boolean;
  onToggle: () => void;
  replay: ReplayedTurn;
  /** The record obeys the same boundary the live line does: a room's trace
   *  never gains the file names the room was not shown while it ran. */
  room: boolean;
}) {
  const summary = traceSummary("Luca", replay);
  return (
    <div>
      <button
        aria-expanded={expanded}
        className={cn(
          "inline-flex h-5 items-center rounded-[4px] border px-1.5",
          "text-xs leading-none text-white/[0.42]",
          "transition-[color,border-color,background-color] duration-150",
          "border-white/[0.09] bg-white/[0.022]",
          "hover:border-white/[0.17] hover:text-white/[0.7]",
          "focus-visible:border-white/50 focus-visible:!outline-none",
        )}
        onClick={onToggle}
        type="button"
      >
        {summary.line}
      </button>
      {expanded ? (
        <ol className="mt-2 max-h-64 overflow-y-auto border-l border-white/[0.07] pl-3">
          {replay.timeline.map((entry, index) => (
            <li
              className="flex gap-3 py-[3px] text-xs leading-[1.45]"
              key={`${entry.at}-${index}`}
            >
              <span className="w-14 shrink-0 whitespace-nowrap tabular-nums text-white/[0.26]">
                {elapsed(entry.offsetMs)}
              </span>
              {entry.type === "step" ? (
                <span className="min-w-0 text-white/[0.5]">
                  {room ? entry.roomStatus : entry.privateStatus}
                  {!room && entry.privateStatusSource === "speculative" ? (
                    <span className="pl-1 text-white/[0.28]">°</span>
                  ) : null}
                </span>
              ) : (
                <span className="min-w-0 text-white/[0.38]">
                  {narrationText(entry)}
                </span>
              )}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function OptionOne({
  replay,
  room,
  state,
}: {
  replay: ReplayedTurn;
  room: boolean;
  state: OptionState;
}) {
  const [expanded, setExpanded] = React.useState(state === "expanded");
  if (state === "settled" || state === "expanded") {
    return (
      <RowShell live={false} name="Luca" seed={RESIDENTS[0].seed}>
        <div className="mt-1">
          <TraceLine
            expanded={expanded}
            onToggle={() => setExpanded((v) => !v)}
            replay={replay}
            room={room}
          />
        </div>
      </RowShell>
    );
  }
  const ms = STATE_AT_MS[state];
  const step = stepFor(replay, ms);
  if (!step) return null;
  return (
    <RowShell
      live
      name="Luca"
      seed={RESIDENTS[0].seed}
      tail={
        <span className="flex items-center gap-3">
          <Elapsed ms={ms} />
          <StopButton />
        </span>
      }
      verb={
        <StatusText
          speculative={!room && step.privateStatusSource === "speculative"}
          text={room ? step.roomStatus : step.privateStatus}
        />
      }
    />
  );
}

function OptionTwo({
  replay,
  room,
  state,
}: {
  replay: ReplayedTurn;
  room: boolean;
  state: OptionState;
}) {
  const [expanded, setExpanded] = React.useState(state === "expanded");
  if (state === "settled" || state === "expanded") {
    return (
      <RowShell live={false} name="Luca" seed={RESIDENTS[0].seed}>
        <div className="mt-1">
          <TraceLine
            expanded={expanded}
            onToggle={() => setExpanded((v) => !v)}
            replay={replay}
            room={room}
          />
        </div>
      </RowShell>
    );
  }
  const ms = STATE_AT_MS[state];
  const { step, prose } = stateAt(replay, ms);
  if (!step) return null;
  return (
    <RowShell
      live
      name="Luca"
      seed={RESIDENTS[0].seed}
      tail={
        <span className="flex items-center gap-3">
          <Elapsed ms={ms} />
          <StopButton />
        </span>
      }
      verb={
        <StatusText
          speculative={!room && step.privateStatusSource === "speculative"}
          text={room ? step.roomStatus : step.privateStatus}
        />
      }
    >
      {prose ? <Narration text={narrationText(prose)} /> : null}
    </RowShell>
  );
}

function OptionThree({
  replay,
  room,
  state,
}: {
  replay: ReplayedTurn;
  room: boolean;
  state: OptionState;
}) {
  const [expanded, setExpanded] = React.useState(state === "expanded");
  if (state === "settled" || state === "expanded") {
    return (
      <RowShell live={false} name="Luca" seed={RESIDENTS[0].seed}>
        <div className="mt-1">
          <TraceLine
            expanded={expanded}
            onToggle={() => setExpanded((v) => !v)}
            replay={replay}
            room={room}
          />
        </div>
      </RowShell>
    );
  }
  const ms = STATE_AT_MS[state];
  const { step, prose, stepsSoFar } = stateAt(replay, ms);
  if (!step) return null;
  const tail = stepsSoFar.slice(-5);
  return (
    <RowShell
      live
      name="Luca"
      seed={RESIDENTS[0].seed}
      tail={
        <span className="flex items-center gap-3">
          <Elapsed ms={ms} />
          <StopButton />
        </span>
      }
      verb={
        <StatusText
          speculative={!room && step.privateStatusSource === "speculative"}
          text={room ? step.roomStatus : step.privateStatus}
        />
      }
    >
      {prose ? <Narration text={narrationText(prose)} /> : null}
      <ol className="mt-1.5 border-l border-white/[0.07] pl-3">
        {tail.map((entry, index) => (
          <li
            className="flex gap-3 py-[2px] text-xs leading-[1.4]"
            key={`${entry.at}-${index}`}
          >
            <span className="w-14 shrink-0 whitespace-nowrap tabular-nums text-white/[0.24]">
              {elapsed(entry.offsetMs)}
            </span>
            <span
              className={cn(
                "min-w-0 truncate",
                index === tail.length - 1
                  ? "text-white/[0.46]"
                  : "text-white/[0.3]",
              )}
            >
              {room ? entry.roomStatus : entry.privateStatus}
            </span>
          </li>
        ))}
        <li className="pt-1 text-xs leading-none text-white/[0.24]">
          {stepsSoFar.length} steps
        </li>
      </ol>
    </RowShell>
  );
}

// ---------------------------------------------------------------------------
// Page section
// ---------------------------------------------------------------------------

const OPTIONS = [
  {
    key: "1",
    title: "Option 1 — the line",
    note: "Layer 1 only. One status line, replaced in place, and it collapses into the trace summary when the turn ends. The quietest of the three; the room never sees more than a verb.",
    render: OptionOne,
  },
  {
    key: "2",
    title: "Option 2 — the line and the voice",
    note: "Layers 1 + 2. The resident's own sentence sits one line under the status, in body type, dim, replacing itself. The row is already at the x and y the reply will land on.",
    render: OptionTwo,
  },
  {
    key: "3",
    title: "Option 3 — the ledger",
    note: "Layers 1 + 2 + the running step list, denser. Everything the turn has done so far is on screen; the last five steps are kept and the count is named.",
    render: OptionThree,
  },
] as const;

const STATES: OptionState[] = ["working", "narrating", "settled", "expanded"];

function Panel({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div>
      <p className="mb-2 text-2xs uppercase tracking-[0.14em] text-white/[0.3]">
        {label}
      </p>
      <div
        className="rounded-[6px] border border-white/[0.07] px-3 py-2.5"
        data-lab-panel
        style={{ background: FLOOR }}
      >
        {children}
      </div>
    </div>
  );
}

export function WorkingTurnLayers() {
  const replay = useReplay();
  const [room, setRoom] = React.useState(false);
  const speculativeCount = replay.steps.filter(
    (s) => s.privateStatusSource === "speculative",
  ).length;
  const summary = traceSummary("Luca", replay);

  return (
    <section
      className="mb-16"
      data-lab-section="working-turn-layers"
      style={{ fontFamily: "Inter, system-ui, sans-serif" }}
    >
      <header className="mb-5" data-lab-header>
        <p className="text-2xs uppercase tracking-[0.14em] text-white/[0.3]">
          WP-LAB2 · preview only
        </p>
        <h2 className="mt-1.5 text-xl leading-tight tracking-[-0.015em] text-white/[0.88]">
          The three layers of a working turn
        </h2>
        <p className="mt-2 max-w-[46rem] text-sm leading-[1.6] text-white/[0.5]">
          Status, voice, trace — three ways of putting them together, each in
          four states. The row is WP-STRIP1&rsquo;s geometry, with the mark
          centred on the name and the verb on a fixed column.
        </p>
      </header>

      <div className="mb-6 rounded-[6px] border border-white/[0.07] px-3.5 py-3 text-xs leading-[1.6] text-white/[0.44]">
        <p className="text-white/[0.62]">
          Driven by a real turn — nothing on this page was written by hand.
        </p>
        <p className="mt-1.5">
          {CAPTURED_TURN.frameCount} ACP frames from one turn Luca ran on{" "}
          {new Date(CAPTURED_TURN.startedAt).toLocaleString()} ·{" "}
          {summary.elapsed} · {replay.stepCount} steps ·{" "}
          {replay.narration.length} things said. Captured from{" "}
          <span className="text-white/[0.34]">{CAPTURED_TURN.capturedFrom}</span>
          .
        </p>
        <p className="mt-1.5">
          Room phrasing comes from the app&rsquo;s own{" "}
          <code className="text-white/[0.6]">activityLabel(deriveActivity(frame))</code>
          . Private phrasing reads the frame&rsquo;s own{" "}
          <code className="text-white/[0.6]">locations[].path</code> and{" "}
          <code className="text-white/[0.6]">title</code>.{" "}
          {speculativeCount > 0 ? (
            <>
              <span className="text-white/[0.62]">{speculativeCount}</span> of{" "}
              {replay.stepCount} steps are marked{" "}
              <span className="text-white/[0.62]">°</span> — shell commands,
              whose frame carries a command line and no object, so
              &ldquo;Running&nbsp;<em>x</em>&rdquo; is this lab&rsquo;s guess,
              not a derivation the app has.
            </>
          ) : null}
        </p>
      </div>

      <div className="mb-6 flex items-center gap-2">
        {(
          [
            ["private", false],
            ["room", true],
          ] as const
        ).map(([label, value]) => (
          <button
            className={cn(
              "inline-flex h-6 items-center rounded-[4px] border px-2",
              "text-xs leading-none transition-[color,border-color,background-color] duration-150",
              "focus-visible:border-white/50 focus-visible:!outline-none",
              room === value
                ? "border-white/[0.24] bg-white/[0.05] text-white/[0.86]"
                : "border-white/[0.09] bg-white/[0.022] text-white/[0.44] hover:border-white/[0.17] hover:text-white/[0.7]",
            )}
            key={label}
            onClick={() => setRoom(value)}
            type="button"
          >
            {label === "private"
              ? "Private conversation"
              : "Room with other people"}
          </button>
        ))}
        <span className="pl-2 text-xs text-white/[0.34]">
          {room
            ? "generic phrasing — activityPhase.ts keeps arguments out of a shared room"
            : "full object — your own resident, nobody else reading"}
        </span>
      </div>

      <div className="grid gap-8">
        {OPTIONS.map((option) => (
          <div data-lab-option={option.key} key={option.key}>
            <div className="mb-3">
              <h3 className="text-base leading-snug text-white/[0.8]">
                {option.title}
              </h3>
              <p className="mt-1 max-w-[46rem] text-xs leading-[1.6] text-white/[0.42]">
                {option.note}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {STATES.map((state) => (
                <Panel key={state} label={state}>
                  <option.render
                    replay={replay}
                    room={room}
                    state={state}
                  />
                </Panel>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-10" data-lab-block="room-vs-private">
        <h3 className="text-base leading-snug text-white/[0.8]">
          Room and private, side by side
        </h3>
        <p className="mt-1 max-w-[46rem] text-xs leading-[1.6] text-white/[0.42]">
          The same frame, the same instant, both phrasings. The room never
          learns the file name; your own conversation does.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-4">
          <Panel label="private — full object">
            <div className="grid gap-2.5">
              {OBJECT_INSTANTS.map((ms) => {
                const step = stepFor(replay, ms);
                return step ? (
                  <RowShell
                    key={ms}
                    live
                    name="Luca"
                    seed={RESIDENTS[0].seed}
                    tail={<Elapsed ms={ms} />}
                    verb={
                      <StatusText
                        speculative={step.privateStatusSource === "speculative"}
                        text={step.privateStatus}
                      />
                    }
                  />
                ) : null;
              })}
            </div>
          </Panel>
          <Panel label="room — generic phrasing">
            <div className="grid gap-2.5">
              {OBJECT_INSTANTS.map((ms) => {
                const step = stepFor(replay, ms);
                return step ? (
                  <RowShell
                    key={ms}
                    live
                    name="Luca"
                    seed={RESIDENTS[0].seed}
                    tail={<Elapsed ms={ms} />}
                    verb={<StatusText text={step.roomStatus} />}
                  />
                ) : null;
              })}
            </div>
          </Panel>
        </div>
      </div>

      <div className="mt-10" data-lab-block="verb-column">
        <h3 className="text-base leading-snug text-white/[0.8]">
          The verb column, three residents
        </h3>
        <p className="mt-1 max-w-[46rem] text-xs leading-[1.6] text-white/[0.42]">
          Names of different lengths, verbs on one column. Measured in the
          check: every <code className="text-white/[0.6]">[data-lab-verb]</code>{" "}
          starts at the same x.
        </p>
        <div className="mt-3">
          <Panel label="fixed verb column">
            <div className="grid gap-2.5">
              {[
                { name: "Luca", seed: RESIDENTS[0].seed, ms: OBJECT_INSTANTS[0] },
                { name: "Sol", seed: RESIDENTS[1].seed, ms: OBJECT_INSTANTS[1] },
                {
                  name: "Aster Fieldwright",
                  seed: RESIDENTS[0].seed.slice(8),
                  ms: OBJECT_INSTANTS[2],
                },
              ].map((resident) => {
                const step = stepFor(replay, resident.ms);
                return step ? (
                  <RowShell
                    key={resident.name}
                    live
                    name={resident.name}
                    seed={resident.seed}
                    tail={<Elapsed ms={resident.ms} />}
                    verb={
                      <StatusText
                        speculative={step.privateStatusSource === "speculative"}
                        text={step.privateStatus}
                      />
                    }
                  />
                ) : null;
              })}
            </div>
          </Panel>
        </div>
      </div>

      <div
        className="mt-10 rounded-[6px] border border-white/[0.07] px-3.5 py-3 text-xs leading-[1.65] text-white/[0.44]"
        data-lab-block="capture-note"
      >
        <p className="text-white/[0.62]">What the capture actually says</p>
        <p className="mt-1.5">
          Layer 2&rsquo;s named source is{" "}
          <code className="text-white/[0.6]">agent_thought_chunk</code>. On the
          Codex runtime those frames are bold summary headers, not sentences —
          the first one in this turn reads{" "}
          <span className="text-white/[0.62]">
            {(() => {
              const first = replay.narration.find(
                (n) => n.from === "agent_thought_chunk",
              );
              return first ? `“${narrationText(first)}”` : "—";
            })()}
          </span>
          . The prose in the resident&rsquo;s voice is in{" "}
          <code className="text-white/[0.6]">agent_message_chunk</code> frames
          with the commentary phase, and that is what the narration line above
          shows. {replay.narration.filter((n) => n.from === "agent_message_chunk").length}{" "}
          of {replay.narration.length} narration frames in this turn are prose.
        </p>
      </div>
    </section>
  );
}
