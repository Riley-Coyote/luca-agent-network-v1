import { ResidentIdentityMark } from "@/features/channels/ui/ResidentIdentityMark";
import {
  resolveUserLabel,
  type UserProfileLookup,
} from "@/features/profile/lib/identity";
import { cn } from "@/shared/lib/cn";

const MAX_VISIBLE_RESIDENTS = 3;

export function ConversationPresenceRail({
  onOpenResident,
  onOpenRoster,
  profiles,
  residentPersonaIdLookup,
  residentPubkeys,
  visitorPubkeys,
}: {
  onOpenResident: (pubkey: string) => void;
  onOpenRoster: () => void;
  profiles?: UserProfileLookup;
  residentPersonaIdLookup?: ReadonlyMap<string, string | null>;
  residentPubkeys: readonly string[];
  /** Residents who stepped in for a question and have not stepped out. */
  visitorPubkeys?: ReadonlySet<string>;
}) {
  // Who lives here first, then who is passing through. Presence is lighter
  // for a guest; their words in the timeline are not.
  const members = residentPubkeys.filter(
    (pubkey) => !visitorPubkeys?.has(pubkey.toLowerCase()),
  );
  const visitors = residentPubkeys.filter((pubkey) =>
    visitorPubkeys?.has(pubkey.toLowerCase()),
  );
  const ordered = [...members, ...visitors];
  const visible = ordered.filter(
    (_pubkey, index) => index < MAX_VISIBLE_RESIDENTS,
  );
  const hiddenCount = Math.max(0, ordered.length - visible.length);
  if (visible.length === 0) return null;
  const firstVisitorIndex = visible.findIndex((pubkey) =>
    visitorPubkeys?.has(pubkey.toLowerCase()),
  );

  return (
    <nav
      aria-label="Residents in this conversation"
      className="flex items-center justify-center gap-2"
      data-testid="conversation-presence-rail"
    >
      {visible.map((pubkey, index) => {
        const name = resolveUserLabel({ profiles, pubkey });
        const visiting = visitorPubkeys?.has(pubkey.toLowerCase()) ?? false;
        return (
          <span className="flex items-center gap-2" key={pubkey}>
            {visiting && index === firstVisitorIndex && index > 0 ? (
              <span
                aria-hidden="true"
                className="h-3.5 w-px bg-border"
                data-testid="conversation-presence-rail-divider"
              />
            ) : null}
            <button
              aria-label={
                visiting
                  ? `Open ${name} details (visiting)`
                  : `Open ${name} details`
              }
              className={cn(
                "flex h-8 items-center justify-center gap-1.5 rounded-md px-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                visiting && "opacity-60 hover:opacity-100",
              )}
              data-visiting={visiting ? "" : undefined}
              onClick={() => onOpenResident(pubkey)}
              title={visiting ? `${name} · visiting` : name}
              type="button"
            >
              <ResidentIdentityMark
                accessibleName={name}
                className="luca-identity-breath"
                decorative
                personaId={
                  residentPersonaIdLookup?.get(pubkey.toLowerCase()) ?? null
                }
                presentation="glyph"
                publicKey={pubkey}
                size={22}
                style={{
                  // Presence is breath. Prime-ish cycles and a seed-offset
                  // phase: four marks never rise together.
                  animationDuration: `${[3.1, 5.3, 7.1, 11][index % 4]}s`,
                  animationDelay: `-${(index * 1.9) % 6}s`,
                }}
              />
              {visiting ? (
                <span className="text-3xs uppercase tracking-caps text-muted-foreground">
                  visiting
                </span>
              ) : null}
            </button>
          </span>
        );
      })}
      {hiddenCount > 0 ? (
        <button
          aria-label={`Open conversation roster. ${hiddenCount} more residents.`}
          className="flex size-8 items-center justify-center rounded-md text-2xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onOpenRoster}
          type="button"
        >
          +{hiddenCount}
        </button>
      ) : null}
    </nav>
  );
}
