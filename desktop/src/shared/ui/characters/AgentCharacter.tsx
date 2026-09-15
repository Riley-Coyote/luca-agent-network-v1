import { useIdentityQuery } from "@/shared/api/hooks";
import { cn } from "@/shared/lib/cn";
import type { AgentVisualState } from "@/shared/ui/AgentIdentitySpecimen";
import { useChatMarkAppearance } from "@/features/messages/lib/chatMarkAppearancePreference";
import {
  residentGlyphSeed,
  useCanonicalLucaPubkey,
} from "@/features/luca/canonicalLucaResident";
import { IdentityMark } from "@/shared/ui/dot-display/identity/IdentityMark";
import motePoster from "@/features/luca/residents/mote-chat-poster.png";
import type { CharacterId } from "./characterAppearance";

/** Compatibility surface: legacy character assignments never render sprites. */
export function AgentCharacter({
  accessibleName,
  className,
  publicKey,
  size,
  state = "present",
}: {
  accessibleName: string;
  className?: string;
  id?: CharacterId;
  motion?: "ambient" | "still";
  publicKey: string;
  size: number;
  state?: AgentVisualState;
}) {
  const identity = useIdentityQuery();
  const appearance = useChatMarkAppearance(identity.data?.pubkey);
  const lucaPubkey = useCanonicalLucaPubkey();
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        className,
      )}
      data-agent-state={state}
      data-agent-appearance={appearance.style}
      style={{ width: size, height: size }}
    >
      {appearance.style === "glyph" ? (
        <IdentityMark
          accessibleName={`${accessibleName} identity`}
          seed={residentGlyphSeed(publicKey, lucaPubkey)}
          size={size}
        />
      ) : (
        <img
          alt={`${accessibleName} sphere`}
          src={motePoster}
          width={size}
          height={size}
          className="h-full w-full object-contain"
          draggable={false}
        />
      )}
    </span>
  );
}
