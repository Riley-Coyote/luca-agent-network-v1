import * as React from "react";

import { cn } from "@/shared/lib/cn";
import { normalizePubkey, truncatePubkey } from "@/shared/lib/pubkey";

export type AgentVisualState =
  | "present"
  | "idle"
  | "thinking"
  | "working"
  | "responding"
  | "unavailable"
  | "fault";

export type AgentIdentityCustody = "managed" | "guest" | "owner";

const GRID_SIZE = 7;
const SOURCE_COLUMNS = 4;

function keyBytes(publicKey: string): number[] {
  const normalized = normalizePubkey(publicKey).replace(/[^a-f0-9]/g, "");
  const source = normalized || publicKey.toLowerCase();
  let seed = 0x811c9dc5;

  for (let index = 0; index < source.length; index += 1) {
    seed ^= source.charCodeAt(index);
    seed = Math.imul(seed, 0x01000193) >>> 0;
  }

  return Array.from({ length: GRID_SIZE * SOURCE_COLUMNS }, (_, index) => {
    seed ^= index + 0x9e3779b9;
    seed = Math.imul(seed ^ (seed >>> 16), 0x21f0aaad) >>> 0;
    seed = Math.imul(seed ^ (seed >>> 15), 0x735a2d97) >>> 0;
    return (seed ^ (seed >>> 15)) & 1;
  });
}

export function agentIdentityMatrix(publicKey: string): boolean[][] {
  const bits = keyBytes(publicKey);
  return Array.from({ length: GRID_SIZE }, (_, row) => {
    const half = bits.slice(
      row * SOURCE_COLUMNS,
      row * SOURCE_COLUMNS + SOURCE_COLUMNS,
    );
    return [...half, ...half.slice(0, GRID_SIZE - SOURCE_COLUMNS).reverse()].map(
      Boolean,
    );
  });
}

export function shortAgentFingerprint(publicKey: string): string {
  return truncatePubkey(normalizePubkey(publicKey));
}

export function AgentIdentitySpecimen({
  accessibleName,
  className,
  custody = "managed",
  publicKey,
  size = 32,
  state = "present",
}: {
  accessibleName: string;
  className?: string;
  custody?: AgentIdentityCustody;
  publicKey: string;
  size?: number;
  state?: AgentVisualState;
}) {
  const matrix = React.useMemo(
    () => agentIdentityMatrix(publicKey),
    [publicKey],
  );

  return (
    <span
      aria-label={`${accessibleName} identity, ${state}`}
      className={cn("agent-identity-specimen", className)}
      data-agent-state={state}
      data-custody={custody}
      role="img"
      style={{ "--agent-specimen-size": `${size}px` } as React.CSSProperties}
      title={`${accessibleName} · ${shortAgentFingerprint(publicKey)}`}
    >
      <svg
        aria-hidden="true"
        className="agent-identity-specimen__matrix"
        shapeRendering="crispEdges"
        viewBox="0 0 7 7"
      >
        {matrix.flatMap((row, rowIndex) =>
          row.map((active, columnIndex) =>
            active ? (
              <rect
                className="agent-identity-specimen__cell"
                height="0.74"
                key={`${rowIndex}-${columnIndex}`}
                rx="0.08"
                style={
                  {
                    "--agent-cell-index": rowIndex * GRID_SIZE + columnIndex,
                  } as React.CSSProperties
                }
                width="0.74"
                x={columnIndex + 0.13}
                y={rowIndex + 0.13}
              />
            ) : null,
          ),
        )}
      </svg>
      <span aria-hidden="true" className="agent-identity-specimen__lamp" />
    </span>
  );
}
