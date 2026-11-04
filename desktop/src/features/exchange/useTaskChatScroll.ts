import * as React from "react";

/** Follow new replies without pulling the reader away from older messages. */
export function useTaskChatScroll(
  enabled: boolean,
  scrollRef: React.RefObject<HTMLDivElement | null>,
  taskId: string | undefined,
  latestEventId: string | undefined,
) {
  const previousTask = React.useRef<string | undefined>(undefined);
  const following = React.useRef(true);
  React.useEffect(() => {
    const scroller = scrollRef.current;
    if (!enabled || !scroller) return;
    const onScroll = () => {
      following.current =
        scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop < 80;
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [enabled, scrollRef]);
  React.useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!enabled || !scroller || !taskId || !latestEventId) return;
    if (previousTask.current !== taskId) following.current = true;
    previousTask.current = taskId;
    if (following.current) scroller.scrollTop = scroller.scrollHeight;
  }, [enabled, scrollRef, taskId, latestEventId]);
}
