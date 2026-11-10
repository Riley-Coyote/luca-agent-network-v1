import { formatExpressionColor } from "./expressionColorMath";
import type { ExpressionNode } from "./expressionTree";
import type { ExpressionSpec } from "./expressionSyntax";
import { livingInkSeed } from "./livingInkMath";

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const length = (s: string) => Array.from(segmenter.segment(s)).length;
const skip = (node: ExpressionNode) =>
  ["code", "inlineCode", "image", "html"].includes(node.type);
const words = (node: ExpressionNode): string =>
  skip(node)
    ? ""
    : node.type === "text"
      ? (node.value ?? "")
      : node.type === "break"
        ? "\n"
        : (node.children?.map(words).join("") ?? "");

/** Only the two neighbouring plain words can give way to a press. Wrap them
 * in the parser, never by mutating React-owned text nodes at runtime. */
export function decorateLandNeighbours(
  node: ExpressionNode,
  budget: { remaining: number },
) {
  if (skip(node) || !node.children) return;
  const children = node.children;
  node.children = children.flatMap((child, index) => {
    if (child.type !== "text" || budget.remaining < 1) return [child];
    const land = (at: number) =>
      children[at]?.data?.hProperties?.["data-expression-pressure"] === "land";
    const side = land(index + 1)
      ? "before"
      : land(index - 1)
        ? "after"
        : undefined;
    if (!side) return [child];
    const pieces = (
      side === "before" ? /^(.*?)(\S+)(\s*)$/su : /^(\s*)(\S+)(.*)$/su
    ).exec(child.value ?? "");
    if (!pieces) return [child];
    budget.remaining--;
    return [
      { type: "text", value: pieces[1] },
      {
        type: "expressionColor",
        children: [{ type: "text", value: pieces[2] }],
        data: { hName: "span", hProperties: { "data-ink-give": side } },
      },
      { type: "text", value: pieces[3] },
    ];
  });
  for (const child of node.children) decorateLandNeighbours(child, budget);
}

/** Add bounded paint samples only to the live renderer's normalized expression.
 * Ordinary Markdown, code, legacy parses and the browser's shaping stay intact. */
export function decorateLivingInk(
  node: ExpressionNode,
  spec: ExpressionSpec,
  budget: { remaining: number },
) {
  if (!spec.stops.length || !node.data?.hProperties) return;
  const text = words(node),
    total = Math.max(1, length(text) - 1);
  const hasGlyphs = (child: ExpressionNode): boolean =>
    child.data?.hProperties?.["data-expression-glyph"] !== undefined ||
    child.children?.some(hasGlyphs) === true;
  let index = 0;
  const properties = (part: string) => {
    const from = index / total;
    index += length(part);
    return {
      "data-ink-field-part": `${from},${Math.min(1, (index - 1) / total)}`,
    };
  };
  const wrap = (child: ExpressionNode): ExpressionNode[] => {
    if (skip(child)) return [child];
    if (child.type === "break") {
      index++;
      return [child];
    }
    // Existing letter / row / wet spans cost no additional elements.
    if (
      child.data?.hName === "span" &&
      child.children?.length === 1 &&
      child.children[0].type === "text"
    ) {
      const value = child.children[0].value ?? "";
      if (value.trim()) {
        child.data.hProperties ??= {};
        Object.assign(child.data.hProperties, properties(value));
      } else index += length(value);
      return [child];
    }
    if (child.type === "text") {
      const value = child.value ?? "";
      // Joining scripts retain a single shaped run, never separate letters/words.
      const joining =
        /[^\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Common}\p{Script=Inherited}]/u.test(
          value,
        );
      const parts = joining ? [value] : value.split(/(\s+)/).filter(Boolean);
      if (parts.filter((p) => p.trim()).length > budget.remaining) {
        index += length(value);
        return [child];
      }
      return parts.map((part) => {
        if (!part.trim()) {
          index += length(part);
          return { type: "text", value: part };
        }
        budget.remaining--;
        return {
          type: "expressionColor",
          children: [{ type: "text", value: part }],
          data: { hName: "span", hProperties: properties(part) },
        };
      });
    }
    if (child.children) child.children = child.children.flatMap(wrap);
    return [child];
  };
  node.children = node.children?.flatMap(wrap);
  const hasParts = (child: ExpressionNode): boolean =>
    child.data?.hProperties?.["data-ink-field-part"] !== undefined ||
    child.children?.some(hasParts) === true;
  // Past the shared DOM budget, keep static paint without registering empty
  // fields that would still cost visibility checks on every update.
  if (hasParts(node))
    Object.assign(node.data.hProperties, {
      "data-ink-field": spec.stops.map(formatExpressionColor).join("~"),
      "data-ink-field-seed": String(livingInkSeed(text)),
      "data-ink-field-axis":
        node.data.hProperties["data-expression-gradient"] !== undefined
          ? "flow"
          : spec.motion === "wave" && hasGlyphs(node)
            ? "letters"
            : spec.axis,
    });
}
