import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

import remarkExpressionColors from "./remarkExpressionColors";

/**
 * Living ink's echo: a reply can light the words of the message it answers,
 * so the person sees what was heard. The words warm in the reply's colour and
 * keep a hairline of it. Only words the person actually wrote are lit; a
 * phrase that is not in their message lights nothing.
 */
export type InkHeard = {
  /** The person's words to light, as the reply named them. */
  phrase: string;
  /** The reply's paint where it echoes, or null for paint-less ink. */
  colour: string | null;
  /** True for a moment after the reply lands, so the words warm in once. */
  fresh?: boolean;
};

type Node = {
  type: string;
  children?: Node[];
  data?: { hProperties?: Record<string, string> };
};

/** The paint a passage carries: the middle of its gradient, else its fill. */
function paintOf(style: string | undefined): string | null {
  if (!style) return null;
  const gradient = style.match(
    /--expression-gradient:linear-gradient\(([^)]*)\)/,
  );
  if (gradient) {
    const stops = gradient[1].split(",").slice(1);
    const middle = stops[Math.floor(stops.length / 2)]?.trim();
    if (middle) return middle;
  }
  return style.match(/--expression-fill:(#[0-9a-f]{6})/i)?.[1] ?? null;
}

function findEcho(node: Node): InkHeard | null {
  const properties = node.data?.hProperties;
  const phrase = properties?.["data-expression-echo"];
  if (phrase?.trim()) {
    return { phrase: phrase.trim(), colour: paintOf(properties?.style) };
  }
  for (const child of node.children ?? []) {
    const found = findEcho(child);
    if (found) return found;
  }
  return null;
}

const HEARD_CACHE_LIMIT = 500;
const heardByContent = new Map<string, InkHeard | null>();

/**
 * The echo a message's words carry, read by the same parse that draws them:
 * one per message, the first in reading order, with its own words when the
 * mark names none.
 */
export function inkHeardOf(content: string): InkHeard | null {
  if (!content.includes("echo")) return null;
  const known = heardByContent.get(content);
  if (known !== undefined) return known;
  let heard: InkHeard | null = null;
  // The parse runs synchronously inside the call; only its tree is wanted.
  ReactMarkdown({
    children: content,
    remarkPlugins: [
      remarkGfm,
      remarkBreaks,
      remarkExpressionColors,
      () => (tree: Node) => {
        heard = findEcho(tree);
      },
    ],
  });
  heardByContent.set(content, heard);
  if (heardByContent.size > HEARD_CACHE_LIMIT) {
    const oldest = heardByContent.keys().next().value;
    if (oldest !== undefined) heardByContent.delete(oldest);
  }
  return heard;
}

/** Two lists of heard phrases that would light the same words the same way. */
export function inkHeardEqual(
  left: readonly InkHeard[] | undefined,
  right: readonly InkHeard[] | undefined,
): boolean {
  if (left === right) return true;
  if ((left?.length ?? 0) !== (right?.length ?? 0)) return false;
  return (left ?? []).every(
    (heard, index) =>
      heard.phrase === right?.[index]?.phrase &&
      heard.colour === right?.[index]?.colour &&
      Boolean(heard.fresh) === Boolean(right?.[index]?.fresh),
  );
}

// --- the rehype pass -------------------------------------------------------

type HastText = { type: "text"; value: string };
type HastElement = {
  type: "element";
  tagName: string;
  properties: Record<string, unknown>;
  children: HastNode[];
};
type HastNode = HastElement | HastText | { type: string };
type HastRoot = { type: "root"; children: HastNode[] };

function textNode(value: string): HastText {
  return { type: "text", value };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Lights the first place each phrase appears in the person's message, as
 * whole words, whatever their case. Code is never lit.
 */
export default function rehypeInkHeard({
  heard,
}: {
  heard: readonly InkHeard[];
}) {
  return (tree: HastRoot) => {
    for (const echo of heard) {
      const words = echo.phrase.trim().split(/\s+/).map(escapeRegExp);
      if (!words.length || !words[0]) continue;
      const pattern = new RegExp(
        `(?<![\\p{L}\\p{N}])(${words.join("\\s+")})(?![\\p{L}\\p{N}])`,
        "iu",
      );
      let lit = false;
      const walk = (nodes: HastNode[]): HastNode[] =>
        nodes.flatMap((node): HastNode[] => {
          if (lit) return [node];
          if (node.type === "text") {
            const value = (node as HastText).value;
            const match = pattern.exec(value);
            if (!match) return [node];
            lit = true;
            const start = match.index;
            const end = start + match[0].length;
            const heardSpan: HastElement = {
              type: "element",
              tagName: "span",
              properties: {
                dataInkHeard: echo.fresh ? "fresh" : "",
                ...(echo.colour ? { style: `--ink-heard:${echo.colour}` } : {}),
              },
              children: [textNode(match[0])],
            };
            return [
              ...(start > 0 ? [textNode(value.slice(0, start))] : []),
              heardSpan,
              ...(end < value.length ? [textNode(value.slice(end))] : []),
            ];
          }
          if (node.type !== "element") return [node];
          const element = node as HastElement;
          if (element.tagName === "code" || element.tagName === "pre")
            return [node];
          return [{ ...element, children: walk(element.children) }];
        });
      tree.children = walk(tree.children);
    }
  };
}
