import { Search } from "lucide-react";
import * as React from "react";

import { resolveUserLabel } from "@/features/profile/lib/identity";
import {
  MIN_SEARCH_QUERY_LENGTH,
  useSearchResults,
} from "@/features/search/useSearchResults";
import {
  resultIcon,
  resultKey,
  resultTestId,
  type SearchResult,
} from "@/features/search/ui/SearchResultItem";
import { SearchPromptPlaceholder } from "@/features/search/ui/SearchPromptPlaceholder";
import type { Channel, SearchHit, UserSearchResult } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { isIdentityKeyLabel } from "@/features/profile/lib/identity";
import { Dialog, DialogContent, DialogTitle } from "@/shared/ui/dialog";
import { useDeferredModalOpen } from "@/shared/ui/deferredModalOpen";
import {
  MENTION_CHIP_BASE_CLASSES,
  MESSAGE_MARKDOWN_CLASS,
} from "@/shared/ui/mentionChip";
import { Skeleton } from "@/shared/ui/skeleton";
import { UserAvatar } from "@/shared/ui/UserAvatar";

type TopbarSearchProps = {
  channelLabels?: Record<string, string>;
  channels: Channel[];
  className?: string;
  currentPubkey?: string;
  focusRequest?: number;
  onOpenChannel: (channelId: string) => void;
  onOpenResult: (hit: SearchHit) => void;
  onOpenUser?: (user: UserSearchResult) => void | Promise<void>;
  onBrowseChannels?: () => void | Promise<void>;
  onCreateAgent?: () => void | Promise<void>;
  onCreateChannel?: () => void | Promise<void>;
  suggestionChannels?: Channel[];
  variant?: "bar" | "icon";
};

const MAX_SEARCH_SUGGESTIONS = 4;
const SEARCH_SECTION_TITLE_CLASS =
  "px-3 pb-1.5 pt-2 text-xs font-medium text-ink-faint";
const SEARCH_RESULT_SECTION_ORDER = [
  "channels",
  "direct-messages",
  "people",
  "agents",
  "messages",
  "actions",
] as const;

type SearchResultSectionKey = (typeof SEARCH_RESULT_SECTION_ORDER)[number];

type SearchResultSection = {
  key: SearchResultSectionKey;
  results: SearchResult[];
  title: string;
};

type SearchHitContextLabel = {
  channelLabel: string | null;
  text: string;
};

function truncateResultText(content: string, maxLength = 96) {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return "No message body.";
  }

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength - 3).trimEnd()}...`;
}

function formatRelativeTime(unixSeconds: number) {
  const diff = Math.floor(Date.now() / 1_000) - unixSeconds;

  if (diff < 60) {
    return "just now";
  }

  if (diff < 60 * 60) {
    return `${Math.floor(diff / 60)}m ago`;
  }

  if (diff < 60 * 60 * 24) {
    return `${Math.floor(diff / (60 * 60))}h ago`;
  }

  if (diff < 60 * 60 * 24 * 7) {
    return `${Math.floor(diff / (60 * 60 * 24))}d ago`;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(unixSeconds * 1_000));
}

function getChannelActivityTime(channel: Channel) {
  if (!channel.lastMessageAt) {
    return 0;
  }

  const timestamp = Date.parse(channel.lastMessageAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getChannelSuggestionMeta(channel: Channel) {
  const activityTime = getChannelActivityTime(channel);

  if (activityTime > 0) {
    return formatRelativeTime(Math.floor(activityTime / 1_000));
  }

  return null;
}

function getChannelDisplayName(
  channel: Channel,
  channelLabels?: Record<string, string>,
) {
  return channelLabels?.[channel.id]?.trim() || channel.name;
}

function getChannelPreview(channel: Channel) {
  if (channel.channelType === "dm") {
    return "";
  }

  if (channel.description.trim()) {
    return channel.description;
  }

  return "";
}

function getUserDisplayName(user: UserSearchResult) {
  const displayName = user.displayName?.trim();
  const nip05Handle = user.nip05Handle?.trim();
  if (displayName && !isIdentityKeyLabel(displayName, user.pubkey)) {
    return displayName;
  }
  if (nip05Handle && !isIdentityKeyLabel(nip05Handle, user.pubkey)) {
    return nip05Handle;
  }
  return user.isAgent ? "Agent" : "Person";
}

function getUserSecondaryLabel(user: UserSearchResult) {
  const displayName = user.displayName?.trim();
  const nip05Handle = user.nip05Handle?.trim();

  if (nip05Handle && nip05Handle !== displayName) {
    return nip05Handle;
  }

  return null;
}

function getSearchHitChannelName(
  hit: SearchHit,
  channelLookup: ReadonlyMap<string, Channel>,
  channelLabels?: Record<string, string>,
) {
  const channel = hit.channelId ? channelLookup.get(hit.channelId) : null;
  const channelName =
    (hit.channelId ? channelLabels?.[hit.channelId]?.trim() : null) ||
    hit.channelName?.trim() ||
    channel?.name.trim() ||
    null;

  if (!channelName) {
    return null;
  }

  return channelName;
}

function getSearchHitContextLabel(
  hit: SearchHit,
  channelLookup: ReadonlyMap<string, Channel>,
  channelLabels?: Record<string, string>,
): SearchHitContextLabel {
  const channel = hit.channelId ? channelLookup.get(hit.channelId) : null;
  const channelName = getSearchHitChannelName(
    hit,
    channelLookup,
    channelLabels,
  );

  if (channel?.channelType === "dm") {
    return {
      channelLabel: null,
      text: "Direct message",
    };
  }

  const isThread = hit.kind === 45003 || Boolean(hit.threadRootId);

  return {
    channelLabel: channelName,
    text: channelName
      ? `${isThread ? "Thread" : "Message"} in`
      : isThread
        ? "Thread"
        : "Message",
  };
}

function getResultSectionKey(result: SearchResult): SearchResultSectionKey {
  if (result.kind === "channel") {
    return result.channel.channelType === "dm" ? "direct-messages" : "channels";
  }

  if (result.kind === "user") {
    return result.user.isAgent ? "agents" : "people";
  }

  if (result.kind === "action") {
    return "actions";
  }

  return "messages";
}

function getSectionTitle(sectionKey: SearchResultSectionKey) {
  switch (sectionKey) {
    case "channels":
      return "Channels";
    case "direct-messages":
      return "Direct messages";
    case "people":
      return "People";
    case "agents":
      return "Agents";
    case "messages":
      return "Most relevant";
    case "actions":
      return "Actions";
  }
}

function SearchHitContextLine({ label }: { label: SearchHitContextLabel }) {
  return (
    <span
      className={cn(
        MESSAGE_MARKDOWN_CLASS,
        "mt-0 flex min-w-0 items-center gap-1.5 text-2xs font-medium leading-3 text-ink-faint",
      )}
    >
      <span className="shrink-0">{label.text}</span>
      {label.channelLabel ? (
        <span
          className={cn(
            MENTION_CHIP_BASE_CLASSES,
            "search-channel-chip min-w-0 max-w-full overflow-hidden",
          )}
          data-channel-link=""
        >
          <span className="truncate">#{label.channelLabel}</span>
        </span>
      ) : null}
    </span>
  );
}

function groupSearchResults(results: SearchResult[]): SearchResultSection[] {
  const resultsBySection = new Map<SearchResultSectionKey, SearchResult[]>();

  for (const result of results) {
    const sectionKey = getResultSectionKey(result);
    const sectionResults = resultsBySection.get(sectionKey) ?? [];
    sectionResults.push(result);
    resultsBySection.set(sectionKey, sectionResults);
  }

  return SEARCH_RESULT_SECTION_ORDER.flatMap((sectionKey) => {
    const sectionResults = resultsBySection.get(sectionKey);

    if (!sectionResults || sectionResults.length === 0) {
      return [];
    }

    return [
      {
        key: sectionKey,
        results: sectionResults,
        title: getSectionTitle(sectionKey),
      },
    ];
  });
}

function getSuggestedSearchResults(channels: Channel[]) {
  return channels
    .filter(
      (channel) =>
        !channel.archivedAt &&
        (channel.isMember || channel.channelType === "dm"),
    )
    .sort((a, b) => {
      const activityDiff =
        getChannelActivityTime(b) - getChannelActivityTime(a);
      if (activityDiff !== 0) {
        return activityDiff;
      }

      const typeRank = (channel: Channel) =>
        channel.channelType === "dm"
          ? 0
          : channel.channelType === "stream"
            ? 1
            : 2;
      const rankDiff = typeRank(a) - typeRank(b);
      if (rankDiff !== 0) {
        return rankDiff;
      }

      return a.name.localeCompare(b.name);
    })
    .slice(0, MAX_SEARCH_SUGGESTIONS)
    .map((channel) => ({
      kind: "channel" as const,
      channel,
    }));
}

const searchSkeletonRows = [
  {
    iconShape: "rounded-md",
    key: "channel",
    metaWidth: "w-16",
    previewWidth: "w-48",
    titleWidth: "w-28",
    trailingWidth: "w-14",
  },
  {
    iconShape: "rounded-full",
    key: "message",
    metaWidth: "w-24",
    previewWidth: "w-72",
    titleWidth: "w-24",
    trailingWidth: "w-20",
  },
  {
    iconShape: "rounded-full",
    key: "note",
    metaWidth: "w-20",
    previewWidth: "w-60",
    titleWidth: "w-32",
    trailingWidth: "w-16",
  },
] as const;

function SearchResultsSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="max-h-[360px] overflow-y-auto p-1"
      data-testid="search-results-loading"
    >
      {searchSkeletonRows.map((row) => (
        <div
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2"
          key={row.key}
        >
          <Skeleton className={cn("h-7 w-7 shrink-0", row.iconShape)} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <Skeleton className={cn("h-4", row.titleWidth)} />
              <Skeleton className={cn("h-3", row.metaWidth)} />
            </div>
            <Skeleton
              className={cn("mt-1.5 h-3 max-w-full", row.previewWidth)}
            />
          </div>
          <Skeleton className={cn("h-3 shrink-0", row.trailingWidth)} />
        </div>
      ))}
    </div>
  );
}

export function TopbarSearch({
  channelLabels,
  channels,
  className,
  currentPubkey,
  focusRequest = 0,
  onOpenChannel,
  onOpenResult,
  onOpenUser,
  onBrowseChannels,
  onCreateAgent,
  onCreateChannel,
  suggestionChannels,
  variant = "bar",
}: TopbarSearchProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [selectedMenuIndex, setSelectedMenuIndex] = React.useState(0);
  // Opening a person or an agent is the one result kind that has to travel to
  // the relay before it has anywhere to go, so it is the one kind that can be
  // slow and the one kind that can fail. Both states are held here.
  const [openingResultKey, setOpeningResultKey] = React.useState<string | null>(
    null,
  );
  const [openFailure, setOpenFailure] = React.useState<{
    name: string;
    result: SearchResult;
  } | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const dialogInputRef = React.useRef<HTMLInputElement>(null);
  const { cancelDeferredModalOpen, openAfterExit, openNextFrame } =
    useDeferredModalOpen();
  const {
    channelLookup,
    debouncedQuery,
    query,
    resultProfiles,
    results,
    searchQuery,
    setQuery,
    userSearchQuery,
  } = useSearchResults({ channelLabels, channels, enabled: isOpen, limit: 8 });
  const trimmedQuery = query.trim();
  const isIconVariant = variant === "icon";
  const currentPubkeyNormalized = currentPubkey
    ? normalizePubkey(currentPubkey)
    : null;
  const suggestedResults = React.useMemo(
    () => getSuggestedSearchResults(suggestionChannels ?? channels),
    [channels, suggestionChannels],
  );
  const suggestionActionResults = React.useMemo(() => {
    const actions: SearchResult[] = [];

    if (onBrowseChannels) {
      actions.push({
        kind: "action",
        action: {
          id: "browse-channels",
          title: "Browse channels",
        },
      });
    }

    if (onCreateChannel) {
      actions.push({
        kind: "action",
        action: {
          id: "create-channel",
          title: "Create a new channel",
        },
      });
    }

    if (onCreateAgent) {
      actions.push({
        kind: "action",
        action: {
          id: "create-agent",
          title: "Create a new agent",
        },
      });
    }

    return actions;
  }, [onBrowseChannels, onCreateAgent, onCreateChannel]);
  const suggestionResults = React.useMemo(
    () => [...suggestedResults, ...suggestionActionResults],
    [suggestedResults, suggestionActionResults],
  );
  const isShowingSuggestions =
    debouncedQuery.length < MIN_SEARCH_QUERY_LENGTH &&
    trimmedQuery.length < MIN_SEARCH_QUERY_LENGTH;
  // A result that leads nowhere is worse than no result: without an
  // `onOpenUser` handler a person or agent row would highlight, accept Return,
  // and do nothing. Drop the whole kind rather than ship the dead end.
  const canOpenUsers = Boolean(onOpenUser);
  const searchableResults = React.useMemo(
    () =>
      results.filter((result) => {
        if (result.kind !== "user") {
          return true;
        }
        return (
          canOpenUsers &&
          normalizePubkey(result.user.pubkey) !== currentPubkeyNormalized
        );
      }),
    [canOpenUsers, currentPubkeyNormalized, results],
  );
  const searchResultSections = React.useMemo(
    () => groupSearchResults(searchableResults),
    [searchableResults],
  );
  const groupedSearchResults = React.useMemo(
    () => searchResultSections.flatMap((section) => section.results),
    [searchResultSections],
  );
  const activeResults = isShowingSuggestions
    ? suggestionResults
    : groupedSearchResults;
  const isSearchLoading = searchQuery.isLoading || userSearchQuery.isLoading;

  const openSearchDialog = React.useCallback(() => {
    setSelectedMenuIndex(0);
    openNextFrame(() => setIsOpen(true));
  }, [openNextFrame]);

  const handleSearchOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        openSearchDialog();
        return;
      }

      cancelDeferredModalOpen();
      setSelectedMenuIndex(0);
      setOpenFailure(null);
      setOpeningResultKey(null);
      setIsOpen(false);
    },
    [cancelDeferredModalOpen, openSearchDialog],
  );

  // Every other kind resolves to a route the app already holds, so the palette
  // can close on the keystroke. A user resolves to a conversation that may not
  // exist yet — the relay is asked to open or create it. Closing first is what
  // turned a failed open into "Return did nothing": the dialog vanished, the
  // rejection was swallowed, and the app stayed exactly where it was. So this
  // one kind holds the palette open until the conversation is real, and says
  // so plainly when it is not.
  const openUserResult = React.useCallback(
    async (result: SearchResult & { kind: "user" }) => {
      if (!onOpenUser) {
        return;
      }

      setOpenFailure(null);
      setOpeningResultKey(resultKey(result));

      try {
        await onOpenUser(result.user);
        setOpeningResultKey(null);
        setIsOpen(false);
        setQuery("");
      } catch {
        // The underlying error is a relay string ("relay returned 404 …") and
        // has no business in front of the owner. What they can act on is the
        // name they picked and the fact that it can be tried again.
        setOpeningResultKey(null);
        setOpenFailure({ name: getUserDisplayName(result.user), result });
      }
    },
    [onOpenUser, setQuery],
  );

  const openResult = React.useCallback(
    (result: SearchResult) => {
      if (result.kind === "user") {
        void openUserResult(result);
        return;
      }

      setIsOpen(false);
      setQuery("");
      setOpenFailure(null);
      setOpeningResultKey(null);

      if (result.kind === "channel") {
        onOpenChannel(result.channel.id);
        return;
      }

      if (result.kind === "action") {
        setSelectedMenuIndex(0);
        if (result.action.id === "browse-channels") {
          openAfterExit(() => {
            void onBrowseChannels?.();
          });
        } else if (result.action.id === "create-channel") {
          openAfterExit(() => {
            void onCreateChannel?.();
          });
        } else {
          openAfterExit(() => {
            void onCreateAgent?.();
          });
        }
        return;
      }

      onOpenResult(result.hit);
    },
    [
      onBrowseChannels,
      onCreateAgent,
      onCreateChannel,
      onOpenChannel,
      onOpenResult,
      openAfterExit,
      openUserResult,
      setQuery,
    ],
  );

  // Edge-trigger: the counter never resets, so `!== 0` would replay on remount.
  const lastFocusRequestRef = React.useRef(focusRequest);
  React.useEffect(() => {
    if (focusRequest === lastFocusRequestRef.current) {
      return;
    }
    lastFocusRequestRef.current = focusRequest;

    openSearchDialog();
  }, [focusRequest, openSearchDialog]);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      dialogInputRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [isOpen]);

  React.useEffect(() => {
    setSelectedMenuIndex((current) => {
      if (activeResults.length === 0) {
        return 0;
      }

      return Math.min(current, activeResults.length - 1);
    });
  }, [activeResults]);

  const handleDialogInputKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown" && activeResults.length > 0) {
        event.preventDefault();
        setSelectedMenuIndex((current) =>
          Math.min(current + 1, activeResults.length - 1),
        );
        return;
      }

      if (event.key === "ArrowUp" && activeResults.length > 0) {
        event.preventDefault();
        setSelectedMenuIndex((current) => Math.max(current - 1, 0));
        return;
      }

      if (event.key === "Enter" && !event.nativeEvent.isComposing) {
        event.preventDefault();
        // One open at a time: Return is held down easily, and a second
        // in-flight request would race the first for the destination.
        if (openingResultKey !== null) {
          return;
        }
        const result = activeResults[selectedMenuIndex];
        if (result) {
          openResult(result);
        }
      }
    },
    [activeResults, openResult, openingResultKey, selectedMenuIndex],
  );

  const renderSearchResultRow = (result: SearchResult, index: number) => {
    const channelDisplayName =
      result.kind === "channel"
        ? getChannelDisplayName(result.channel, channelLabels)
        : null;
    const userDisplayName =
      result.kind === "user" ? getUserDisplayName(result.user) : null;
    const messageAuthorLabel =
      result.kind === "message"
        ? resolveUserLabel({
            currentPubkey,
            profiles: resultProfiles,
            pubkey: result.hit.pubkey,
            preferResolvedSelfLabel: true,
          })
        : null;
    const messageContextLabel =
      result.kind === "message"
        ? getSearchHitContextLabel(result.hit, channelLookup, channelLabels)
        : null;
    const title =
      result.kind === "channel"
        ? channelDisplayName
        : result.kind === "action"
          ? result.action.title
          : result.kind === "user"
            ? userDisplayName
            : messageAuthorLabel;
    const preview =
      result.kind === "channel"
        ? getChannelPreview(result.channel)
        : result.kind === "action"
          ? result.action.description
          : result.kind === "user"
            ? getUserSecondaryLabel(result.user)
            : truncateResultText(result.hit.content);
    const isOpening = openingResultKey === resultKey(result);
    const trailingLabel = isOpening
      ? "Opening"
      : result.kind === "channel"
        ? getChannelSuggestionMeta(result.channel)
        : result.kind === "message"
          ? formatRelativeTime(result.hit.createdAt)
          : null;

    return (
      <button
        aria-busy={isOpening || undefined}
        aria-selected={index === selectedMenuIndex}
        className={cn(
          "search-result-row flex w-full gap-3 rounded-lg px-3 text-left transition-colors",
          result.kind === "message" ? "items-start" : "items-center",
          result.kind === "message" ? "py-3.5" : "py-2.5",
          index === selectedMenuIndex
            ? "bg-muted/45 text-foreground"
            : "hover:bg-muted/35",
        )}
        disabled={openingResultKey !== null && !isOpening}
        key={resultKey(result)}
        onClick={() => openResult(result)}
        onMouseEnter={() => setSelectedMenuIndex(index)}
        role="option"
        type="button"
        data-testid={resultTestId(result)}
      >
        {result.kind === "message" ? (
          <UserAvatar
            avatarUrl={
              resultProfiles?.[result.hit.pubkey.toLowerCase()]?.avatarUrl ??
              null
            }
            className="h-8 w-8"
            displayName={resolveUserLabel({
              currentPubkey,
              profiles: resultProfiles,
              pubkey: result.hit.pubkey,
              preferResolvedSelfLabel: true,
            })}
            size="md"
          />
        ) : result.kind === "user" ? (
          <UserAvatar
            avatarUrl={result.user.avatarUrl}
            className="h-7 w-7"
            displayName={userDisplayName ?? "Person"}
            size="sm"
          />
        ) : (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-background/70 text-muted-foreground">
            {React.createElement(resultIcon(result, channelLookup), {
              className: "h-4 w-4",
            })}
          </span>
        )}
        <span className="min-w-0 flex-1">
          {result.kind === "message" ? (
            <span className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3">
              <span className="col-start-1 row-start-1 min-w-0 truncate text-sm font-semibold leading-4 text-foreground">
                {title}
              </span>
              {trailingLabel ? (
                <span className="col-start-2 row-start-1 flex shrink-0 items-center justify-self-end text-xs font-medium leading-4 text-ink-faint">
                  {trailingLabel}
                </span>
              ) : null}
              {messageContextLabel ? (
                <span className="col-start-1 min-w-0">
                  <SearchHitContextLine label={messageContextLabel} />
                </span>
              ) : null}
              {preview ? (
                <span className="col-start-1 mt-1.5 block min-w-0 truncate text-sm leading-5 text-muted-foreground">
                  {preview}
                </span>
              ) : null}
            </span>
          ) : (
            <span className="block space-y-0.5">
              <span className="block truncate text-sm font-semibold">
                {title}
              </span>
              {preview ? (
                <span className="block truncate text-xs text-muted-foreground">
                  {preview}
                </span>
              ) : null}
            </span>
          )}
        </span>
        {result.kind !== "message" && trailingLabel ? (
          <span className="shrink-0 text-2xs text-ink-faint">
            {trailingLabel}
          </span>
        ) : null}
      </button>
    );
  };

  const renderSearchResultSections = (sections: SearchResultSection[]) => {
    let resultIndex = 0;

    return sections.map((section) => (
      <div key={section.key}>
        <div className={SEARCH_SECTION_TITLE_CLASS}>{section.title}</div>
        {section.results.map((result) =>
          renderSearchResultRow(result, resultIndex++),
        )}
      </div>
    ));
  };

  const searchResultContent = isShowingSuggestions ? (
    suggestionResults.length === 0 ? (
      <div className="px-4 py-5 text-sm text-muted-foreground">
        <p>No recent activity yet.</p>
      </div>
    ) : (
      <div
        aria-label="Recent activity"
        className="max-h-96 overflow-y-auto p-1.5"
        role="listbox"
      >
        {(() => {
          let resultIndex = 0;

          return (
            <>
              {suggestedResults.length > 0 ? (
                <div>
                  <div className={SEARCH_SECTION_TITLE_CLASS}>
                    Recent activity
                  </div>
                  {suggestedResults.map((result) =>
                    renderSearchResultRow(result, resultIndex++),
                  )}
                </div>
              ) : null}
              {suggestionActionResults.length > 0 ? (
                <div>
                  <div className={SEARCH_SECTION_TITLE_CLASS}>Actions</div>
                  {suggestionActionResults.map((result) =>
                    renderSearchResultRow(result, resultIndex++),
                  )}
                </div>
              ) : null}
            </>
          );
        })()}
      </div>
    )
  ) : isSearchLoading && searchableResults.length === 0 ? (
    <SearchResultsSkeleton />
  ) : searchQuery.error instanceof Error && searchableResults.length === 0 ? (
    // The thrown message is a relay string with an HTTP status in it. What the
    // owner can act on is that search is the part that is down, not the app.
    <p className="px-4 py-5 text-sm text-ink-muted">
      Search isn&rsquo;t reachable right now. Your conversations are still in
      the sidebar.
    </p>
  ) : searchableResults.length === 0 ? (
    <p className="px-4 py-5 text-sm text-muted-foreground">
      No matches for <span className="font-semibold">{trimmedQuery}</span>.
    </p>
  ) : (
    <div className="max-h-96 overflow-y-auto p-1.5" role="listbox">
      {renderSearchResultSections(searchResultSections)}
    </div>
  );

  return (
    <div className={cn("relative", className)}>
      <Dialog open={isOpen} onOpenChange={handleSearchOpenChange}>
        <button
          aria-label="Search everything"
          className={
            isIconVariant
              ? "group/search flex size-6 items-center justify-center rounded p-1 text-ink-faint transition-colors hover:bg-sidebar-border/35 hover:text-sidebar-foreground focus-visible:bg-sidebar-border/35 focus-visible:text-sidebar-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              : "group/search flex h-8 w-full items-center gap-2 rounded-md bg-sidebar-border/35 px-2 text-left text-sm text-ink-faint transition-colors duration-150 ease-out hover:bg-sidebar-border/35 hover:text-sidebar-foreground focus-visible:bg-sidebar-border/35 focus-visible:text-sidebar-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-sidebar-ring"
          }
          data-testid="open-search"
          onClick={openSearchDialog}
          ref={triggerRef}
          title="Search everything"
          type="button"
        >
          <Search
            className={
              isIconVariant
                ? "h-4 w-4 shrink-0"
                : "h-4 w-4 shrink-0 text-ink-faint transition-colors duration-150 ease-out group-hover/search:text-ink-muted group-focus-visible/search:text-sidebar-foreground"
            }
          />
          {isIconVariant ? null : (
            <>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate transition-colors duration-150 ease-out",
                  query ? "text-sidebar-foreground" : "text-ink-faint",
                )}
              >
                {query || "Search everything"}
              </span>
              <kbd className="shrink-0 text-2xs text-ink-faint">&#x2318;K</kbd>
            </>
          )}
        </button>
        <DialogContent
          aria-busy={isSearchLoading && searchableResults.length === 0}
          className="mt-[18vh] max-w-2xl self-start gap-0 overflow-hidden rounded-2xl p-0 shadow-2xl"
          data-testid="search-results"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            dialogInputRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            triggerRef.current?.focus();
          }}
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">Search everything</DialogTitle>
          <div className="flex h-12 items-center gap-3 border-b border-border/70 px-4">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="relative min-w-0 flex-1">
              {query.length === 0 ? (
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center text-base leading-none">
                  <SearchPromptPlaceholder />
                </span>
              ) : null}
              <input
                aria-label="Search everything"
                autoCapitalize="none"
                autoCorrect="off"
                className="relative z-10 w-full min-w-0 bg-transparent text-base text-foreground outline-none"
                data-testid="search-dialog-input"
                ref={dialogInputRef}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelectedMenuIndex(0);
                  // The notice names a result the new query may not contain.
                  setOpenFailure(null);
                }}
                onKeyDown={handleDialogInputKeyDown}
                spellCheck={false}
                value={query}
              />
            </div>
            <kbd className="shrink-0 rounded border border-border/70 bg-muted/70 px-1.5 py-0.5 text-2xs text-muted-foreground">
              ESC
            </kbd>
          </div>
          {searchResultContent}
          {openFailure ? (
            /* Contained, quiet, and self-clearing: the notice sits on the
             * dialog's own hairline instead of shouting in red, names the
             * thing that failed, and keeps the one action worth offering. */
            <div
              className="flex items-center gap-3 border-t border-border/70 px-4 py-3 text-sm"
              data-testid="search-open-failure"
              role="status"
            >
              <span className="min-w-0 flex-1 text-ink-muted">
                Couldn&rsquo;t open the conversation with{" "}
                <span className="text-foreground">{openFailure.name}</span>
                {". "}
                Check your connection.
              </span>
              <button
                className="shrink-0 rounded-md border border-transparent px-2 py-1 text-ink-muted transition-colors hover:text-foreground focus-visible:border-ring focus-visible:text-foreground focus-visible:outline-hidden"
                data-testid="search-open-failure-retry"
                onClick={() => openResult(openFailure.result)}
                type="button"
              >
                Retry
              </button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
