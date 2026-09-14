import { cn } from "@/shared/lib/cn";
import { normalizePubkey, truncatePubkey } from "@/shared/lib/pubkey";
import { sigilPattern } from "@/shared/ui/dot-display/engine";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import { AgentCharacter } from "@/shared/ui/characters/AgentCharacter";
import {
  useAgentPhotoPreferred,
  useCharacterId,
} from "@/shared/ui/characters/characterAppearance";
import {
  residentGlyphSeed,
  useCanonicalLucaPubkey,
} from "@/features/luca/canonicalLucaResident";
import { IdentityMark } from "@/shared/ui/dot-display/identity/IdentityMark";

export type AgentVisualState =
  | "present"
  | "idle"
  | "thinking"
  | "working"
  | "responding"
  | "unavailable"
  | "fault";

export type AgentIdentityCustody = "managed" | "guest" | "owner";

/**
 * Compatibility projection for callers and fixtures that need the canonical
 * static 7×7 identity matrix without mounting a canvas.
 */
export function agentIdentityMatrix(publicKey: string): boolean[][] {
  const { grid } = sigilPattern(normalizePubkey(publicKey));
  return grid.map((row) =>
    [...row, ...row.slice(0, row.length - 1).reverse()].map(Boolean),
  );
}

export function shortAgentFingerprint(publicKey: string): string {
  return truncatePubkey(normalizePubkey(publicKey));
}

/** Stable character identity with the actual activity represented as a state. */
export function AgentIdentitySpecimen({
  accessibleName,
  avatarUrl,
  className,
  custody = "managed",
  motion = "still",
  publicKey,
  size = 32,
  state = "present",
}: {
  accessibleName: string;
  avatarUrl?: string | null;
  className?: string;
  custody?: AgentIdentityCustody;
  motion?: "ambient" | "still";
  publicKey: string;
  size?: number;
  state?: AgentVisualState;
}) {
  const characterId = useCharacterId(publicKey);
  const customAvatar = avatarUrl?.trim() || null;
  const photoPreferred = useAgentPhotoPreferred(publicKey, customAvatar);
  const lucaPubkey = useCanonicalLucaPubkey();

  return (
    <span
      className={cn("agent-identity-specimen", className)}
      data-agent-state={state}
      data-custody={custody}
      style={{ width: size, height: size }}
      title={`${accessibleName} · ${shortAgentFingerprint(publicKey)}`}
    >
      {customAvatar && (custody === "owner" || photoPreferred) ? (
        <UserAvatar
          avatarUrl={customAvatar}
          className="h-full w-full"
          displayName={accessibleName}
        />
      ) : custody === "owner" ? (
        <IdentityMark
          accessibleName={`${accessibleName} identity`}
          breath
          seed={residentGlyphSeed(publicKey, lucaPubkey)}
          size={size}
        />
      ) : (
        <AgentCharacter
          accessibleName={accessibleName}
          id={characterId}
          motion={motion}
          publicKey={publicKey}
          size={size}
          state={state}
        />
      )}
    </span>
  );
}
