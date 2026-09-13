/** Text-fill vocabulary shared by finalized and streaming Markdown. */
export const EXPRESSION_COLORS = {
  amber: ["#a4540b", "#f2b86b"],
  gold: ["#806000", "#e7cc72"],
  rose: ["#b02e65", "#ef9bb9"],
  violet: ["#7941b4", "#c4a0ed"],
  magenta: ["#a12e95", "#e6a0db"],
  cyan: ["#006d80", "#79ccdc"],
  blue: ["#2864b4", "#8ebcf4"],
  orange: ["#ac481c", "#f3a080"],
  slate: ["#526179", "#aebcd4"],
  red: ["#b32d40", "#f198a3"],
  emerald: ["#13744e", "#82ceaa"],
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

type ExpressionNode = {
  type: string;
  url?: string;
  children?: ExpressionNode[];
  data?: { hName?: string; hProperties?: Record<string, string> };
};

/** Resolve only published vocabulary entries, never arbitrary CSS or URLs. */
export function expressionColor(value: string): string | undefined {
  const name = value.toLowerCase();
  if (Object.hasOwn(EXPRESSION_COLORS, name)) return name;
  return Object.hasOwn(MEANINGS, name) ? MEANINGS[name] : undefined;
}

/** [Words](color:warmth) becomes a noninteractive span, preserving emphasis.
 * Unknown color names keep readable children without creating a broken link.
 * Code and escaped Markdown remain literal because this works on parsed links.
 */
export default function remarkExpressionColors() {
  return (tree: ExpressionNode) => {
    function transform(node: ExpressionNode) {
      if (node.type === "link" && node.url?.startsWith("color:")) {
        const color = expressionColor(node.url.slice(6));
        node.type = "expressionColor";
        delete node.url;
        node.data = {
          hName: "span",
          hProperties: color ? { "data-expression-color": color } : {},
        };
      }
      for (const child of node.children ?? []) transform(child);
    }
    transform(tree);
  };
}
