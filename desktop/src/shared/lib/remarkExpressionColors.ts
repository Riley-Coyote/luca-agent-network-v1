import { parseExpressionSyntax } from "./expressionSyntax";
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

/** Parse expressive Markdown links while keeping code and escaped notation literal. */
export default function remarkExpressionColors() {
  return (tree: ExpressionNode) => {
    const budget = { remaining: 512 };
    let enhancements = 0;
    function transform(node: ExpressionNode) {
      if (node.type === "link" && node.url?.startsWith("color:")) {
        const value = node.url.slice(6);
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
            buildExpressionTree(node, spec, budget);
          else {
            node.type = "expressionColor";
            delete node.url;
            node.data = { hName: "span", hProperties: {} };
          }
        }
        return;
      }
      for (const child of node.children ?? []) transform(child);
    }
    transform(tree);
  };
}
