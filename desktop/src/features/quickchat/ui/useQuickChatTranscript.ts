import * as React from "react";
import type { QuickChatViewModel } from "../types";

/** Follow the end, never pull a reader away from older messages. Scroll masks
 * live on the transcript, not on the glass or the header's scrollbar area.
 *
 * Following turns on whenever the view is at the end, and off only when the
 * view has moved toward older messages since it was last seen. Any other
 * change leaves it as it was, so the late scroll event of our own jump, or
 * growth that lands before that event, can't read as the reader leaving, in
 * whatever order scroll and resize callbacks arrive. */
export function useQuickChatTranscript(model: QuickChatViewModel) {
  const transcript = React.useRef<HTMLDivElement>(null);
  const messages = React.useRef<HTMLDivElement>(null);
  const following = React.useRef(true);
  /** Where the view was the last time it was looked at. */
  const last = React.useRef(0);
  const [away, setAway] = React.useState(false);
  /** `fromPosition` decides from where the view is alone, as on opening. */
  const update = React.useCallback((fromPosition = false) => {
    const node = transcript.current;
    if (!node) return;
    const top = node.scrollTop;
    const remaining = Math.max(0, node.scrollHeight - node.clientHeight - top);
    node.style.setProperty(
      "--qc-edge-top",
      String(Math.min(1, Math.max(0, top) / 28)),
    );
    node.style.setProperty(
      "--qc-edge-bottom",
      String(Math.min(1, remaining / 20)),
    );
    if (remaining <= 2) following.current = true;
    else if (fromPosition || top < last.current) following.current = false;
    last.current = top;
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
    update(true);
  }, [model.open, model.selectedPubkey, model.channelId, update]);

  // Observe both the viewport and the content: streaming, images, and a
  // growing composer can change the end without adding a message. The view
  // is read before following, so a move toward older messages that has not
  // yet reached its scroll event still lets the reader go.
  React.useLayoutEffect(() => {
    const node = transcript.current;
    const content = messages.current;
    if (!model.open || !node || !content) return;
    const follow = () => {
      update();
      if (!following.current) return;
      node.scrollTop = node.scrollHeight;
      update();
    };
    const observer = new ResizeObserver(follow);
    observer.observe(node);
    // Border box: the list's bottom padding follows the composer's height, so
    // a composer opening or closing is a look in the frame it lands.
    observer.observe(content, { box: "border-box" });
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
