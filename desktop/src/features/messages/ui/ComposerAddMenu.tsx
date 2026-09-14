import {
  ALargeSmall,
  AtSign,
  FolderPlus,
  Paperclip,
  Plus,
  Sparkles,
  SquareArrowOutUpRight,
} from "lucide-react";
import type * as React from "react";

import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

export function ComposerAddMenu({
  buttonRef,
  disabled,
  isUploading,
  onCaptureSelection,
  onFormattingToggle,
  onOpenCapabilities,
  onOpenContext,
  onOpenMentionPicker,
  onPaperclip,
  onRunTask,
}: {
  buttonRef?: React.Ref<HTMLButtonElement>;
  disabled: boolean;
  isUploading: boolean;
  onCaptureSelection: () => void;
  onFormattingToggle: (pressed: boolean) => void;
  onOpenCapabilities?: () => void;
  onOpenContext?: () => void;
  onOpenMentionPicker: () => void;
  onPaperclip: () => void;
  onRunTask?: () => void;
}) {
  return (
    <DropdownMenu modal={false}>
      <Tooltip disableHoverableContent>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label="Add to message"
              className="size-8 shrink-0 rounded-full"
              data-testid="message-composer-add"
              disabled={disabled}
              onMouseDown={onCaptureSelection}
              ref={buttonRef}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Plus />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Add to message</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" side="top" sideOffset={10}>
        <DropdownMenuItem onSelect={onOpenMentionPicker}>
          <AtSign />
          Mention someone
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={disabled || isUploading}
          onSelect={onPaperclip}
        >
          <Paperclip />
          Attach files
        </DropdownMenuItem>
        {onOpenCapabilities ? (
          <DropdownMenuItem onSelect={onOpenCapabilities}>
            <Sparkles />
            Skills and tools
          </DropdownMenuItem>
        ) : null}
        {onRunTask ? (
          <DropdownMenuItem onSelect={onRunTask}>
            <SquareArrowOutUpRight />
            Run task
          </DropdownMenuItem>
        ) : null}
        {onOpenContext ? (
          <DropdownMenuItem onSelect={onOpenContext}>
            <FolderPlus />
            Add context
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => onFormattingToggle(true)}>
          <ALargeSmall />
          Formatting
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
