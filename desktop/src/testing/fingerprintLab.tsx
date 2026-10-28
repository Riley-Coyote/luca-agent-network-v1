import { Folder } from "lucide-react";
import * as React from "react";

import "@/app/shell/shell-rail.css";
import { setCanonicalLucaPubkey } from "@/features/luca/canonicalLucaResident";
import { cn } from "@/shared/lib/cn";
import {
  AgentFingerprint,
  FingerprintResidentsProvider,
  ringAgentFingerprint,
} from "@/shared/ui/fingerprint/AgentFingerprint";
import { assignFingerprintKinds } from "@/shared/ui/fingerprint/kinds";
import { LAB_RESIDENTS } from "@/testing/labScene";

/**
 * The proof harness for WP-39's fingerprints, `?lab=fingerprint` in dev and
 * e2e builds: the rail's real rows (shell-rail.css) at real size, an agent's
 * page head at 64, and all five kinds at 128. `?working=Luca,Mara` starts
 * those agents working. Nothing in the app reads this file.
 */

const AGENTS = [
  { ...LAB_RESIDENTS.luca, arrivedAt: "2026-08-01T00:00:00Z" },
  { ...LAB_RESIDENTS.vektor, arrivedAt: "2026-08-14T00:00:00Z" },
  { ...LAB_RESIDENTS.ziggy, name: "Ziggy", arrivedAt: "2026-09-02T00:00:00Z" },
  {
    name: "Mara",
    pubkey: "c3a1f0e29b7d4c5a8e6f1b2d3c4a5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d",
    arrivedAt: "2026-09-20T00:00:00Z",
  },
  {
    name: "Sol",
    pubkey: "5e7d9c1b3a2f4e6d8c0b9a7f5e3d1c2b4a6f8e0d9c7b5a3f1e2d4c6b8a0f9e7d",
    arrivedAt: "2026-10-11T00:00:00Z",
  },
] as const;

type Agent = (typeof AGENTS)[number];

// Luca's print comes from Luca's fixed seed: name Luca before any mark draws.
setCanonicalLucaPubkey(LAB_RESIDENTS.luca.pubkey);

const RESIDENTS = AGENTS.map((agent) => ({
  publicKey: agent.pubkey,
  arrivedAt: agent.arrivedAt,
}));
const KINDS = assignFingerprintKinds(RESIDENTS, LAB_RESIDENTS.luca.pubkey);
const KIND_NAME = {
  whorl: "whorl",
  loop: "loop",
  arch: "arch",
  sideloop: "sideways loop",
  double: "double loop",
} as const;

function initialWorking(): Set<string> {
  const names = new URL(window.location.href).searchParams.get("working");
  return new Set(names ? names.split(",").filter(Boolean) : []);
}

function RailRow({
  agent,
  current,
  onOpen,
  working,
}: {
  agent: Agent;
  current: boolean;
  onOpen: () => void;
  working: boolean;
}) {
  return (
    <div className="luca-rail-home">
      <div
        className="luca-rail-row"
        data-active={current ? "true" : undefined}
        data-sidebar="menu-button"
        data-testid={`fp-row-${agent.name}`}
      >
        <button
          aria-current={current ? "page" : undefined}
          aria-label={agent.name}
          className="luca-rail-row-hit"
          onClick={onOpen}
          type="button"
        />
        <span aria-hidden className="luca-rail-face" data-face="agent">
          <AgentFingerprint
            current={current}
            residentKey={agent.pubkey}
            size={18}
            working={working}
          />
        </span>
        <span aria-hidden className="luca-rail-row-name text-sm">
          {agent.name}
        </span>
        <span className="luca-rail-row-end text-xs text-muted-foreground">
          {working ? "working" : null}
        </span>
      </div>
    </div>
  );
}

function ProjectRow({ name }: { name: string }) {
  return (
    <div className="luca-rail-home">
      <div className="luca-rail-row" data-sidebar="menu-button">
        <button aria-label={name} className="luca-rail-row-hit" type="button" />
        <span aria-hidden className="luca-rail-face" data-face="icon">
          <Folder />
        </span>
        <span aria-hidden className="luca-rail-row-name text-sm">
          {name}
        </span>
      </div>
    </div>
  );
}

function Section({
  children,
  name,
}: {
  children: React.ReactNode;
  name: string;
}) {
  return (
    <div className="luca-rail-section">
      <div className="luca-rail-section-head type-eyebrow">{name}</div>
      {children}
    </div>
  );
}

export function FingerprintLab() {
  const [working, setWorking] = React.useState(initialWorking);
  const [current, setCurrent] = React.useState<string>(AGENTS[0].name);
  const open = AGENTS.find((agent) => agent.name === current) ?? AGENTS[0];
  const toggle = (name: string) =>
    setWorking((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  const speaker = AGENTS.find((agent) => working.has(agent.name)) ?? AGENTS[0];
  const speak = () => {
    // The speaker's own ring at full strength; the others answer it a beat
    // later at half (the study's "someone speaks").
    for (const agent of AGENTS) {
      const own = agent.name === speaker.name;
      ringAgentFingerprint(agent.pubkey, {
        delayMs: own ? 0 : 140,
        strength: own ? 1 : 0.5,
      });
    }
  };

  return (
    <FingerprintResidentsProvider residents={RESIDENTS}>
      <div
        className="h-dvh overflow-y-auto bg-background text-foreground"
        data-testid="fingerprint-lab"
      >
        <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-8">
          <header className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold">Agent fingerprints</h1>
            <p className="text-sm text-muted-foreground">
              WP-39's proof harness: the rail at real size, a page head, and all
              five kinds.
            </p>
          </header>

          <fieldset className="m-0 flex flex-wrap items-center gap-2 border-0 p-0">
            <legend className="sr-only">What the agents are doing</legend>
            <span className="text-xs text-muted-foreground">Working</span>
            {AGENTS.map((agent) => (
              <button
                aria-pressed={working.has(agent.name)}
                className={cn(
                  "rounded-md border border-border px-2.5 py-1 text-xs",
                  working.has(agent.name)
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground",
                )}
                data-testid={`fp-working-${agent.name}`}
                key={agent.name}
                onClick={() => toggle(agent.name)}
                type="button"
              >
                {agent.name}
              </button>
            ))}
            <button
              className="ml-4 rounded-md border border-border px-2.5 py-1 text-xs"
              data-testid="fp-speak"
              onClick={speak}
              type="button"
            >
              {speaker.name} speaks
            </button>
          </fieldset>

          <div className="flex flex-wrap items-start gap-8">
            <nav
              aria-label="Rail"
              className="w-64 shrink-0 rounded-xl border border-border bg-sidebar py-2"
              data-shell-rail=""
              data-testid="fp-rail"
            >
              <Section name="Chats">
                <RailRow
                  agent={AGENTS[0]}
                  current={current === AGENTS[0].name}
                  onOpen={() => setCurrent(AGENTS[0].name)}
                  working={working.has(AGENTS[0].name)}
                />
              </Section>
              <Section name="Projects">
                <ProjectRow name="Tidepool" />
                <ProjectRow name="Field guide" />
              </Section>
              <Section name="Agents">
                {AGENTS.slice(1).map((agent) => (
                  <RailRow
                    agent={agent}
                    current={current === agent.name}
                    key={agent.name}
                    onOpen={() => setCurrent(agent.name)}
                    working={working.has(agent.name)}
                  />
                ))}
              </Section>
            </nav>

            <section
              className="flex min-w-0 flex-1 flex-col gap-5 rounded-2xl border border-border bg-card p-7"
              data-fingerprint-light=""
              data-testid="fp-head"
            >
              <div className="flex items-center gap-4">
                <AgentFingerprint
                  current
                  residentKey={open.pubkey}
                  size={64}
                  working={working.has(open.name)}
                />
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-2xl font-semibold tracking-tight">
                    {open.name}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {working.has(open.name) ? "Working" : "Resting"}
                  </span>
                </div>
              </div>
              <div
                aria-hidden
                className="flex gap-5 border-b border-border text-sm text-muted-foreground"
              >
                <span className="pb-2 text-foreground">Notebook</span>
                <span className="pb-2">Self</span>
                <span className="pb-2">Settings</span>
              </div>
            </section>
          </div>

          <section
            className="grid grid-cols-5 gap-2 rounded-2xl border border-border bg-card px-3 pb-4 pt-6"
            data-testid="fp-plate"
          >
            {AGENTS.map((agent) => {
              const kind = KINDS.get(agent.pubkey) ?? "whorl";
              return (
                <div
                  className="flex flex-col items-center gap-3"
                  data-fingerprint-light=""
                  data-kind={kind}
                  data-testid={`fp-spec-${agent.name}`}
                  key={agent.name}
                >
                  <AgentFingerprint
                    residentKey={agent.pubkey}
                    size={128}
                    working={working.has(agent.name)}
                  />
                  <span className="flex flex-col items-center gap-0.5">
                    <span className="text-sm">{agent.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {KIND_NAME[kind]} ·{" "}
                      {working.has(agent.name) ? "working" : "resting"}
                    </span>
                  </span>
                </div>
              );
            })}
          </section>

          {/* Far below the fold: a print that should do no work until seen. */}
          <section className="mt-[2400px] pb-16" data-testid="fp-offscreen">
            <div className="flex items-center gap-3 text-sm">
              <AgentFingerprint
                residentKey={AGENTS[1].pubkey}
                size={18}
                working={working.has(AGENTS[1].name)}
              />
              {AGENTS[1].name}, below the fold
            </div>
          </section>
        </div>
      </div>
    </FingerprintResidentsProvider>
  );
}
