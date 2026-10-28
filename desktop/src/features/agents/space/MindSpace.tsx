import * as React from "react";
import { CircleAlert, Play } from "lucide-react";

import "@/app/shell/shell-mind-space.css";
import { PLACE_RAIL_HOOKS } from "@/app/shell/placeRails/usePlaceRails";
import { ResidentDocumentsSection } from "@/features/agents/documents/ResidentDocumentsSection";
import { useAgentWorking } from "@/features/agents/agentWorkingSignal";
import {
  mindStateLabel,
  useMindState,
} from "@/features/agents/lib/useMindState";
import { useRunningRuntimeTask } from "@/features/capabilities/useAllRuntimeTasks";
import { useChannelsQuery } from "@/features/channels/hooks";
import {
  namesAsList,
  runtimeLabel,
} from "@/features/exchange/sideConversations";
import { useSideConversations } from "@/features/exchange/useSideConversations";
import type { AgentPersona, ManagedAgent } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { AgentIdentitySpecimen } from "@/shared/ui/AgentIdentitySpecimen";
import { AgentMark } from "@/shared/ui/AgentMark";
import {
  LogsSheet,
  SettingsSection,
} from "@/features/agents/ui/AgentLibraryWorkspace";
import {
  residentSourceLabel,
  type ResidentSummaryViewModel,
} from "@/features/agents/ui/agentLibraryViewModel";
import { MindNotebook } from "./MindNotebook";
import { usePermissionsValue, useWhatTheyCanRead } from "./MindSettings";
import type { MindSection, MindSettingsAt } from "./mindSection";

/** The specimen's box, for the lab's 52 body (BETA14_RELEASE.md WP-40): it
 *  draws its body at 29 of 40 of its box. */
const MARK_SIZE = 72;

const MIND_TABS: { id: MindSection; label: string }[] = [
  { id: "notebook", label: "Notebook" },
  { id: "self", label: "Self" },
  { id: "settings", label: "Settings" },
];

/**
 * A mind's own space (NAVIGATION.md, "A mind's own space"; SHELL_BUILD.md
 * WP-13): where you raise them. Their mark, their name, what they're doing
 * now and Talk; then Notebook (their days), Self (who they are) and Settings
 * (how they run). The same space for every mind: a part a mind has no data
 * for hides.
 */
export function MindSpace({
  actionErrorMessage,
  actionNoticeMessage,
  channels,
  focusAt,
  isActionPending,
  managedAgent,
  onEdit,
  onMessage,
  onOpenChannel,
  onFocusAtConsumed,
  onRestart,
  onSectionChange,
  onStart,
  onStop,
  onToggleStartOnLaunch,
  persona,
  resident,
  section,
}: {
  actionErrorMessage: string | null;
  actionNoticeMessage: string | null;
  channels: Array<{ id: string; name: string }>;
  /** Open on What they can read (`/brain`'s landing). */
  focusAt: MindSettingsAt | null;
  isActionPending: boolean;
  managedAgent: ManagedAgent | null;
  onEdit: () => void;
  onMessage: () => void;
  onOpenChannel: (channelId: string) => void;
  onFocusAtConsumed: () => void;
  onRestart: () => void;
  onSectionChange: (section: MindSection) => void;
  onStart: () => void;
  onStop: () => void;
  onToggleStartOnLaunch: (enabled: boolean) => void;
  persona: AgentPersona | null;
  resident: ResidentSummaryViewModel;
  section: MindSection;
}) {
  const [logsOpen, setLogsOpen] = React.useState(false);
  const tabRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const name = resident.displayName;

  return (
    <div className="luca-place-page luca-mind" data-testid="mind-space">
      <div className="luca-place-page-axis">
        <MindHead
          isActionPending={isActionPending}
          managedAgent={managedAgent}
          onMessage={onMessage}
          onStart={onStart}
          resident={resident}
        />
        <div
          aria-label={`${name}'s space`}
          className="luca-mind-tabs"
          role="tablist"
        >
          {MIND_TABS.map((each, index) => (
            <button
              aria-controls={`mind-panel-${each.id}`}
              aria-selected={section === each.id}
              className="luca-mind-tab"
              data-selected={section === each.id ? "true" : undefined}
              data-testid={`mind-tab-${each.id}`}
              id={`mind-tab-${each.id}`}
              key={each.id}
              onClick={() => onSectionChange(each.id)}
              onKeyDown={(event) => {
                const last = MIND_TABS.length - 1;
                const next =
                  event.key === "ArrowRight"
                    ? index === last
                      ? 0
                      : index + 1
                    : event.key === "ArrowLeft"
                      ? index === 0
                        ? last
                        : index - 1
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? last
                          : null;
                if (next === null) return;
                event.preventDefault();
                const tab = MIND_TABS[next];
                if (!tab) return;
                onSectionChange(tab.id);
                tabRefs.current[next]?.focus();
              }}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              role="tab"
              tabIndex={section === each.id ? 0 : -1}
              type="button"
            >
              {each.label}
            </button>
          ))}
        </div>
        <div className="luca-mind-columns">
          <div
            aria-labelledby={`mind-tab-${section}`}
            className="luca-mind-body"
            id={`mind-panel-${section}`}
            role="tabpanel"
          >
            {actionErrorMessage ? (
              <div className="luca-mind-alert" role="alert">
                <CircleAlert aria-hidden />
                <span>{actionErrorMessage}</span>
              </div>
            ) : actionNoticeMessage ? (
              <p className="luca-mind-quiet" role="status">
                {actionNoticeMessage}
              </p>
            ) : null}
            {section === "notebook" ? (
              <MindNotebook
                key={resident.pubkey ?? resident.residentId}
                managedAgent={managedAgent}
                resident={resident}
              />
            ) : section === "self" ? (
              managedAgent ? (
                <ResidentDocumentsSection
                  intro={`Who ${name} is. Most of this grows from talking.`}
                  agent={managedAgent}
                  onRestart={onRestart}
                  residentName={name}
                  variant="space"
                />
              ) : (
                <p className="luca-mind-intro">
                  {name} doesn't have a folder yet. Their documents — soul,
                  convictions, self-model, user model, lessons, instructions —
                  are laid down when the resident is set up
                  {persona?.systemPrompt
                    ? ", starting from this definition's instructions"
                    : ""}
                  .
                </p>
              )
            ) : (
              <SettingsSection
                channels={channels}
                focusAt={focusAt}
                isActionPending={isActionPending}
                layout="space"
                managedAgent={managedAgent}
                onEdit={onEdit}
                onOpenChannel={onOpenChannel}
                onOpenLogs={() => setLogsOpen(true)}
                onFocusAtConsumed={onFocusAtConsumed}
                onRestart={onRestart}
                onStart={onStart}
                onStop={onStop}
                onToggleStartOnLaunch={onToggleStartOnLaunch}
                persona={persona}
                resident={resident}
              />
            )}
          </div>
          <MindAside managedAgent={managedAgent} resident={resident} />
        </div>
      </div>
      {managedAgent ? (
        <LogsSheet
          agent={managedAgent}
          onOpenChange={setLogsOpen}
          open={logsOpen}
        />
      ) : null}
    </div>
  );
}

/**
 * Beside all three tabs (BETA14_RELEASE.md WP-33, Decided 8): how they run
 * at a glance, from what the app holds about them, and who they work with,
 * from the side conversations they share. A fact the app doesn't hold is
 * left out.
 */
function MindAside({
  managedAgent,
  resident,
}: {
  managedAgent: ManagedAgent | null;
  resident: ResidentSummaryViewModel;
}) {
  const reads = useWhatTheyCanRead(Boolean(resident.pubkey));
  const permissions = usePermissionsValue(managedAgent?.pubkey ?? null);
  const workspace = managedAgent?.nativeRuntimeBinding?.defaultWorkspace;
  const facts = [
    {
      label: "Runs on",
      value: [
        residentSourceLabel(resident),
        managedAgent || resident.modelLabel
          ? (resident.modelLabel ?? "Default model")
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
    },
    {
      label: "Wakes",
      value: managedAgent
        ? managedAgent.startOnAppLaunch
          ? "With the app"
          : "When started"
        : "",
    },
    { label: "Works in", value: workspace ?? "" },
    { label: "Reads", value: reads },
    { label: "Permissions", value: managedAgent ? permissions : "" },
  ].filter((fact) => fact.value.length > 0);

  // Who they work with: every other mind in a side conversation they share,
  // in the order the feed holds them (newest first), with the state the
  // Agents rail gives each.
  const side = useSideConversations();
  const { sections } = PLACE_RAIL_HOOKS.agents();
  const minds = React.useMemo(
    () =>
      new Map(
        sections
          .flatMap((each) => each.rows)
          .filter((row) => row.id.startsWith("mind:"))
          .map((row) => [row.id.slice(5), row]),
      ),
    [sections],
  );
  const key = resident.pubkey ? normalizePubkey(resident.pubkey) : null;
  const withThem = React.useMemo(() => {
    if (!key) return [];
    const seen: string[] = [];
    for (const item of side.items) {
      if (item.kind !== "exchange") continue;
      const people = [item.openedBy, ...item.members].map(normalizePubkey);
      if (!people.includes(key)) continue;
      for (const other of people)
        if (other !== key && minds.has(other) && !seen.includes(other))
          seen.push(other);
    }
    return seen;
  }, [key, minds, side.items]);

  if (facts.length === 0 && withThem.length === 0) return null;
  return (
    <aside
      aria-label="At a glance"
      className="luca-mind-aside"
      data-testid="mind-aside"
    >
      {facts.length > 0 ? (
        <section aria-label="At a glance" className="luca-mind-aside-part">
          <h2 className="type-eyebrow luca-mind-eyebrow">At a glance</h2>
          <dl className="luca-mind-facts" data-testid="mind-at-a-glance">
            {facts.map((fact) => (
              <div
                className="luca-mind-fact"
                data-fact={fact.label}
                key={fact.label}
              >
                <dt>{fact.label}</dt>
                <dd title={fact.value}>{fact.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      {withThem.length > 0 ? (
        <section aria-label="Works with" className="luca-mind-aside-part">
          <h2 className="type-eyebrow luca-mind-eyebrow">
            Works with
            <span className="luca-mind-count">{withThem.length}</span>
          </h2>
          <ul className="luca-mind-facts" data-testid="mind-works-with">
            {withThem.map((pubkey) => {
              const row = minds.get(pubkey);
              return (
                <li className="luca-mind-fact luca-mind-with" key={pubkey}>
                  <span aria-hidden className="luca-mind-with-face">
                    <AgentMark />
                  </span>
                  <span className="luca-mind-with-name">
                    {row?.title ?? side.nameOf(pubkey)}
                  </span>
                  {row?.note ? (
                    <span className="luca-mind-date">{row.note}</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </aside>
  );
}

/** The head (Decided 1): their mark as the app draws a resident elsewhere,
 *  their name, one line of what they're doing now, and Talk. */
function MindHead({
  isActionPending,
  managedAgent,
  onMessage,
  onStart,
  resident,
}: {
  isActionPending: boolean;
  managedAgent: ManagedAgent | null;
  onMessage: () => void;
  onStart: () => void;
  resident: ResidentSummaryViewModel;
}) {
  const agentWorking = useAgentWorking(resident.pubkey);
  const channelsQuery = useChannelsQuery();
  // A task they run with Claude Code or Codex is work too (WP-09b, Decided
  // 2): the line says so, as Now's row does.
  const task = useRunningRuntimeTask(resident.pubkey);
  // Their one state (WP-18, Decided 2), as the Agents rail, their profile
  // card and Now say it; the line says what it is about.
  const state = useMindState(resident.pubkey, {
    availability: resident.availability,
    lastError: managedAgent?.lastError,
    waking: Boolean(managedAgent?.waking),
  });
  const side = useSideConversations();
  const key = resident.pubkey?.toLowerCase() ?? null;
  const talk =
    state === "talking" && key
      ? (side.items.find(
          (item) =>
            item.kind === "exchange" &&
            item.live &&
            (item.openedBy === key || item.members.includes(key)),
        ) ?? null)
      : null;
  const now = React.useMemo(() => {
    if (state === "working") {
      if (agentWorking.working && agentWorking.channels.length > 0) {
        if (agentWorking.channels.length > 1)
          return `Working in ${agentWorking.channels.length} conversations`;
        const channelId = agentWorking.channels[0]?.channelId;
        const channel = channelsQuery.data?.find(
          (each) => each.id === channelId,
        );
        return channel
          ? `Working in ${channel.name}`
          : "Working in one conversation";
      }
      if (task)
        return `Working with ${runtimeLabel(task.runtimeFamily)} · ${task.summary}`;
    }
    if (talk && talk.kind === "exchange" && key) {
      const others = [talk.openedBy, ...talk.members]
        .filter(
          (member, index, all) =>
            member !== key && all.indexOf(member) === index,
        )
        .map(side.nameOf);
      const room = side.roomOf(talk.conversationId);
      return `Talking with ${namesAsList(others)}${room ? ` · ${room}` : ""}`;
    }
    return mindStateLabel(state);
  }, [agentWorking, channelsQuery.data, key, side, state, talk, task]);

  // What runs them, in a breath (the lab's head): their app and model.
  const runs = [
    residentSourceLabel(resident),
    managedAgent || resident.modelLabel
      ? (resident.modelLabel ?? "Default model")
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <header className="luca-mind-head" data-testid="mind-head">
      {/* The specimen draws its body inside its box with room for its
          light; sized so the body itself is the study's 40, on a 40
          column (WP-13 review, item 5). */}
      <span aria-hidden={!resident.pubkey} className="luca-mind-mark">
        {resident.pubkey ? (
          <AgentIdentitySpecimen
            accessibleName={resident.displayName}
            avatarUrl={resident.avatarUrl}
            motion="ambient"
            publicKey={resident.pubkey}
            size={MARK_SIZE}
            state={identityState(resident)}
          />
        ) : (
          // The roster's mark for one not yet set up.
          <span className="luca-mind-initial">
            {resident.displayName.slice(0, 1).toUpperCase()}
          </span>
        )}
      </span>
      <div className="luca-mind-who">
        <h1 className="luca-mind-name">{resident.displayName}</h1>
        <p
          className="luca-mind-now"
          data-live={
            // Both are live, so both breathe (WP-21, 2), as Side
            // conversations' live dot does.
            state === "working" || state === "talking" ? "true" : undefined
          }
          data-mind-state={state}
          data-testid="mind-now"
          data-working={state === "working" ? "true" : undefined}
        >
          {now}
        </p>
        {runs ? (
          <p className="luca-mind-runs" data-testid="mind-runs">
            {runs}
          </p>
        ) : null}
      </div>
      {managedAgent ? (
        <button
          className="luca-mind-talk"
          data-testid="mind-talk"
          disabled={isActionPending}
          onClick={onMessage}
          type="button"
        >
          Talk
        </button>
      ) : (
        <button
          className="luca-mind-talk"
          disabled={isActionPending}
          onClick={onStart}
          type="button"
        >
          <Play aria-hidden /> Set up
        </button>
      )}
    </header>
  );
}

function identityState(resident: ResidentSummaryViewModel) {
  if (resident.availability === "failed") return "fault" as const;
  if (resident.availability === "working") return "working" as const;
  if (resident.availability === "idle") return "idle" as const;
  if (resident.availability === "offline") return "unavailable" as const;
  return "present" as const;
}
