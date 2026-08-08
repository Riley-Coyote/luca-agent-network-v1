import type { Editor } from "@tiptap/react";
import {
  ALargeSmall,
  ArrowUp,
  AtSign,
  Mic,
  Paperclip,
  Plus,
} from "lucide-react";
import * as React from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Button } from "@/shared/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { ComposerEmojiPicker } from "./ComposerEmojiPicker";
import { FormattingToolbar } from "./FormattingToolbar";
import { SelectionFormattingTray } from "./SelectionFormattingTray";

export const MessageComposerToolbar = React.memo(
  function MessageComposerToolbar({
    children,
    composerDisabled,
    editor,
    extraActions,
    formattingDisabled,
    isEmojiPickerOpen,
    isFormattingOpen,
    isSending,
    isUploading,
    onCaptureSelection,
    onEmojiPickerOpenChange,
    onEmojiSelect,
    onFormattingToggle,
    onLinkButton,
    onOpenMentionPicker,
    onPaperclip,
    sendDisabled,
  }: {
    children?: React.ReactNode;
    composerDisabled: boolean;
    editor: Editor | null;
    extraActions?: React.ReactNode;
    formattingDisabled: boolean;
    isEmojiPickerOpen: boolean;
    isFormattingOpen: boolean;
    isSending: boolean;
    isUploading: boolean;
    onCaptureSelection: () => void;
    onEmojiPickerOpenChange: (open: boolean) => void;
    onEmojiSelect: (emoji: string) => void;
    onFormattingToggle: (pressed: boolean) => void;
    onLinkButton: () => void;
    onOpenMentionPicker: () => void;
    onPaperclip: () => void;
    sendDisabled: boolean;
  }) {
    return (
      <div
        className="flex min-w-0 shrink-0 items-center gap-0.5"
        data-testid="message-composer-toolbar"
      >
        <SelectionFormattingTray
          disabled={formattingDisabled}
          editor={editor}
          onLinkButton={onLinkButton}
        />

        {isFormattingOpen ? (
          <div className="mr-1 flex max-w-72 items-center gap-1 overflow-x-auto">
            <Button
              aria-label="Close formatting"
              aria-pressed="true"
              className="size-8 shrink-0"
              disabled={composerDisabled}
              onClick={() => onFormattingToggle(false)}
              onMouseDown={onCaptureSelection}
              size="icon"
              type="button"
              variant="secondary"
            >
              <ALargeSmall />
            </Button>
            <FormattingToolbar
              disabled={formattingDisabled}
              editor={editor}
              onLinkButton={onLinkButton}
            />
          </div>
        ) : (
          <>
            <DropdownMenu modal={false}>
              <Tooltip disableHoverableContent>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      aria-label="Add to message"
                      className="size-8 rounded-full"
                      data-testid="message-composer-add"
                      disabled={composerDisabled}
                      onMouseDown={onCaptureSelection}
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
                  disabled={composerDisabled || isUploading}
                  onSelect={onPaperclip}
                >
                  <Paperclip />
                  Attach files
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onFormattingToggle(true)}>
                  <ALargeSmall />
                  Formatting
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <ComposerEmojiPicker
              disabled={composerDisabled}
              onClose={() => editor?.commands.focus()}
              onEmojiSelect={onEmojiSelect}
              onOpenChange={onEmojiPickerOpenChange}
              onTriggerMouseDown={onCaptureSelection}
              open={isEmojiPickerOpen}
            />
          </>
        )}

        {children}
        {extraActions}

        <Tooltip disableHoverableContent>
          <TooltipTrigger asChild>
            <span className="inline-grid">
              <Button
                aria-label="Voice input is not available in this build"
                className="size-8 rounded-full"
                disabled
                size="icon"
                type="button"
                variant="ghost"
              >
                <Mic />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>Voice input is coming later</TooltipContent>
        </Tooltip>

        <Button
          aria-label={isSending ? "Sending" : "Send message"}
          className="ml-1 size-7 rounded-full border border-border/70 bg-secondary p-0 text-secondary-foreground shadow-none hover:bg-accent"
          data-testid="send-message"
          disabled={sendDisabled || isSending}
          size="icon"
          type="submit"
        >
          {isSending ? (
            <span
              aria-hidden
              className="size-3.5 animate-spin rounded-full border border-current border-t-transparent"
            />
          ) : (
            <ArrowUp aria-hidden className="size-3.5" />
          )}
        </Button>
      </div>
    );
  },
);
