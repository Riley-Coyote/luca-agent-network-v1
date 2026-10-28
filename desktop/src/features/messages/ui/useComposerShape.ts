import * as React from "react";

import type { Editor } from "@tiptap/react";

/**
 * The composer's two shapes under the frame (Riley, 2026-10-27: past a couple
 * of lines "the shape of the composer gets fucked up and expands
 * incorrectly"). On one line it is a capsule: the add button, the words, Send.
 * Past one line the words take the whole width above, and the two buttons
 * keep their row beneath, so neither moves and no strip of empty space runs
 * down the left beside the words.
 *
 * The capsule's line is narrower than the open shape's, so a line that only
 * fits the open shape stays open: back to the capsule only when the words fit
 * the capsule's own line again. Nothing flickers at the edge.
 */
export function useComposerShape(
  enabled: boolean,
  editor: Editor | null,
  scrollRef: React.RefObject<HTMLElement | null>,
): boolean {
  const [open, setOpen] = React.useState(false);
  const openRef = React.useRef(false);
  /** The capsule's line, measured while it is the capsule. */
  const capsuleLine = React.useRef(0);

  React.useEffect(() => {
    if (!enabled || !editor) {
      openRef.current = false;
      setOpen(false);
      return;
    }
    let frame = 0;
    const measure = () => {
      frame = 0;
      const scroll = scrollRef.current;
      let root: HTMLElement;
      try {
        root = editor.view.dom as HTMLElement;
      } catch {
        return;
      }
      if (!scroll) return;
      if (!openRef.current) capsuleLine.current = root.clientWidth;
      const blocks = Array.from(root.children).filter(
        (child) => child instanceof HTMLElement,
      ) as HTMLElement[];
      let next = false;
      if (!editor.isEmpty) {
        if (blocks.length > 1) {
          next = true;
        } else if (blocks.length === 1) {
          const block = blocks[0];
          const leading = Number.parseFloat(getComputedStyle(block).lineHeight);
          const lines = Number.isFinite(leading)
            ? Math.round(block.getBoundingClientRect().height / leading)
            : 1;
          if (lines > 1) {
            next = true;
          } else if (openRef.current) {
            const words = document.createRange();
            words.selectNodeContents(block);
            next =
              words.getBoundingClientRect().width > capsuleLine.current - 2;
          }
        }
      }
      if (next !== openRef.current) {
        openRef.current = next;
        setOpen(next);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    editor.on("update", schedule);
    const observer = new ResizeObserver(schedule);
    if (scrollRef.current) observer.observe(scrollRef.current);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      editor.off("update", schedule);
      observer.disconnect();
    };
  }, [editor, enabled, scrollRef]);

  return open;
}
