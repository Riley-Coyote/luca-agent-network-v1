import * as React from "react";
import { ChevronRight } from "lucide-react";

import { CompanionSourceSetup } from "@/features/luca/CompanionSourceSetup";
import type { CompanionSetupApi } from "@/features/luca/CompanionSetupDialog";
import {
  companionHistory,
  companionState,
  connectCompanionBrowser,
  disconnectCompanionBrowser,
  followCompanionWork,
  pauseCompanionAwareness,
  pickCompanionBrowserProfile,
  pickCompanionSource,
  revealCompanionBrowserExtension,
  selectCompanionMachineSource,
  setCompanionHistory,
  setCompanionSource,
  setCompanionWork,
  type CompanionGrant,
  type CompanionHistory,
  type ProfileKind,
  type SourceChoices,
} from "@/shared/api/companion";
import { Switch } from "@/shared/ui/switch";
import {
  grantOf,
  isFollowing,
  PROFILE_WORDS,
  useCompanionOperate,
  useMindCompanion,
} from "./mindCompanion";
import { MindGroup, MindPageHead, MindRow } from "./MindPageKit";

const API: CompanionSetupApi = {
  companionHistory,
  companionState,
  connectCompanionBrowser,
  disconnectCompanionBrowser,
  followCompanionWork,
  pauseCompanionAwareness,
  pickCompanionBrowserProfile,
  pickCompanionSource,
  revealCompanionBrowserExtension,
  selectCompanionMachineSource,
  setCompanionHistory,
  setCompanionSource,
  setCompanionWork,
};

const OFF: SourceChoices = {
  observe: false,
  promote: false,
  providerEgress: false,
  retainRaw: false,
};

/**
 * Keeps up with (BETA14_RELEASE.md WP-42, Decided 12): today's companion
 * settings as two groups. Following: Codex and Claude Code work, each with
 * its status, a switch and Review access. Also available: a file, browser
 * activity and app activity. Then the profile folder for a custom install,
 * and what isn't connected. Every choice is today's, made the same way.
 */
export function MindKeepsUpWith({
  backLabel,
  name,
  onBack,
  residentPubkey,
  titleRef,
}: {
  backLabel: string;
  name: string;
  onBack: () => void;
  residentPubkey: string;
  titleRef: React.Ref<HTMLHeadingElement>;
}) {
  const companion = useMindCompanion(residentPubkey);
  const { error, operate, pending } = useCompanionOperate(residentPubkey);
  const [reviewing, setReviewing] = React.useState<CompanionGrant | null>(null);
  const loaded = companion.data;
  // CompanionSourceSetup asks for today's `operate` (resident only).
  const operateResident = React.useCallback(
    (action: (resident: string) => Promise<unknown>) =>
      operate((resident) => action(resident)),
    [operate],
  );
  const sourceName = (sourceId: string) => {
    const selection = loaded?.selections.find(
      (value) => value.sourceId === sourceId,
    );
    if (selection?.kind) return `${PROFILE_WORDS[selection.kind]} work`;
    if (selection?.class === "selected_file") return "Selected file";
    return (
      (
        {
          app_metadata: "App names",
          accessibility_text: "Document text",
          screen_text: "Visible document text",
          browser_visit: "Browser visits",
          browser_bookmark: "Shared bookmarks",
          browser_excerpt: "Selected page excerpts",
        } as Record<string, string>
      )[selection?.class ?? ""] ?? "Selected source"
    );
  };
  const others = (loaded?.awareness.grants ?? []).filter((grant) => {
    const selection = loaded?.selections.find(
      (value) => value.sourceId === grant.source.source_id,
    );
    return !selection?.kind;
  });

  return (
    <div data-testid="mind-keeps-up-with">
      <MindPageHead
        back={backLabel}
        lede={`Choose what ${name} follows while you work. Nothing here is needed to keep chatting, and you can change it anytime.`}
        onBack={onBack}
        title="Keeps up with"
        titleRef={titleRef}
      />
      {companion.isError ? (
        <p className="luca-mind-help" role="alert">
          Companion controls are unavailable. You can keep talking normally.
        </p>
      ) : !loaded ? (
        <p className="luca-mind-help" role="status">
          Loading current choices…
        </p>
      ) : (
        <>
          <MindGroup testId="mind-following" title="Following">
            {(Object.keys(PROFILE_WORDS) as ProfileKind[]).map((kind) => {
              const grant = grantOf(loaded, kind);
              const following = isFollowing(grant);
              const words = PROFILE_WORDS[kind];
              return (
                <MindRow
                  control={
                    <span className="luca-mind-row-controls">
                      {grant ? (
                        <button
                          className="luca-mind-inline"
                          disabled={pending}
                          onClick={() => setReviewing(grant)}
                          type="button"
                        >
                          Review access
                        </button>
                      ) : null}
                      <Switch
                        aria-label={`Follow ${words} work`}
                        checked={following}
                        disabled={pending}
                        onCheckedChange={(on) => {
                          if (!on && grant)
                            void operate((resident) =>
                              setCompanionSource(resident, grant, OFF),
                            );
                          else if (on && grant) setReviewing(grant);
                          else
                            void operate((resident) =>
                              followCompanionWork(resident, kind),
                            );
                        }}
                      />
                    </span>
                  }
                  help={
                    !grant
                      ? `New and changed ${words} sessions · not followed`
                      : grant.grant.state === "not_granted"
                        ? `New and changed ${words} sessions · access off`
                        : grant.grant.state !== "active"
                          ? `New and changed ${words} sessions · withdrawn`
                          : following
                            ? `New and changed ${words} sessions · access reviewed`
                            : `New and changed ${words} sessions · observation off`
                  }
                  key={kind}
                  label={`${words} work`}
                  testId={`mind-follow-${kind}`}
                  value={following ? "Following" : undefined}
                />
              );
            })}
            {others.map((grant) => (
              <MindRow
                control={
                  <button
                    className="luca-mind-inline"
                    disabled={pending}
                    onClick={() => setReviewing(grant)}
                    type="button"
                  >
                    Review access
                  </button>
                }
                help={
                  grant.grant.state === "not_granted"
                    ? "Paired · access off"
                    : grant.grant.state !== "active"
                      ? "Withdrawn"
                      : grant.grant.choices.observe
                        ? "Observation chosen"
                        : "Selected · observation off"
                }
                key={grant.source.source_id}
                label={sourceName(grant.source.source_id)}
              />
            ))}
            {loaded.browsers
              .filter((profile) => profile.enabled)
              .map((profile) => (
                <MindRow
                  control={
                    <button
                      className="luca-mind-inline"
                      disabled={pending}
                      onClick={() =>
                        void operate((resident) =>
                          disconnectCompanionBrowser(
                            resident,
                            profile.profile_instance_id,
                          ),
                        )
                      }
                      type="button"
                    >
                      Disconnect
                    </button>
                  }
                  help={
                    profile.bridge_ready
                      ? "Connector ready"
                      : "Connector unavailable"
                  }
                  key={profile.profile_instance_id}
                  label="Paired browser"
                />
              ))}
          </MindGroup>
          {reviewing ? (
            <ReviewAccess
              grant={reviewing}
              name={sourceName(reviewing.source.source_id)}
              onDone={() => setReviewing(null)}
              operate={operate}
              pending={pending}
              residentPubkey={residentPubkey}
            />
          ) : null}
          <MindGroup testId="mind-also-available" title="Also available">
            <MindRow
              control={
                <button
                  className="luca-mind-button luca-mind-button-small"
                  disabled={pending}
                  onClick={() =>
                    void operate((resident) =>
                      pickCompanionSource(resident, "file"),
                    )
                  }
                  type="button"
                >
                  Add
                </button>
              }
              help={`One document ${name} keeps an eye on`}
              label="A file"
            />
            <div className="luca-mind-prow luca-mind-prow-host">
              <span className="luca-mind-prow-words">
                <span className="luca-mind-prow-label">
                  Browser activity and app activity
                </span>
                <span className="luca-mind-prow-help">
                  Each needs its own system permission. Choosing one keeps
                  access off until you review it.
                </span>
              </span>
              <div className="luca-mind-prow-setup">
                <CompanionSourceSetup
                  api={API}
                  operate={operateResident}
                  pending={pending}
                />
              </div>
            </div>
          </MindGroup>
          <ProfileFolder operate={operate} pending={pending} />
          {error ? (
            <p className="luca-mind-error" role="alert">
              {error}
            </p>
          ) : null}
          <p className="luca-mind-footnote">
            Only new and changed sessions are followed; old history isn't
            brought in. Social accounts and iMessage aren't connected. Brain is
            optional.
          </p>
        </>
      )}
    </div>
  );
}

/** "Use a different profile folder": today's advanced choice, as a
 *  disclosure. */
function ProfileFolder({
  operate,
  pending,
}: {
  operate: ReturnType<typeof useCompanionOperate>["operate"];
  pending: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="luca-mind-disclosure">
      <button
        aria-expanded={open}
        className="luca-mind-opener luca-mind-disclosure-toggle"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className="luca-mind-opener-end">
          <ChevronRight aria-hidden />
        </span>
        Use a different profile folder
      </button>
      {open ? (
        <div className="luca-mind-disclosure-body">
          <p className="luca-mind-help">
            For custom installations. Selecting a folder keeps access off until
            you review it.
          </p>
          <div className="luca-mind-actions">
            {(Object.keys(PROFILE_WORDS) as ProfileKind[]).map((kind) => (
              <button
                className="luca-mind-button"
                disabled={pending}
                key={kind}
                onClick={() =>
                  void operate((resident) =>
                    pickCompanionSource(resident, kind),
                  )
                }
                type="button"
              >
                Choose {PROFILE_WORDS[kind]} folder
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Review access: today's four choices for one source, confirmed together. */
function ReviewAccess({
  grant,
  name,
  onDone,
  operate,
  pending,
  residentPubkey,
}: {
  grant: CompanionGrant;
  name: string;
  onDone: () => void;
  operate: ReturnType<typeof useCompanionOperate>["operate"];
  pending: boolean;
  residentPubkey: string;
}) {
  const [choices, setChoices] = React.useState<SourceChoices>({
    observe: grant.grant.choices.observe,
    promote: grant.grant.choices.promote,
    providerEgress: Boolean(grant.grant.choices.provider_egress_binding),
    retainRaw: false,
  });
  const [history, setHistory] = React.useState<CompanionHistory | null>(null);
  const [includeHistory, setIncludeHistory] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    let live = true;
    companionHistory(residentPubkey, grant.source.source_id)
      .then((result) => {
        if (!live) return;
        setHistory(result);
        setIncludeHistory(
          result.choice?.allowed === true && result.currentBindingConfirmed,
        );
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [grant.source.source_id, residentPubkey]);
  const choice = (
    label: string,
    detail: string,
    checked: boolean,
    onChange: (value: boolean) => void,
    disabled = false,
  ) => (
    <MindRow
      control={
        <Switch
          aria-label={label}
          checked={checked}
          disabled={disabled}
          onCheckedChange={onChange}
        />
      }
      help={detail}
      label={label}
    />
  );
  return (
    <MindGroup testId="mind-review-access" title={`Review access · ${name}`}>
      {failed ? (
        <p className="luca-mind-help luca-mind-panel-note" role="alert">
          Could not load the current activity-in-chat explanation.
        </p>
      ) : !history ? (
        <p className="luca-mind-help luca-mind-panel-note" role="status">
          Loading…
        </p>
      ) : (
        <>
          {choice(
            "Observe new activity",
            "Short-lived context from this selected source.",
            choices.observe,
            (observe) => setChoices(observe ? { ...choices, observe } : OFF),
          )}
          {choice(
            "Keep meaningful notes",
            "Allow useful, source-backed material into this companion's own memory.",
            choices.promote,
            (promote) => setChoices({ ...choices, promote }),
            !choices.observe,
          )}
          {choice(
            "Send selected context to the model",
            "Uses the current connected runtime, not another account or companion.",
            choices.providerEgress,
            (providerEgress) => setChoices({ ...choices, providerEgress }),
            !choices.observe,
          )}
          {choice(
            "Use selected activity in conversations",
            history.disclosure,
            includeHistory && choices.observe && choices.providerEgress,
            setIncludeHistory,
            !choices.observe || !choices.providerEgress,
          )}
          <div className="luca-mind-prow">
            <span className="luca-mind-prow-words">
              {!history.consumersReady ? (
                <span className="luca-mind-prow-help">
                  Live conversation context is not active in this candidate yet.
                  Saving this permission does not claim that the connection has
                  finished.
                </span>
              ) : null}
            </span>
            <span className="luca-mind-row-controls">
              <button
                className="luca-mind-inline"
                disabled={pending}
                onClick={onDone}
                type="button"
              >
                Not now
              </button>
              <button
                className="luca-mind-button luca-mind-button-solid"
                disabled={pending}
                onClick={() =>
                  void operate(async (resident) => {
                    await setCompanionSource(resident, grant, choices);
                    const current = await companionHistory(
                      resident,
                      grant.source.source_id,
                    );
                    await setCompanionHistory(
                      resident,
                      grant.source.source_id,
                      current,
                      includeHistory &&
                        choices.observe &&
                        choices.providerEgress,
                    );
                  }).then(onDone)
                }
                type="button"
              >
                Confirm these choices
              </button>
            </span>
          </div>
        </>
      )}
    </MindGroup>
  );
}
