import type { SVGProps } from "react";

export type MnemosGlyphName =
  | "mnemos"
  | "network"
  | "agents"
  | "brain"
  | "continuity"
  | "memory"
  | "receipt"
  | "activity";

type MnemosGlyphProps = SVGProps<SVGSVGElement> & {
  name: MnemosGlyphName;
  title?: string;
};

export function MnemosGlyph({ name, title, ...props }: MnemosGlyphProps) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "square" as const,
    strokeLinejoin: "miter" as const,
    strokeWidth: 1.5,
    vectorEffect: "non-scaling-stroke" as const,
  };

  return (
    <svg
      aria-hidden={title ? undefined : true}
      aria-label={title}
      role={title ? "img" : undefined}
      viewBox="0 0 24 24"
      {...props}
    >
      <title>{title ?? name}</title>
      <g {...common}>
        {name === "mnemos" ? (
          <>
            <path d="M4 19V5h4l4 7 4-7h4v14" />
            <path d="M8 19v-7l4 6 4-6v7" />
          </>
        ) : null}
        {name === "network" ? (
          <>
            <rect x="3.5" y="9.5" width="5" height="5" />
            <rect x="15.5" y="3.5" width="5" height="5" />
            <rect x="15.5" y="15.5" width="5" height="5" />
            <path d="M8.5 11h4V6h3M8.5 13h4v5h3" />
          </>
        ) : null}
        {name === "agents" ? (
          <>
            <rect x="4" y="4" width="6" height="6" />
            <rect x="14" y="4" width="6" height="6" />
            <rect x="9" y="14" width="6" height="6" />
            <path d="M7 10v2h5M17 10v2h-5v2" />
          </>
        ) : null}
        {name === "brain" ? (
          <>
            <path d="M9 4H6v4H4v8h3v4h5V4H9Z" />
            <path d="M15 4h3v4h2v8h-3v4h-5V4h3Z" />
            <path d="M7 11h5M12 15h5" />
          </>
        ) : null}
        {name === "continuity" ? (
          <>
            <path d="M7 6h10l3 3-3 3H7l-3-3 3-3Z" />
            <path d="M17 12H7l-3 3 3 3h10l3-3-3-3Z" />
            <path d="M12 3v3M12 18v3" />
          </>
        ) : null}
        {name === "memory" ? (
          <>
            <rect x="4" y="4" width="16" height="16" />
            <path d="M8 8h8v8H8zM12 4v4M12 16v4M4 12h4M16 12h4" />
          </>
        ) : null}
        {name === "receipt" ? (
          <>
            <path d="M5 3h14v18l-3-2-4 2-4-2-3 2V3Z" />
            <path d="M8 8h8M8 12h5M8 16h8" />
          </>
        ) : null}
        {name === "activity" ? (
          <>
            <path d="M3 12h4l2-6 4 12 2-6h6" />
            <rect x="2.5" y="2.5" width="19" height="19" />
          </>
        ) : null}
      </g>
    </svg>
  );
}
