import {
  mixExpressionColors,
  readableExpressionColor,
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
const paint = (rgb: RGB) =>
  `--expression-light:${readableExpressionColor(rgb, false)};--expression-dark:${readableExpressionColor(rgb, true)}`;

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

/** Transform only text; a shared message budget bounds generated DOM during streaming. */
export function buildExpressionTree(
  node: ExpressionNode,
  spec: ExpressionSpec,
  budget: { remaining: number },
) {
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
  let axis = spec.motion === "wave" ? "letters" : spec.axis;
  if (
    (axis === "letters" && (count > budget.remaining || complexShaping)) ||
    (axis === "lines" && runs > budget.remaining)
  )
    axis = "flow";
  const motion =
    spec.motion === "wave" && axis !== "letters" ? "drift" : spec.motion;
  let style = paint(spec.stops[0]);
  if (spec.weight !== undefined) style += `;--expression-weight:${spec.weight}`;
  if (spec.tracking !== undefined)
    style += `;--expression-tracking:${spec.tracking}em`;
  style += `;--expression-duration:${spec.duration}s`;
  const properties: Record<string, string> = {
    "data-expression-tone": "",
    style,
  };
  if (motion) properties["data-expression-motion"] = motion;
  if (spec.weight !== undefined) properties["data-expression-weight"] = "";
  if (spec.tracking !== undefined) properties["data-expression-tracking"] = "";
  if (axis === "flow" && spec.stops.length > 1) {
    const samples = Array.from({ length: 33 }, (_, i) =>
      mixExpressionColors(spec.stops, i / 32),
    );
    properties["data-expression-gradient"] = "";
    properties.style += `;--expression-gradient-light:linear-gradient(90deg,${samples.map((c) => readableExpressionColor(c, false)).join(",")});--expression-gradient-dark:linear-gradient(90deg,${samples.map((c) => readableExpressionColor(c, true)).join(",")})`;
  }
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
            const style = `${paint(mixExpressionColors(spec.stops, progress))};--expression-delay:${(((index % 24) / 24) * 0.6).toFixed(3)}s`;
            index++;
            return span([{ type: "text", value }], {
              "data-expression-tone": "",
              ...(motion === "wave" ? { "data-expression-glyph": "" } : {}),
              style,
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
