import * as React from "react";
import type { QuickChatViewModel } from "../types";

/** Follow the end, never pull a reader away from older messages. Scroll masks
 * live on the transcript, not on the glass or the header's scrollbar area. */
export function useQuickChatTranscript(model: QuickChatViewModel) {
  const transcript = React.useRef<HTMLDivElement>(null);
  const messages = React.useRef<HTMLDivElement>(null);
  const following = React.useRef(true);
  const [away, setAway] = React.useState(false);
  const update = React.useCallback(() => {
    const node = transcript.current;
    if (!node) return;
    const remaining = Math.max(
      0,
      node.scrollHeight - node.clientHeight - node.scrollTop,
    );
    node.style.setProperty(
      "--qc-edge-top",
      String(Math.min(1, Math.max(0, node.scrollTop) / 28)),
    );
    node.style.setProperty(
      "--qc-edge-bottom",
      String(Math.min(1, remaining / 20)),
    );
    following.current = remaining <= 2;
    setAway(!following.current);
  }, []);
  const newest = React.useCallback(() => {
    const node = transcript.current;
    if (!node) return;
    following.current = true;
    node.scrollTop = node.scrollHeight;
    update();
  }, [update]);

  // Restore only when changing conversations or reopening, not when saving
  // every scroll event. That would race auto-follow and streamed markdown.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scrollTop is a snapshot for the conversation being opened
  React.useLayoutEffect(() => {
    if (!model.open || !transcript.current) return;
    transcript.current.scrollTop = model.scrollTop;
    update();
  }, [model.open, model.selectedPubkey, model.channelId, update]);

  // Observe both the viewport and the content: streaming, images, and a
  // growing composer can change the end without adding a message.
  React.useLayoutEffect(() => {
    const node = transcript.current;
    const content = messages.current;
    if (!model.open || !node || !content) return;
    const follow = () => {
      if (following.current) node.scrollTop = node.scrollHeight;
      update();
    };
    const observer = new ResizeObserver(follow);
    observer.observe(node);
    observer.observe(content);
    return () => observer.disconnect();
  }, [model.open, update]);

  // Mark arrivals, not the entire restored history, for the small rise.
  const known = React.useRef(new Set<string>());
  const conversation = React.useRef<string | null>(null);
  React.useLayoutEffect(() => {
    const key = `${model.selectedPubkey}:${model.channelId}`;
    const same = conversation.current === key;
    const nodes =
      messages.current?.querySelectorAll<HTMLElement>(".qc-message") ?? [];
    for (const [index, message] of model.messages.entries()) {
      if (same && !known.current.has(message.id))
        nodes[index]?.setAttribute("data-new", "");
    }
    known.current = new Set(model.messages.map((message) => message.id));
    conversation.current = key;
  }, [model.messages, model.selectedPubkey, model.channelId]);

  return {
    transcript,
    messages,
    away,
    newest,
    onScroll: () => {
      update();
      if (transcript.current) model.setScrollTop(transcript.current.scrollTop);
    },
  };
}
