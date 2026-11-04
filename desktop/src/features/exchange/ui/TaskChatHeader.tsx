import { MoreHorizontal, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

/** Conversation identity first; task switching and occasional controls stay secondary. */
export function TaskChatHeader({
  title,
  taskId,
  tasks,
  sending,
  onSelect,
  onRefresh,
  onNewMessage,
  onStop,
  onLoadOlder,
  onClose,
}: {
  title: string;
  taskId?: string;
  tasks: { id: string; title: string }[];
  sending: boolean;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  onNewMessage?: () => void;
  onStop?: () => void;
  onLoadOlder?: () => void;
  onClose?: () => void;
}) {
  return (
    <header className="luca-task-chat__header shrink-0">
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-medium">{title}</h2>
        <select
          aria-label="Task"
          className="mt-1 w-full truncate bg-transparent text-xs text-muted-foreground"
          value={taskId ?? ""}
          disabled={sending}
          onChange={(event) => onSelect(event.target.value)}
        >
          {!taskId ? <option value="">Loading conversation…</option> : null}
          {tasks.map((task) => (
            <option key={task.id} value={task.id}>
              {task.title}
            </option>
          ))}
        </select>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="Conversation options">
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onRefresh}>Refresh</DropdownMenuItem>
          <DropdownMenuItem disabled={!onNewMessage} onSelect={onNewMessage}>
            New message
          </DropdownMenuItem>
          {onStop ? (
            <DropdownMenuItem onSelect={onStop}>Stop exchange</DropdownMenuItem>
          ) : null}
          {onLoadOlder ? (
            <DropdownMenuItem onSelect={onLoadOlder}>
              Load older tasks
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        aria-label="Close task conversation"
        onClick={onClose}
      >
        <X className="size-4" />
      </button>
    </header>
  );
}
