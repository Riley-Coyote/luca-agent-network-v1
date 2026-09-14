import type { ChatMarkStyle } from "@/features/messages/lib/chatMarkAppearancePreference";
import { ResidentIdentityMark } from "@/features/channels/ui/ResidentIdentityMark";
import { AgentCharacter } from "@/shared/ui/characters/AgentCharacter";
import { useCharacterId } from "@/shared/ui/characters/characterAppearance";

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
  const characterId = useCharacterId(publicKey);

  return (
    <span aria-hidden="true" data-in-chat-agent-mark={style}>
      {style === "glyph" ? (
        <ResidentIdentityMark
          accessibleName={name}
          decorative
          presentation="glyph"
          publicKey={publicKey}
          size={21}
        />
      ) : (
        <AgentCharacter
          accessibleName={name}
          id={characterId}
          publicKey={publicKey}
          size={21}
        />
      )}
    </span>
  );
}
