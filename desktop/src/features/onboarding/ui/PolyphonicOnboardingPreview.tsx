import * as React from "react";
import {
  AnimatePresence,
  motion,
  type Transition,
  useReducedMotion,
} from "motion/react";
import { Check, FolderPlus, Plus } from "lucide-react";

import { cn } from "@/shared/lib/cn";
import { AgentIdentitySpecimen } from "@/shared/ui/AgentIdentitySpecimen";
import { StartupWindowDragRegion } from "@/shared/ui/StartupWindowDragRegion";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  DEFAULT_DISCOVERED_RESIDENTS,
  OWNER_MARKS,
  type DiscoveredResident,
} from "./LucaOnboardingIdentitySteps";
import {
  PolyphonicBrandMark,
  PolyphonicThresholdField,
} from "./PolyphonicThresholdField";

const PREVIEW_PARAM = "polyphonicOnboardingPreview";

type PolyphonicOnboardingStage =
  | "threshold"
  | "you"
  | "agents"
  | "brain"
  | "ready";

const stages = new Set<PolyphonicOnboardingStage>([
  "threshold",
  "you",
  "agents",
  "brain",
  "ready",
]);

const stepDetails: Record<
  Exclude<PolyphonicOnboardingStage, "threshold">,
  { current: number; label: string }
> = {
  you: { current: 2, label: "You" },
  agents: { current: 3, label: "Your agents" },
  brain: { current: 4, label: "Your Brain" },
  ready: { current: 5, label: "Ready" },
};

const addedResident: DiscoveredResident = {
  detail: "Added for this Mac",
  id: "polyphonic-studio",
  name: "Studio",
  provider: "Managed resident",
  publicKey: "3b752265a749221751aff7036db47918078910ca1103ea52cfe7605e3f18b8d9",
  status: "Ready",
};

const initialBrainSources = [
  { detail: "12 repositories", id: "repositories", name: "Repositories" },
  { detail: "48 recent sessions", id: "codex", name: "Codex" },
  { detail: "31 recent sessions", id: "claude-code", name: "Claude Code" },
] as const;

type BrainSource = {
  detail: string;
  id: string;
  name: string;
};

export function readPolyphonicOnboardingPreviewStage(): PolyphonicOnboardingStage | null {
  if (!(import.meta.env.DEV || import.meta.env.MODE === "e2e")) return null;

  const value = new URL(window.location.href).searchParams.get(PREVIEW_PARAM);
  if (!value) return null;
  if (value === "1" || value === "welcome") return "threshold";
  return stages.has(value as PolyphonicOnboardingStage)
    ? (value as PolyphonicOnboardingStage)
    : null;
}

export function PolyphonicOnboardingPreview({
  initialStage,
  onComplete,
}: {
  initialStage: PolyphonicOnboardingStage;
  onComplete: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [stage, setStage] = React.useState(initialStage);
  const [name, setName] = React.useState("Riley");
  const [ownerMark, setOwnerMark] = React.useState<string>(OWNER_MARKS[0]);
  const [residents, setResidents] = React.useState<
    readonly DiscoveredResident[]
  >(DEFAULT_DISCOVERED_RESIDENTS);
  const [selectedResidents, setSelectedResidents] = React.useState(
    () =>
      new Set(
        DEFAULT_DISCOVERED_RESIDENTS.filter(
          (resident) => resident.status === "Ready",
        ).map((resident) => resident.id),
      ),
  );
  const [brainSources, setBrainSources] =
    React.useState<readonly BrainSource[]>(initialBrainSources);
  const [selectedSources, setSelectedSources] = React.useState<Set<string>>(
    () => new Set(initialBrainSources.map((source) => source.id)),
  );

  const transition: Transition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.4, ease: [0.2, 0, 0, 1] as const };

  return (
    <div
      className="max-h-dvh min-h-dvh overflow-x-hidden overflow-y-auto bg-[hsl(var(--mn-navigator))] text-[hsl(var(--mn-ink))]"
      data-stage={stage}
      data-testid="polyphonic-onboarding-preview"
      style={{
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif',
      }}
    >
      <StartupWindowDragRegion />
      {stage === "threshold" ? null : (
        <p aria-live="polite" className="sr-only" role="status">
          Step {stepDetails[stage].current} of 5: {stepDetails[stage].label}
        </p>
      )}

      <AnimatePresence initial={false} mode="wait">
        {stage === "threshold" ? (
          <Threshold
            key="threshold"
            onBegin={() => setStage("you")}
            onSkip={onComplete}
            transition={transition}
          />
        ) : (
          <SetupAssistant
            brainSources={brainSources}
            key={stage}
            name={name}
            onAddResident={() => {
              if (
                residents.some((resident) => resident.id === addedResident.id)
              ) {
                return;
              }
              setResidents((current) => [...current, addedResident]);
              setSelectedResidents(
                (current) => new Set([...current, addedResident.id]),
              );
            }}
            onAddSource={() => {
              if (brainSources.some((source) => source.id === "files")) return;
              const source = {
                detail: "1 folder added",
                id: "files",
                name: "Files",
              };
              setBrainSources((current) => [...current, source]);
              setSelectedSources((current) => new Set([...current, source.id]));
            }}
            onBack={() => setStage(previousStage(stage))}
            onComplete={onComplete}
            onContinue={() => setStage(nextStage(stage))}
            onNameChange={setName}
            onOwnerMarkChange={setOwnerMark}
            onToggleResident={(id) =>
              setSelectedResidents((current) => toggledSet(current, id))
            }
            onToggleSource={(id) =>
              setSelectedSources((current) => toggledSet(current, id))
            }
            ownerMark={ownerMark}
            residents={residents}
            selectedResidents={selectedResidents}
            selectedSources={selectedSources}
            stage={stage}
            transition={transition}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function Threshold({
  onBegin,
  onSkip,
  transition,
}: {
  onBegin: () => void;
  onSkip: () => void;
  transition: Transition;
}) {
  return (
    <motion.main
      animate={{ opacity: 1, scale: 1 }}
      className="flex min-h-dvh flex-col items-center justify-center px-6 pb-10 pt-14 text-center"
      exit={{ opacity: 0, scale: 0.985 }}
      initial={{ opacity: 0, scale: 0.985 }}
      transition={transition}
    >
      <div className="flex min-h-0 flex-col items-center">
        <PolyphonicThresholdField />
        <div className="relative -mt-5 flex flex-col items-center sm:-mt-8">
          <h1 className="text-4xl font-medium tracking-[-0.04em] text-white">
            Polyphonic
          </h1>
          <p className="mt-3 max-w-[26rem] text-sm leading-6 text-white/58">
            A private home for your agents and the work that makes them useful.
          </p>
          <Button
            className="mt-7 h-10 rounded-lg border border-[hsl(var(--primary))] bg-[hsl(var(--primary))] px-5 text-sm font-medium text-[hsl(var(--primary-foreground))] shadow-[0_10px_30px_rgba(0,0,0,0.45)] outline-none hover:bg-[hsl(var(--mn-ink))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--mn-navigator))]"
            data-testid="polyphonic-onboarding-begin"
            onClick={onBegin}
            type="button"
          >
            Begin setup
          </Button>
          <button
            className="mt-3 rounded-md px-3 py-2 text-xs text-white/42 transition-colors hover:text-white/72 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            onClick={onSkip}
            type="button"
          >
            Set up later
          </button>
        </div>
      </div>
    </motion.main>
  );
}

type SetupAssistantProps = {
  brainSources: readonly BrainSource[];
  name: string;
  onAddResident: () => void;
  onAddSource: () => void;
  onBack: () => void;
  onComplete: () => void;
  onContinue: () => void;
  onNameChange: (name: string) => void;
  onOwnerMarkChange: (mark: string) => void;
  onToggleResident: (id: string) => void;
  onToggleSource: (id: string) => void;
  ownerMark: string;
  residents: readonly DiscoveredResident[];
  selectedResidents: ReadonlySet<string>;
  selectedSources: ReadonlySet<string>;
  stage: Exclude<PolyphonicOnboardingStage, "threshold">;
  transition: Transition;
};

function SetupAssistant(props: SetupAssistantProps) {
  const step = stepDetails[props.stage];
  return (
    <motion.main
      animate={{ opacity: 1, y: 0 }}
      className="flex min-h-dvh items-center justify-center px-4 pb-8 pt-16 sm:px-6 sm:pb-10 sm:pt-20"
      exit={{ opacity: 0, y: -8 }}
      initial={{ opacity: 0, y: 12 }}
      transition={props.transition}
    >
      <section
        aria-labelledby={`polyphonic-${props.stage}-heading`}
        className="relative w-full max-w-[38rem] overflow-hidden rounded-2xl border border-[hsl(var(--mn-border))] bg-[hsl(var(--mn-raised))] shadow-[0_1px_1px_rgba(0,0,0,0.5),0_18px_50px_rgba(0,0,0,0.4)]"
        data-testid="polyphonic-setup-assistant"
      >
        <header className="flex items-center justify-between px-5 pt-5 sm:px-8 sm:pt-7">
          <div className="flex items-center gap-2.5">
            <PolyphonicBrandMark />
            <span className="text-sm font-medium tracking-[-0.01em] text-white/88">
              Polyphonic
            </span>
          </div>
          <span className="text-xs tracking-[-0.005em] text-white/42">
            Step {step.current} of 5
          </span>
        </header>

        <div className="px-5 pb-6 pt-8 sm:px-8 sm:pb-8">
          {props.stage === "you" ? <YouStep {...props} /> : null}
          {props.stage === "agents" ? <AgentsStep {...props} /> : null}
          {props.stage === "brain" ? <BrainStep {...props} /> : null}
          {props.stage === "ready" ? <ReadyStep {...props} /> : null}
        </div>

        <SetupFooter {...props} />
      </section>
    </motion.main>
  );
}

function FocusHeading({
  description,
  id,
  title,
}: {
  description: string;
  id: string;
  title: string;
}) {
  const headingRef = React.useRef<HTMLHeadingElement>(null);

  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() =>
      headingRef.current?.focus(),
    );
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <header>
      <h1
        className="text-3xl font-medium tracking-[-0.035em] text-white outline-none"
        id={id}
        ref={headingRef}
        style={{ outline: "none" }}
        tabIndex={-1}
      >
        {title}
      </h1>
      <p className="mt-2.5 max-w-[32rem] text-sm leading-6 text-white/58">
        {description}
      </p>
    </header>
  );
}

function YouStep(props: SetupAssistantProps) {
  return (
    <>
      <FocusHeading
        description="Choose how you appear to your agents. You can change this later without changing your private identity."
        id="polyphonic-you-heading"
        title="Make Polyphonic yours"
      />
      <div className="mt-7 space-y-6">
        <label className="block" htmlFor="polyphonic-owner-name">
          <span className="text-xs font-medium text-white/70">Your name</span>
          <Input
            autoComplete="name"
            className="mt-2 h-10 border-[hsl(var(--mn-border-strong))] bg-[hsl(var(--mn-navigator))] px-3.5 text-sm text-[hsl(var(--mn-ink))] placeholder:text-white/28 focus-visible:ring-2 focus-visible:ring-white/55"
            data-testid="polyphonic-owner-name"
            id="polyphonic-owner-name"
            onChange={(event) => props.onNameChange(event.target.value)}
            placeholder="What should your agents call you?"
            value={props.name}
          />
        </label>
        <fieldset>
          <legend className="text-xs font-medium text-white/70">
            Your mark
          </legend>
          <div className="mt-2.5 flex flex-wrap gap-2.5">
            {OWNER_MARKS.map((mark, index) => {
              const selected = props.ownerMark === mark;
              return (
                <button
                  aria-label={`Choose Polyphonic identity mark ${index + 1}`}
                  aria-pressed={selected}
                  className={cn(
                    "relative flex h-14 w-14 items-center justify-center rounded-xl border bg-[hsl(var(--mn-surface))] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
                    selected
                      ? "border-[hsl(var(--mn-border-strong))] bg-[hsl(var(--mn-hover))]"
                      : "border-[hsl(var(--mn-border))] hover:border-[hsl(var(--mn-border-strong))]",
                  )}
                  key={mark}
                  onClick={() => props.onOwnerMarkChange(mark)}
                  type="button"
                >
                  <AgentIdentitySpecimen
                    accessibleName={`Owner mark ${index + 1}`}
                    custody="owner"
                    publicKey={mark}
                    size={34}
                  />
                  {selected ? (
                    <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-[hsl(var(--mn-border-strong))] bg-[hsl(var(--mn-hover))] text-white/88">
                      <Check aria-hidden className="h-2.5 w-2.5" />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </fieldset>
      </div>
    </>
  );
}

function AgentsStep(props: SetupAssistantProps) {
  return (
    <>
      <FocusHeading
        description="Polyphonic found agents already set up on this Mac. Bring in the ones you want now; models and native settings stay unchanged."
        id="polyphonic-agents-heading"
        title="Bring your agents together"
      />
      <div className="mt-6 overflow-hidden rounded-lg border border-[hsl(var(--mn-border))] bg-[hsl(var(--mn-surface))]">
        {props.residents.map((resident) => {
          const selected = props.selectedResidents.has(resident.id);
          return (
            <button
              aria-pressed={selected}
              className="group flex min-h-14 w-full items-center gap-3 border-b border-[hsl(var(--mn-border))] px-3.5 py-2 text-left transition-colors last:border-b-0 hover:bg-[hsl(var(--mn-hover))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/55"
              key={resident.id}
              onClick={() => props.onToggleResident(resident.id)}
              type="button"
            >
              <AgentIdentitySpecimen
                accessibleName={resident.name}
                className={cn(!selected && "opacity-38")}
                publicKey={resident.publicKey}
                size={36}
                state="present"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-white/88">
                  {resident.name}
                </span>
                <span className="mt-0.5 block text-xs text-white/42">
                  {resident.provider} · {resident.detail}
                </span>
              </span>
              <SelectionIndicator selected={selected} />
            </button>
          );
        })}
      </div>
      <Button
        className="mt-2 h-10 gap-2 rounded-lg px-2.5 text-sm text-white/58 hover:bg-white/[0.04] hover:text-white"
        data-testid="polyphonic-add-agent"
        onClick={props.onAddResident}
        type="button"
        variant="ghost"
      >
        <Plus aria-hidden className="h-3.5 w-3.5" />
        Add another agent…
      </Button>
    </>
  );
}

function BrainStep(props: SetupAssistantProps) {
  return (
    <>
      <FocusHeading
        description="Connect the places where your work already lives. Originals stay where they are, and you decide exactly what is included."
        id="polyphonic-brain-heading"
        title="Connect your work"
      />
      <div className="mt-6 overflow-hidden rounded-lg border border-[hsl(var(--mn-border))] bg-[hsl(var(--mn-surface))]">
        {props.brainSources.map((source) => {
          const selected = props.selectedSources.has(source.id);
          return (
            <button
              aria-label={`Include ${source.name}`}
              aria-pressed={selected}
              className="group flex min-h-14 w-full items-center gap-3 border-b border-[hsl(var(--mn-border))] px-3.5 py-2 text-left transition-colors last:border-b-0 hover:bg-[hsl(var(--mn-hover))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/55"
              key={source.id}
              onClick={() => props.onToggleSource(source.id)}
              type="button"
            >
              <span className="flex h-8 w-8 items-center justify-center border border-[hsl(var(--mn-border))] font-mono text-2xs uppercase text-white/52">
                {source.name.slice(0, 2)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-white/88">
                  {source.name}
                </span>
                <span className="mt-0.5 block text-xs text-white/42">
                  {source.detail}
                </span>
              </span>
              <SelectionIndicator selected={selected} />
            </button>
          );
        })}
      </div>
      <Button
        className="mt-2 h-10 gap-2 rounded-lg px-2.5 text-sm text-white/58 hover:bg-white/[0.04] hover:text-white"
        data-testid="polyphonic-add-source"
        onClick={props.onAddSource}
        type="button"
        variant="ghost"
      >
        <FolderPlus aria-hidden className="h-3.5 w-3.5" />
        Add files or a folder…
      </Button>
      <p className="mt-4 border-t border-[hsl(var(--mn-border))] pt-4 text-xs leading-5 text-white/46">
        Polyphonic keeps a private local index. Agents may send only relevant
        excerpts to their configured models. Edits and commands always ask
        first.
      </p>
    </>
  );
}

function ReadyStep(props: SetupAssistantProps) {
  const residentCount = props.selectedResidents.size;
  const sourceCount = props.selectedSources.size;
  return (
    <>
      <FocusHeading
        description={`${props.name || "You"}, your private agent network is ready. Polyphonic will keep the machinery quiet and ask whenever a decision is yours.`}
        id="polyphonic-ready-heading"
        title="Everything is in its place"
      />
      <dl className="mt-7 overflow-hidden rounded-lg border border-[hsl(var(--mn-border))] bg-[hsl(var(--mn-surface))]">
        <SummaryRow label="You" value={props.name || "Owner"} />
        <SummaryRow
          label="Agents"
          value={
            residentCount > 0 ? `${residentCount} ready to work` : "Add later"
          }
        />
        <SummaryRow
          label="Brain"
          value={
            sourceCount > 0
              ? `${sourceCount} source groups included`
              : "Set up later"
          }
        />
      </dl>
      <p className="mt-4 text-xs leading-5 text-white/42">
        Every choice remains available from Agents, Brain, or Settings.
      </p>
    </>
  );
}

function SelectionIndicator({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-5 w-5 items-center justify-center rounded-full border transition-colors",
        selected
          ? "border-[hsl(var(--mn-border-strong))] bg-[hsl(var(--mn-hover))] text-white/88"
          : "border-[hsl(var(--mn-border))] text-transparent group-hover:border-[hsl(var(--mn-border-strong))]",
      )}
    >
      <Check className="h-3 w-3" />
    </span>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-5 border-b border-[hsl(var(--mn-border))] px-4 py-3 last:border-b-0">
      <dt className="text-xs text-white/46">{label}</dt>
      <dd className="text-sm text-white/82">{value}</dd>
    </div>
  );
}

function SetupFooter(props: SetupAssistantProps) {
  const canContinue = props.stage !== "you" || props.name.trim().length > 0;
  const primaryLabel =
    props.stage === "ready" ? "Enter Polyphonic" : "Continue";

  return (
    <footer className="flex items-center justify-between gap-4 px-5 pb-5 sm:px-8 sm:pb-7">
      <Button
        className="h-9 rounded-lg px-3 text-sm text-white/64 hover:bg-white/[0.05] hover:text-white"
        onClick={props.onBack}
        type="button"
        variant="ghost"
      >
        Back
      </Button>
      <Button
        className="h-9 rounded-lg border border-[hsl(var(--primary))] bg-[hsl(var(--primary))] px-4 text-sm font-medium text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--mn-ink))] focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--mn-surface))]"
        data-testid="polyphonic-setup-continue"
        disabled={!canContinue}
        onClick={props.stage === "ready" ? props.onComplete : props.onContinue}
        type="button"
      >
        {primaryLabel}
      </Button>
    </footer>
  );
}

function toggledSet(current: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function previousStage(
  stage: Exclude<PolyphonicOnboardingStage, "threshold">,
): PolyphonicOnboardingStage {
  if (stage === "you") return "threshold";
  if (stage === "agents") return "you";
  if (stage === "brain") return "agents";
  return "brain";
}

function nextStage(
  stage: Exclude<PolyphonicOnboardingStage, "threshold">,
): Exclude<PolyphonicOnboardingStage, "threshold"> {
  if (stage === "you") return "agents";
  if (stage === "agents") return "brain";
  if (stage === "brain") return "ready";
  return "ready";
}
