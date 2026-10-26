import * as React from "react";
import { CircleAlert, Play } from "lucide-react";

import "@/app/shell/shell-mind-space.css";
import { agentStateWord } from "@/app/shell/placeRails/placePicks";
import { ResidentDocumentsSection } from "@/features/agents/documents/ResidentDocumentsSection";
import { useAgentWorking } from "@/features/agents/agentWorkingSignal";
import { useChannelsQuery } from "@/features/channels/hooks";
import type { AgentPersona, ManagedAgent } from "@/shared/api/types";
import { AgentIdentitySpecimen } from "@/shared/ui/AgentIdentitySpecimen";
import {
  LogsSheet,
  SettingsSection,
} from "@/features/agents/ui/AgentLibraryWorkspace";
import type { ResidentSummaryViewModel } from "@/features/agents/ui/agentLibraryViewModel";
import { MindNotebook } from "./MindNotebook";
import type { MindSection } from "./mindSection";

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
                const step =
                  event.key === "ArrowRight"
                    ? 1
                    : event.key === "ArrowLeft"
                      ? -1
                      : 0;
                if (!step) return;
                event.preventDefault();
                const next =
                  (index + step + MIND_TABS.length) % MIND_TABS.length;
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
  const working = useAgentWorking(resident.pubkey);
  const channelsQuery = useChannelsQuery();
  const now = React.useMemo(() => {
    if (working.working && working.channels.length > 0) {
      if (working.channels.length > 1)
        return `Working in ${working.channels.length} conversations`;
      const channelId = working.channels[0]?.channelId;
      const channel = channelsQuery.data?.find((each) => each.id === channelId);
      return channel
        ? `Working in ${channel.name}`
        : "Working in one conversation";
    }
    const word = agentStateWord({
      availability: resident.availability,
      lastError: managedAgent?.lastError,
      waking: Boolean(managedAgent?.waking),
      working: working.working,
    });
    return word.charAt(0).toUpperCase() + word.slice(1);
  }, [
    channelsQuery.data,
    managedAgent?.lastError,
    managedAgent?.waking,
    resident.availability,
    working,
  ]);

  return (
    <header className="luca-mind-head" data-testid="mind-head">
      {resident.pubkey ? (
        <AgentIdentitySpecimen
          accessibleName={resident.displayName}
          avatarUrl={resident.avatarUrl}
          className="luca-mind-mark"
          motion="ambient"
          publicKey={resident.pubkey}
          size={40}
          state={identityState(resident)}
        />
      ) : (
        <span aria-hidden className="luca-mind-mark luca-mind-initial">
          {resident.displayName.slice(0, 1).toUpperCase()}
        </span>
      )}
      <div className="luca-mind-who">
        <h1 className="luca-place-page-name">{resident.displayName}</h1>
        <p
          className="luca-mind-now"
          data-testid="mind-now"
          data-working={working.working ? "true" : undefined}
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
          <Play aria-hidden /> Set up resident
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
