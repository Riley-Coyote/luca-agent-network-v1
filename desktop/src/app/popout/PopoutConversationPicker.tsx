import { Check, ChevronDown } from "lucide-react";
import * as React from "react";

import { ConversationTypeIcon } from "@/features/channels/ui/ConversationTypeIcon";
import {
  useRoomProjectCatalog,
  useRoomProjects,
} from "@/features/channels/lib/roomProjects";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveChannelDisplayLabel } from "@/features/sidebar/lib/channelLabels";
import { useIdentityQuery } from "@/shared/api/hooks";
import type { Channel } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";

/** Above this many conversations the list stops being scannable by eye. */
const SEARCH_THRESHOLD = 8;

type PickerEntry = {
  channel: Channel;
  label: string;
};

type PickerGroup = {
  id: string;
  label: string;
  entries: PickerEntry[];
};

function moveOptionFocus(
  options: readonly HTMLButtonElement[],
  current: HTMLButtonElement,
  direction: -1 | 1,
) {
  const index = options.indexOf(current);
  const nextIndex =
    index < 0 ? 0 : (index + direction + options.length) % options.length;
  options[nextIndex]?.focus();
}

/**
 * The focusable options in the order they are DRAWN.
 *
 * The ref map cannot answer this: filtering unmounts rows and remounts them at
 * the end of its insertion order, so arrow keys would start walking the list
 * in the order the owner happened to type. Read the order off the rendered
 * groups instead and look each row up.
 */
function orderedOptions(
  groups: readonly PickerGroup[],
  refs: Map<string, HTMLButtonElement>,
): HTMLButtonElement[] {
  return groups
    .flatMap((group) =>
      group.entries.map((entry) => refs.get(entry.channel.id)),
    )
    .filter((node): node is HTMLButtonElement => node !== undefined);
}

/**
 * Group every conversation the owner can reach the way the sidebar does:
 * each project's rooms under the project's own label, then the rooms that
 * belong to no project, then the direct messages.
 *
 * Projects come first because a project label is the only grouping here that
 * carries meaning the channel list cannot state for itself; "Rooms" and
 * "Direct" are kinds, and a kind is a weaker sort than a piece of work.
 */
function groupConversations(
  channels: readonly Channel[],
  labelFor: (channel: Channel) => string,
  projectByChannelId: ReadonlyMap<string, { id: string; label: string }>,
  projectOrder: readonly { id: string; label: string }[],
): PickerGroup[] {
  const byProject = new Map<string, PickerEntry[]>();
  const rooms: PickerEntry[] = [];
  const direct: PickerEntry[] = [];

  for (const channel of channels) {
    const entry = { channel, label: labelFor(channel) };
    if (channel.channelType === "dm") {
      direct.push(entry);
      continue;
    }
    const project = projectByChannelId.get(channel.id);
    if (!project) {
      rooms.push(entry);
      continue;
    }
    const bucket = byProject.get(project.id);
    if (bucket) bucket.push(entry);
    else byProject.set(project.id, [entry]);
  }

  const groups: PickerGroup[] = [];
  for (const project of projectOrder) {
    const entries = byProject.get(project.id);
    if (entries?.length) {
      groups.push({
        id: `project:${project.id}`,
        label: project.label,
        entries,
      });
    }
  }
  if (rooms.length)
    groups.push({ id: "rooms", label: "Rooms", entries: rooms });
  if (direct.length) {
    groups.push({ id: "direct", label: "Direct", entries: direct });
  }
  return groups;
}

/**
 * The pop-out's title, and its way to every other conversation.
 *
 * The main window reaches another conversation through the sidebar; a pop-out
 * has no sidebar, and until now a plain room or a DM opened in one could only
 * ever be the conversation it was opened for. This is the same object the
 * project-room picker is — a name that is also a menu — widened to the whole
 * conversation list and seated in the window's one bar.
 *
 * Navigation is the shipped route change: `PopoutShell` already re-keys the
 * window title and the `?channel=` identity off the router's location, so
 * choosing here is the same motion as the project picker's.
 */
export function PopoutConversationPicker({
  channelId,
  onSelectChannel,
}: {
  channelId: string | null;
  onSelectChannel: (channelId: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const optionRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const searchRef = React.useRef<HTMLInputElement>(null);

  const channelsQuery = useChannelsQuery();
  const identityQuery = useIdentityQuery();
  const communities = useCommunities();
  const channels = React.useMemo(
    () => channelsQuery.data ?? [],
    [channelsQuery.data],
  );
  const currentPubkey = identityQuery.data?.pubkey;
  const relayUrl = communities.activeCommunity?.relayUrl;

  // Direct messages are named by who is in them, which needs the profiles the
  // sidebar already fetches for exactly this reason.
  const dmParticipantPubkeys = React.useMemo(
    () =>
      channels.flatMap((channel) =>
        channel.channelType === "dm"
          ? channel.participantPubkeys.filter(
              (pubkey) => pubkey.toLowerCase() !== currentPubkey?.toLowerCase(),
            )
          : [],
      ),
    [channels, currentPubkey],
  );
  const dmProfilesQuery = useUsersBatchQuery(dmParticipantPubkeys, {
    enabled: dmParticipantPubkeys.length > 0,
  });
  const dmProfiles = dmProfilesQuery.data?.profiles;

  const projectByChannelId = useRoomProjects(channels, currentPubkey, relayUrl);
  const projectCatalog = useRoomProjectCatalog(
    channels,
    currentPubkey,
    relayUrl,
  );

  const labelFor = React.useCallback(
    (channel: Channel) =>
      resolveChannelDisplayLabel(channel, currentPubkey, dmProfiles),
    [currentPubkey, dmProfiles],
  );

  const groups = React.useMemo(
    () =>
      groupConversations(
        channels,
        labelFor,
        projectByChannelId,
        projectCatalog,
      ),
    [channels, labelFor, projectByChannelId, projectCatalog],
  );

  const entryCount = React.useMemo(
    () => groups.reduce((total, group) => total + group.entries.length, 0),
    [groups],
  );
  const showSearch = entryCount > SEARCH_THRESHOLD;

  const visibleGroups = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return groups;
    return groups
      .map((group) => ({
        ...group,
        entries: group.entries.filter((entry) =>
          entry.label.toLowerCase().includes(needle),
        ),
      }))
      .filter((group) => group.entries.length > 0);
  }, [groups, query]);

  const selected = React.useMemo(() => {
    for (const group of groups) {
      for (const entry of group.entries) {
        if (entry.channel.id === channelId) return entry;
      }
    }
    return null;
  }, [channelId, groups]);

  const focusSelected = React.useCallback(() => {
    if (showSearch) {
      searchRef.current?.focus();
      return;
    }
    const options = orderedOptions(visibleGroups, optionRefs.current);
    const current = channelId ? optionRefs.current.get(channelId) : undefined;
    (current ?? options[0])?.focus();
  }, [channelId, showSearch, visibleGroups]);

  const handleOpenChange = React.useCallback((next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  }, []);

  const handleSelect = React.useCallback(
    (nextChannelId: string) => {
      setOpen(false);
      setQuery("");
      if (nextChannelId !== channelId) onSelectChannel(nextChannelId);
    },
    [channelId, onSelectChannel],
  );

  // A window whose conversation has not resolved yet still has a name — the
  // native title is already set — so the face falls back rather than blanking.
  const title = selected?.label ?? "Conversation";

  return (
    <Popover onOpenChange={handleOpenChange} open={open}>
      <div className="luca-popout-picker">
        <PopoverTrigger asChild>
          <button
            aria-label={`Switch conversation from ${title}`}
            className="luca-popout-picker__button"
            data-testid="popout-conversation-picker-trigger"
            type="button"
          >
            <span className="sr-only">Switch conversation</span>
          </button>
        </PopoverTrigger>
        <div aria-hidden="true" className="luca-popout-picker__face">
          {selected ? (
            <ConversationTypeIcon
              channel={selected.channel}
              className="shrink-0"
            />
          ) : null}
          <span className="luca-popout-picker__name" data-testid="chat-title">
            {title}
          </span>
          <ChevronDown
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 transition-transform",
              open && "rotate-180",
            )}
          />
        </div>
      </div>
      <PopoverContent
        align="start"
        aria-label="Conversations"
        className="luca-project-room-picker"
        data-testid="popout-conversation-picker"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          requestAnimationFrame(focusSelected);
        }}
        role="listbox"
        sideOffset={6}
      >
        <div className="luca-project-room-picker__header">
          <span>Conversations</span>
          <span>{entryCount}</span>
        </div>
        {showSearch ? (
          <input
            aria-label="Filter conversations"
            className="luca-popout-picker__search"
            data-testid="popout-conversation-picker-search"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowDown") return;
              event.preventDefault();
              orderedOptions(visibleGroups, optionRefs.current)[0]?.focus();
            }}
            placeholder="Find a conversation"
            ref={searchRef}
            type="search"
            value={query}
          />
        ) : null}
        <div className="luca-project-room-picker__list">
          {visibleGroups.length === 0 ? (
            <p className="luca-popout-picker__empty">
              No conversation matches.
            </p>
          ) : null}
          {visibleGroups.map((group) => (
            // biome-ignore lint/a11y/useSemanticElements: `group` is the ARIA role a listbox section takes; <fieldset> is not a legal child of a listbox.
            <div
              aria-label={group.label}
              className="luca-popout-picker__group"
              key={group.id}
              role="group"
            >
              <div className="luca-popout-picker__group-label">
                {group.label}
              </div>
              {group.entries.map(({ channel, label }) => {
                const isCurrent = channel.id === channelId;
                return (
                  <button
                    aria-selected={isCurrent}
                    className="luca-project-room-picker__option"
                    data-selected={isCurrent ? "true" : undefined}
                    data-testid={`popout-conversation-picker-option-${channel.id}`}
                    key={channel.id}
                    onClick={() => handleSelect(channel.id)}
                    onKeyDown={(event) => {
                      const options = orderedOptions(
                        visibleGroups,
                        optionRefs.current,
                      );
                      if (
                        event.key === "ArrowDown" ||
                        event.key === "ArrowUp"
                      ) {
                        event.preventDefault();
                        moveOptionFocus(
                          options,
                          event.currentTarget,
                          event.key === "ArrowDown" ? 1 : -1,
                        );
                      } else if (event.key === "Home" || event.key === "End") {
                        event.preventDefault();
                        options[
                          event.key === "Home" ? 0 : options.length - 1
                        ]?.focus();
                      }
                    }}
                    ref={(node) => {
                      if (node) optionRefs.current.set(channel.id, node);
                      else optionRefs.current.delete(channel.id);
                    }}
                    role="option"
                    title={label}
                    type="button"
                  >
                    <span className="luca-project-room-picker__mark">
                      <ConversationTypeIcon channel={channel} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    <span className="luca-project-room-picker__meta">
                      {isCurrent ? (
                        <Check
                          aria-label="Current conversation"
                          className="size-3.5"
                        />
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="luca-project-room-picker__footer">
          <span>Switch conversation</span>
          <span>
            <kbd>Esc</kbd> closes
          </span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
