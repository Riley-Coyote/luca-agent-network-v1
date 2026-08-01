import { useId, useMemo } from "react";

export type AgentOperationalState =
  | "idle"
  | "present"
  | "working"
  | "unavailable";

type AgentIdentitySpecimenProps = {
  publicKey: string;
  accessibleName: string;
  size?: number;
  state?: AgentOperationalState;
  className?: string;
};

const CELL = 2.7;
const GAP = 0.75;
const ORIGIN = 3.15;

function keyBits(publicKey: string): number[] {
  return publicKey
    .toLowerCase()
    .replace(/[^0-9a-f]/g, "")
    .split("")
    .flatMap((digit) =>
      Number.parseInt(digit, 16)
        .toString(2)
        .padStart(4, "0")
        .split("")
        .map(Number),
    );
}

export function identitySpecimenPattern(publicKey: string) {
  const bits = keyBits(publicKey);
  const cells: Array<{ row: number; column: number }> = [];

  for (let row = 0; row < 5; row += 1) {
    for (let sourceColumn = 0; sourceColumn < 3; sourceColumn += 1) {
      if (bits[row * 3 + sourceColumn] !== 1) continue;
      cells.push({ row, column: sourceColumn });
      const mirrorColumn = 4 - sourceColumn;
      if (mirrorColumn !== sourceColumn) {
        cells.push({ row, column: mirrorColumn });
      }
    }
  }

  return {
    cells,
    registrationCorner: (bits[15] ?? 0) * 2 + (bits[16] ?? 0),
  };
}

function RegistrationMark({ corner }: { corner: number }) {
  const paths = [
    "M1.5 5V1.5H5",
    "M19 1.5h3.5V5",
    "M22.5 19v3.5H19",
    "M5 22.5H1.5V19",
  ];
  return <path className="mn-identity-registration" d={paths[corner]} />;
}

export function AgentIdentitySpecimen({
  publicKey,
  accessibleName,
  size = 32,
  state = "present",
  className,
}: AgentIdentitySpecimenProps) {
  const titleId = useId();
  const pattern = useMemo(
    () => identitySpecimenPattern(publicKey),
    [publicKey],
  );
  const patternKey = pattern.cells
    .map(({ row, column }) => `${row}${column}`)
    .join("-");

  return (
    <span
      className={["mn-identity", `mn-identity--${state}`, className]
        .filter(Boolean)
        .join(" ")}
      data-agent-name={accessibleName}
      data-pattern={patternKey}
      data-state={state}
      style={{ "--mn-identity-size": `${size}px` } as React.CSSProperties}
    >
      <svg aria-labelledby={titleId} role="img" viewBox="0 0 24 24">
        <title
          id={titleId}
        >{`${accessibleName} identity specimen, ${state}`}</title>
        <RegistrationMark corner={pattern.registrationCorner} />
        {pattern.cells.map(({ row, column }) => (
          <rect
            className="mn-identity-cell"
            height={CELL}
            key={`${row}-${column}`}
            width={CELL}
            x={ORIGIN + column * (CELL + GAP)}
            y={ORIGIN + row * (CELL + GAP)}
          />
        ))}
      </svg>
      {state === "working" ? (
        <span aria-hidden="true" className="mn-flux-lamp" />
      ) : null}
    </span>
  );
}
