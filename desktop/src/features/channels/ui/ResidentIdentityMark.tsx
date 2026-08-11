import * as React from "react";

import {
  RESIDENT_PROVIDER_MARKS,
  residentIdentityCells,
  residentMarkKind,
} from "@/features/channels/lib/residentIdentity";
import { cn } from "@/shared/lib/cn";

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
  const cells = React.useMemo(
    () => (kind === "custom" ? residentIdentityCells(publicKey) : null),
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
      {kind === "custom" && cells ? (
        <svg
          aria-hidden="true"
          className="block size-full overflow-visible"
          focusable="false"
          viewBox="0 0 7 7"
        >
          {cells.map((cell) => (
            <rect
              fill="currentColor"
              height="0.78"
              key={cell.id}
              rx="0.18"
              width="0.78"
              x={cell.x + 0.11}
              y={cell.y + 0.11}
            />
          ))}
        </svg>
      ) : (
        <img
          alt=""
          aria-hidden="true"
          className="block size-full object-contain"
          draggable={false}
          src={RESIDENT_PROVIDER_MARKS[kind as "claude" | "codex"]}
        />
      )}
    </span>
  );
});
