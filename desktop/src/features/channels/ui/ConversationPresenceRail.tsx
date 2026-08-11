import { ResidentIdentityMark } from "@/features/channels/ui/ResidentIdentityMark";
import {
  resolveUserLabel,
  type UserProfileLookup,
} from "@/features/profile/lib/identity";

const MAX_VISIBLE_RESIDENTS = 3;

export function ConversationPresenceRail({
  onOpenResident,
  onOpenRoster,
  profiles,
  residentPersonaIdLookup,
  residentPubkeys,
}: {
  onOpenResident: (pubkey: string) => void;
  onOpenRoster: () => void;
  profiles?: UserProfileLookup;
  residentPersonaIdLookup?: ReadonlyMap<string, string | null>;
  residentPubkeys: readonly string[];
}) {
  const visible = residentPubkeys.filter(
    (_pubkey, index) => index < MAX_VISIBLE_RESIDENTS,
  );
  const hiddenCount = Math.max(0, residentPubkeys.length - visible.length);
  if (visible.length === 0) return null;

  return (
    <nav
      aria-label="Residents in this conversation"
      className="flex items-center justify-center gap-2"
      data-testid="conversation-presence-rail"
    >
      {visible.map((pubkey) => {
        const name = resolveUserLabel({ profiles, pubkey });
        return (
          <button
            aria-label={`Open ${name} details`}
            className="rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            key={pubkey}
            onClick={() => onOpenResident(pubkey)}
            title={name}
            type="button"
          >
            <ResidentIdentityMark
              accessibleName={name}
              decorative
              personaId={
                residentPersonaIdLookup?.get(pubkey.toLowerCase()) ?? null
              }
              publicKey={pubkey}
              size={22}
            />
          </button>
        );
      })}
      {hiddenCount > 0 ? (
        <button
          aria-label={`Open conversation roster. ${hiddenCount} more residents.`}
          className="flex h-6 min-w-6 items-center justify-center rounded-md px-1 text-2xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onOpenRoster}
          type="button"
        >
          +{hiddenCount}
        </button>
      ) : null}
    </nav>
  );
}
