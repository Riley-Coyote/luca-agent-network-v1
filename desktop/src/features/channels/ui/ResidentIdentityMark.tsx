import * as React from "react";

import { useResidentHarness } from "@/features/agents/ResidentHarnessContext";
import { cn } from "@/shared/lib/cn";
import { AgentIdentitySpecimen } from "@/shared/ui/AgentIdentitySpecimen";
import { HarnessLogo, harnessHasLogo } from "@/shared/ui/HarnessLogo";
import { IdentityMark } from "@/shared/ui/dot-display/identity/IdentityMark";
import {
  residentGlyphSeed,
  useCanonicalLucaPubkey,
} from "@/features/luca/canonicalLucaResident";

/** What the resident is doing right now, if the mark should show it. */
export type ResidentMarkLiveState = "thinking" | "writing" | null;

/** Explicit harness presentations remain available where runtime identity matters. */
export type ResidentMarkPresentation = "auto" | "glyph" | "harness";

export type ResidentIdentityMarkProps = {
  accessibleName: string;
  avatarUrl?: string | null;
  className?: string;
  decorative?: boolean;
  live?: ResidentMarkLiveState;
  motion?: "ambient" | "still";
  personaId?: string | null;
  presentation?: ResidentMarkPresentation;
  publicKey: string;
  size?: number;
  "data-testid"?: string;
};

/** A public-key-bound character across conversation surfaces. */
export const ResidentIdentityMark = React.memo(function ResidentIdentityMark({
  accessibleName,
  avatarUrl,
  className,
  decorative = false,
  live = null,
  motion = "still",
  presentation = "auto",
  publicKey,
  size = 20,
  "data-testid": dataTestId,
}: ResidentIdentityMarkProps) {
  const harness = useResidentHarness(publicKey);
  const lucaPubkey = useCanonicalLucaPubkey();
  const showHarness =
    presentation === "harness" &&
    harness !== null &&
    (harnessHasLogo(harness) || harness === "hermes" || harness === "openclaw");
  const state =
    live === "thinking"
      ? "thinking"
      : live === "writing"
        ? "responding"
        : "present";

  return (
    <span
      aria-hidden={decorative ? true : undefined}
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        className,
      )}
      data-resident-mark-kind={
        showHarness
          ? "harness"
          : presentation === "glyph"
            ? "glyph"
            : "character"
      }
      data-resident-mark-live={live ?? undefined}
      data-testid={dataTestId}
      style={{ height: size, width: size }}
    >
      {showHarness && harness ? (
        <>
          <HarnessLogo decorative harness={harness} size={size} />
          {!decorative ? (
            <span className="sr-only">{accessibleName} runtime</span>
          ) : null}
        </>
      ) : presentation === "glyph" ? (
        <IdentityMark
          accessibleName={decorative ? undefined : `${accessibleName} identity`}
          breath={motion === "ambient"}
          seed={residentGlyphSeed(publicKey, lucaPubkey)}
          size={size}
        />
      ) : (
        <AgentIdentitySpecimen
          accessibleName={accessibleName}
          avatarUrl={avatarUrl}
          motion={live ? "ambient" : motion}
          publicKey={publicKey}
          size={size}
          state={state}
        />
      )}
    </span>
  );
});
