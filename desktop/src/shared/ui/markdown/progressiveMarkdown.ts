export type ProgressiveMarkdownSegments = {
  complete: string;
  trailing: string;
};

export type ProgressiveMarkdownBlocks = {
  blocks: Array<{ content: string; start: number }>;
  trailing: string;
};

type Fence = {
  character: "`" | "~";
  length: number;
};

function fenceForLine(line: string): Fence | null {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
  const marker = match?.[1];
  if (!marker) return null;
  return {
    character: marker[0] as Fence["character"],
    length: marker.length,
  };
}

/**
 * Splits an in-flight response at the last Markdown block boundary. Completed
 * blocks may be parsed once while the unfinished tail stays literal, avoiding
 * per-grapheme Markdown reparses and incomplete syntax churn.
 */
export function splitProgressiveMarkdown(
  content: string,
): ProgressiveMarkdownSegments {
  const { blocks, trailing } = splitProgressiveMarkdownBlocks(content);
  return { complete: blocks.map((block) => block.content).join(""), trailing };
}

/**
 * Returns immutable completed blocks so React can retain already-parsed nodes
 * while only the unfinished tail changes at the presentation paint cadence.
 */
export function splitProgressiveMarkdownBlocks(
  content: string,
): ProgressiveMarkdownBlocks {
  if (!content) return { blocks: [], trailing: "" };

  let cursor = 0;
  let blockStart = 0;
  let openFence: Fence | null = null;
  const blocks: ProgressiveMarkdownBlocks["blocks"] = [];

  while (cursor < content.length) {
    const newline = content.indexOf("\n", cursor);
    const end = newline === -1 ? content.length : newline + 1;
    const line = content.slice(cursor, newline === -1 ? end : newline);
    const marker = fenceForLine(line);

    if (openFence) {
      if (
        marker?.character === openFence.character &&
        marker.length >= openFence.length
      ) {
        openFence = null;
        blocks.push({
          content: content.slice(blockStart, end),
          start: blockStart,
        });
        blockStart = end;
      }
    } else if (marker) {
      openFence = marker;
    } else if (line.trim().length === 0) {
      blocks.push({
        content: content.slice(blockStart, end),
        start: blockStart,
      });
      blockStart = end;
    }

    cursor = end;
  }

  return {
    blocks,
    trailing: content.slice(blockStart),
  };
}
