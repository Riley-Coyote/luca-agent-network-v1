import { parseExpressionColor, type RGB } from "./expressionColorMath";

export type ExpressionSpec = {
  stops: RGB[];
  axis: "flow" | "letters" | "lines";
  motion?: "breathe" | "drift" | "wave";
  duration: number;
  weight?: number;
  tracking?: number;
};

/** Parse the expression URL as a small vocabulary, not an executable style sheet. */
export function parseExpressionSyntax(
  value: string,
  namedColor: (name: string) => string | undefined,
): ExpressionSpec | undefined {
  if (value.length > 512) return;
  const [paint, query = "", extra] = value.split("?");
  if (extra !== undefined) return;
  const tokens = paint.split("~");
  if (!tokens.length || tokens.length > 6) return;
  const stops = tokens.map((token) =>
    parseExpressionColor(namedColor(token) ?? token),
  );
  if (stops.some((stop) => !stop)) return;
  const options = new URLSearchParams(query);
  const axis = options.get("axis") ?? "flow";
  const motion = options.get("motion");
  const pace = options.get("pace") ?? "slow";
  const weight = options.has("weight")
    ? Number(options.get("weight"))
    : undefined;
  const tracking = options.has("tracking")
    ? Number(options.get("tracking"))
    : undefined;
  if (
    !["flow", "letters", "lines"].includes(axis) ||
    (motion !== null && !["breathe", "drift", "wave"].includes(motion)) ||
    !["slow", "medium"].includes(pace) ||
    (weight !== undefined &&
      (!Number.isFinite(weight) || weight < 300 || weight > 750)) ||
    (tracking !== undefined &&
      (!Number.isFinite(tracking) || tracking < -0.02 || tracking > 0.12)) ||
    [...options.keys()].some(
      (key) => !["axis", "motion", "pace", "weight", "tracking"].includes(key),
    )
  )
    return;
  return {
    stops: stops as RGB[],
    axis: axis as ExpressionSpec["axis"],
    motion: (motion as ExpressionSpec["motion"]) ?? undefined,
    duration: pace === "slow" ? 3.6 : 2.4,
    weight,
    tracking,
  };
}
