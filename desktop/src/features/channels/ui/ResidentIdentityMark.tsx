import * as React from "react";

import { useResidentHarness } from "@/features/agents/ResidentHarnessContext";
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
import { HarnessLogo, harnessHasLogo } from "@/shared/ui/HarnessLogo";

const PROVIDER_MARKS = {
  claude: claudeLogoUrl,
  codex: chatgptLogoUrl,
} as const;

/** What the resident is doing right now, if the mark should show it. */
export type ResidentMarkLiveState = "thinking" | "writing" | null;

/**
 * Which face of the resident to show. The identity glyph says WHO; the
 * harness logo says WHAT THEY RUN ON. Conversation rows and drawer lists show
 * the harness by default (`auto` → logo when the harness is known); the
 * presence rail and the drawer's top identity ask for the glyph explicitly.
 */
export type ResidentMarkPresentation = "auto" | "glyph" | "harness";

export type ResidentIdentityMarkProps = {
  accessibleName: string;
  className?: string;
  decorative?: boolean;
  /** While a reply is coming, light moves through the resident's own mark. */
  live?: ResidentMarkLiveState;
  personaId?: string | null;
  presentation?: ResidentMarkPresentation;
  publicKey: string;
  size?: number;
  "data-testid"?: string;
};

/**
 * The one resident identity mark used across conversation surfaces.
 *
 * Direct runtime contacts use their canonical transparent provider asset.
 * Every owned/custom resident uses a static public-key-derived mark, even when
 * Codex or Claude powers that resident behind the scenes — unless the surface
 * asks for the harness face, in which case a known harness shows its logo.
 */
export const ResidentIdentityMark = React.memo(function ResidentIdentityMark({
  accessibleName,
  className,
  decorative = false,
  live = null,
  personaId,
  presentation = "auto",
  publicKey,
  size = 20,
  "data-testid": dataTestId,
}: ResidentIdentityMarkProps) {
  const kind = residentMarkKind(personaId);
  const lucaPubkey = useCanonicalLucaPubkey();
  const harness = useResidentHarness(publicKey);
  // Known harness with a drawable logo (or a named harness whose asset is
  // still missing — the monogram) wins when the surface wants the harness
  // face. Unknown commands keep the glyph: a stand-in would say nothing.
  const showHarness =
    presentation !== "glyph" &&
    kind === "custom" &&
    harness !== null &&
    (harnessHasLogo(harness) || harness === "hermes" || harness === "openclaw");
  // Keep the established murmur moving for the whole live turn. Switching it
  // off when the first words arrive made the resident appear to stop working
  // before the response was actually complete.
  const filamentMode: FilamentMode | null =
    kind === "custom" && live ? "current" : null;
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
      data-resident-mark-kind={
        filamentMode ? kind : showHarness ? "harness" : kind
      }
      data-resident-mark-live={live ?? undefined}
      data-testid={dataTestId}
      style={{ height: size, width: size }}
      {...accessibilityProps}
    >
      {filamentMode ? (
        <FilamentMark
          bloom={false}
          fit="box"
          mode={filamentMode}
          motion="murmur"
          seed={residentGlyphSeed(publicKey, lucaPubkey)}
          size={size}
        />
      ) : showHarness && harness ? (
        <HarnessLogo decorative harness={harness} size={size} />
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
