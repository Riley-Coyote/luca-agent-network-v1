import * as React from "react";

import {
  residentIdentityPath,
  residentMarkKind,
} from "@/features/channels/lib/residentIdentity";
import {
  residentGlyphSeed,
  useCanonicalLucaPubkey,
} from "@/features/luca/canonicalLucaResident";
import chatgptLogoUrl from "@/features/onboarding/assets/harness-logos/chatgpt.png?inline";
import claudeLogoUrl from "@/features/onboarding/assets/harness-logos/claude.png?inline";
import { cn } from "@/shared/lib/cn";
import {
  FilamentMark,
  type FilamentMode,
} from "@/shared/ui/dot-display/identity/FilamentMark";

const PROVIDER_MARKS = {
  claude: claudeLogoUrl,
  codex: chatgptLogoUrl,
} as const;

/** What the resident is doing right now, if the mark should show it. */
export type ResidentMarkLiveState = "thinking" | "writing" | null;

export type ResidentIdentityMarkProps = {
  accessibleName: string;
  className?: string;
  decorative?: boolean;
  /** While a reply is coming the mark is a filament: light travels the
   *  stroke while thinking; the glyph holds lit while words arrive. */
  live?: ResidentMarkLiveState;
  personaId?: string | null;
  publicKey: string;
  size?: number;
  "data-testid"?: string;
};

/**
 * The one resident identity mark used across conversation surfaces.
 *
 * Direct runtime contacts use their canonical transparent provider asset.
 * Every owned/custom resident uses a static public-key-derived mark, even when
 * Codex or Claude powers that resident behind the scenes.
 */
export const ResidentIdentityMark = React.memo(function ResidentIdentityMark({
  accessibleName,
  className,
  decorative = false,
  live = null,
  personaId,
  publicKey,
  size = 20,
  "data-testid": dataTestId,
}: ResidentIdentityMarkProps) {
  const kind = residentMarkKind(personaId);
  const lucaPubkey = useCanonicalLucaPubkey();
  const filamentMode: FilamentMode | null =
    kind === "custom" && live
      ? live === "thinking"
        ? "current"
        : "lit"
      : null;
  const path = React.useMemo(
    () =>
      kind === "custom" ? residentIdentityPath(publicKey, lucaPubkey) : null,
    [kind, lucaPubkey, publicKey],
  );
  const accessibilityProps = decorative
    ? ({ "aria-hidden": true } as const)
    : ({
        "aria-label": `${accessibleName} identity mark`,
        role: "img",
      } as const);

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center text-foreground",
        className,
      )}
      data-resident-mark-kind={kind}
      data-resident-mark-live={live ?? undefined}
      data-testid={dataTestId}
      style={{ height: size, width: size }}
      {...accessibilityProps}
    >
      {filamentMode ? (
        // The live mark is the resting glyph — same box, same edge, same
        // corners — with a light moving through it. No quiet zone, no bloom:
        // nothing about the mark says "thinking" except the fill.
        <FilamentMark
          bloom={false}
          fit="box"
          mode={filamentMode}
          seed={residentGlyphSeed(publicKey, lucaPubkey)}
          size={size}
        />
      ) : kind === "custom" && path ? (
        <svg
          aria-hidden="true"
          className="block size-full overflow-visible"
          focusable="false"
          viewBox="0 0 7 7"
        >
          <path d={path} fill="currentColor" />
        </svg>
      ) : (
        <img
          alt=""
          aria-hidden="true"
          className={cn(
            "block size-full object-contain",
            kind === "codex" && "brightness-0 dark:invert",
          )}
          draggable={false}
          src={PROVIDER_MARKS[kind as "claude" | "codex"]}
        />
      )}
    </span>
  );
});
