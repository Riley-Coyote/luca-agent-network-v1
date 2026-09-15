import type { ChatMarkStyle } from "@/features/messages/lib/chatMarkAppearancePreference";
import { ResidentIdentityMark } from "@/features/channels/ui/ResidentIdentityMark";

/** A still, small identity in the message gutter; the sphere owns the ledge. */
export function InChatAgentMark({
  name,
  publicKey,
  style,
}: {
  name: string;
  publicKey: string;
  style: Exclude<ChatMarkStyle, "sphere">;
}) {
  return (
    <span aria-hidden="true" data-in-chat-agent-mark={style}>
      <ResidentIdentityMark
        accessibleName={name}
        decorative
        presentation="glyph"
        publicKey={publicKey}
        size={21}
      />
    </span>
  );
}
