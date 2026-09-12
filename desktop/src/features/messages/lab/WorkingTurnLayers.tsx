import * as React from "react";

import { cn } from "@/shared/lib/cn";
import { IdentityMark } from "@/shared/ui/dot-display/identity/IdentityMark";
import { SandpileActivityIndicator } from "@/shared/ui/SandpileActivityIndicator";
import { Shimmer } from "@/shared/ui/Shimmer";
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
 * WP-LAB3 · A WORKING TURN — OPTION 2, REFINED AND PLAYABLE. Preview only;
 * nothing here is imported by the app.
 *
 * Riley chose Option 2 — the line and the voice — out of WP-LAB2 and gave
 * three corrections. Options 1 and 3 are gone from this page.
 *
 * 1 STATUS  one line, present tense, replaced in place, naming the action and
 *           its object. While the resident is working the line carries the
 *           sweeping gradient fill; when the turn settles the sweep stops.
 * 2 VOICE   the resident's own words as they work, one sentence at a time.
 * 3 TRACE   when the turn ends the row collapses in place into one quiet line
 *           of plain text that expands to the ordered record.
 *
 * THE STANDING RULE FOR THIS SURFACE (Riley, 2026-09-11): no bordered, filled
 * boxes anywhere. No chips, no cards, no boxed rows, no panel around a
 * specimen. Hairlines and space only. The whole section paints the app's own
 * floor so the specimens sit on it directly instead of inside a frame.
 *
 * EVERY PHRASE COMES FROM A REAL CAPTURED TURN. See `turnLayers.ts`; the
 * fixture is one turn Luca ran on 2026-09-11, 168 frames over 8m19s. Where a
 * phrase needed a derivation the app does not have, it is marked with a
 * degree sign and listed as speculative.
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
  {
    name: "Luca",
    seed: "63dbe15bb4cf4a6b01df77d99fe30969707d758020057045f5b04763571aa77d",
  },
  {
    name: "Sol",
    seed: "89dd30c3b083e63043a8010e969b16deafe5c59e35301384e728fb554c121aab",
  },
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
          {tail ? <span className="ml-auto shrink-0 pl-3">{tail}</span> : null}
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * The row's Stop.
 *
 * WP-STRIP1 built this as a bordered, filled text button and that version
 * landed (`321056d4f`). Riley's standing rule for THIS surface — no bordered,
 * filled boxes anywhere — is applied literally here, so the lab's Stop is
 * plain text that brightens on hover and on focus. That is a change to a
 * detail Riley already approved elsewhere; it is made in the lab only and is
 * raised as an open question rather than treated as decided.
 */
function StopButton() {
  return (
    <span className="flex h-4 items-center opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 group-focus-within/row:opacity-100">
      <button
        className={cn(
          "inline-flex h-4 select-none items-center",
          "text-xs leading-none text-white/[0.42]",
          "transition-colors duration-150",
          "hover:text-white/[0.86]",
          "focus-visible:text-white/[0.92] focus-visible:!outline-none",
          "focus-visible:underline focus-visible:decoration-white/40 focus-visible:underline-offset-4",
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

/**
 * CORRECTION 3 · the sweeping gradient text fill, restored not reinvented.
 *
 * `Shimmer` (`shared/ui/Shimmer.tsx`) + `.buzz-shimmer`
 * (`shared/styles/globals/animations.css:132`) is the app's own implementation
 * and already the one on a live status label in
 * `features/channels/ui/BotActivityBar.tsx:208`. It is a 400%-wide linear
 * gradient clipped to the text, travelling right-to-left on a 2s linear loop;
 * it is cool greyscale (`--foreground` over `--muted-foreground`), carries no
 * accent colour, and the stylesheet already turns the animation off under
 * `prefers-reduced-motion: reduce`. `block truncate` is the same className
 * BotActivityBar passes.
 *
 * It runs only while `live` is true, so it stops the moment the turn settles.
 */
function StatusText({
  live,
  speculative,
  text,
}: {
  live?: boolean;
  speculative?: boolean;
  text: string;
}) {
  const body = live ? (
    <Shimmer
      className={cn(
        // `!block` and `max-w-full` because `.buzz-shimmer` sets
        // `display: inline-block`, which shrink-wraps to the text and lets a
        // long status run under the elapsed instead of truncating.
        "!block max-w-full truncate text-xs leading-none",
        // The only thing localised: the two colours. Production's
        // `--foreground` / `--muted-foreground` are warm here — measured
        // rgb(159,157,147) over a rgb(193,189,178) highlight — and Riley's
        // baseline is a cool white/grey cascade. Same component, same
        // keyframes, same mechanism; the sweep is put back on the surface's
        // own ink so it matches the line it replaces.
        "[--buzz-shimmer-highlight:rgba(255,255,255,0.9)]!",
        "!text-white/[0.5]",
      )}
    >
      {text}
    </Shimmer>
  ) : (
    <span className="block truncate text-xs leading-none text-white/[0.5]">
      {text}
    </span>
  );
  if (!speculative) return body;
  return (
    <span className="flex min-w-0 items-center">
      <span className="min-w-0">{body}</span>
      <span
        className="shrink-0 pl-1 text-xs leading-none text-white/[0.28]"
        title="speculative — see note"
      >
        °
      </span>
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
// Flat controls. No borders, no fills — the standing rule applies to the
// lab's own chrome too, or the page cannot be judged.
// ---------------------------------------------------------------------------

function FlatButton({
  children,
  onClick,
  selected,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  selected?: boolean;
  title?: string;
}) {
  return (
    <button
      aria-pressed={selected}
      className={cn(
        "inline-flex h-6 select-none items-center text-xs leading-none",
        "transition-colors duration-150",
        "focus-visible:!outline-none focus-visible:underline",
        "focus-visible:decoration-white/40 focus-visible:underline-offset-4",
        selected
          ? "text-white/[0.88]"
          : "text-white/[0.4] hover:text-white/[0.72]",
      )}
      onClick={onClick}
      title={title}
      type="button"
    >
      {children}
    </button>
  );
}

function SectionHeading({
  children,
  note,
}: {
  children: React.ReactNode;
  note?: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <h3 className="text-base leading-snug text-white/[0.8]">{children}</h3>
      {note ? (
        <p className="mt-1 max-w-[46rem] text-xs leading-[1.6] text-white/[0.42]">
          {note}
        </p>
      ) : null}
    </div>
  );
}

/** A specimen sits on the floor with a label above it. No frame. */
function Specimen({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div data-lab-specimen={label}>
      <p className="mb-2 text-2xs uppercase tracking-[0.14em] text-white/[0.3]">
        {label}
      </p>
      <div className="px-1 py-1.5">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layer 3 — the trace
// ---------------------------------------------------------------------------

/**
 * CORRECTION 1 · the summary is plain text at a lower opacity, not a chip.
 * CORRECTION 2 · the expanded record keeps its ordering and drops the seconds.
 */
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
          "inline-flex h-5 select-none items-center text-xs leading-none",
          "text-white/[0.38] transition-colors duration-150",
          "hover:text-white/[0.66]",
          "focus-visible:text-white/[0.86] focus-visible:!outline-none",
          "focus-visible:underline focus-visible:decoration-white/40 focus-visible:underline-offset-4",
        )}
        data-lab-trace-summary
        onClick={onToggle}
        type="button"
      >
        {summary.line}
      </button>
      {expanded ? (
        // The one hairline this surface keeps: a rule down the left of the
        // record, standing in for the box the record used to sit in.
        <ol
          className="mt-2 max-h-64 overflow-y-auto border-l border-white/[0.07] pl-3"
          data-lab-trace-list
        >
          {replay.timeline.map((entry) => (
            <li className="py-[3px] text-xs leading-[1.45]" key={entry.seq}>
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

// ---------------------------------------------------------------------------
// Option 2 — the line and the voice. The only option left on the page.
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
const STATE_AT_MS: Record<
  Exclude<OptionState, "settled" | "expanded">,
  number
> = {
  working: 141_027,
  narrating: 254_703,
};

/**
 * Three instants whose frames each carry a different kind of object — a file
 * read, a shell command, a search — so the room/private difference can be
 * read three ways rather than asserted once.
 */
const OBJECT_INSTANTS = [5_983, 141_027, 254_703] as const;

/**
 * One real `execute` frame, for the open commands question. 1m 18s into the
 * turn; the frame's `title` is the whole command line and it carries no
 * `locations`, which is exactly why the question exists.
 */
const COMMAND_INSTANT_MS = 77_942;

function useReplay(): ReplayedTurn {
  return React.useMemo(() => replayTurn(), []);
}

function stepFor(replay: ReplayedTurn, ms: number): TurnStep | null {
  return stateAt(replay, ms).step;
}

function LineAndVoice({
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
          live
          speculative={!room && step.privateStatusSource === "speculative"}
          text={room ? step.roomStatus : step.privateStatus}
        />
      }
    >
      {prose ? <Narration text={narrationText(prose)} /> : null}
    </RowShell>
  );
}

// ---------------------------------------------------------------------------
// THE MAIN DELIVERABLE · playback. The captured turn on its own clock.
// ---------------------------------------------------------------------------

const SPEEDS = [1, 8, 30] as const;

function Scrubber({
  durationMs,
  offsetMs,
  onSeek,
}: {
  durationMs: number;
  offsetMs: number;
  onSeek: (ms: number) => void;
}) {
  return (
    <input
      aria-label="Position in the turn"
      className={cn(
        "h-4 w-full cursor-pointer appearance-none bg-transparent",
        "focus-visible:!outline-none",
        // A hairline track and a small pale dot. No box, no fill, no accent.
        "[&::-webkit-slider-runnable-track]:h-px",
        "[&::-webkit-slider-runnable-track]:bg-white/[0.14]",
        "[&::-webkit-slider-thumb]:appearance-none",
        "[&::-webkit-slider-thumb]:mt-[-3.5px]",
        "[&::-webkit-slider-thumb]:h-2 [&::-webkit-slider-thumb]:w-2",
        "[&::-webkit-slider-thumb]:rounded-full",
        "[&::-webkit-slider-thumb]:bg-white/[0.55]",
        "focus-visible:[&::-webkit-slider-thumb]:bg-white/[0.92]",
      )}
      data-lab-scrubber
      max={durationMs}
      min={0}
      onChange={(event) => onSeek(Number(event.target.value))}
      step={1}
      type="range"
      value={Math.min(offsetMs, durationMs)}
    />
  );
}

function Playback({ replay, room }: { replay: ReplayedTurn; room: boolean }) {
  const duration = replay.durationMs;
  const [offsetMs, setOffsetMs] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [speed, setSpeed] = React.useState<(typeof SPEEDS)[number]>(8);
  const [expanded, setExpanded] = React.useState(false);

  // The frames arrive on their real timestamps: wall-clock delta × speed.
  React.useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const delta = now - last;
      last = now;
      setOffsetMs((current) => {
        const next = current + delta * speed;
        if (next >= duration) {
          setPlaying(false);
          return duration;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [duration, playing, speed]);

  const finished = offsetMs >= duration;
  const { step, prose, stepsSoFar } = stateAt(replay, offsetMs);
  const summary = traceSummary("Luca", replay);

  return (
    <div data-lab-block="playback">
      <SectionHeading
        note={
          <>
            The captured turn, replayed on its own clock — the frames arrive at
            the offsets they really arrived at. The status line replaces itself,
            the sentence under it replaces itself, the sweep runs while the
            resident is working, and at the end the row settles in place into
            the summary and the record becomes available. 1× is the eight and a
            half minutes it actually took.
          </>
        }
      >
        Watch the turn happen
      </SectionHeading>

      {/* The specimen, on the floor, nothing around it. */}
      <div
        className="min-h-[76px] px-1 py-3"
        data-lab-playback-stage
        data-lab-playback-offset={Math.round(offsetMs)}
      >
        {finished ? (
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
        ) : (
          <RowShell
            live
            name="Luca"
            seed={RESIDENTS[0].seed}
            tail={
              <span className="flex items-center gap-3">
                <Elapsed ms={offsetMs} />
                <StopButton />
              </span>
            }
            verb={
              step ? (
                <StatusText
                  live
                  speculative={
                    !room && step.privateStatusSource === "speculative"
                  }
                  text={room ? step.roomStatus : step.privateStatus}
                />
              ) : (
                <StatusText live text="Thinking" />
              )
            }
          >
            {prose ? <Narration text={narrationText(prose)} /> : null}
          </RowShell>
        )}
      </div>

      {/* Transport. Flat controls, a hairline scrubber, no boxes. */}
      <div className="mt-2 flex items-center gap-5" data-lab-transport>
        <FlatButton
          onClick={() => {
            if (finished) setOffsetMs(0);
            setPlaying((value) => !value);
          }}
          selected={playing}
        >
          {playing ? "Pause" : finished ? "Replay" : "Play"}
        </FlatButton>
        <span className="flex items-center gap-3">
          {SPEEDS.map((value) => (
            <FlatButton
              key={value}
              onClick={() => setSpeed(value)}
              selected={speed === value}
              title={`${value}× — ${elapsed(duration / value)} of watching`}
            >
              {value}×
            </FlatButton>
          ))}
        </span>
        <FlatButton
          onClick={() => {
            setPlaying(false);
            setExpanded(false);
            setOffsetMs(0);
          }}
        >
          Reset
        </FlatButton>
        <span className="ml-auto shrink-0 text-xs leading-none tabular-nums text-white/[0.34]">
          {elapsed(offsetMs)} / {summary.elapsed} · {stepsSoFar.length} of{" "}
          {replay.stepCount} steps
        </span>
      </div>
      <div className="mt-2">
        <Scrubber
          durationMs={duration}
          offsetMs={offsetMs}
          onSeek={(ms) => {
            setPlaying(false);
            setOffsetMs(ms);
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The open question: what a shell command is called on the status line.
// ---------------------------------------------------------------------------

function CommandPhrasings({ replay }: { replay: ReplayedTurn }) {
  const step = stepFor(replay, COMMAND_INSTANT_MS);
  const command = step?.object ?? "";
  const program = command.trim().split(/\s+/)[0] ?? command;
  const speculativeCount = replay.steps.filter(
    (s) => s.privateStatusSource === "speculative",
  ).length;

  const candidates = [
    {
      key: "a",
      label: "A · the full command, privately",
      text: `Running ${command}`,
      note: "Everything the frame has. Truthful and unguessed; long, and it puts a command line in the thread.",
    },
    {
      key: "b",
      label: "B · the program name only",
      text: `Running ${program}`,
      note: "What the lab shows today, marked ° because the frame has no object field — naming the program is a guess at a readable phrase.",
    },
    {
      key: "c",
      label: "C · no object at all",
      text: "Running a command",
      note: "Nothing derived. The same phrase for all 35, and the room phrasing already says this.",
    },
  ];

  return (
    <div data-lab-block="command-phrasings">
      <SectionHeading
        note={
          <>
            Still open — {speculativeCount} of {replay.stepCount} steps in this
            turn are shell commands, and a shell command&rsquo;s frame carries a
            command line and no object. One real frame,{" "}
            {elapsed(COMMAND_INSTANT_MS)} in, phrased three ways. Not a
            recommendation; a choice to make.
          </>
        }
      >
        What a command is called
      </SectionHeading>
      <p className="mb-3 text-xs leading-[1.6] text-white/[0.34]">
        The frame&rsquo;s own title:{" "}
        <code className="text-white/[0.6]">{command}</code>
      </p>
      <div className="grid gap-5">
        {candidates.map((candidate) => (
          <div data-lab-phrasing={candidate.key} key={candidate.key}>
            <p className="mb-2 text-2xs uppercase tracking-[0.14em] text-white/[0.3]">
              {candidate.label}
            </p>
            <div className="px-1 py-1.5">
              <RowShell
                live
                name="Luca"
                seed={RESIDENTS[0].seed}
                tail={<Elapsed ms={COMMAND_INSTANT_MS} />}
                verb={<StatusText live text={candidate.text} />}
              />
            </div>
            <p className="mt-1.5 max-w-[46rem] text-xs leading-[1.6] text-white/[0.36]">
              {candidate.note}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page section
// ---------------------------------------------------------------------------

const STATES: OptionState[] = ["working", "narrating", "settled", "expanded"];

export function WorkingTurnLayers() {
  const replay = useReplay();
  const [room, setRoom] = React.useState(false);
  const speculativeCount = replay.steps.filter(
    (s) => s.privateStatusSource === "speculative",
  ).length;
  const summary = traceSummary("Luca", replay);

  return (
    <section
      className="mb-16 px-6 py-8"
      data-lab-section="working-turn-layers"
      // The section paints the app's floor, so every specimen sits directly
      // on it. That is what replaces the panels: no frames anywhere.
      style={{ background: FLOOR, fontFamily: "Inter, system-ui, sans-serif" }}
    >
      <header className="mb-6" data-lab-header>
        <p className="text-2xs uppercase tracking-[0.14em] text-white/[0.3]">
          WP-LAB3 · preview only
        </p>
        <h2 className="mt-1.5 text-xl leading-tight tracking-[-0.015em] text-white/[0.88]">
          A working turn — the line and the voice
        </h2>
        <p className="mt-2 max-w-[46rem] text-sm leading-[1.6] text-white/[0.5]">
          Riley chose Option 2 out of WP-LAB2; options 1 and 3 are gone. The
          status line names the action and its object and carries the sweeping
          fill while the resident works; the resident&rsquo;s own sentence sits
          one line under it; when the turn ends the row settles in place into a
          quiet summary that expands to the record.
        </p>
        <p className="mt-2.5 max-w-[46rem] text-xs leading-[1.6] text-white/[0.42]">
          <span className="text-white/[0.62]">
            Standing rule for this surface (Riley, 2026-09-11):
          </span>{" "}
          no bordered, filled boxes anywhere — no chips, no cards, no boxed
          rows, no panel around a specimen. Hairlines and space only. The
          section paints the app&rsquo;s own floor instead of framing each
          specimen, and the lab&rsquo;s own controls obey the rule too.
        </p>
      </header>

      <div className="mb-7 max-w-[46rem] text-xs leading-[1.6] text-white/[0.44]">
        <p className="text-white/[0.62]">
          Driven by a real turn — nothing on this page was written by hand.
        </p>
        <p className="mt-1.5">
          {CAPTURED_TURN.frameCount} ACP frames from one turn Luca ran on{" "}
          {new Date(CAPTURED_TURN.startedAt).toLocaleString()} ·{" "}
          {summary.elapsed} · {replay.stepCount} steps ·{" "}
          {replay.narration.length} things said. Captured from{" "}
          <span className="text-white/[0.34]">
            {CAPTURED_TURN.capturedFrom}
          </span>
          .
        </p>
        <p className="mt-1.5">
          Room phrasing comes from the app&rsquo;s own{" "}
          <code className="text-white/[0.6]">
            activityLabel(deriveActivity(frame))
          </code>
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
        <p className="mt-1.5">
          The sweep is the app&rsquo;s own{" "}
          <code className="text-white/[0.6]">Shimmer</code> /{" "}
          <code className="text-white/[0.6]">.buzz-shimmer</code>, the same one
          already running on a status label in{" "}
          <code className="text-white/[0.6]">BotActivityBar.tsx</code> —
          restored here, not rewritten. It stops under{" "}
          <code className="text-white/[0.6]">prefers-reduced-motion</code>, and
          it stops when the turn settles.
        </p>
      </div>

      <div className="mb-8 flex items-center gap-5" data-lab-audience-toggle>
        {(
          [
            ["Private conversation", false],
            ["Room with other people", true],
          ] as const
        ).map(([label, value]) => (
          <FlatButton
            key={label}
            onClick={() => setRoom(value)}
            selected={room === value}
          >
            {label}
          </FlatButton>
        ))}
        <span className="text-xs text-white/[0.34]">
          {room
            ? "generic phrasing — activityPhase.ts keeps arguments out of a shared room"
            : "full object — your own resident, nobody else reading"}
        </span>
      </div>

      <Playback replay={replay} room={room} />

      <div className="mt-12" data-lab-block="states">
        <SectionHeading note="The same row held still at four points, so the states can be compared rather than remembered. The two working instants are real frames on the turn's clock.">
          The four states, held still
        </SectionHeading>
        <div className="grid grid-cols-2 gap-x-10 gap-y-7">
          {STATES.map((state) => (
            <Specimen key={state} label={state}>
              <LineAndVoice replay={replay} room={room} state={state} />
            </Specimen>
          ))}
        </div>
      </div>

      <div className="mt-12">
        <CommandPhrasings replay={replay} />
      </div>

      <div className="mt-12" data-lab-block="room-vs-private">
        <SectionHeading note="The same frame, the same instant, both phrasings. The room never learns the file name; your own conversation does.">
          Room and private, side by side
        </SectionHeading>
        <div className="grid grid-cols-2 gap-x-10">
          <Specimen label="private — full object">
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
                        live
                        speculative={step.privateStatusSource === "speculative"}
                        text={step.privateStatus}
                      />
                    }
                  />
                ) : null;
              })}
            </div>
          </Specimen>
          <Specimen label="room — generic phrasing">
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
                    verb={<StatusText live text={step.roomStatus} />}
                  />
                ) : null;
              })}
            </div>
          </Specimen>
        </div>
      </div>

      <div className="mt-12" data-lab-block="verb-column">
        <SectionHeading
          note={
            <>
              Names of different lengths, verbs on one column. Measured in the
              check: every{" "}
              <code className="text-white/[0.6]">[data-lab-verb]</code> starts
              at the same x.
            </>
          }
        >
          The verb column, three residents
        </SectionHeading>
        <Specimen label="fixed verb column">
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
                      live
                      speculative={step.privateStatusSource === "speculative"}
                      text={step.privateStatus}
                    />
                  }
                />
              ) : null;
            })}
          </div>
        </Specimen>
      </div>

      <div
        className="mt-12 max-w-[46rem] text-xs leading-[1.65] text-white/[0.44]"
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
          shows.{" "}
          {
            replay.narration.filter((n) => n.from === "agent_message_chunk")
              .length
          }{" "}
          of {replay.narration.length} narration frames in this turn are prose.
        </p>
        <p className="mt-2.5">
          <span className="text-white/[0.62]">One deliberate deviation.</span>{" "}
          The row&rsquo;s Stop was a bordered, filled text button in WP-STRIP1,
          and that version landed. The standing rule above is applied literally,
          so here Stop is plain text. That is a change to something already
          approved elsewhere — lab only, and Riley&rsquo;s call.
        </p>
      </div>
    </section>
  );
}
