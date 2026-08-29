import { Check, ChevronDown, FolderGit2 } from "lucide-react";
import * as React from "react";

import { ConversationTypeIcon } from "@/features/channels/ui/ConversationTypeIcon";
import {
  projectRoomRelativeTime,
  type ProjectNavigatorViewModel,
} from "@/features/projects/lib/projectNavigator";
import { cn } from "@/shared/lib/cn";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";

function moveRoomFocus(
  options: readonly HTMLButtonElement[],
  current: HTMLButtonElement,
  direction: -1 | 1,
) {
  const index = options.indexOf(current);
  const nextIndex =
    index < 0 ? 0 : (index + direction + options.length) % options.length;
  options[nextIndex]?.focus();
}

export function ProjectRoomPicker({
  onSelectRoom,
  viewModel,
}: {
  onSelectRoom: (channelId: string) => void;
  viewModel: ProjectNavigatorViewModel;
}) {
  const [open, setOpen] = React.useState(false);
  const optionRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const selectedRoom =
    viewModel.rooms.find(
      ({ channel }) => channel.id === viewModel.selectedRoomId,
    ) ?? viewModel.rooms[0];

  const focusSelectedRoom = React.useCallback(() => {
    const selectedId = selectedRoom?.channel.id;
    const fallback = optionRefs.current.values().next().value;
    (selectedId ? optionRefs.current.get(selectedId) : fallback)?.focus();
  }, [selectedRoom]);

  if (!selectedRoom) return null;

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <div className="luca-project-room-picker-control">
        <PopoverTrigger asChild>
          <button
            aria-label={`Switch room from ${selectedRoom.channel.name} in ${viewModel.label}`}
            className="luca-project-room-picker-trigger__button"
            data-workspace-pane-local-control
            data-testid="project-room-picker-trigger"
            type="button"
          >
            <span className="sr-only">Switch project room</span>
          </button>
        </PopoverTrigger>
        <div className="luca-project-room-picker-trigger" aria-hidden="true">
          <FolderGit2 aria-hidden className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            <h1 data-testid="chat-title">{selectedRoom.channel.name}</h1>
            <span data-testid="chat-subtitle">
              {viewModel.label} · project room
            </span>
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
        aria-label={`${viewModel.label} rooms`}
        className="luca-project-room-picker"
        data-testid="project-room-picker"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          requestAnimationFrame(focusSelectedRoom);
        }}
        role="listbox"
        sideOffset={6}
      >
        <div className="luca-project-room-picker__header">
          <span>{viewModel.label}</span>
          <span>
            {viewModel.rooms.length}{" "}
            {viewModel.rooms.length === 1 ? "room" : "rooms"}
          </span>
        </div>
        <div className="luca-project-room-picker__list">
          {viewModel.rooms.map(({ channel, preview }) => {
            const selected = channel.id === viewModel.selectedRoomId;
            return (
              <button
                aria-selected={selected}
                className="luca-project-room-picker__option"
                data-selected={selected ? "true" : undefined}
                data-testid={`project-room-picker-option-${channel.id}`}
                key={channel.id}
                onClick={() => {
                  onSelectRoom(channel.id);
                  setOpen(false);
                }}
                onKeyDown={(event) => {
                  const options = [...optionRefs.current.values()];
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    moveRoomFocus(
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
                title={preview || channel.name}
                type="button"
              >
                <span className="luca-project-room-picker__mark">
                  <ConversationTypeIcon channel={channel} />
                </span>
                <span className="min-w-0 flex-1 truncate">{channel.name}</span>
                <span className="luca-project-room-picker__meta">
                  {selected ? (
                    <Check aria-label="Current room" className="size-3.5" />
                  ) : (
                    projectRoomRelativeTime(channel.lastMessageAt)
                  )}
                </span>
              </button>
            );
          })}
        </div>
        <div className="luca-project-room-picker__footer">
          <span>Switch room</span>
          <span>
            <kbd>Esc</kbd> closes
          </span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
