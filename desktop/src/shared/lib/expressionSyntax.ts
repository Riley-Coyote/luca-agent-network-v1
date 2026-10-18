import { parseExpressionColor, type RGB } from "./expressionColorMath";

export type ExpressionSpec = {
  /** Empty for paint-less ink: the words keep the page's own colour. */
  stops: RGB[];
  axis: "flow" | "letters" | "lines";
  motion?: "breathe" | "drift" | "wave";
  duration: number;
  weight?: number;
  tracking?: number;
  pressure?: "hush" | "land";
  tempo?: "linger" | "rush";
  /** Seconds, 0.2–2. */
  hold?: number;
  wet?: boolean;
  /** The phrase to find again; "" means the passage's own words. */
  echo?: string;
};

const GESTURES = ["breathe", "drift", "wave"];
/** One-word marks: present or absent, never given a value. */
const FLAGS = ["hush", "land", "linger", "rush", "wet", ...GESTURES];
const MARKS = [...FLAGS, "hold", "echo"];
const NAMES = ["axis", "motion", "pace", "weight", "tracking", ...MARKS];

/** One to six stops joined by `~`, each a named paint, hex or numeric HSL. */
function parsePaint(
  paint: string,
  namedColor: (name: string) => string | undefined,
): RGB[] | undefined {
  const tokens = paint.split("~");
  if (tokens.length > 6) return;
  const stops = tokens.map((token) =>
    parseExpressionColor(namedColor(token) ?? token),
  );
  if (stops.some((stop) => !stop)) return;
  return stops as RGB[];
}

/** Parse the expression URL as a small vocabulary, not an executable style sheet. */
export function parseExpressionSyntax(
  value: string,
  namedColor: (name: string) => string | undefined,
): ExpressionSpec | undefined {
  if (value.length > 512) return;
  const [paint, marks, extra] = value.split("?");
  if (extra !== undefined) return;
  let stops = paint ? parsePaint(paint, namedColor) : [];
  let query = marks ?? "";
  // A value with no "?" that is not paint is read whole as marks.
  if (!stops && marks === undefined) {
    stops = [];
    query = paint;
  }
  if (!stops) return;
  const options = new URLSearchParams(query);
  const names = [...options.keys()];
  // Paint-less ink with no marks would say nothing; it stays plain text.
  if (!stops.length && !names.length) return;
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
    (motion !== null && !GESTURES.includes(motion)) ||
    !["slow", "medium"].includes(pace) ||
    (weight !== undefined &&
      (!Number.isFinite(weight) || weight < 300 || weight > 750)) ||
    (tracking !== undefined &&
      (!Number.isFinite(tracking) || tracking < -0.02 || tracking > 0.12)) ||
    names.some((name) => !NAMES.includes(name))
  )
    return;
  // Living ink. Legacy keys keep today's first-wins reading; a new mark is
  // named once, and `motion=` counts as one gesture however often it appears.
  const gestures = GESTURES.filter((name) => options.has(name));
  const hold = options.has("hold")
    ? Number(options.get("hold") || 0.7)
    : undefined;
  if (
    MARKS.some((name) => options.getAll(name).length > 1) ||
    FLAGS.some((name) => options.has(name) && options.get(name) !== "") ||
    (options.has("hush") && options.has("land")) ||
    (options.has("linger") && options.has("rush")) ||
    gestures.length + (motion === null ? 0 : 1) > 1 ||
    (hold !== undefined && (!Number.isFinite(hold) || hold < 0.2 || hold > 2))
  )
    return;
  return {
    stops,
    axis: axis as ExpressionSpec["axis"],
    motion: (motion ?? gestures[0]) as ExpressionSpec["motion"],
    duration: pace === "slow" ? 3.6 : 2.4,
    weight,
    tracking,
    pressure: ["hush", "land"].find((name) =>
      options.has(name),
    ) as ExpressionSpec["pressure"],
    tempo: ["linger", "rush"].find((name) =>
      options.has(name),
    ) as ExpressionSpec["tempo"],
    hold,
    wet: options.has("wet"),
    echo: options.get("echo") ?? undefined,
  };
}
