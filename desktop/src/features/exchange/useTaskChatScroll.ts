import * as React from "react";

// Presentation hosts share only a bounded scroll position, never transcript or
// permission state. Scope includes the community, owner and correspondence.
const positions = new Map<string, { top: number; following: boolean }>();

/** Follow new replies without pulling the reader away from older messages. */
export function useTaskChatScroll(
  enabled: boolean,
  scrollRef: React.RefObject<HTMLDivElement | null>,
  taskId: string | undefined,
  latestEventId: string | undefined,
  scope = "",
) {
  const key = scope && taskId ? `${scope}:${taskId}` : undefined;
  const previousTask = React.useRef<string | undefined>(undefined);
  const following = React.useRef(true);
  React.useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!enabled || !scroller) return;
    const onScroll = () => {
      following.current =
        scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop < 80;
      if (key) {
        positions.delete(key);
        positions.set(key, {
          top: scroller.scrollTop,
          following: following.current,
        });
        if (positions.size > 64)
          positions.delete(positions.keys().next().value as string);
      }
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      onScroll();
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [enabled, scrollRef, key]);
  React.useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!enabled || !scroller || !taskId || !latestEventId) return;
    const target = key ?? taskId;
    if (previousTask.current !== target) {
      const saved = key ? positions.get(key) : undefined;
      following.current = saved?.following ?? true;
      if (saved && !saved.following) scroller.scrollTop = saved.top;
    }
    previousTask.current = target;
    if (following.current) scroller.scrollTop = scroller.scrollHeight;
  }, [enabled, scrollRef, taskId, latestEventId, key]);
}
