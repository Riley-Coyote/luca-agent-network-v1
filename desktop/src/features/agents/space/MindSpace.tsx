import * as React from "react";
import { CircleAlert, Play } from "lucide-react";

import "@/app/shell/shell-mind-space.css";
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
import { AgentIdentitySpecimen } from "@/shared/ui/AgentIdentitySpecimen";
import {
  LogsSheet,
  SettingsSection,
} from "@/features/agents/ui/AgentLibraryWorkspace";
import type { ResidentSummaryViewModel } from "@/features/agents/ui/agentLibraryViewModel";
import { MindNotebook } from "./MindNotebook";
import type { MindSection } from "./mindSection";

/** The specimen's box, for a 40 body: it draws its body at 29 of 40. */
const MARK_SIZE = 55;

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
  focusRead,
  isActionPending,
  managedAgent,
  onEdit,
  onMessage,
  onOpenChannel,
  onReadFocused,
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
  focusRead: boolean;
  isActionPending: boolean;
  managedAgent: ManagedAgent | null;
  onEdit: () => void;
  onMessage: () => void;
  onOpenChannel: (channelId: string) => void;
  onReadFocused: () => void;
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
                agent={managedAgent}
                onRestart={onRestart}
                residentName={name}
                variant="space"
              />
            ) : (
              <p className="luca-mind-quiet">
                {name} doesn't have a folder yet. Their documents — soul,
                convictions, self-model, user model, lessons, instructions — are
                laid down when the resident is set up
                {persona?.systemPrompt
                  ? ", starting from this definition's instructions"
                  : ""}
                .
              </p>
            )
          ) : (
            <SettingsSection
              channels={channels}
              focusRead={focusRead}
              isActionPending={isActionPending}
              layout="space"
              managedAgent={managedAgent}
              onEdit={onEdit}
              onOpenChannel={onOpenChannel}
              onOpenLogs={() => setLogsOpen(true)}
              onReadFocused={onReadFocused}
              onRestart={onRestart}
              onStart={onStart}
              onStop={onStop}
              onToggleStartOnLaunch={onToggleStartOnLaunch}
              persona={persona}
              resident={resident}
            />
          )}
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
        <h1 className="luca-place-page-name">{resident.displayName}</h1>
        <p
          className="luca-mind-now"
          data-mind-state={state}
          data-testid="mind-now"
          data-working={state === "working" ? "true" : undefined}
        >
          {now}
        </p>
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
