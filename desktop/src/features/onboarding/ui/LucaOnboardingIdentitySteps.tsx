import * as React from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Plus,
  ShieldCheck,
} from "lucide-react";

import { cn } from "@/shared/lib/cn";
import { AgentIdentitySpecimen } from "@/shared/ui/AgentIdentitySpecimen";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { ONBOARDING_PRIMARY_CTA_CLASS } from "./OnboardingChrome";
import { OnboardingFooter } from "./OnboardingFooter";

function LucaOnboardingHeading({
  description,
  eyebrow,
  focusKey,
  title,
}: {
  description: React.ReactNode;
  eyebrow: string;
  focusKey: string;
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
    <header className="w-full max-w-[30rem]">
      <p className="font-mono text-2xs uppercase tracking-caps-wider text-white/52">
        {eyebrow}
      </p>
      <h1
        className="mt-4 max-w-[13ch] text-title font-normal tracking-[-0.035em] text-white outline-hidden focus-visible:outline-hidden"
        data-focus-key={focusKey}
        ref={headingRef}
        style={{ outline: "none" }}
        tabIndex={-1}
      >
        {title}
      </h1>
      <p className="mt-4 max-w-[28rem] text-base leading-7 text-white/58">
        {description}
      </p>
    </header>
  );
}

export const OWNER_MARKS = [
  "d1e3c2b4a5968778695a4b3c2d1e0f1029384756aabbccddeeff001122334455",
  "0f8e7d6c5b4a39281716151413121110ffeeddccbbaa99887766554433221100",
  "91a2b3c4d5e6f708192837465564738291a0b1c2d3e4f5061728394051627384",
  "5d4c3b2a190817263544536271809faebdccbbaa99887766554433221100ffee",
] as const;

export type DiscoveredResident = {
  detail: string;
  id: string;
  name: string;
  provider: string;
  publicKey: string;
  status: "Needs attention" | "Ready";
};

export const DEFAULT_DISCOVERED_RESIDENTS: readonly DiscoveredResident[] = [
  {
    detail: "Personal workspace",
    id: "hermes-default",
    name: "default",
    provider: "Hermes",
    publicKey:
      "1e8a781e155d29ee5598666c67b42b704c5f7c4ab6cc7c5cb739237105239b23",
    status: "Ready",
  },
  {
    detail: "Main workspace",
    id: "openclaw-main",
    name: "main",
    provider: "OpenClaw",
    publicKey:
      "9d09a1f407fc6c2266a769be6de174946261057242eef61719e0faacfb2d140f",
    status: "Ready",
  },
  {
    detail: "Local coding resident",
    id: "claude-code",
    name: "Claude Code",
    provider: "ACP",
    publicKey:
      "72879dfdfe67543c6e25cbfc79b326801fd3d45b022f809da4a43b5d54e46fe1",
    status: "Needs attention",
  },
];

const ADDED_RESIDENT: DiscoveredResident = {
  detail: "Added for this Mac",
  id: "custom-resident",
  name: "Studio",
  provider: "Managed resident",
  publicKey: "3b752265a749221751aff7036db47918078910ca1103ea52cfe7605e3f18b8d9",
  status: "Ready",
};

const primaryCta = `${ONBOARDING_PRIMARY_CTA_CLASS} h-11 gap-2 px-6 text-sm shadow-[0_8px_32px_rgba(0,0,0,0.32)] transition-transform duration-150 active:scale-[0.98]`;

export function WelcomeChapter({ onContinue }: { onContinue: () => void }) {
  return (
    <>
      <LucaOnboardingHeading
        description="A private place for you and the agents you work with—connected to the context that makes them useful."
        eyebrow="Welcome to Luca"
        focusKey="welcome"
        title="Your agents, working as one network"
      />
      <div className="mt-8 border-y border-white/[0.09] py-5">
        <p className="max-w-[27rem] text-sm leading-6 text-white/72">
          Luca will find what is already on this Mac, show you exactly what it
          found, and let you decide what to bring in.
        </p>
        <div className="mt-4 flex items-center gap-2.5 text-xs text-white/48">
          <ShieldCheck aria-hidden className="h-4 w-4" />
          Private by default. Nothing connects without your approval.
        </div>
      </div>
      <OnboardingFooter className="mt-8 max-w-none items-start">
        <Button
          className={primaryCta}
          data-testid="luca-onboarding-welcome-continue"
          onClick={onContinue}
          type="button"
        >
          Begin setup
          <ArrowRight aria-hidden className="h-3.5 w-3.5" />
        </Button>
      </OnboardingFooter>
    </>
  );
}

export function OwnerChapter({
  name,
  onBack,
  onContinue,
  onNameChange,
  onOwnerMarkChange,
  ownerMark,
}: {
  name: string;
  onBack: () => void;
  onContinue: () => void;
  onNameChange: (name: string) => void;
  onOwnerMarkChange: (mark: string) => void;
  ownerMark: string;
}) {
  return (
    <>
      <LucaOnboardingHeading
        description="This is how you appear to your residents. You can change both later without changing your private identity."
        eyebrow="You"
        focusKey="owner"
        title="Make Luca feel like yours"
      />
      <div className="mt-8 w-full space-y-6 border-y border-white/[0.09] py-5">
        <label className="block" htmlFor="luca-owner-name">
          <span className="font-mono text-2xs uppercase tracking-caps-wide text-white/52">
            Your name
          </span>
          <Input
            autoComplete="name"
            className="mt-2.5 h-11 border-white/12 bg-white/[0.035] px-3.5 text-base text-white placeholder:text-white/28 focus-visible:ring-white/45"
            data-testid="luca-onboarding-owner-name"
            id="luca-owner-name"
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="What should your agents call you?"
            value={name}
          />
        </label>
        <fieldset>
          <legend className="font-mono text-2xs uppercase tracking-caps-wide text-white/52">
            Your mark
          </legend>
          <div className="mt-3 flex gap-2.5">
            {OWNER_MARKS.map((mark, index) => {
              const selected = ownerMark === mark;
              return (
                <button
                  aria-label={`Choose identity mark ${index + 1}`}
                  aria-pressed={selected}
                  className={cn(
                    "relative flex h-14 w-14 items-center justify-center rounded-xl border bg-white/[0.025] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
                    selected
                      ? "border-white/70 bg-white/[0.07]"
                      : "border-white/10 hover:border-white/28",
                  )}
                  key={mark}
                  onClick={() => onOwnerMarkChange(mark)}
                  type="button"
                >
                  <AgentIdentitySpecimen
                    accessibleName={`Owner mark ${index + 1}`}
                    custody="owner"
                    publicKey={mark}
                    size={34}
                  />
                  {selected ? (
                    <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-white text-black">
                      <Check aria-hidden className="h-2.5 w-2.5" />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </fieldset>
      </div>
      <ChapterActions
        continueDisabled={!name.trim()}
        continueLabel="Continue"
        onBack={onBack}
        onContinue={onContinue}
        testId="luca-onboarding-owner-continue"
      />
    </>
  );
}

export function AgentsChapter({
  initialResidents = DEFAULT_DISCOVERED_RESIDENTS,
  onBack,
  onContinue,
}: {
  initialResidents?: readonly DiscoveredResident[];
  onBack: () => void;
  onContinue: (selected: readonly DiscoveredResident[]) => void;
}) {
  const [residents, setResidents] = React.useState([...initialResidents]);
  const [selectedIds, setSelectedIds] = React.useState(
    () =>
      new Set(
        initialResidents
          .filter((resident) => resident.status === "Ready")
          .map((resident) => resident.id),
      ),
  );

  const toggleResident = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addResident = () => {
    if (residents.some((resident) => resident.id === ADDED_RESIDENT.id)) return;
    setResidents((current) => [...current, ADDED_RESIDENT]);
    setSelectedIds((current) => new Set([...current, ADDED_RESIDENT.id]));
  };

  const selected = residents.filter((resident) => selectedIds.has(resident.id));

  return (
    <>
      <LucaOnboardingHeading
        description={
          residents.length > 0
            ? "Luca found agents already set up on this Mac. Choose which ones should live in your network."
            : "No agents are set up on this Mac yet. Add one now, or keep going and return whenever you are ready."
        }
        eyebrow="Your agents"
        focusKey="agents"
        title={
          residents.length > 0
            ? "Bring your agents together"
            : "Add your first agent"
        }
      />
      {residents.length > 0 ? (
        <section aria-label="Agents found on this Mac" className="mt-6 w-full">
          <div className="flex items-center justify-between border-b border-white/[0.09] pb-2.5">
            <h2 className="font-mono text-2xs uppercase tracking-caps-wide text-white/52">
              Found on this Mac
            </h2>
            <span className="text-xs text-white/42">
              {selected.length} selected
            </span>
          </div>
          <ul>
            {residents.map((resident) => {
              const isSelected = selectedIds.has(resident.id);
              return (
                <li className="border-b border-white/[0.07]" key={resident.id}>
                  <button
                    aria-pressed={isSelected}
                    className="group flex min-h-14 w-full items-center gap-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/55"
                    onClick={() => toggleResident(resident.id)}
                    type="button"
                  >
                    <AgentIdentitySpecimen
                      accessibleName={resident.name}
                      className={cn(!isSelected && "opacity-40")}
                      publicKey={resident.publicKey}
                      size={38}
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
                    <span
                      className={cn(
                        "font-mono text-2xs uppercase tracking-caps-wide",
                        resident.status === "Ready"
                          ? "text-white/52"
                          : "text-warning",
                      )}
                    >
                      {resident.status}
                    </span>
                    <span
                      aria-hidden
                      className={cn(
                        "flex h-5 w-5 items-center justify-center rounded-full border transition-colors",
                        isSelected
                          ? "border-white bg-white text-black"
                          : "border-white/20 text-transparent group-hover:border-white/40",
                      )}
                    >
                      <Check className="h-3 w-3" />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between pt-3">
            <Button
              className="h-9 gap-2 rounded-full px-0 text-sm text-white/58 hover:bg-transparent hover:text-white"
              data-testid="luca-onboarding-add-agent"
              onClick={addResident}
              type="button"
              variant="ghost"
            >
              <Plus aria-hidden className="h-3.5 w-3.5" />
              Add another agent
            </Button>
            <details className="group text-right">
              <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-white/42 hover:text-white/72">
                Details
                <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
              </summary>
              <p className="mt-2 max-w-[15rem] text-xs leading-5 text-white/38">
                Runtime and model settings stay unchanged. Agents are imported
                with stable Luca identities.
              </p>
            </details>
          </div>
        </section>
      ) : (
        <section className="mt-8 border-y border-dashed border-white/15 py-7">
          <p className="text-sm text-white/82">No agents found yet</p>
          <p className="mt-2 text-xs leading-5 text-white/46">
            Add one now, or continue and create residents from Agents later.
          </p>
          <Button
            className="mt-5 h-10 gap-2 rounded-full border border-white/16 bg-white/[0.04] px-4 text-sm text-white hover:bg-white/[0.08]"
            onClick={addResident}
            type="button"
            variant="outline"
          >
            <Plus aria-hidden className="h-3.5 w-3.5" />
            Add an agent
          </Button>
        </section>
      )}
      <ChapterActions
        continueLabel={
          selected.length > 0
            ? `Continue with ${selected.length} ${selected.length === 1 ? "agent" : "agents"}`
            : "Continue without agents"
        }
        onBack={onBack}
        onContinue={() => onContinue(selected)}
        testId="luca-onboarding-agents-continue"
      />
    </>
  );
}

export function ReadyChapter({
  brainConnected,
  name,
  onBack,
  onComplete,
  residents,
}: {
  brainConnected: boolean;
  name: string;
  onBack: () => void;
  onComplete: () => void;
  residents: readonly DiscoveredResident[];
}) {
  return (
    <>
      <LucaOnboardingHeading
        description={`${name || "You"}, your personal agent network is ready. Luca will keep the complex parts quiet and ask whenever a decision is yours.`}
        eyebrow="Ready"
        focusKey="ready"
        title="Everything is in its place"
      />
      <section
        aria-label="Setup summary"
        className="mt-8 border-y border-white/[0.09]"
      >
        <SummaryRow label="You" value={name || "Owner"} />
        <SummaryRow
          label="Agents"
          value={
            residents.length > 0
              ? `${residents.length} ready to work`
              : "Add them anytime"
          }
        />
        <SummaryRow
          label="Brain"
          value={brainConnected ? "Connected and current" : "Set up later"}
        />
      </section>
      <p className="mt-4 text-xs leading-5 text-white/46">
        You can revisit every choice from Settings, Agents, or Brain.
      </p>
      <ChapterActions
        continueLabel="Enter Luca"
        onBack={onBack}
        onContinue={onComplete}
        testId="luca-onboarding-enter"
      />
    </>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-5 border-b border-white/[0.07] py-3 last:border-b-0">
      <span className="font-mono text-2xs uppercase tracking-caps-wide text-white/45">
        {label}
      </span>
      <span className="text-sm text-white/82">{value}</span>
    </div>
  );
}

function ChapterActions({
  continueDisabled = false,
  continueLabel,
  onBack,
  onContinue,
  testId,
}: {
  continueDisabled?: boolean;
  continueLabel: string;
  onBack: () => void;
  onContinue: () => void;
  testId: string;
}) {
  return (
    <OnboardingFooter className="mt-6 max-w-none flex-row items-center justify-start gap-5">
      <Button
        className={primaryCta}
        data-testid={testId}
        disabled={continueDisabled}
        onClick={onContinue}
        type="button"
      >
        {continueLabel}
        <ArrowRight aria-hidden className="h-3.5 w-3.5" />
      </Button>
      <Button
        className="h-11 gap-1.5 rounded-full px-0 text-sm text-white/45 hover:bg-transparent hover:text-white/76"
        onClick={onBack}
        type="button"
        variant="ghost"
      >
        <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
        Back
      </Button>
    </OnboardingFooter>
  );
}
