import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Copy,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  Square,
} from "lucide-react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import {
  documentKindMeta,
  formatRelativeAge,
  validateExtraFilePath,
} from "@/features/agents/documents/documentKinds";
import { useResidentDocumentsQuery } from "@/features/agents/documents/useResidentDocuments";
import {
  useAcpRuntimesQuery,
  useAgentConfigSurface,
  useManagedAgentsQuery,
  useSetManagedAgentAutoRestartMutation,
} from "@/features/agents/hooks";
import { artifactMcpCapabilityPresentation } from "@/features/agents/lib/artifactMcpCapability";
import { ResidentModelMenu } from "@/features/agents/ui/ResidentModelMenu";
import {
  agentConfigurationViewModel,
  residentSourceLabel,
  type ResidentSummaryViewModel,
} from "@/features/agents/ui/agentLibraryViewModel";
import { BrainMindAccess } from "@/features/luca/brain/BrainMindAccess";
import { useWhatTheyCanRead } from "@/features/luca/brain/hooks";
import { useCanonicalLucaPubkey } from "@/features/luca/canonicalLucaResident";
import { ResidentAccessControl } from "@/features/settings/ui/ResidentCapabilitySettings";
import { useSettingsAppName } from "@/features/settings/ui/SettingsSectionHeader";
import { getResidentCapabilitySettings } from "@/shared/api/residentCapabilities";
import {
  pauseCompanionAwareness,
  setCompanionWork,
} from "@/shared/api/companion";
import type { ResidentPlaceContent } from "@/shared/api/tauriResidentPlace";
import type {
  AgentPersona,
  ManagedAgent,
  RespondToMode,
} from "@/shared/api/types";
import { normalizePubkey, truncatePubkey } from "@/shared/lib/pubkey";
import { AgentFingerprint } from "@/shared/ui/fingerprint/AgentFingerprint";
import { Switch } from "@/shared/ui/switch";
import {
  awayOn,
  followedWork,
  hasAwareness,
  isNoticing,
  useCompanionOperate,
  useMindCompanion,
} from "./mindCompanion";
import { configRowOf, groupConfigRows } from "./mindConfigGroups";
import { MindDocPane } from "./MindDocPane";
import { MindKeepsUpWith } from "./MindKeepsUpWith";
import { MindGroup, MindPageHead, MindRow } from "./MindPageKit";
import { useMindPlace } from "./mindPlaceContext";
import { agentOriginDescription, authorityLabel } from "./mindRunsOn";
import type { MindPage, MindPane } from "./mindSection";

type SettingsProps = {
  backLabel: string;
  channels: Array<{ id: string; name: string }>;
  isActionPending: boolean;
  managedAgent: ManagedAgent | null;
  onBack: () => void;
  onEdit: () => void;
  onGo: (page: MindPage) => void;
  onOpenLogs: () => void;
  onRestart: () => void;
  onStart: () => void;
  onStop: () => void;
  onToggleStartOnLaunch: (enabled: boolean) => void;
  page: MindPage;
  persona: AgentPersona | null;
  resident: ResidentSummaryViewModel;
  titleRef: React.Ref<HTMLHeadingElement>;
};

/** Each pane's title and the line that says what it decides (Decided 12). */
function paneHead(
  pane: MindPane,
  name: string,
  harness: string,
): { title: string; lede: string } {
  switch (pane) {
    case "words":
      return {
        title: "Their words",
        lede: `The introduction and what ${name} is exploring, at the top of their page, and the one piece they pin.`,
      };
    case "permissions":
      return {
        title: "Permissions",
        lede: `What ${name} may do on this Mac without asking you first.`,
      };
    case "harness":
      return {
        title: "Harness",
        lede: `What runs ${name}. Changing it restarts ${name}; their name, identity and documents stay the same.`,
      };
    case "works":
      return {
        title: "Works in",
        lede: `The folder ${name} starts in, and where their documents live.`,
      };
    case "read":
      return {
        title: "Can read",
        lede: `What Brain has connected that ${name} may read.`,
      };
    case "config":
      return {
        title: `${harness} settings`,
        lede: `These belong to ${harness}, not to ${name}: every agent that runs on ${harness} shares them.`,
      };
    case "files":
      return {
        title: "Files",
        lede: `The other files in ${name}'s folder.`,
      };
    case "identity":
      return {
        title: "Network identity",
        lede: `Who ${name} is on the network, whatever runs them.`,
      };
    case "instructions":
      return {
        title: "Instructions",
        lede: `How ${name} works with you.`,
      };
    default:
      return { title: "", lede: "" };
  }
}

/**
 * Settings (BETA14_RELEASE.md WP-42, Decided 10–13): everything you decide
 * about a mind, in the look Riley chose (filled panels, plain titles, rows
 * of at least 44), and its panes, each a page of its own. Nothing is said
 * twice; their page is theirs.
 */
export function MindSettingsPage(props: SettingsProps) {
  const { managedAgent, page, resident } = props;
  const name = resident.displayName;
  const surface = useAgentConfigSurface(managedAgent?.pubkey ?? null);
  const harness = surface.data?.runtimeLabel ?? residentSourceLabel(resident);
  const documents = useResidentDocumentsQuery(managedAgent?.pubkey ?? null);
  const nativeRuntime =
    documents.data?.source === "native"
      ? (documents.data.nativeRuntime ?? "Their runtime")
      : null;

  if (page.kind === "settings")
    return <SettingsRoot {...props} harness={harness} />;

  if (page.kind === "file" && managedAgent)
    return (
      <MindDocPane
        agent={managedAgent}
        backLabel={props.backLabel}
        nativeRuntime={nativeRuntime}
        onBack={props.onBack}
        onRestart={props.onRestart}
        residentName={name}
        target={{ relPath: page.relPath }}
        titleRef={props.titleRef}
      />
    );

  if (page.kind === "reading" && managedAgent)
    return (
      <MindDocPane
        agent={managedAgent}
        backLabel={props.backLabel}
        nativeRuntime={nativeRuntime}
        onBack={props.onBack}
        onRestart={props.onRestart}
        residentName={name}
        target={{ kind: page.doc }}
        titleRef={props.titleRef}
      />
    );

  if (page.kind !== "pane")
    return (
      <MindPageHead
        back={props.backLabel}
        lede={`${name} isn't set up on this Mac yet.`}
        onBack={props.onBack}
        title="Nothing here"
        titleRef={props.titleRef}
      />
    );

  const pane = page.pane;
  if (
    (pane === "soul" || pane === "convictions" || pane === "instructions") &&
    managedAgent &&
    documents.data &&
    !(pane === "instructions" && nativeRuntime)
  )
    return (
      <MindDocPane
        agent={managedAgent}
        backLabel={props.backLabel}
        nativeRuntime={nativeRuntime}
        onBack={props.onBack}
        onRestart={props.onRestart}
        residentName={name}
        target={{ kind: pane }}
        titleRef={props.titleRef}
      />
    );

  if (pane === "keeps" && managedAgent)
    return (
      <MindKeepsUpWith
        backLabel={props.backLabel}
        name={name}
        onBack={props.onBack}
        residentPubkey={managedAgent.pubkey}
        titleRef={props.titleRef}
      />
    );

  const head = paneHead(pane, name, harness);
  return (
    <div data-pane={pane} data-testid={`mind-pane-${pane}`}>
      <MindPageHead
        back={props.backLabel}
        lede={head.lede}
        onBack={props.onBack}
        title={head.title}
        titleRef={props.titleRef}
      />
      <PaneBody {...props} harness={harness} pane={pane} />
    </div>
  );
}

function PaneBody({
  harness,
  pane,
  ...props
}: SettingsProps & { harness: string; pane: MindPane }) {
  const { managedAgent, persona, resident } = props;
  const name = resident.displayName;
  const appName = useSettingsAppName();
  const luca = useCanonicalLucaPubkey();
  switch (pane) {
    case "words":
      return <WordsPane name={name} />;
    case "permissions":
      return (
        <MindPermissions
          appName={appName}
          harness={harness}
          managedAgent={managedAgent}
          persona={persona}
          resident={resident}
        />
      );
    case "harness":
      return <HarnessPane {...props} />;
    case "works":
      return <WorksPane managedAgent={managedAgent} />;
    case "read":
      return resident.pubkey ? (
        <BrainMindAccess
          isLuca={Boolean(luca && normalizePubkey(resident.pubkey) === luca)}
          name={name}
          residentPubkey={resident.pubkey}
        />
      ) : (
        <p className="luca-mind-help">{name} isn't set up on this Mac yet.</p>
      );
    case "config":
      return managedAgent ? (
        <ConfigPane harness={harness} pubkey={managedAgent.pubkey} />
      ) : null;
    case "files":
      return managedAgent ? (
        <FilesPane agent={managedAgent} onGo={props.onGo} />
      ) : null;
    case "identity":
      return <IdentityPane {...props} appName={appName} />;
    case "instructions":
      return <InstructionsPane {...props} />;
    default:
      return (
        <p className="luca-mind-help">
          {name} isn't set up on this Mac yet, so this part waits until they
          are.
        </p>
      );
  }
}

const RESPOND_WORDS: Record<RespondToMode, string> = {
  "owner-only": "Only you",
  allowlist: "You and the people you choose",
  anyone: "Anyone",
};

/** The whole of Settings, in order (Decided 11). */
function SettingsRoot({
  backLabel,
  harness,
  isActionPending,
  managedAgent,
  onBack,
  onGo,
  onOpenLogs,
  onRestart,
  onStart,
  onStop,
  onToggleStartOnLaunch,
  persona,
  resident,
  titleRef,
}: SettingsProps & { harness: string }) {
  const name = resident.displayName;
  const pubkey = managedAgent?.pubkey ?? null;
  const documents = useResidentDocumentsQuery(pubkey);
  const autoRestart = useSetManagedAgentAutoRestartMutation();
  const surface = useAgentConfigSurface(pubkey);
  const reads = useWhatTheyCanRead(Boolean(resident.pubkey));
  const permissions = usePermissionsValue(pubkey);
  const placeState = useMindPlace();
  const place = placeState?.place ?? null;
  const companion = useMindCompanion(pubkey);
  const { error, operate, pending } = useCompanionOperate(pubkey);
  const [reviewAway, setReviewAway] = React.useState(false);
  const isRunning =
    managedAgent?.status === "running" || managedAgent?.status === "deployed";
  const native =
    documents.data?.source === "native"
      ? (documents.data.nativeRuntime ?? "Their runtime")
      : null;
  const docOf = (kind: "soul" | "convictions" | "instructions") =>
    documents.data?.documents.find((each) => each.kind === kind);
  const docValue = (kind: "soul" | "convictions" | "instructions") => {
    const entry = docOf(kind);
    if (!entry) return documents.isPending ? "" : undefined;
    if (!entry.exists) return "Not written yet";
    return entry.modifiedAt
      ? formatRelativeAge(entry.modifiedAt * 1000, Date.now())
      : "Written";
  };
  // Shown once (Decided 13): with a folder, the documents are what they
  // read, so the runtime's prompt built from them isn't shown again; with
  // no folder, the prompt is their only instructions and is the row.
  const promptOnly =
    !documents.data && (managedAgent?.systemPrompt || persona?.systemPrompt);
  const loaded = companion.data;
  const followed = followedWork(loaded);
  const configCount = surface.data
    ? surface.data.advanced.length +
      Object.values(surface.data.normalized).filter(Boolean).length
    : null;
  const extraFiles = documents.data?.extraFiles.length ?? 0;
  const authorWord =
    place?.author?.kind === "resident"
      ? `Written by ${name}`
      : place?.author?.kind === "owner"
        ? "Written by you"
        : place
          ? "Not written yet"
          : "";

  return (
    <div className="luca-mind-settings-page" data-testid="agent-settings">
      <MindPageHead
        back={backLabel}
        lede={`Everything you decide about ${name}. Their page is theirs: what they make, write and do lives there.`}
        mark={
          resident.pubkey ? (
            <AgentFingerprint
              residentKey={resident.pubkey}
              size={28}
              variant="large"
            />
          ) : null
        }
        onBack={onBack}
        title="Settings"
        titleRef={titleRef}
        titleTestId="mind-settings-title"
      />

      <MindGroup
        footnote={`You write these. ${name} reads them each time they start.`}
        testId="mind-group-who"
        title={`Who ${name} is`}
      >
        {documents.data ? (
          <>
            {(["soul", "convictions"] as const).map((kind) => (
              <MindRow
                help={documentKindMeta(kind).blurb}
                key={kind}
                label={documentKindMeta(kind).label}
                onOpen={() => onGo({ kind: "pane", pane: kind })}
                testId={`mind-row-${kind}`}
                value={docValue(kind)}
              />
            ))}
            {native ? (
              <MindRow
                help={`${native} keeps their instructions itself.`}
                label="Instructions"
                testId="mind-row-instructions"
                value={`Managed by ${native}`}
              />
            ) : (
              <MindRow
                help={documentKindMeta("instructions").blurb}
                label="Instructions"
                onOpen={() => onGo({ kind: "pane", pane: "instructions" })}
                testId="mind-row-instructions"
                value={docValue("instructions")}
              />
            )}
          </>
        ) : promptOnly ? (
          <MindRow
            help={firstLineOf(String(promptOnly))}
            label="Instructions"
            onOpen={() => onGo({ kind: "pane", pane: "instructions" })}
            testId="mind-row-instructions"
          />
        ) : (
          <p className="luca-mind-help luca-mind-panel-note">
            {managedAgent
              ? documents.isError
                ? "Couldn't read their folder."
                : " "
              : `${name} doesn't have a folder yet. Their documents are laid down when they're set up.`}
          </p>
        )}
      </MindGroup>

      {placeState && place ? (
        <MindGroup
          footnote={`What ${name} makes and writes is kept on their page, and in Library with everything else.`}
          testId="mind-group-page"
          title="Their page"
        >
          <MindRow
            control={
              <Switch
                aria-label={`Let ${name} arrange it`}
                checked={place.residentEditingEnabled}
                data-testid="mind-let-arrange"
                disabled={placeState.switching || Boolean(placeState.draft)}
                onCheckedChange={() => void placeState.toggleEditing()}
              />
            }
            help={`${name} can write their introduction, say what they're exploring, and pin something they made.`}
            label={`Let ${name} arrange it`}
            testId="mind-row-arrange"
          />
          <MindRow
            help="The introduction and what they're exploring, at the top of their page"
            label="Their words"
            onOpen={() => onGo({ kind: "pane", pane: "words" })}
            testId="mind-row-words"
            value={authorWord}
          />
        </MindGroup>
      ) : null}

      {managedAgent && loaded && hasAwareness(loaded) ? (
        <MindGroup
          footnote="Only new and changed sessions are followed; old history isn't brought in."
          testId="mind-group-companion"
          title="Companion"
        >
          <MindRow
            help={`The work ${name} follows while you're busy`}
            label="Keeps up with"
            onOpen={() => onGo({ kind: "pane", pane: "keeps" })}
            testId="mind-row-keeps"
            value={followed.length > 0 ? followed.join(", ") : "Nothing yet"}
          />
          <MindRow
            control={
              <Switch
                aria-label="Noticing"
                checked={isNoticing(loaded)}
                data-testid="mind-noticing"
                disabled={
                  pending ||
                  !loaded.awareness.grants.some(
                    (grant) =>
                      grant.grant.state === "active" &&
                      grant.grant.choices.observe,
                  )
                }
                onCheckedChange={() =>
                  void operate((resident, data) =>
                    pauseCompanionAwareness(
                      resident,
                      data.awareness,
                      !data.awareness.paused &&
                        data.awareness.collectionRunning,
                    ),
                  )
                }
              />
            }
            help="Pause to stop following your work for now"
            label="Noticing"
            testId="mind-row-noticing"
          />
          <AwayRow
            loaded={loaded}
            name={name}
            onReview={setReviewAway}
            operate={operate}
            pending={pending}
            reviewing={reviewAway}
          />
        </MindGroup>
      ) : managedAgent && loaded ? (
        <MindGroup testId="mind-group-own" title="On their own">
          <AwayRow
            loaded={loaded}
            name={name}
            onReview={setReviewAway}
            operate={operate}
            pending={pending}
            reviewing={reviewAway}
          />
        </MindGroup>
      ) : null}
      {error ? (
        <p className="luca-mind-error" role="alert">
          {error}
        </p>
      ) : null}

      <MindGroup testId="mind-group-runs" title={`How ${name} runs`}>
        {managedAgent ? (
          <MindRow
            control={
              <ResidentModelMenu
                agent={managedAgent}
                testId="agent-settings-model"
                variant="field"
              />
            }
            help={`Changing it restarts ${name}`}
            label="Model"
            testId="mind-row-model"
          />
        ) : resident.modelLabel ? (
          <MindRow label="Model" value={resident.modelLabel} />
        ) : null}
        <MindRow
          label="Harness"
          onOpen={() => onGo({ kind: "pane", pane: "harness" })}
          testId="mind-row-harness"
          value={harness}
        />
        {managedAgent || persona ? (
          <MindRow
            label="Permissions"
            onOpen={() => onGo({ kind: "pane", pane: "permissions" })}
            testId="mind-row-permissions"
            value={permissions}
          />
        ) : null}
        <MindRow
          label="Works in"
          onOpen={() => onGo({ kind: "pane", pane: "works" })}
          testId="mind-row-works"
          value={
            managedAgent?.nativeRuntimeBinding?.defaultWorkspace ??
            "No folder set"
          }
        />
        {resident.pubkey ? (
          <MindRow
            label="Can read"
            onOpen={() => onGo({ kind: "pane", pane: "read" })}
            testId="mind-what-they-can-read"
            value={reads}
          />
        ) : null}
        {managedAgent ? (
          <>
            <MindRow
              control={
                <Switch
                  aria-label="Wakes with the app"
                  checked={managedAgent.startOnAppLaunch}
                  onCheckedChange={onToggleStartOnLaunch}
                />
              }
              help="Ready before you write, so the first message never waits on a cold start"
              label="Wakes with the app"
              testId="mind-row-wakes"
            />
            <MindRow
              control={
                <Switch
                  aria-label="Restarts on their own after a change"
                  checked={managedAgent.autoRestartOnConfigChange}
                  data-testid="agent-settings-auto-restart"
                  disabled={autoRestart.isPending}
                  onCheckedChange={(enabled) =>
                    autoRestart.mutate({
                      pubkey: managedAgent.pubkey,
                      autoRestartOnConfigChange: enabled,
                    })
                  }
                />
              }
              help="After a document or setting changes, once they're idle"
              label="Restarts on their own after a change"
              testId="mind-row-autorestart"
            />
            <MindRow
              label="Answers"
              testId="mind-row-answers"
              value={
                RESPOND_WORDS[managedAgent.respondTo] ?? managedAgent.respondTo
              }
            />
          </>
        ) : null}
      </MindGroup>

      <MindGroup testId="mind-group-advanced" title="Advanced">
        {managedAgent ? (
          <MindRow
            label={`${harness} settings`}
            onOpen={() => onGo({ kind: "pane", pane: "config" })}
            testId="mind-row-config"
            value={configCount === null ? "" : `${configCount} values`}
          />
        ) : null}
        {managedAgent && documents.data ? (
          <MindRow
            label="Files"
            onOpen={() => onGo({ kind: "pane", pane: "files" })}
            testId="mind-row-files"
            value={`${extraFiles} ${extraFiles === 1 ? "file" : "files"}`}
          />
        ) : null}
        <MindRow
          label="Network identity"
          onOpen={() => onGo({ kind: "pane", pane: "identity" })}
          testId="mind-row-identity"
          value={
            managedAgent?.pubkey
              ? truncatePubkey(managedAgent.pubkey)
              : "Created when they start"
          }
        />
        {managedAgent ? (
          <MindRow
            label="Logs"
            onOpen={onOpenLogs}
            testId="agent-strip-logs"
            value="The harness log"
          />
        ) : null}
      </MindGroup>

      <div className="luca-mind-settings-foot">
        {managedAgent ? (
          <>
            {isRunning && managedAgent.backend.type === "local" ? (
              <button
                className="luca-mind-button"
                data-testid="mind-restart"
                disabled={isActionPending}
                onClick={onRestart}
                type="button"
              >
                <RotateCcw aria-hidden /> Restart {name}
              </button>
            ) : null}
            <button
              className="luca-mind-button"
              data-testid="mind-stop-start"
              disabled={isActionPending}
              onClick={isRunning ? onStop : onStart}
              type="button"
            >
              {isRunning ? <Square aria-hidden /> : <Play aria-hidden />}
              {isRunning ? `Stop ${name}` : `Start ${name}`}
            </button>
          </>
        ) : (
          <button
            className="luca-mind-button"
            disabled={isActionPending}
            onClick={onStart}
            type="button"
          >
            <Play aria-hidden /> Set up {name}
          </button>
        )}
      </div>
    </div>
  );
}

/** While you're away (Decided 11): a switch; turning it on asks today's
 *  question first. */
function AwayRow({
  loaded,
  name,
  onReview,
  operate,
  pending,
  reviewing,
}: {
  loaded: NonNullable<ReturnType<typeof useMindCompanion>["data"]>;
  name: string;
  onReview: (value: boolean) => void;
  operate: ReturnType<typeof useCompanionOperate>["operate"];
  pending: boolean;
  reviewing: boolean;
}) {
  const on = awayOn(loaded);
  const available = loaded.work.nativeChannelAvailable;
  return (
    <>
      <MindRow
        control={
          <Switch
            aria-label="While you're away"
            checked={on || reviewing}
            data-testid="mind-away"
            disabled={pending || (!on && !available)}
            onCheckedChange={(next) => {
              if (!next && on)
                void operate((resident, data) =>
                  setCompanionWork(resident, data.work, false, true),
                );
              else onReview(next);
            }}
          />
        }
        help={
          !on && !available
            ? `Start ${name} before giving them time of their own.`
            : `Small pursuits of their own. What they make stays on their page.`
        }
        label="While you're away"
        testId="mind-row-away"
      />
      {reviewing ? (
        <div
          className="luca-mind-prow luca-mind-consent"
          data-testid="mind-away-review"
        >
          <span className="luca-mind-prow-words">
            <span className="luca-mind-prow-help">
              Allow bounded local creations and private inquiries? Codex uses a
              restricted temporary working folder; this is not a separate
              computer or project-editing permission. Work may use your existing
              harness allowance. There is no required output quota.
            </span>
          </span>
          <span className="luca-mind-row-controls">
            <button
              className="luca-mind-inline"
              onClick={() => onReview(false)}
              type="button"
            >
              Not now
            </button>
            <button
              className="luca-mind-button luca-mind-button-solid"
              disabled={pending || !available}
              onClick={() =>
                void operate((resident, data) =>
                  setCompanionWork(resident, data.work, true, false),
                ).then(() => onReview(false))
              }
              type="button"
            >
              Allow background work
            </button>
          </span>
        </div>
      ) : null}
    </>
  );
}

function firstLineOf(text: string): string {
  const line =
    text
      .split("\n")
      .map((each) => each.replace(/^\s*#{1,6}\s+/, "").trim())
      .find(Boolean) ?? "";
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}

/** Instructions, when they're an agent's only ones (no folder): the
 *  definition's own words, changed in Advanced… (Decided 13). */
function InstructionsPane({ managedAgent, onEdit, persona }: SettingsProps) {
  const text = managedAgent?.systemPrompt || persona?.systemPrompt || "";
  return (
    <>
      <div className="luca-mind-panel luca-mind-reading">
        <p className="luca-mind-reading-text">
          {text || "No instructions set."}
        </p>
      </div>
      <div className="luca-mind-actions">
        <button
          className="luca-mind-button"
          data-testid="agent-settings-advanced"
          onClick={onEdit}
          type="button"
        >
          <Settings2 aria-hidden /> Advanced…
        </button>
      </div>
    </>
  );
}

/** Their words: the place editor (introduction, exploring, the pinned
 *  piece), today's `useResidentPlace` draft and save. */
function WordsPane({ name }: { name: string }) {
  const state = useMindPlace();
  const place = state?.place ?? null;
  const draft = state?.draft ?? null;
  const beginEdit = state?.beginEdit;
  const cancelEdit = state?.cancelEdit;
  React.useEffect(() => {
    if (place && !draft) beginEdit?.();
  }, [beginEdit, draft, place]);
  React.useEffect(() => () => cancelEdit?.(), [cancelEdit]);
  if (!state || !place)
    return (
      <p className="luca-mind-help">
        {name}'s place isn't available on this Mac.
      </p>
    );
  if (!draft) return null;
  const change = (content: ResidentPlaceContent) =>
    state.changeContent(content);
  const selected = place.selectedWork;
  const conflict = state.conflict || place.revision !== draft.expectedRevision;
  return (
    <form
      className="luca-mind-words-form"
      data-testid="resident-place-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void state.save();
      }}
    >
      <MindGroup title="Introduction">
        <textarea
          aria-label="Introduction"
          className="luca-mind-editor luca-mind-editor-short"
          disabled={state.saving}
          maxLength={1200}
          onChange={(event) =>
            change({ ...draft.content, introduction: event.target.value })
          }
          placeholder="Write an introduction"
          value={draft.content.introduction}
        />
      </MindGroup>
      <MindGroup title="Exploring">
        <textarea
          aria-label="Exploring"
          className="luca-mind-editor luca-mind-editor-short"
          disabled={state.saving}
          maxLength={1600}
          onChange={(event) =>
            change({ ...draft.content, exploration: event.target.value })
          }
          placeholder="Write what is being explored"
          value={draft.content.exploration}
        />
      </MindGroup>
      <MindGroup
        footnote="One existing version. New versions won't replace it automatically."
        title="Pinned"
      >
        {state.work ? (
          <div className="luca-mind-prow">
            <select
              aria-label="Pinned piece"
              className="luca-mind-select"
              disabled={state.saving}
              onChange={(event) => {
                const choice = state.work?.[Number(event.target.value)];
                change({
                  ...draft.content,
                  selectedWork:
                    event.target.value === "" || !choice
                      ? null
                      : {
                          artifactId: choice.artifactId,
                          version: choice.version,
                        },
                });
              }}
              value={String(
                state.work.findIndex(
                  (choice) =>
                    choice.artifactId ===
                      draft.content.selectedWork?.artifactId &&
                    choice.version === draft.content.selectedWork?.version,
                ),
              ).replace("-1", "")}
            >
              <option value="">Nothing pinned</option>
              {state.work.map((choice, index) => (
                <option
                  disabled={choice.availability !== "available"}
                  key={`${choice.artifactId}:${choice.version}`}
                  value={String(index)}
                >
                  {choice.availability === "available"
                    ? choice.title
                    : "Unavailable work"}{" "}
                  · version {choice.version}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <MindRow
            control={
              <span className="luca-mind-row-controls">
                {draft.content.selectedWork ? (
                  <button
                    className="luca-mind-inline"
                    disabled={state.saving}
                    onClick={() =>
                      change({ ...draft.content, selectedWork: null })
                    }
                    type="button"
                  >
                    Clear
                  </button>
                ) : null}
                <button
                  className="luca-mind-button luca-mind-button-small"
                  disabled={state.workLoading || state.saving}
                  onClick={() => void state.loadWork()}
                  type="button"
                >
                  {state.workLoading ? "Loading…" : "Choose"}
                </button>
              </span>
            }
            label={
              draft.content.selectedWork
                ? selected?.availability === "available"
                  ? selected.title
                  : `Version ${draft.content.selectedWork.version} unavailable`
                : "Nothing pinned"
            }
          />
        )}
      </MindGroup>
      {state.workError || state.saveError ? (
        <p className="luca-mind-error" role="alert">
          {state.saveError ?? state.workError}
        </p>
      ) : null}
      {conflict ? (
        <div className="luca-mind-actions" role="alert">
          <p className="luca-mind-help">
            This place changed while you were editing. Your draft remains here.
          </p>
          <button
            className="luca-mind-button"
            disabled={state.saving || state.loading}
            onClick={() => void state.reloadLatest()}
            type="button"
          >
            Reload latest
          </button>
        </div>
      ) : null}
      <div className="luca-mind-actions luca-mind-actions-end">
        <span className="luca-mind-meta">
          Your edits are attributed to you.
        </span>
        <button
          className="luca-mind-button luca-mind-button-solid"
          disabled={state.saving || conflict}
          type="submit"
        >
          {state.saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

/** Harness (Decided 12): the runtime, the program, the version or
 *  profile, and Thinking, with Recheck and Advanced…. */
function HarnessPane({ managedAgent, onEdit, resident }: SettingsProps) {
  const managedQuery = useManagedAgentsQuery();
  const surface = useAgentConfigSurface(managedAgent?.pubkey ?? null);
  const binding = managedAgent?.nativeRuntimeBinding;
  const thinking = surface.data?.normalized.thinkingEffort?.value ?? null;
  return (
    <>
      <MindGroup title="What runs them">
        <MindRow label="Runtime" value={residentSourceLabel(resident)} />
        {binding?.executablePath || managedAgent?.agentCommand ? (
          <MindRow
            label="Program"
            value={
              <span className="luca-mind-mono">
                {binding?.executablePath ?? managedAgent?.agentCommand}
              </span>
            }
          />
        ) : null}
        {binding ? (
          <MindRow
            label={binding.kind === "hermes" ? "Profile" : "Agent ID"}
            value={
              binding.kind === "hermes" ? binding.profileName : binding.agentId
            }
          />
        ) : null}
        {binding?.runtimeVersion ? (
          <MindRow label="Version" value={binding.runtimeVersion} />
        ) : null}
        {thinking ? (
          <MindRow
            help={`From ${surface.data?.runtimeLabel ?? "the harness"}'s own settings`}
            label="Thinking"
            value={thinking}
          />
        ) : null}
      </MindGroup>
      <div className="luca-mind-actions">
        {managedAgent ? (
          <button
            className="luca-mind-button"
            data-testid="mind-setting-recheck"
            disabled={managedQuery.isFetching}
            onClick={() => void managedQuery.refetch()}
            title="Checks the exact native profile or agent without modifying it."
            type="button"
          >
            <RefreshCw aria-hidden /> Recheck
          </button>
        ) : null}
        <button
          className="luca-mind-button"
          data-testid="agent-settings-advanced"
          onClick={onEdit}
          type="button"
        >
          <Settings2 aria-hidden /> Advanced…
        </button>
      </div>
    </>
  );
}

/** Works in: the folder they start in and their documents folder. */
function WorksPane({ managedAgent }: { managedAgent: ManagedAgent | null }) {
  return (
    <MindGroup title="Folders">
      <MindRow
        label="Starts in"
        value={
          <span className="luca-mind-mono">
            {managedAgent?.nativeRuntimeBinding?.defaultWorkspace ??
              "No native workspace reported"}
          </span>
        }
      />
      {managedAgent?.documentsDir ? (
        <MindRow
          label="Documents"
          value={
            <span className="luca-mind-mono">{managedAgent.documentsDir}</span>
          }
        />
      ) : null}
    </MindGroup>
  );
}

/** {Harness} settings (Decided 12): read-only, searchable, grouped. */
function ConfigPane({ harness, pubkey }: { harness: string; pubkey: string }) {
  const surface = useAgentConfigSurface(pubkey);
  const [query, setQuery] = React.useState("");
  const rows = React.useMemo(() => {
    if (!surface.data) return [];
    const normalized = Object.entries(surface.data.normalized)
      .filter(
        (entry): entry is [string, NonNullable<(typeof entry)[1]>] =>
          entry[1] !== null && entry[0] !== "systemPrompt",
      )
      .map(([key, field]) => configRowOf(key, field.value ?? "Not set"));
    const advanced = surface.data.advanced.map((field) =>
      configRowOf(field.key, field.value ?? "Not set"),
    );
    return [...normalized, ...advanced];
  }, [surface.data]);
  const groups = groupConfigRows(rows, query);
  const file = surface.data?.sources.configFilePath;
  if (surface.isPending)
    return <p className="luca-mind-help">Loading {harness}'s settings…</p>;
  if (surface.isError || !surface.data)
    return (
      <p className="luca-mind-error" role="alert">
        {surface.error instanceof Error
          ? surface.error.message
          : `Couldn't read ${harness}'s settings.`}
      </p>
    );
  return (
    <div data-testid="mind-config">
      {file ? (
        <p className="luca-mind-meta luca-mind-config-file">
          Read from <span className="luca-mind-mono">{file}</span>
        </p>
      ) : null}
      <label className="luca-mind-search">
        <Search aria-hidden />
        <input
          aria-label={`Search ${rows.length} settings`}
          data-testid="mind-config-search"
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${rows.length} settings`}
          type="search"
          value={query}
        />
      </label>
      {groups.length === 0 ? (
        <p className="luca-mind-help">Nothing matches “{query}”.</p>
      ) : (
        groups.map((group) => (
          <MindGroup
            key={group.id}
            testId={`mind-config-${group.id}`}
            title={
              <>
                {group.title}{" "}
                <span className="luca-mind-count">{group.rows.length}</span>
              </>
            }
          >
            {group.rows.map((row) => (
              <div
                className="luca-mind-prow luca-mind-config-row"
                key={row.key}
              >
                <span
                  className="luca-mind-mono luca-mind-config-key"
                  title={row.key}
                >
                  {row.label}
                </span>
                <span
                  className="luca-mind-mono luca-mind-config-value"
                  title={row.value}
                >
                  {row.value}
                </span>
              </div>
            ))}
          </MindGroup>
        ))
      )}
    </div>
  );
}

/** Files: the other files in their folder, with New file. */
function FilesPane({
  agent,
  onGo,
}: {
  agent: ManagedAgent;
  onGo: (page: MindPage) => void;
}) {
  const documents = useResidentDocumentsQuery(agent.pubkey);
  const [adding, setAdding] = React.useState(false);
  const [path, setPath] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const files = documents.data?.extraFiles ?? [];
  return (
    <>
      <MindGroup title="In their folder">
        {files.length === 0 ? (
          <p className="luca-mind-help luca-mind-panel-note">
            Nothing else in their folder yet.
          </p>
        ) : (
          files.map((file) => (
            <MindRow
              key={file.relPath}
              label={<span className="luca-mind-mono">{file.relPath}</span>}
              onOpen={() => onGo({ kind: "file", relPath: file.relPath })}
              value={formatRelativeAge(file.modifiedAt * 1000, Date.now())}
            />
          ))
        )}
      </MindGroup>
      {adding ? (
        <form
          className="luca-mind-actions"
          onSubmit={(event) => {
            event.preventDefault();
            const problem = validateExtraFilePath(path);
            if (problem) {
              setError(problem);
              return;
            }
            onGo({ kind: "file", relPath: path.trim() });
          }}
        >
          <input
            aria-label="New file path"
            ref={(element) => element?.focus()}
            className="luca-mind-input"
            onChange={(event) => {
              setPath(event.target.value);
              setError(null);
            }}
            placeholder="notes/ideas.md"
            value={path}
          />
          <button className="luca-mind-button" type="submit">
            Open
          </button>
          {error ? (
            <p className="luca-mind-error" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      ) : (
        <div className="luca-mind-actions">
          <button
            className="luca-mind-button"
            data-testid="mind-new-file"
            onClick={() => setAdding(true)}
            type="button"
          >
            <Plus aria-hidden /> New file
          </button>
        </div>
      )}
    </>
  );
}

/** Network identity: the public key with Copy, custody, definition, kind
 *  and authority. */
function IdentityPane({
  appName,
  managedAgent,
  persona,
  resident,
}: SettingsProps & { appName: string }) {
  const [copied, setCopied] = React.useState(false);
  const pubkey = managedAgent?.pubkey ?? null;
  return (
    <MindGroup title="Identity">
      <MindRow
        control={
          pubkey ? (
            <button
              className="luca-mind-button luca-mind-button-small"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(pubkey)
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false));
              }}
              type="button"
            >
              <Copy aria-hidden /> {copied ? "Copied" : "Copy"}
            </button>
          ) : null
        }
        help={
          pubkey ? (
            <span className="luca-mind-mono luca-mind-key">{pubkey}</span>
          ) : (
            "Created when the resident starts"
          )
        }
        label="Public identity"
      />
      {pubkey ? (
        <MindRow label="Custody" value="Held in local secure storage" />
      ) : null}
      <MindRow
        label="Definition"
        value={persona ? "Editable Luca definition" : "Runtime-owned profile"}
      />
      <MindRow label="Kind" value={agentOriginDescription(resident)} />
      <MindRow
        help={`Runtime: ${agentConfigurationViewModel(resident).authorities.runtime.replaceAll("_", " ")} · Continuity and permissions: ${appName} managed`}
        label="Authority"
        value={authorityLabel(resident, appName)}
      />
    </MindGroup>
  );
}

/**
 * Permissions (Decided 12): today's choices for their machine access, the
 * permissions remembered for them, the Canvas tools, and the way to their
 * MCP access.
 */
function MindPermissions({
  appName,
  harness,
  managedAgent,
  persona,
  resident,
}: {
  appName: string;
  harness: string;
  managedAgent: ManagedAgent | null;
  persona: AgentPersona | null;
  resident: ResidentSummaryViewModel;
}) {
  const { goSettings } = useAppNavigation();
  const runtimesQuery = useAcpRuntimesQuery();
  const canvas = artifactMcpCapabilityPresentation({
    runtimeReference: managedAgent?.agentCommand ?? persona?.runtime ?? null,
    runtimes: runtimesQuery.data,
    loading: runtimesQuery.isPending,
    failed: runtimesQuery.isError,
  });
  return (
    <>
      {managedAgent ? (
        <div className="luca-mind-access" data-testid="mind-access">
          <ResidentAccessControl residentPubkey={managedAgent.pubkey} />
        </div>
      ) : (
        <p className="luca-mind-help">
          Set up {resident.displayName} before giving them machine access.
        </p>
      )}
      <MindGroup
        footnote={`MCP access never grants tool approval. Every protected action still uses ${appName}'s own permission flow. Private continuity jobs never receive MCP tools.`}
        title="Tools"
      >
        <MindRow
          help={canvas.detail ?? `${harness} and the Canvas`}
          label="Canvas tools"
          testId="agent-artifact-mcp-capability"
          value={canvas.value}
        />
        <MindRow
          label="Continuity"
          value={
            managedAgent
              ? `Available as a ${appName}-managed overlay`
              : "Available after setup"
          }
        />
        <MindRow
          control={
            <button
              className="luca-mind-inline luca-mind-arrow"
              data-testid="mind-setting-manage-mcp"
              onClick={() => void goSettings("connections")}
              type="button"
            >
              Manage MCP access <ArrowUpRight aria-hidden />
            </button>
          }
          help={`Their ${appName} MCP grants are in Connections & MCP.`}
          label="MCP access"
        />
      </MindGroup>
    </>
  );
}

/** Their machine access, as today's picker names it. */
export function usePermissionsValue(residentPubkey: string | null): string {
  const settings = useQuery({
    enabled: Boolean(residentPubkey),
    queryFn: getResidentCapabilitySettings,
    queryKey: ["resident-capability-settings"],
  });
  if (!settings.data || !residentPubkey) return "";
  const level =
    settings.data.residentAccess[residentPubkey] ??
    settings.data.householdDefault;
  return level === "full" ? "Don't ask me" : "Work in my project";
}
