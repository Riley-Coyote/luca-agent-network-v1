import { parseExpressionSyntax, type ExpressionSpec } from "./expressionSyntax";
import { buildExpressionTree, type ExpressionNode } from "./expressionTree";

/** Text-fill vocabulary shared by finalized and streaming Markdown. */
export const EXPRESSION_COLORS = {
  amber: "#ffad1f",
  gold: "#ffd21f",
  rose: "#ff4f91",
  violet: "#a65cff",
  magenta: "#ed3cda",
  cyan: "#16ccef",
  blue: "#4285ff",
  orange: "#ff742e",
  slate: "#899bb8",
  red: "#f83e50",
  emerald: "#18bd79",
} as const;

const MEANINGS: Record<string, keyof typeof EXPRESSION_COLORS> = {
  warmth: "amber",
  joy: "gold",
  care: "rose",
  curiosity: "violet",
  wonder: "magenta",
  calm: "cyan",
  clarity: "blue",
  resolve: "orange",
  reflection: "slate",
  urgency: "red",
  hope: "emerald",
};

/** Resolve only published vocabulary entries, never arbitrary CSS or URLs. */
export function expressionColor(value: string): string | undefined {
  const name = value.toLowerCase();
  if (Object.hasOwn(EXPRESSION_COLORS, name)) return name;
  return Object.hasOwn(MEANINGS, name) ? MEANINGS[name] : undefined;
}

/** Both schemes carry the same expression value. */
function expressionValue(url = ""): string | undefined {
  for (const scheme of ["ink:", "color:"])
    if (url.startsWith(scheme)) return url.slice(scheme.length);
}

/** Inline content's nearest block, where one land per paragraph is counted. */
const BLOCKS = ["paragraph", "listItem", "heading", "tableCell"];
const HOLDS_PER_MESSAGE = 3;
const ECHOES_PER_MESSAGE = 1;

type Spent = { holds: number; echoes: number; lands: Set<ExpressionNode> };

/** Marks over a message's limits are dropped in reading order; the rest stays. */
function withinLimits(
  spec: ExpressionSpec,
  block: ExpressionNode,
  spent: Spent,
): ExpressionSpec {
  const kept = { ...spec };
  if (kept.hold !== undefined && ++spent.holds > HOLDS_PER_MESSAGE)
    kept.hold = undefined;
  if (kept.pressure === "land") {
    if (spent.lands.has(block)) kept.pressure = undefined;
    spent.lands.add(block);
  }
  if (kept.echo !== undefined && ++spent.echoes > ECHOES_PER_MESSAGE)
    kept.echo = undefined;
  return kept;
}

/** Parse expressive Markdown links while keeping code and escaped notation literal. */
export default function remarkExpressionColors() {
  return (tree: ExpressionNode) => {
    const budget = { remaining: 512 };
    const spent: Spent = { holds: 0, echoes: 0, lands: new Set() };
    let enhancements = 0;
    function transform(node: ExpressionNode, block: ExpressionNode) {
      const value =
        node.type === "link" ? expressionValue(node.url) : undefined;
      if (value !== undefined) {
        const color = expressionColor(value);
        if (color) {
          node.type = "expressionColor";
          delete node.url;
          node.data = {
            hName: "span",
            hProperties: { "data-expression-color": color },
          };
        } else {
          const spec = parseExpressionSyntax(value, (name) => {
            const key = expressionColor(name) as
              | keyof typeof EXPRESSION_COLORS
              | undefined;
            return key ? EXPRESSION_COLORS[key] : undefined;
          });
          if (spec && enhancements++ < 64)
            buildExpressionTree(node, withinLimits(spec, block, spent), budget);
          else {
            node.type = "expressionColor";
            delete node.url;
            node.data = { hName: "span", hProperties: {} };
          }
        }
        return;
      }
      const inner = BLOCKS.includes(node.type) ? node : block;
      for (const child of node.children ?? []) transform(child, inner);
    }
    transform(tree, tree);
  };
}
