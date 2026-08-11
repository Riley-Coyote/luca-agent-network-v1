import {
  Activity,
  Bot,
  CircleDot,
  Copy,
  FileText,
  FolderGit2,
  MessagesSquare,
  House,
  Lock,
  Zap,
} from "lucide-react";
import type * as React from "react";
import { toast } from "sonner";

import type { ChannelType, ChannelVisibility } from "@/shared/api/types";
import { UpdateIndicator } from "@/features/settings/UpdateIndicator";
import { cn } from "@/shared/lib/cn";
import { channelChrome } from "@/shared/layout/chromeLayout";
import { Button } from "@/shared/ui/button";
import { writeTextToClipboard } from "@/shared/lib/clipboard";

type ChatHeaderProps = {
  actions?: React.ReactNode;
  belowSystemChrome?: boolean;
  /** Ref to the outer chrome wrapper when `belowSystemChrome` is true. */
  chromeWrapperRef?: React.Ref<HTMLDivElement>;
  title: string;
  description?: string;
  channelType?: ChannelType;
  visibility?: ChannelVisibility;
  leadingContent?: React.ReactNode;
  centerContent?: React.ReactNode;
  identityMeta?: React.ReactNode;
  mode?: "home" | "channel" | "agents" | "workflows" | "pulse" | "projects";
  overlaysContent?: boolean;
  statusBadge?: React.ReactNode;
  /** Second line. Live resident state when something is happening, the room's
   *  own description otherwise. Its height is ALWAYS reserved, so a resident
   *  starting to think never nudges the title — layout that shifts under you is
   *  the fastest way to feel cheap. */
  subtitle?: React.ReactNode;
  /** Conversation mode: drops the workspace furniture (copy-name button). */
  conversation?: boolean;
  /** Render the chrome wrapper without an individual backdrop when a parent supplies shared blur. */
  transparentChrome?: boolean;
};

const HEADER_ICON_CLASS = "h-4 w-4 text-muted-foreground";

function ChannelIcon({
  channelType,
  visibility,
  mode = "channel",
}: {
  channelType?: ChannelType;
  visibility?: ChannelVisibility;
  mode?: "home" | "channel" | "agents" | "workflows" | "pulse" | "projects";
}) {
  if (mode === "home") {
    return <House className={HEADER_ICON_CLASS} />;
  }

  if (mode === "agents") {
    return <Bot className={HEADER_ICON_CLASS} />;
  }

  if (mode === "workflows") {
    return <Zap className={HEADER_ICON_CLASS} />;
  }

  if (mode === "pulse") {
    return <Activity className={HEADER_ICON_CLASS} />;
  }

  if (mode === "projects") {
    return <FolderGit2 className={HEADER_ICON_CLASS} />;
  }

  if (channelType === "dm") {
    return <CircleDot className={HEADER_ICON_CLASS} />;
  }

  if (visibility === "private") {
    return <Lock className={HEADER_ICON_CLASS} />;
  }

  if (channelType === "forum") {
    return <FileText className={HEADER_ICON_CLASS} />;
  }

  return <MessagesSquare className={HEADER_ICON_CLASS} />;
}

export function ChatHeader({
  actions,
  belowSystemChrome = false,
  chromeWrapperRef,
  title,
  description,
  channelType,
  visibility,
  leadingContent,
  centerContent,
  identityMeta,
  mode = "channel",
  overlaysContent = false,
  statusBadge,
  subtitle,
  conversation = false,
  transparentChrome = false,
}: ChatHeaderProps) {
  const trimmedDescription = description?.trim() ?? "";

  async function handleCopyTitle() {
    const value = title.trim();
    if (!value) return;

    try {
      await writeTextToClipboard(value);
      toast.success("Channel name copied");
    } catch {
      toast.error("Failed to copy channel name");
    }
  }

  const header = (
    <header
      className={cn(
        "pointer-events-auto relative z-30 min-w-0 shrink-0 cursor-default select-none border-b border-border/70 bg-background px-5 py-2 transition-[margin,padding] duration-200 ease-linear",
        overlaysContent && !belowSystemChrome && "-mb-14",
      )}
      data-testid="chat-header"
      data-tauri-drag-region
    >
      {centerContent ? (
        <div className="pointer-events-auto absolute left-1/2 top-3 hidden -translate-x-1/2 items-center justify-center min-[56rem]:flex">
          {centerContent}
        </div>
      ) : null}
      <div className="flex min-h-9 min-w-0 items-center gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="group/title flex min-w-0 items-center gap-[4px] overflow-hidden">
            <div className="flex shrink-0 items-center">
              {leadingContent ?? (
                <ChannelIcon
                  channelType={channelType}
                  mode={mode}
                  visibility={visibility}
                />
              )}
            </div>
            <h1
              className={cn(
                "min-w-0 truncate text-chat font-medium leading-6 tracking-[-0.01em]",
                channelType !== "dm" && "translate-y-px",
              )}
              data-testid="chat-title"
              title={trimmedDescription || undefined}
            >
              {title}
            </h1>
            {identityMeta ? (
              <div className="ml-1 shrink-0" data-luca-header-meta>
                {identityMeta}
              </div>
            ) : null}
            {/* Copying a conversation's name is a workspace habit, not a chat
                one. Kept for non-conversation surfaces that still want it. */}
            {conversation ? null : (
              <Button
                aria-label={`Copy channel name: ${title}`}
                className="h-6 w-6 shrink-0 opacity-0 text-muted-foreground transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/title:opacity-100"
                onClick={() => void handleCopyTitle()}
                size="icon-xs"
                title="Copy channel name"
                type="button"
                variant="ghost"
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            )}
            {statusBadge ? (
              <div className="flex shrink-0 flex-wrap items-center gap-1">
                {statusBadge}
              </div>
            ) : null}
          </div>

          {/* The line every messenger puts under the name — "online", "last
              seen", "typing". Ours can say far more, because we know whether a
              resident is thinking, running a tool or writing. Height is
              reserved unconditionally so it never shifts the title. */}
          {conversation ? (
            <p
              className="min-h-4 truncate text-xs leading-4 text-muted-foreground"
              data-testid="chat-subtitle"
            >
              {subtitle}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <UpdateIndicator />
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      </div>
      {centerContent ? (
        <div className="pointer-events-auto mt-1 flex min-w-0 justify-center min-[56rem]:hidden">
          {centerContent}
        </div>
      ) : null}
    </header>
  );

  if (!belowSystemChrome) {
    return header;
  }

  return (
    <div
      ref={chromeWrapperRef}
      className={cn(
        "pointer-events-none relative z-40 overflow-visible rounded-tl-xl",
        transparentChrome ? "bg-transparent" : "bg-background",
        channelChrome.negativeMargin,
      )}
    >
      {header}
    </div>
  );
}
