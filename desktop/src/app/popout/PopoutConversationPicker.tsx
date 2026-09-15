import { Check, ChevronDown } from "lucide-react";
import * as React from "react";

import {
  usePopoutConversations,
  type PopoutConversationGroup,
} from "@/app/popout/usePopoutConversations";
import { ConversationTypeIcon } from "@/features/channels/ui/ConversationTypeIcon";
import { cn } from "@/shared/lib/cn";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";

/** Above this many conversations the list stops being scannable by eye. */
const SEARCH_THRESHOLD = 8;

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
  groups: readonly PopoutConversationGroup[],
  refs: Map<string, HTMLButtonElement>,
): HTMLButtonElement[] {
  return groups
    .flatMap((group) =>
      group.entries.map((entry) => refs.get(entry.channel.id)),
    )
    .filter((node): node is HTMLButtonElement => node !== undefined);
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

  const { groups, entryCount, selected } = usePopoutConversations(channelId);
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

  /**
   * NAVIGATE FIRST, THEN CLOSE — the order is load-bearing.
   *
   * Closing first queues the popover's own state update ahead of the router's,
   * and the router's transition never commits: the URL changes and the tree
   * stays on the old conversation. The project-room picker has always done it
   * in this order; so does this one.
   */
  const handleSelect = React.useCallback(
    (nextChannelId: string) => {
      if (nextChannelId !== channelId) onSelectChannel(nextChannelId);
      setOpen(false);
      setQuery("");
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
