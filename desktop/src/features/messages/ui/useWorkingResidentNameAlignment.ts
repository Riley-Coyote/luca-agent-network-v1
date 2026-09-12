import * as React from "react";

const WIDTH_PROPERTY = "--resident-activity-name-width";
const NAME_SELECTOR = '[data-activity-state="working"] [data-activity-name]';

function naturalTextWidth(element: HTMLElement): number {
  const document = element.ownerDocument;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let width = 0;
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    range.selectNodeContents(text);
    width += range.getBoundingClientRect().width;
  }
  return width;
}

/** Align only the working names mounted inside this particular timeline. */
export function useWorkingResidentNameAlignment(): React.RefCallback<HTMLDivElement> {
  return React.useCallback((host: HTMLDivElement | null) => {
    if (!host) return;
    const timeline = host;
    let frame = 0;
    let disposed = false;
    let names = new Set<HTMLElement>();
    const schedule = () => {
      if (!disposed && !frame) frame = requestAnimationFrame(measure);
    };
    const resizeObserver = new ResizeObserver(schedule);
    function measure() {
      frame = 0;
      if (disposed) return;
      const next = new Set(
        [...timeline.querySelectorAll<HTMLElement>(NAME_SELECTOR)].filter(
          (name) => name.getClientRects().length > 0,
        ),
      );
      for (const previous of names) {
        if (next.has(previous)) continue;
        previous.style.removeProperty(WIDTH_PROPERTY);
        resizeObserver.unobserve(previous);
      }
      for (const name of next) {
        if (!names.has(name)) resizeObserver.observe(name);
      }
      names = next;
      const width =
        names.size > 1
          ? `${Math.ceil(Math.max(...[...names].map(naturalTextWidth)) * 100) / 100}px`
          : "";
      for (const name of names) {
        if (name.style.getPropertyValue(WIDTH_PROPERTY) === width) continue;
        if (width) name.style.setProperty(WIDTH_PROPERTY, width);
        else name.style.removeProperty(WIDTH_PROPERTY);
      }
    }

    const mutationObserver = new MutationObserver((records) => {
      if (
        records.some((record) => {
          const target =
            record.target instanceof Element
              ? record.target
              : record.target.parentElement;
          if (
            record.type === "attributes" ||
            target?.closest("[data-activity-name]")
          )
            return true;
          return [...record.addedNodes, ...record.removedNodes].some(
            (node) =>
              node instanceof Element &&
              (node.matches("[data-activity-trace]") ||
                node.querySelector("[data-activity-trace]")),
          );
        })
      )
        schedule();
    });
    mutationObserver.observe(timeline, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["data-activity-state"],
    });
    resizeObserver.observe(timeline);
    timeline.ownerDocument.fonts.addEventListener("loadingdone", schedule);
    void timeline.ownerDocument.fonts.ready.then(schedule);
    schedule();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      timeline.ownerDocument.fonts.removeEventListener("loadingdone", schedule);
      for (const name of names) name.style.removeProperty(WIDTH_PROPERTY);
      names.clear();
    };
  }, []);
}
