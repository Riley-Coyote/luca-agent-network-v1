import * as React from "react";
import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog";
import { Switch } from "@/shared/ui/switch";
import {
  companionState,
  companionHistory,
  pickCompanionSource,
  setCompanionHistory,
  setCompanionSource,
  pauseCompanionAwareness,
  setCompanionWork,
  selectCompanionMachineSource,
  pickCompanionBrowserProfile,
  connectCompanionBrowser,
  revealCompanionBrowserExtension,
  disconnectCompanionBrowser,
  type CompanionGrant,
  type CompanionHistory,
  type SourceChoices,
} from "@/shared/api/companion";
import { CompanionSourceSetup } from "./CompanionSourceSetup";

type Loaded = Awaited<ReturnType<typeof companionState>>;
const initialChoices: SourceChoices = {
  observe: false,
  promote: false,
  providerEgress: false,
  retainRaw: false,
};
const nativeApi = {
  companionState,
  companionHistory,
  pickCompanionSource,
  setCompanionHistory,
  setCompanionSource,
  pauseCompanionAwareness,
  setCompanionWork,
  selectCompanionMachineSource,
  pickCompanionBrowserProfile,
  connectCompanionBrowser,
  revealCompanionBrowserExtension,
  disconnectCompanionBrowser,
};
export type CompanionSetupApi = typeof nativeApi;

/** One owner-reviewed control surface opened from chat or agent settings. It does not restart
 * onboarding, choose a harness/model, or turn a chat answer into a grant. */
type SetupProps = {
  request: { residentPubkey: string } | null;
  onClose: () => void;
  trigger?: React.ReactElement;
  closeLabel?: string;
  api?: CompanionSetupApi;
  simulation?: boolean;
};
export function CompanionSetupDialog(props: SetupProps) {
  const agents = useManagedAgentsQuery();
  const name =
    agents.data?.find((agent) => agent.pubkey === props.request?.residentPubkey)
      ?.name ?? "Your companion";
  return <CompanionSetupPanel {...props} name={name} />;
}

/** Same controls, with no provider/IPC dependency when an isolated sample API
 * and label are supplied by the design lab. */
export function CompanionSetupPanel({
  request,
  onClose,
  trigger,
  closeLabel = "Back to our conversation",
  api = nativeApi,
  simulation = false,
  name,
}: SetupProps & { name: string }) {
  const {
    companionState,
    companionHistory,
    pickCompanionSource,
    setCompanionHistory,
    setCompanionSource,
    pauseCompanionAwareness,
    setCompanionWork,
  } = api;
  const [loaded, setLoaded] = React.useState<Loaded | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [choices, setChoices] = React.useState<SourceChoices>(initialChoices);
  const [history, setHistory] = React.useState<CompanionHistory | null>(null);
  const [includeHistory, setIncludeHistory] = React.useState(false);
  const [reviewWork, setReviewWork] = React.useState(false);
  const titleRef = React.useRef<HTMLHeadingElement>(null);
  const generation = React.useRef(0);
  const reviewGeneration = React.useRef(0);

  React.useEffect(() => {
    const current = ++generation.current;
    reviewGeneration.current += 1;
    setLoaded(null);
    setError(null);
    setPending(false);
    setSelected(null);
    setHistory(null);
    setChoices(initialChoices);
    setIncludeHistory(false);
    setReviewWork(false);
    if (!request) return;
    void companionState(request.residentPubkey)
      .then((value) => {
        if (generation.current === current) setLoaded(value);
      })
      .catch(() => {
        if (generation.current === current)
          setError(
            "Companion controls are unavailable. You can keep talking normally.",
          );
      });
    return () => {
      generation.current += 1;
    };
  }, [request, companionState]);

  async function operate(
    action: (resident: string, data: Loaded) => Promise<unknown>,
  ) {
    if (!request || !loaded || pending) return;
    const current = generation.current;
    setPending(true);
    setError(null);
    try {
      await action(request.residentPubkey, loaded);
      const refreshed = await companionState(request.residentPubkey);
      if (current === generation.current) setLoaded(refreshed);
    } catch (cause) {
      if (current === generation.current) {
        setError(
          typeof cause === "string"
            ? cause
            : cause instanceof Error
              ? cause.message
              : "Could not update this choice. Refresh and try again.",
        );
        void companionState(request.residentPubkey)
          .then((value) => {
            if (current === generation.current) setLoaded(value);
          })
          .catch(() => {});
      }
    } finally {
      if (current === generation.current) setPending(false);
    }
  }
  async function review(grant: CompanionGrant) {
    if (!request) return;
    const current = generation.current;
    const reviewCurrent = ++reviewGeneration.current;
    setSelected(grant.source.source_id);
    setHistory(null);
    setIncludeHistory(false);
    setError(null);
    setChoices({
      observe: grant.grant.choices.observe,
      promote: grant.grant.choices.promote,
      providerEgress: !!grant.grant.choices.provider_egress_binding,
      retainRaw: false,
    });
    try {
      const result = await companionHistory(
        request.residentPubkey,
        grant.source.source_id,
      );
      if (
        current === generation.current &&
        reviewCurrent === reviewGeneration.current
      ) {
        setHistory(result);
        setIncludeHistory(
          result.choice?.allowed === true && result.currentBindingConfirmed,
        );
      }
    } catch {
      if (
        current === generation.current &&
        reviewCurrent === reviewGeneration.current
      )
        setError("Could not load the current activity-in-chat explanation.");
    }
  }
  function dismissReview() {
    reviewGeneration.current += 1;
    setSelected(null);
    setHistory(null);
  }
  const backgroundWorkEnabled = loaded?.work.policy.enabled === true;
  const backgroundWorkPaused =
    loaded?.work.policy.paused === true ||
    loaded?.work.executionPaused === true;
  const grants: CompanionGrant[] = loaded
    ? [
        ...loaded.awareness.grants,
        ...loaded.selections
          .filter(
            (value) =>
              value.class.startsWith("browser_") &&
              !loaded.awareness.grants.some(
                (grant) => grant.source.source_id === value.sourceId,
              ),
          )
          .map((value) => ({
            source: { source_id: value.sourceId, state: "unknown" },
            grant: {
              grant_revision: 0,
              state: "not_granted",
              choices: {
                observe: false,
                promote: false,
                retain: false,
                provider_egress_binding: null,
              },
            },
          })),
      ]
    : [];
  const grant = grants.find((grant) => grant.source.source_id === selected);
  const sourceName = (sourceId: string) => {
    const selection = loaded?.selections.find(
      (value) => value.sourceId === sourceId,
    );
    return selection?.kind === "codex_sessions"
      ? "Codex work"
      : selection?.kind === "claude_projects"
        ? "Claude Code work"
        : selection?.class === "selected_file"
          ? "Selected file"
          : ((
              {
                app_metadata: "App names",
                accessibility_text: "Document text",
                screen_text: "Visible document text",
                browser_visit: "Browser visits",
                browser_bookmark: "Shared bookmarks",
                browser_excerpt: "Selected page excerpts",
              } as Record<string, string>
            )[selection?.class ?? ""] ?? "Selected source");
  };
  return (
    <Dialog
      open={!!request}
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent
        className="max-h-[85dvh] max-w-xl overflow-y-auto"
        aria-describedby="companion-setup-description"
        onOpenAutoFocus={(event) => {
          // Settings arrive asynchronously. Keep initial focus in this panel,
          // not on the Quick Chat launcher hosted inside every dialog.
          event.preventDefault();
          titleRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle ref={titleRef} tabIndex={-1} className="outline-none">
            With {name}
          </DialogTitle>
          <DialogDescription id="companion-setup-description">
            Choose what your companion can follow and work on. Nothing is
            required to keep chatting; these choices can be changed later.
          </DialogDescription>
          {simulation ? (
            <p className="text-xs leading-5 text-muted-foreground">
              Interactive sample only. These controls do not access the machine,
              grant permissions, run a model or change a real account.
            </p>
          ) : null}
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm leading-6 text-muted-foreground">
            {error}
          </p>
        ) : null}
        {!loaded && !error ? (
          <p className="text-sm text-muted-foreground" role="status">
            Loading current choices…
          </p>
        ) : null}
        {loaded ? (
          <div className="space-y-6">
            <section className="space-y-3">
              <h3 className="text-sm font-medium">Keep up with your work</h3>
              <p className="text-xs leading-5 text-muted-foreground">
                Choose a source first. Permission is reviewed separately. Native
                sessions are followed after new changes, not scanned as a whole
                history.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    void operate((resident) =>
                      pickCompanionSource(resident, "codex_sessions"),
                    )
                  }
                >
                  Codex work
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    void operate((resident) =>
                      pickCompanionSource(resident, "claude_projects"),
                    )
                  }
                >
                  Claude Code work
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    void operate((resident) =>
                      pickCompanionSource(resident, "file"),
                    )
                  }
                >
                  A file
                </Button>
              </div>
              {request ? (
                <CompanionSourceSetup
                  key={request.residentPubkey}
                  api={api}
                  pending={pending}
                  operate={operate}
                />
              ) : null}
              {loaded.browsers
                .filter((profile) => profile.enabled)
                .map((profile) => (
                  <div
                    key={profile.profile_instance_id}
                    className="flex items-center justify-between gap-3 text-xs text-muted-foreground"
                  >
                    <span>
                      {profile.bridge_ready
                        ? "Paired browser · connector ready"
                        : "Paired browser · connector unavailable"}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() =>
                        void operate((resident) =>
                          api.disconnectCompanionBrowser(
                            resident,
                            profile.profile_instance_id,
                          ),
                        )
                      }
                    >
                      Disconnect browser
                    </Button>
                  </div>
                ))}
              {grants.map((source) => (
                <div
                  key={source.source.source_id}
                  className="flex items-center justify-between gap-3 border-t border-border/40 py-3"
                >
                  <div>
                    <p className="text-sm">
                      {sourceName(source.source.source_id)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {source.grant.state === "not_granted"
                        ? "Paired · access off"
                        : source.grant.state !== "active"
                          ? "Withdrawn"
                          : source.grant.choices.observe
                            ? "Observation chosen"
                            : "Selected · observation off"}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => void review(source)}
                  >
                    Review access
                  </Button>
                </div>
              ))}
              {grant && history ? (
                <div className="space-y-4 rounded-xl border border-border/50 p-4">
                  <h4 className="text-sm font-medium">
                    {sourceName(grant.source.source_id)}
                  </h4>
                  <Choice
                    label="Observe new activity"
                    detail="Short-lived context from this selected source."
                    checked={choices.observe}
                    onChange={(observe) =>
                      setChoices(
                        observe ? { ...choices, observe } : initialChoices,
                      )
                    }
                  />
                  <Choice
                    label="Keep meaningful notes"
                    detail="Allow useful, source-backed material into this companion’s own memory."
                    checked={choices.promote}
                    disabled={!choices.observe}
                    onChange={(promote) => setChoices({ ...choices, promote })}
                  />
                  <Choice
                    label="Send selected context to the model"
                    detail="Uses the current connected runtime, not another account or companion."
                    checked={choices.providerEgress}
                    disabled={!choices.observe}
                    onChange={(providerEgress) =>
                      setChoices({ ...choices, providerEgress })
                    }
                  />
                  <Choice
                    label="Use selected activity in conversations"
                    detail={history.disclosure}
                    checked={
                      includeHistory &&
                      choices.observe &&
                      choices.providerEgress
                    }
                    disabled={!choices.observe || !choices.providerEgress}
                    onChange={setIncludeHistory}
                  />
                  {!history.consumersReady ? (
                    <p className="text-xs leading-5 text-muted-foreground">
                      Live conversation context is not active in this candidate
                      yet. Saving this permission does not claim that the
                      connection has finished.
                    </p>
                  ) : null}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        void operate(async (resident) => {
                          const current = generation.current;
                          await setCompanionSource(resident, grant, choices);
                          if (current !== generation.current) return;
                          const currentHistory = await companionHistory(
                            resident,
                            grant.source.source_id,
                          );
                          if (current !== generation.current) return;
                          await setCompanionHistory(
                            resident,
                            grant.source.source_id,
                            currentHistory,
                            includeHistory &&
                              choices.observe &&
                              choices.providerEgress,
                          );
                          if (current === generation.current) dismissReview();
                        })
                      }
                    >
                      Confirm these choices
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={dismissReview}
                    >
                      Not now
                    </Button>
                  </div>
                </div>
              ) : null}
              {loaded.awareness.grants.some(
                (source) =>
                  source.grant.choices.observe &&
                  source.grant.state === "active",
              ) ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    void operate((resident, data) =>
                      pauseCompanionAwareness(
                        resident,
                        data.awareness,
                        !data.awareness.paused &&
                          data.awareness.collectionRunning,
                      ),
                    )
                  }
                >
                  {loaded.awareness.paused ||
                  !loaded.awareness.collectionRunning
                    ? "Resume selected awareness"
                    : "Pause awareness"}
                </Button>
              ) : null}
            </section>
            <section className="space-y-3 border-t border-border/40 pt-5">
              <h3 className="text-sm font-medium">While you’re away</h3>
              <p className="text-xs leading-5 text-muted-foreground">
                Optional, small background pursuits using the connected harness.
                Your conversations take priority. Results stay quietly in
                Library; no automatic messages or account access.
              </p>
              {backgroundWorkEnabled && backgroundWorkPaused ? (
                <p className="text-xs leading-5 text-muted-foreground">
                  Background work is paused. Resuming observation won’t restart
                  it.
                </p>
              ) : null}
              {reviewWork ? (
                <div className="space-y-3 rounded-xl border border-border/50 p-4">
                  <p className="text-sm leading-6">
                    Allow bounded local creations and private inquiries? Codex
                    uses a restricted temporary working folder; this is not a
                    separate computer or project-editing permission. Work may
                    use your existing harness allowance. There is no required
                    output quota.
                  </p>
                  <Button
                    size="sm"
                    disabled={pending || !loaded.work.nativeChannelAvailable}
                    onClick={() =>
                      void operate(async (resident, data) => {
                        const current = generation.current;
                        await setCompanionWork(
                          resident,
                          data.work,
                          true,
                          false,
                        );
                        if (current === generation.current)
                          setReviewWork(false);
                      })
                    }
                  >
                    Allow background work
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => setReviewWork(false)}
                  >
                    Not now
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    backgroundWorkEnabled && !backgroundWorkPaused
                      ? void operate((resident, data) =>
                          setCompanionWork(resident, data.work, false, true),
                        )
                      : setReviewWork(true)
                  }
                >
                  {backgroundWorkEnabled
                    ? backgroundWorkPaused
                      ? "Resume background work"
                      : "Turn background work off"
                    : "Review background work"}
                </Button>
              )}
              {!loaded.work.nativeChannelAvailable ? (
                <p className="text-xs text-muted-foreground">
                  Start this companion before enabling background work.
                </p>
              ) : null}
            </section>
            <p className="text-xs leading-5 text-muted-foreground">
              Browser and document text need their separate connector/system
              permission. Social accounts and iMessage are not connected. Brain
              is optional.
            </p>
            <Button variant="ghost" disabled={pending} onClick={onClose}>
              {closeLabel}
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
function Choice({
  label,
  detail,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  detail: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
      </div>
      <Switch
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </div>
  );
}
