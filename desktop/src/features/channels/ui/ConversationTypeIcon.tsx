import {
  FileText,
  Hash,
  Lock,
  MessageCircle,
  MessagesSquare,
  UsersRound,
} from "lucide-react";

import type { Channel } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";

export function ConversationTypeIcon({
  channel,
  className,
}: {
  channel: Channel;
  className?: string;
}) {
  const iconClassName = cn("size-4", className);

  if (channel.channelType === "dm") {
    return channel.participantPubkeys.length > 2 ? (
      <UsersRound aria-hidden className={iconClassName} />
    ) : (
      <MessageCircle aria-hidden className={iconClassName} />
    );
  }

  if (channel.visibility === "private") {
    return <Lock aria-hidden className={iconClassName} />;
  }

  if (channel.channelType === "forum") {
    return <FileText aria-hidden className={iconClassName} />;
  }

  return <MessagesSquare aria-hidden className={iconClassName} />;
}

export function ProjectTypeIcon({ className }: { className?: string }) {
  return <Hash aria-hidden className={cn("size-4", className)} />;
}
