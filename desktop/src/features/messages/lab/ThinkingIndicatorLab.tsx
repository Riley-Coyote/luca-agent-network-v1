import { AnimatePresence, motion } from "motion/react";
import * as React from "react";

import { LUCA_IDENTITY_SEED } from "@/features/luca/canonicalLucaResident";
import { WorkingTurnLayers } from "@/features/messages/lab/WorkingTurnLayers";
import { cn } from "@/shared/lib/cn";
import { DotSigil } from "@/shared/ui/dot-display/DotSigil";
import { IdentityMark } from "@/shared/ui/dot-display/identity/IdentityMark";
import {
  FilamentMark,
  type FilamentMotion,
} from "@/shared/ui/dot-display/identity/FilamentMark";

/**
 * Design lab: how a resident's reply row should read while the reply is
 * coming — before any of it goes into the product. `?lab=thinking` in dev.
 *
 * Every specimen is the same real message row (mark · name · time · body) and
 * runs the same loop: about to speak → thinking → reading files → streaming →
 * settled. Only the way "coming" is shown differs.
 */

type Phase = "about" | "thinking" | "reading" | "streaming" | "settled";

const PHASES: { phase: Phase; ms: number; word: string | null }[] = [
  { phase: "about", ms: 900, word: null },
  { phase: "thinking", ms: 2600, word: "thinking" },
  { phase: "reading", ms: 2200, word: "reading files" },
  { phase: "streaming", ms: 3200, word: null },
  { phase: "settled", ms: 3400, word: null },
];
const LOOP_MS = PHASES.reduce((sum, p) => sum + p.ms, 0);

const GREETING =
  "Hey Riley — I’m Luca. I’ve had a quiet look around this Mac, so whenever you’re ready, tell me what you’re working on, or pick a place to begin.";
const WORDS = GREETING.split(" ");

const EASE: [number, number, number, number] = [0.2, 0, 0, 1];
const MARK = 20;

function useLoop(playing: boolean, speed: number) {
  const [t, setT] = React.useState(0);
  React.useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const start = performance.now() - t / speed;
    const tick = (now: number) => {
      setT(((now - start) * speed) % LOOP_MS);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, t]);
  let acc = 0;
  for (const step of PHASES) {
    if (t < acc + step.ms) {
      return {
        phase: step.phase,
        word: step.word,
        progress: (t - acc) / step.ms,
        setT,
      };
    }
    acc += step.ms;
  }
  return { phase: "settled" as Phase, word: null, progress: 1, setT };
}

// ---- shared row chrome -----------------------------------------------------

function Row({
  mark,
  status,
  body,
  live,
}: {
  mark: React.ReactNode;
  status?: React.ReactNode;
  body: React.ReactNode;
  live: boolean;
}) {
  return (
    <div className="flex gap-3 px-1 py-2" data-live={live || undefined}>
      <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
        {mark}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 leading-4">
          <span className="truncate text-sm font-semibold leading-4 tracking-[-0.012em]">
            Luca
          </span>
          <span className="shrink-0 font-mono text-badge font-normal leading-4 tracking-caps tabular-nums text-ink-faint">
            12:11 AM
          </span>
          {status}
        </div>
        <div className="-mt-0.5 min-h-6 text-base leading-6 text-ink">
          {body}
        </div>
      </div>
    </div>
  );
}

function StatusWord({ word }: { word: string | null }) {
  return (
    <AnimatePresence mode="wait">
      {word ? (
        <motion.span
          animate={{ opacity: 1, y: 0 }}
          className="text-xs text-ink-faint"
          exit={{ opacity: 0, y: -2, transition: { duration: 0.16 } }}
          initial={{ opacity: 0, y: 2 }}
          key={word}
          transition={{ duration: 0.28, ease: EASE }}
        >
          {word}
        </motion.span>
      ) : null}
    </AnimatePresence>
  );
}

function StreamedText({ phase, progress }: { phase: Phase; progress: number }) {
  if (phase === "about" || phase === "thinking" || phase === "reading") {
    return null;
  }
  const count =
    phase === "settled"
      ? WORDS.length
      : Math.floor(Math.min(1, progress * 1.15) * WORDS.length);
  return (
    <span>
      {WORDS.slice(0, count).map((word, index) => (
        <motion.span
          animate={{ opacity: 1 }}
          initial={{ opacity: 0 }}
          // biome-ignore lint/suspicious/noArrayIndexKey: streamed words are positional
          key={index}
          transition={{ duration: 0.22 }}
        >
          {index > 0 ? " " : ""}
          {word}
        </motion.span>
      ))}
      {phase === "streaming" && count < WORDS.length ? (
        <span className="ml-0.5 inline-block h-[1.05em] w-px translate-y-[0.15em] animate-pulse bg-foreground/60 align-baseline" />
      ) : null}
    </span>
  );
}

const inThought = (phase: Phase) =>
  phase === "about" || phase === "thinking" || phase === "reading";

// ---- A: the mark itself is what is thinking --------------------------------
function SpecimenA({ phase, word, progress }: LoopState) {
  const scene =
    phase === "streaming" ? "pulse" : inThought(phase) ? "think" : null;
  return (
    <Row
      live={phase !== "settled"}
      mark={
        <div className="relative size-5">
          <motion.div
            animate={{ opacity: scene ? 0 : 1 }}
            className="absolute inset-0"
            transition={{ duration: 0.45, ease: EASE }}
          >
            <IdentityMark seed={LUCA_IDENTITY_SEED} size={MARK} />
          </motion.div>
          <motion.div
            animate={{ opacity: scene ? 1 : 0 }}
            className="absolute inset-0"
            transition={{ duration: 0.45, ease: EASE }}
          >
            <DotSigil
              cell={2}
              scene={scene ?? "sigil"}
              seed={LUCA_IDENTITY_SEED}
              size={MARK}
            />
          </motion.div>
        </div>
      }
      status={<StatusWord word={word} />}
      body={<StreamedText phase={phase} progress={progress} />}
    />
  );
}

// ---- A1: current through the filament ---------------------------------------
function SpecimenA1({ phase, word, progress }: LoopState) {
  const mode = inThought(phase)
    ? "current"
    : phase === "streaming"
      ? "lit"
      : "rest";
  return (
    <Row
      live={phase !== "settled"}
      mark={<FilamentMark mode={mode} seed={LUCA_IDENTITY_SEED} size={MARK} />}
      status={<StatusWord word={word} />}
      body={<StreamedText phase={phase} progress={progress} />}
    />
  );
}

// ---- A3: embers — the pile, starved and monochrome --------------------------
function SpecimenA3({ phase, word, progress }: LoopState) {
  const thinking = inThought(phase);
  return (
    <Row
      live={phase !== "settled"}
      mark={
        <div className="relative size-5">
          <motion.div
            animate={{ opacity: thinking ? 0 : 1 }}
            className="absolute inset-0"
            transition={{ duration: 0.6, ease: EASE }}
          >
            <IdentityMark seed={LUCA_IDENTITY_SEED} size={MARK} />
          </motion.div>
          <motion.div
            animate={{ opacity: thinking ? 0.9 : 0 }}
            className="absolute inset-0 [filter:grayscale(1)]"
            transition={{ duration: 0.6, ease: EASE }}
          >
            {/* `listen` is the engine's own starved think: same physics, a
                quarter of the pour, so it reads as embers, not avalanches. */}
            <DotSigil
              cell={2}
              scene="listen"
              seed={LUCA_IDENTITY_SEED}
              size={MARK}
            />
          </motion.div>
        </div>
      }
      status={<StatusWord word={word} />}
      body={<StreamedText phase={phase} progress={progress} />}
    />
  );
}

// ---- B: identity holds; three soft dots where the words will be ------------
function SpecimenB({ phase, progress }: LoopState) {
  return (
    <Row
      live={phase !== "settled"}
      mark={<IdentityMark seed={LUCA_IDENTITY_SEED} size={MARK} />}
      body={
        inThought(phase) ? (
          <span
            className="inline-flex h-6 items-center gap-1"
            aria-label="thinking"
            role="status"
          >
            {[0, 1, 2].map((i) => (
              <motion.span
                animate={{ opacity: [0.25, 0.9, 0.25], y: [0, -1.5, 0] }}
                className="block size-1.5 rounded-full bg-foreground/70"
                key={i}
                transition={{
                  duration: 1.4,
                  repeat: Number.POSITIVE_INFINITY,
                  delay: i * 0.18,
                  ease: "easeInOut",
                }}
              />
            ))}
          </span>
        ) : (
          <StreamedText phase={phase} progress={progress} />
        )
      }
    />
  );
}

// ---- C: identity breathes; the word carries the state ----------------------
function SpecimenC({ phase, word, progress }: LoopState) {
  const thinking = inThought(phase) || phase === "streaming";
  return (
    <Row
      live={phase !== "settled"}
      mark={
        <motion.div
          animate={
            thinking
              ? {
                  opacity: [0.55, 1, 0.55],
                  filter: ["brightness(1)", "brightness(1.5)", "brightness(1)"],
                }
              : { opacity: 1, filter: "brightness(1)" }
          }
          className="size-5"
          transition={
            thinking
              ? {
                  duration: 1.9,
                  repeat: Number.POSITIVE_INFINITY,
                  ease: "easeInOut",
                }
              : { duration: 0.4 }
          }
        >
          <IdentityMark seed={LUCA_IDENTITY_SEED} size={MARK} />
        </motion.div>
      }
      status={<StatusWord word={word} />}
      body={<StreamedText phase={phase} progress={progress} />}
    />
  );
}

// ---- D: identity holds; a small live field where the words will be ---------
function SpecimenD({ phase, word, progress }: LoopState) {
  return (
    <Row
      live={phase !== "settled"}
      mark={<IdentityMark seed={LUCA_IDENTITY_SEED} size={MARK} />}
      status={<StatusWord word={word} />}
      body={
        inThought(phase) ? (
          <span className="inline-flex h-6 items-center">
            <DotSigil
              cell={2}
              scene={phase === "reading" ? "work" : "think"}
              seed={`${LUCA_IDENTITY_SEED}:trace`}
              size={22}
            />
          </span>
        ) : (
          <StreamedText phase={phase} progress={progress} />
        )
      }
    />
  );
}

type LoopState = { phase: Phase; word: string | null; progress: number };

const SPECIMENS: {
  key: string;
  title: string;
  note: string;
  render: (state: LoopState) => React.ReactNode;
}[] = [
  {
    key: "A",
    title: "A · The mark is what is thinking",
    note: "Identity is replaced by state and returns when the state ends: the joined glyph gives way to the phosphor think field, then pulse while the words stream, then the glyph again. One quiet word beside the name follows the real activity. Who and what stay one object.",
    render: (s) => <SpecimenA {...s} />,
  },
  {
    key: "A1",
    title: "A1 · Current through the filament",
    note: "The glyph is a joined stroke — a wire. While Luca thinks, a soft region of light travels along it end to end, one slow traversal every 2.6s with a phosphor tail, and a quiet beat between passes. Identity never leaves; the state lives inside it. When the reply starts the light arrives and the glyph holds bright while the words stream, then eases back to rest.",
    render: (s) => <SpecimenA1 {...s} />,
  },
  {
    key: "A3",
    title: "A3 · Embers",
    note: "The same replacement as A, but the field is the engine’s own starved think — a quarter of the pour, monochrome — so it reads as slow embers rather than avalanches. On streaming the glyph simply returns and holds; no rings.",
    render: (s) => <SpecimenA3 {...s} />,
  },
  {
    key: "B",
    title: "B · Identity holds; ellipsis in the body",
    note: "The glyph never changes. Three soft dots breathe where the words will be — the messenger convention. Familiar, calm, less ours; the word is unnecessary.",
    render: (s) => <SpecimenB {...s} />,
  },
  {
    key: "C",
    title: "C · Identity breathes",
    note: "The glyph stays itself but breathes deeper and brighter while Luca is busy, and the word carries the state. Cheapest; risks reading as ‘more present’ rather than ‘working’.",
    render: (s) => <SpecimenC {...s} />,
  },
  {
    key: "D",
    title: "D · Identity holds; a live field in the body",
    note: "The glyph stays; a small phosphor field runs where the words will be — think while thinking, work while reading — then the words replace it. Keeps the mark stable and still uses the house material.",
    render: (s) => <SpecimenD {...s} />,
  },
];

const MOTIONS: { motion: FilamentMotion; title: string; note: string }[] = [
  {
    motion: "traverse",
    title: "Traverse",
    note: "End to end, one direction, a quiet beat between passes.",
  },
  {
    motion: "shuttle",
    title: "Shuttle",
    note: "Out along the stroke and back — a thought that goes and returns.",
  },
  {
    motion: "heart",
    title: "From the heart",
    note: "Light born at the glyph’s centre spreads to every terminal and recedes. Inhale, exhale. No direction, no ends.",
  },
  {
    motion: "converge",
    title: "Converge",
    note: "Enters from both ends, meets in the middle, dissolves. Things coming together.",
  },
  {
    motion: "tide",
    title: "Tide",
    note: "No point of light: a long soft crest rolls along the wire and the mark swells section by section.",
  },
  {
    motion: "wander",
    title: "Wander",
    note: "A slow random walk on the stroke, choosing branches, never repeating — drifting attention.",
  },
  {
    motion: "murmur",
    title: "Murmur",
    note: "Three faint currents at different speeds passing each other. Together the wire reads as quietly alive.",
  },
];

function FilamentSection({ bloom }: { bloom: boolean }) {
  // Perpetual: every current runs continuously in its thinking state so the
  // motion itself can be judged, with no phases and no text.
  return (
    <div className="grid gap-4">
      {MOTIONS.map((m) => (
        <section
          className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-6 rounded-xl border border-border bg-card p-5"
          key={m.motion}
        >
          <div className="min-w-0">
            <div className="mb-2 flex items-baseline justify-between gap-6">
              <h3 className="text-sm font-medium">{m.title}</h3>
            </div>
            <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-1">
              <Row
                live
                mark={
                  <FilamentMark
                    bloom={bloom}
                    mode="current"
                    motion={m.motion}
                    seed={LUCA_IDENTITY_SEED}
                    size={MARK}
                  />
                }
                status={<StatusWord word="thinking" />}
                body={null}
              />
            </div>
            <p className="mt-2 max-w-[38rem] text-xs leading-5 text-muted-foreground">
              {m.note}
            </p>
          </div>
          <div className="flex flex-col items-center gap-2">
            <FilamentMark
              bloom={bloom}
              mode="current"
              motion={m.motion}
              seed={LUCA_IDENTITY_SEED}
              size={72}
            />
            <span className="font-mono text-2xs uppercase tracking-caps-wide text-ink-faint">
              72px
            </span>
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * The exact product treatment retired on 2026-08-30. It used to replace a
 * resident's resting runtime/identity mark whenever a managed reply was live.
 * Keeping the specimen here preserves the work without leaving two competing
 * thinking animations in the conversation surface.
 */
function ArchivedRuntimeMarkThinking() {
  return (
    <section
      className="mb-12 rounded-xl border border-border bg-card p-5"
      data-testid="archived-runtime-mark-thinking"
    >
      <div className="mb-4 flex items-start justify-between gap-8">
        <div>
          <p className="font-mono text-2xs uppercase tracking-caps-wide text-ink-faint">
            archived product treatment · 2026-08-30
          </p>
          <h2 className="mt-1 text-lg font-medium tracking-[-0.01em]">
            Runtime-mark murmur
          </h2>
          <p className="mt-1 max-w-[38rem] text-sm leading-6 text-muted-foreground">
            Three faint currents pass through the resident glyph for the whole
            live turn. Retired from chat because the activity shelf now owns the
            single animated thinking signal; preserved here at its exact
            production settings.
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-border px-2 py-1 font-mono text-2xs uppercase tracking-caps-wide text-ink-faint">
          preserved
        </span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-6 rounded-lg border border-border/60 bg-background/60 px-3 py-3">
        <Row
          live
          mark={
            <FilamentMark
              bloom={false}
              fit="box"
              mode="current"
              motion="murmur"
              seed={LUCA_IDENTITY_SEED}
              size={21}
            />
          }
          status={<StatusWord word="thinking" />}
          body={null}
        />
        <div className="flex flex-col items-center gap-2">
          <FilamentMark
            bloom={false}
            fit="box"
            mode="current"
            motion="murmur"
            seed={LUCA_IDENTITY_SEED}
            size={72}
          />
          <span className="font-mono text-2xs uppercase tracking-caps-wide text-ink-faint">
            enlarged
          </span>
        </div>
      </div>
    </section>
  );
}

export function ThinkingIndicatorLab() {
  const [playing, setPlaying] = React.useState(true);
  const [speed, setSpeed] = React.useState(1);
  const [bloom, setBloom] = React.useState(true);
  const state = useLoop(playing, speed);

  return (
    <div className="h-dvh overflow-y-auto overscroll-contain bg-background text-foreground">
      {/* WP-LAB2 sits in its own, wider column: its specimens are real
          conversation rows and a 52rem page would judge them at half the
          width a thread actually has. */}
      <div className="mx-auto max-w-[84rem] px-8 pt-12">
        <WorkingTurnLayers />
      </div>
      <div className="mx-auto max-w-[52rem] px-8 pb-12">
        <header className="mb-8 flex items-end justify-between gap-6">
          <div>
            <p className="font-mono text-2xs uppercase tracking-caps-wide text-ink-faint">
              design lab
            </p>
            <h1 className="mt-1 text-2xl font-medium tracking-[-0.02em]">
              A reply is coming
            </h1>
            <p className="mt-2 max-w-[38rem] text-sm text-muted-foreground">
              The same message row, four ways of showing that Luca is about to
              speak. Each runs about to speak → thinking → reading files →
              streaming → settled, on a shared clock.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <button
              className="rounded-md border border-border px-2.5 py-1 hover:bg-accent"
              onClick={() => setPlaying((p) => !p)}
              type="button"
            >
              {playing ? "Pause" : "Play"}
            </button>
            <button
              className="rounded-md border border-border px-2.5 py-1 hover:bg-accent"
              onClick={() => state.setT(0)}
              type="button"
            >
              Restart
            </button>
            <label className="ml-2 flex items-center gap-2 text-muted-foreground">
              speed
              <select
                className="rounded-md border border-border bg-transparent px-1.5 py-1"
                onChange={(e) => setSpeed(Number(e.target.value))}
                value={speed}
              >
                <option value={0.5}>0.5×</option>
                <option value={1}>1×</option>
                <option value={2}>2×</option>
              </select>
            </label>
          </div>
        </header>

        <div className="mb-6 flex items-center gap-3 font-mono text-2xs uppercase tracking-caps-wide text-ink-faint">
          {PHASES.map((p) => (
            <span
              className={cn(
                "transition-colors",
                state.phase === p.phase && "text-foreground",
              )}
              key={p.phase}
            >
              {p.phase}
            </span>
          ))}
        </div>

        <ArchivedRuntimeMarkThinking />

        <section className="mb-12">
          <div className="mb-4 flex items-end justify-between gap-6">
            <div>
              <h2 className="text-lg font-medium tracking-[-0.01em]">
                Currents through the filament
              </h2>
              <p className="mt-1 max-w-[38rem] text-sm text-muted-foreground">
                The glyph is a graph; light can move on it in more than one way.
                Every current runs perpetually in its thinking state — row size
                on the left, enlarged on the right — so the motion itself can be
                judged.
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <label className="flex items-center gap-2">
                <input
                  checked={bloom}
                  onChange={(e) => setBloom(e.target.checked)}
                  type="checkbox"
                />
                bloom
              </label>
            </div>
          </div>
          <FilamentSection bloom={bloom} />
        </section>

        <h2 className="mb-4 text-lg font-medium tracking-[-0.01em]">
          Earlier directions, for reference
        </h2>
        <div className="grid gap-6">
          {SPECIMENS.map((specimen) => (
            <section
              className="rounded-xl border border-border bg-card p-5"
              key={specimen.key}
            >
              <div className="mb-3 flex items-baseline justify-between gap-6">
                <h2 className="text-sm font-medium">{specimen.title}</h2>
                <span className="font-mono text-2xs uppercase tracking-caps-wide text-ink-faint">
                  {state.phase}
                </span>
              </div>
              <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-1">
                {specimen.render(state)}
              </div>
              <p className="mt-3 max-w-[40rem] text-xs leading-5 text-muted-foreground">
                {specimen.note}
              </p>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
