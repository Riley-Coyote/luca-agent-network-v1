import * as React from "react";

import {
  residentIdentityPath,
  residentMarkKind,
} from "@/features/channels/lib/residentIdentity";
import chatgptLogoUrl from "@/features/onboarding/assets/harness-logos/chatgpt.png?inline";
import claudeLogoUrl from "@/features/onboarding/assets/harness-logos/claude.png?inline";
import { cn } from "@/shared/lib/cn";

const PROVIDER_MARKS = {
  claude: claudeLogoUrl,
  codex: chatgptLogoUrl,
} as const;

export type ResidentIdentityMarkProps = {
  accessibleName: string;
  className?: string;
  decorative?: boolean;
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
  personaId,
  publicKey,
  size = 20,
  "data-testid": dataTestId,
}: ResidentIdentityMarkProps) {
  const kind = residentMarkKind(personaId);
  const path = React.useMemo(
    () => (kind === "custom" ? residentIdentityPath(publicKey) : null),
    [kind, publicKey],
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
      data-testid={dataTestId}
      style={{ height: size, width: size }}
      {...accessibilityProps}
    >
      {kind === "custom" && path ? (
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
