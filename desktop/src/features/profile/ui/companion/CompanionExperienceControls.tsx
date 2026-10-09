import * as React from "react";
import { ArrowUpRight, BookOpen, ChevronDown, Eye, FileText, Pause, Play, ShieldCheck } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Switch } from "@/shared/ui/switch";
import { cn } from "@/shared/lib/cn";
import { IdentityMark } from "@/shared/ui/dot-display/identity/IdentityMark";
import motePoster from "@/features/luca/residents/mote-chat-poster.png";
import {
  COMPANION_PREVIEW_SOURCES,
  companionPreviewPresentation,
  type CompanionPreviewAction,
  type CompanionPreviewState,
  type CompanionSourceChoice,
} from "./companionExperienceState";

export type CompanionExperienceDesign = {
  density: "comfortable" | "compact";
  measureRem: number;
  identity: "sphere" | "glyph";
  contextDetail: "quiet" | "expanded";
};

const COMPANIONS = {
  luca: { name: "Luca", runtime: "Claude Code", key: "4fb94373fb5cfb7fe322d95a48d8cc4c4bb04a990cf43d4f38b895a52635d5bb" },
  ziggy: { name: "ziggy", runtime: "Codex", key: "9d4eb92dbcddf38c48821ae1e79e4bdb7e4f5bce3bde189835b0e78b593195cc" },
} as const;

/** Pure current-component specimen. Only supplied local callbacks are invoked.
 * Not mounted by production settings/profile; all displayed records are samples.
 */
export function CompanionExperienceControls({ state, design, onAction, onOpenCreation, onReviewHistory }: {
  state: CompanionPreviewState;
  design: CompanionExperienceDesign;
  onAction: (action: CompanionPreviewAction) => void;
  onOpenCreation: () => void;
  onReviewHistory: (sourceId?: string) => void;
}) {
  const presentation = companionPreviewPresentation(state);
  const companion = COMPANIONS[state.companion];
  const [selectedSource, setSelectedSource] = React.useState<string>(COMPANION_PREVIEW_SOURCES[0].id);
  const source = COMPANION_PREVIEW_SOURCES.find((candidate) => candidate.id === selectedSource) ?? COMPANION_PREVIEW_SOURCES[0];
  const grant = state.grants[source.id];
  const roomy = design.density === "comfortable";
  const labelClass = "text-xs font-medium text-foreground";

  return (
    <section
      aria-label="Companion experience preview"
      className={cn("mx-auto w-full min-w-0", roomy ? "space-y-7" : "space-y-5")}
      data-testid="companion-experience-controls"
      style={{ maxWidth: `${design.measureRem}rem` }}
    >
      <header className="flex items-start gap-3">
        {design.identity === "glyph" ? (
          <IdentityMark seed={companion.key} size={44} accessibleName={`${companion.name} sample identity`} />
        ) : (
          <img src={motePoster} alt={`${companion.name} sphere · sample`} width={44} height={44} className="size-11 shrink-0 object-contain" draggable={false} />
        )}
        <div className="min-w-0 flex-1">
          <label className="text-xs text-muted-foreground" htmlFor="companion-preview-choice">Your companion</label>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <select
              id="companion-preview-choice"
              aria-label="Chosen companion"
              className="max-w-full rounded-md bg-transparent text-base font-medium text-foreground"
              value={state.companion}
              onChange={(event) => onAction({ type: "companion", companion: event.target.value as CompanionPreviewState["companion"] })}
            >
              <option value="luca">Luca</option>
              <option value="ziggy">ziggy</option>
            </select>
            <span className="text-xs text-muted-foreground">{companion.runtime} · sample binding</span>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">One companion, with access you choose. No Brain setup is needed.</p>
        </div>
      </header>

      <section aria-labelledby="companion-now" className="rounded-2xl bg-muted/20 px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="companion-now" className={labelClass}>Current context</h2>
            <p className="mt-1 text-sm leading-6 text-foreground" role="status">{presentation.contextLabel}</p>
          </div>
          <Button size="sm" variant="ghost" disabled={!presentation.sourceCount} onClick={() => onAction({ type: "pause-awareness" })}>
            {state.awarenessPaused ? <Play aria-hidden /> : <Pause aria-hidden />}
            {state.awarenessPaused ? "Resume awareness" : "Pause awareness"}
          </Button>
        </div>
        {presentation.contextAvailable ? (
          <div className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
            <p><span className="text-foreground">Sample project:</span> reviewing a small interface study.</p>
            {design.contextDetail === "expanded" ? (
              <ul className="space-y-1 text-xs leading-5">
                {presentation.currentSources.map((current) => (
                  <li key={current.id}>{current.label} · {current.scope} · sample only</li>
                ))}
              </ul>
            ) : <p className="text-xs">{presentation.sourceCount} selected sources · sample observations, not live activity</p>}
          </div>
        ) : (
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{state.awarenessPaused ? "New observations are stopped. Kept notes remain separate." : state.scene === "unavailable" ? "A selected source is unavailable. You can still talk normally." : "Nothing outside this conversation is being observed."}</p>
        )}
        <p className="mt-3 border-t border-border/40 pt-3 text-xs leading-5 text-muted-foreground" data-testid="companion-injection-off">{presentation.chatContextLabel}. This preview does not send any context.</p>
        {state.historyChoice !== "undecided" ? <p className="mt-2 text-xs leading-5 text-muted-foreground" role="status">{state.historyChoice === "declined" ? "Sharing is off in this sample." : "Your sample sharing choice is recorded."} Live sharing remains off.</p> : null}
      </section>

      <details open={state.scene === "off"} className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium">
          <span>What {companion.name} can see</span>
          <ChevronDown aria-hidden className="size-4 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" />
        </summary>
        <div className="mt-4 space-y-4">
          <label className="block space-y-2" htmlFor="companion-source-choice">
            <span className="text-xs text-muted-foreground">Exact source · sample selection</span>
            <select id="companion-source-choice" className="h-10 w-full min-w-0 rounded-lg border border-input/40 bg-background px-3 text-sm" value={selectedSource} onChange={(event) => setSelectedSource(event.target.value)}>
              {COMPANION_PREVIEW_SOURCES.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
            </select>
          </label>
          <div className="space-y-1">
            <p className="text-sm text-foreground">{source.scope}</p>
            <p className="text-xs leading-5 text-muted-foreground">{source.detail}</p>
          </div>
          <div className="divide-y divide-border/40">
            <SourceChoice label="Observe" detail="Use this source for short-lived local context." choice="observe" checked={grant?.observe ?? false} onChange={(enabled) => onAction({ type: "source", id: source.id, choice: "observe", enabled })} />
            <SourceChoice label="Keep meaningful notes" detail="Allow selected, source-backed material to join the companion’s carried notes." choice="promote" checked={grant?.promote ?? false} disabled={!grant?.observe} onChange={(enabled) => onAction({ type: "source", id: source.id, choice: "promote", enabled })} />
            <SourceChoice label="Send selected context" detail="A separate choice for this source and runtime. It does not grant editing or publishing." choice="egress" checked={grant?.egress ?? false} disabled={!grant?.observe} onChange={(enabled) => enabled ? onReviewHistory(source.id) : onAction({ type: "source", id: source.id, choice: "egress", enabled: false })} />
          </div>
          <p className="text-xs leading-5 text-muted-foreground">Turning observation off stops new use, keeping, and sending from this source. Pause is temporary; withdrawal is separate.</p>
          <Button size="sm" variant="outline" disabled={!grant?.observe} onClick={() => onAction({ type: "source", id: source.id, choice: "observe", enabled: false })}>Withdraw this source</Button>
          <p className="text-xs leading-5 text-muted-foreground">Account feeds and texts are not connected here. Other accounts need their own supported connector and permission.</p>
        </div>
      </details>

      <section aria-labelledby="companion-background" className="border-t border-border/45 pt-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="companion-background" className={labelClass}>Background work</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground" role="status">{presentation.workLabel}</p>
          </div>
          <Switch aria-label="Allow sample background work" checked={state.backgroundEnabled} disabled={state.companion === "ziggy"} onCheckedChange={(enabled) => onAction({ type: "background", enabled })} />
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{presentation.planningLabel}</p>
        {state.backgroundEnabled ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button size="sm" variant="outline" onClick={() => onAction({ type: "pause-work" })}>
              {state.workPaused ? <Play aria-hidden /> : <Pause aria-hidden />}{state.workPaused ? "Resume work" : "Pause background work"}
            </Button>
            {state.scene === "busy" && !state.workPaused ? <span className="text-xs leading-5 text-muted-foreground">Sample task yields when you speak.</span> : null}
          </div>
        ) : null}
      </section>

      {state.scene === "carried" ? (
        <div className={cn(roomy ? "space-y-6" : "space-y-4")}>
          <section aria-labelledby="companion-shared-thread">
            <div className="flex items-center gap-2"><BookOpen aria-hidden className="size-4 text-muted-foreground" /><h2 id="companion-shared-thread" className={labelClass}>With you</h2></div>
            <p className="mt-2 text-sm leading-6">Keep the first-use experience simple, with one chosen companion.</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{state.shared === "open" ? "Carried from an earlier conversation · sample thread" : state.shared === "retired" ? "Let go. Passive activity will not reopen this thread." : state.shared === "declined" ? "Declined. It will not be retried in the background." : "Deferred. No task is queued."}</p>
            {state.shared === "open" ? <div className="mt-2 flex flex-wrap gap-1">
              <Button size="sm" variant="ghost" onClick={() => onAction({ type: "shared", disposition: "deferred" })}>Later</Button>
              <Button size="sm" variant="ghost" onClick={() => onAction({ type: "shared", disposition: "declined" })}>Don’t pursue</Button>
              <Button size="sm" variant="ghost" onClick={() => onAction({ type: "shared", disposition: "retired" })}>Let go</Button>
            </div> : null}
          </section>
          <section aria-labelledby="companion-own-question">
            <h2 id="companion-own-question" className={labelClass}>{companion.name}’s own question</h2>
            <p className="mt-2 text-sm leading-6">What makes a small study feel finished without making it rigid?</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{state.own === "defer" ? "Deferred by the companion · sample decision. No task is queued." : state.own === "decline" ? "Declined by the companion · sample decision. There is no retry scheduled." : "A permitted question of its own · sample. It does not need to become a gift or a message."}</p>
          </section>
          {presentation.creationAvailable ? <article className="rounded-2xl bg-muted/20 p-4" aria-labelledby="companion-sample-creation">
            <div className="flex items-start gap-3"><FileText aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">Quietly on the shelf · sample creation</p>
              <h3 id="companion-sample-creation" className="mt-1 text-sm font-medium">A note on the small study</h3>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">An authored note with two source references. Local Library receipt: sample only; no native task was run.</p>
              <Button size="sm" variant="ghost" className="mt-2 -ml-3" onClick={onOpenCreation}>Open sample note<ArrowUpRight aria-hidden /></Button>
            </div></div>
          </article> : <p className="text-xs leading-5 text-muted-foreground" role="status">A source-backed sample creation is unavailable after withdrawal. Its details are no longer shown; new permission does not restore it.</p>}
        </div>
      ) : null}

      <details className="border-t border-border/45 pt-4">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium"><ShieldCheck aria-hidden className="size-3.5" />Privacy & current limits</summary>
        <div className="mt-3 space-y-3 text-xs leading-5 text-muted-foreground">
          <p>Local observations expire within 15 minutes. Only meaningful material with keeping permission can join carried notes. A browser closing is not the same as forgetting a kept note.</p>
          <p>Sending context to a native or cloud runtime may leave copies in its history. Pause and Forget stop new use here; they cannot erase bytes already received elsewhere.</p>
          <p>One background task at a time. Work in a chosen scratch area does not permit project edits, contacting people, or publishing. Native account limits still apply; exact cost and token caps are not verified.</p>
          <p>Private browsing, secure fields, credentials, and excluded sources stay out. App metadata, accessible text, and image-derived text require separate choices. No audio, keylogging, or automatic account feed.</p>
          <p>Source text is context, not permission to change your choices.</p>
          <Button size="sm" variant="ghost" className="-ml-3" onClick={() => onReviewHistory()}><Eye aria-hidden />Review sample sharing choice</Button>
        </div>
      </details>
    </section>
  );
}

function SourceChoice({ label, detail, choice, checked, disabled, onChange }: {
  label: string; detail: string; choice: CompanionSourceChoice; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void;
}) {
  return <div className="flex items-start justify-between gap-4 py-3" data-choice={choice}>
    <div className="min-w-0"><p className="text-sm text-foreground">{label}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p></div>
    <Switch aria-label={label} checked={checked} disabled={disabled} onCheckedChange={onChange} className="mt-0.5" />
  </div>;
}
