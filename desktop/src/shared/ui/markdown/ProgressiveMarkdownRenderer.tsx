import * as React from "react";

import { renderUncachedMarkdown, type MarkdownParseInputs } from "./nodeCache";
import {
  advanceProgressiveMarkdownSnapshot,
  type ProgressiveMarkdownBlock,
  type ProgressiveMarkdownSnapshot,
  progressiveMarkdownTailMode,
} from "./progressiveMarkdown";

export type ProgressiveMarkdownRendererProps = Omit<
  MarkdownParseInputs,
  "content" | "searchQuery"
> & {
  content: string;
};

function shallowArrayEqual(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function customEmojiEqual(
  left: ProgressiveMarkdownRendererProps["customEmoji"],
  right: ProgressiveMarkdownRendererProps["customEmoji"],
): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every(
    (emoji, index) =>
      emoji.shortcode === right[index]?.shortcode &&
      emoji.url === right[index]?.url,
  );
}

export function progressiveMarkdownRendererPropsEqual(
  previous: ProgressiveMarkdownRendererProps,
  next: ProgressiveMarkdownRendererProps,
): boolean {
  return (
    previous.content === next.content &&
    previous.components === next.components &&
    customEmojiEqual(previous.customEmoji, next.customEmoji) &&
    previous.variant === next.variant &&
    shallowArrayEqual(previous.channelNames, next.channelNames) &&
    shallowArrayEqual(previous.mentionNames, next.mentionNames)
  );
}

function useProgressiveMarkdownSnapshot(
  content: string,
): ProgressiveMarkdownSnapshot {
  const snapshotRef = React.useRef<ProgressiveMarkdownSnapshot | null>(null);
  if (snapshotRef.current?.content !== content) {
    snapshotRef.current = advanceProgressiveMarkdownSnapshot(
      snapshotRef.current,
      content,
    );
  }
  return snapshotRef.current ?? advanceProgressiveMarkdownSnapshot(null, "");
}

type ProgressiveMarkdownBlockNodeProps = Omit<
  ProgressiveMarkdownRendererProps,
  "content"
> & {
  block: ProgressiveMarkdownBlock;
};

const ProgressiveMarkdownBlockNode = React.memo(
  function ProgressiveMarkdownBlockNode({
    block,
    channelNames,
    components,
    customEmoji,
    mentionNames,
    variant,
  }: ProgressiveMarkdownBlockNodeProps) {
    if (!block.content.trim()) return null;
    return (
      <React.Fragment>
        {renderUncachedMarkdown({
          channelNames,
          components,
          content: block.content,
          customEmoji,
          mentionNames,
          variant,
        })}
      </React.Fragment>
    );
  },
  (previous, next) =>
    previous.block === next.block &&
    previous.components === next.components &&
    customEmojiEqual(previous.customEmoji, next.customEmoji) &&
    previous.variant === next.variant &&
    shallowArrayEqual(previous.channelNames, next.channelNames) &&
    shallowArrayEqual(previous.mentionNames, next.mentionNames),
);

type CompletedBlocksProps = Omit<
  ProgressiveMarkdownRendererProps,
  "content"
> & {
  blocks: readonly ProgressiveMarkdownBlock[];
};

const CompletedProgressiveMarkdownBlocks = React.memo(
  function CompletedProgressiveMarkdownBlocks({
    blocks,
    ...parseInputs
  }: CompletedBlocksProps) {
    return blocks.map((block) => (
      <ProgressiveMarkdownBlockNode
        {...parseInputs}
        block={block}
        key={block.start}
      />
    ));
  },
  (previous, next) =>
    previous.blocks === next.blocks &&
    previous.components === next.components &&
    customEmojiEqual(previous.customEmoji, next.customEmoji) &&
    previous.variant === next.variant &&
    shallowArrayEqual(previous.channelNames, next.channelNames) &&
    shallowArrayEqual(previous.mentionNames, next.mentionNames),
);

function ProgressiveMarkdownTail({
  content,
  ...parseInputs
}: ProgressiveMarkdownRendererProps) {
  if (!content) return null;
  if (progressiveMarkdownTailMode(content) === "literal") {
    return (
      <p className="whitespace-pre-wrap" data-streaming-tail="">
        {content}
      </p>
    );
  }
  return (
    <ProgressiveMarkdownBlockNode
      {...parseInputs}
      block={{ content, start: -1 }}
    />
  );
}

/**
 * Progressive Markdown keeps completed block fibers mounted and parses only a
 * newly completed block or the active structured tail. Provisional parses are
 * deliberately uncached; durable messages use the ordinary node cache after
 * a later mount.
 */
export const ProgressiveMarkdownRenderer = React.memo(
  function ProgressiveMarkdownRenderer({
    content,
    ...parseInputs
  }: ProgressiveMarkdownRendererProps) {
    const snapshot = useProgressiveMarkdownSnapshot(content);
    return (
      <>
        <CompletedProgressiveMarkdownBlocks
          {...parseInputs}
          blocks={snapshot.blocks}
        />
        <ProgressiveMarkdownTail {...parseInputs} content={snapshot.trailing} />
      </>
    );
  },
  progressiveMarkdownRendererPropsEqual,
);

ProgressiveMarkdownRenderer.displayName = "ProgressiveMarkdownRenderer";
