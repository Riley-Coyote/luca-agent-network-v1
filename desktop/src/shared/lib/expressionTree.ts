import {
  mixExpressionColors,
  formatExpressionColor,
  type RGB,
} from "./expressionColorMath";
import type { ExpressionSpec } from "./expressionSyntax";

export type ExpressionNode = {
  type: string;
  value?: string;
  url?: string;
  children?: ExpressionNode[];
  data?: { hName?: string; hProperties?: Record<string, string> };
};
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const graphemes = (text: string) =>
  Array.from(segmenter.segment(text), (part) => part.segment);
const skipped = (node: ExpressionNode) =>
  ["code", "inlineCode", "image", "html"].includes(node.type);
const paint = (rgb: RGB) => `--expression-fill:${formatExpressionColor(rgb)}`;

/** The passage's own words: its text and inline code as written, a break as "\n". */
function ownWords(node: ExpressionNode): string {
  if (node.type === "break") return "\n";
  if (node.type === "text" || node.type === "inlineCode")
    return node.value ?? "";
  return node.children?.map(ownWords).join("") ?? "";
}

function span(
  children: ExpressionNode[],
  properties: Record<string, string>,
): ExpressionNode {
  return {
    type: "expressionColor",
    children,
    data: { hName: "span", hProperties: properties },
  };
}

/**
 * Wet ink is still open, and a narrow gloss lies along it where the light
 * falls. Each word carries its own copy of the gloss (its words, in
 * `data-ink-text`, drawn over it), so the light finds every word however the
 * line wraps. The words count against the message's span budget; past it, the
 * passage keeps its wet tone without the gloss.
 */
function splitWetWords(node: ExpressionNode, budget: { remaining: number }) {
  let words = 0;
  function count(child: ExpressionNode) {
    if (skipped(child)) return;
    if (child.type === "text")
      words += (child.value ?? "").split(/\s+/).filter(Boolean).length;
    child.children?.forEach(count);
  }
  node.children?.forEach(count);
  if (words === 0 || words > budget.remaining) return;
  budget.remaining -= words;
  function wrap(child: ExpressionNode): ExpressionNode[] {
    if (skipped(child)) return [child];
    if (child.type === "text") {
      return (child.value ?? "")
        .split(/(\s+)/)
        .filter(Boolean)
        .map((part) =>
          /^\s+$/.test(part)
            ? { type: "text", value: part }
            : span([{ type: "text", value: part }], {
                "data-expression-wet-word": "",
                "data-ink-text": part,
              }),
        );
    }
    if (child.children) child.children = child.children.flatMap(wrap);
    return [child];
  }
  node.children = node.children?.flatMap(wrap);
}

/** Transform only text; a shared message budget bounds generated DOM during streaming. */
export function buildExpressionTree(
  node: ExpressionNode,
  spec: ExpressionSpec,
  budget: { remaining: number },
) {
  const painted = spec.stops.length > 0;
  if (spec.wet) splitWetWords(node, budget);
  let count = 0,
    lines = 1,
    runs = 0;
  let complexShaping = false;
  function measure(child: ExpressionNode) {
    if (skipped(child)) return;
    if (child.type === "break") lines++;
    if (child.type === "text") {
      runs++;
      count += graphemes(child.value ?? "").length;
      // Keep joining scripts intact. Continuous gradients still work without
      // dividing their text into independently shaped spans.
      if (
        /[^\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Common}\p{Script=Inherited}]/u.test(
          child.value ?? "",
        )
      )
        complexShaping = true;
    }
    child.children?.forEach(measure);
  }
  node.children?.forEach(measure);
  // Without paint there is nothing to spread across letters or lines; a wave
  // still needs its letters.
  let axis = spec.motion === "wave" ? "letters" : painted ? spec.axis : "flow";
  if (
    (axis === "letters" && (count > budget.remaining || complexShaping)) ||
    (axis === "lines" && runs > budget.remaining)
  )
    axis = "flow";
  const motion =
    spec.motion === "wave" && axis !== "letters" ? "drift" : spec.motion;
  const declarations = painted ? [paint(spec.stops[0])] : [];
  if (spec.weight !== undefined)
    declarations.push(`--expression-weight:${spec.weight}`);
  if (spec.tracking !== undefined)
    declarations.push(`--expression-tracking:${spec.tracking}em`);
  declarations.push(`--expression-duration:${spec.duration}s`);
  const style = declarations.join(";");
  // Paint-less ink keeps the page's colour: no tone, no fill, no gradient.
  const properties: Record<string, string> = painted
    ? { "data-expression-tone": "", style }
    : { style };
  if (motion) properties["data-expression-motion"] = motion;
  if (spec.weight !== undefined) properties["data-expression-weight"] = "";
  if (spec.tracking !== undefined) properties["data-expression-tracking"] = "";
  if (axis === "flow" && spec.stops.length > 1) {
    const samples = Array.from({ length: 33 }, (_, i) =>
      mixExpressionColors(spec.stops, i / 32),
    );
    properties["data-expression-gradient"] = "";
    properties.style += `;--expression-gradient:linear-gradient(90deg,${samples.map(formatExpressionColor).join(",")})`;
  }
  // Living ink marks ride on the passage as data; only pressure is drawn yet.
  if (spec.pressure) properties["data-expression-pressure"] = spec.pressure;
  if (spec.hold !== undefined)
    properties["data-expression-hold"] = String(spec.hold);
  if (spec.tempo) properties["data-expression-tempo"] = spec.tempo;
  if (spec.wet) properties["data-expression-wet"] = "";
  // A line break reads as one space: none at the ends, one for a run.
  if (spec.echo !== undefined)
    properties["data-expression-echo"] =
      spec.echo ||
      ownWords(node)
        .replace(/^\n+|\n+$/g, "")
        .replace(/\n+/g, " ");
  if (axis !== "flow") {
    let index = 0,
      line = 0;
    const total = axis === "lines" ? lines : count;
    function transform(child: ExpressionNode): ExpressionNode {
      if (skipped(child)) return child;
      if (child.type === "break") {
        line++;
        return child;
      }
      if (child.type === "text") {
        const parts =
          axis === "letters"
            ? graphemes(child.value ?? "")
            : [child.value ?? ""];
        return span(
          parts.map((value) => {
            const progress =
              (axis === "lines" ? line : index) / Math.max(1, total - 1);
            const delay = `--expression-delay:${(((index % 24) / 24) * 0.6).toFixed(3)}s`;
            index++;
            return span([{ type: "text", value }], {
              ...(painted ? { "data-expression-tone": "" } : {}),
              ...(motion === "wave" ? { "data-expression-glyph": "" } : {}),
              style: painted
                ? `${paint(mixExpressionColors(spec.stops, progress))};${delay}`
                : delay,
            });
          }),
          {},
        );
      }
      return { ...child, children: child.children?.map(transform) };
    }
    node.children = node.children?.map(transform);
    budget.remaining -= axis === "letters" ? count : runs;
  }
  delete node.url;
  node.type = "expressionColor";
  node.data = { hName: "span", hProperties: properties };
}
