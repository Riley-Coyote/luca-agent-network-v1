import type { Editor } from "@tiptap/react";
import {
  ALargeSmall,
  ArrowUp,
  AtSign,
  FolderPlus,
  Mic,
  Paperclip,
  Plus,
  Square,
  X,
} from "lucide-react";
import * as React from "react";

import {
  type AudioAttachmentRecorderStatus,
  formatAudioRecordingElapsed,
} from "@/features/messages/lib/useAudioAttachmentRecorder";

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
    isSending = false,
    sendDisabled,
    audioRecordingElapsedSeconds = 0,
    audioRecordingStatus = "idle",
    composerDisabled,
    editor,
    extraActions,
    formattingDisabled,
    isEmojiPickerOpen,
    isFormattingOpen,
    isUploading,
    onCaptureSelection,
    onAudioRecordCancel,
    onAudioRecordStart,
    onAudioRecordStop,
    onEmojiPickerOpenChange,
    onEmojiSelect,
    onFormattingToggle,
    onLinkButton,
    onOpenContext,
    onOpenMentionPicker,
    onPaperclip,
  }: {
    /**
     * Legacy slot: the forum composer still renders its input inside this
     * row. The message composer no longer does — its card holds the input
     * and the send control, and this row sits naked on the ground below.
     */
    children?: React.ReactNode;
    isSending?: boolean;
    /** When provided, an in-row send button renders (forum layout only). */
    sendDisabled?: boolean;
    audioRecordingElapsedSeconds?: number;
    audioRecordingStatus?: AudioAttachmentRecorderStatus;
    composerDisabled: boolean;
    editor: Editor | null;
    extraActions?: React.ReactNode;
    formattingDisabled: boolean;
    isEmojiPickerOpen: boolean;
    isFormattingOpen: boolean;
    isUploading: boolean;
    onCaptureSelection: () => void;
    onAudioRecordCancel?: () => void;
    onAudioRecordStart?: () => Promise<void>;
    onAudioRecordStop?: () => void;
    onEmojiPickerOpenChange: (open: boolean) => void;
    onEmojiSelect: (emoji: string) => void;
    onFormattingToggle: (pressed: boolean) => void;
    onLinkButton: () => void;
    onOpenContext?: () => void;
    onOpenMentionPicker: () => void;
    onPaperclip: () => void;
  }) {
    const isRecording = audioRecordingStatus === "recording";
    const isAudioAvailable = Boolean(onAudioRecordStart);
    const isAudioBusy =
      audioRecordingStatus === "requesting" ||
      audioRecordingStatus === "preparing";
    const audioButtonLabel =
      audioRecordingStatus === "requesting"
        ? "Requesting microphone access"
        : audioRecordingStatus === "preparing"
          ? "Preparing audio attachment"
          : isRecording
            ? "Stop recording"
            : isAudioAvailable
              ? "Record audio"
              : "Audio recording is available in conversations";

    return (
      /* The baseline row. It sits BELOW the composer card, directly on the
       * conversation ground — no surface, no border. One box on screen (the
       * card, which is only text) is what keeps the composer thin; chrome
       * that lives inside a box reads as a second object. */
      <div
        className="flex min-w-0 shrink-0 items-center gap-0.5 px-1 pt-1"
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

        {isRecording ? (
          <div
            className="flex items-center gap-0.5"
            data-testid="audio-recording-state"
          >
            <span
              aria-live="polite"
              className="min-w-10 text-center font-mono text-xs text-destructive"
            >
              <span className="sr-only">Recording audio, </span>
              {formatAudioRecordingElapsed(audioRecordingElapsedSeconds)}
            </span>
            <Tooltip disableHoverableContent>
              <TooltipTrigger asChild>
                <Button
                  aria-label="Discard recording"
                  className="size-8 rounded-full"
                  data-testid="discard-audio-recording"
                  onClick={onAudioRecordCancel}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <X />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Discard recording (Esc)</TooltipContent>
            </Tooltip>
          </div>
        ) : null}

        <Tooltip disableHoverableContent>
          <TooltipTrigger asChild>
            <span className="inline-grid">
              <Button
                aria-label={audioButtonLabel}
                aria-pressed={isRecording}
                className="size-8 rounded-full"
                data-testid="record-audio"
                disabled={
                  composerDisabled ||
                  isAudioBusy ||
                  isUploading ||
                  !isAudioAvailable
                }
                onClick={() => {
                  if (isRecording) onAudioRecordStop?.();
                  else void onAudioRecordStart?.();
                }}
                size="icon"
                type="button"
                variant={isRecording ? "destructive" : "ghost"}
              >
                {isRecording ? <Square /> : <Mic />}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{audioButtonLabel}</TooltipContent>
        </Tooltip>

        {sendDisabled !== undefined ? (
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
        ) : null}

        <span aria-live="polite" className="sr-only">
          {audioRecordingStatus === "requesting"
            ? "Requesting microphone access"
            : audioRecordingStatus === "preparing"
              ? "Preparing audio attachment"
              : ""}
        </span>
      </div>
    );
  },
);
