import * as React from "react";

/** Mini chat's compact line expands above its anchored controls. Measure the
 * collapsed line even while expanded, so resizing never leaves a stale wrap
 * threshold. Explicit heights also work on WKWebView without field-sizing. */
export function useQuickComposerShape(draft: string) {
  const refresh = React.useRef<(() => void) | null>(null);
  const ref = React.useCallback((form: HTMLFormElement | null) => {
    const field = form?.querySelector("textarea");
    if (!form || !field) return;
    const measure = document.createElement("canvas").getContext("2d");
    let frame = 0;
    let animation: Animation | undefined;
    let lastWidth = 0;
    const shape = () => {
      frame = 0;
      const before = form.getBoundingClientRect().height;
      animation?.cancel();
      const style = getComputedStyle(field);
      const formStyle = getComputedStyle(form);
      const columns = formStyle.gridTemplateColumns
        .split(" ")
        .map(Number.parseFloat);
      const available =
        columns.length === 4 ? columns[1] - 4 : field.clientWidth - 4;
      if (measure)
        measure.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const expanded =
        field.value.includes("\n") ||
        (!!field.value &&
          !!measure &&
          measure.measureText(field.value).width > available - 2);
      form.toggleAttribute("data-composer-open", expanded);
      field.style.height = "0px";
      const computed = getComputedStyle(field);
      const min =
        Number.parseFloat(computed.lineHeight) +
        Number.parseFloat(computed.paddingTop) +
        Number.parseFloat(computed.paddingBottom);
      const limit = Number.parseFloat(computed.maxHeight);
      field.style.height = `${Math.max(min, Math.min(field.scrollHeight, limit))}px`;
      field.toggleAttribute("data-scrolled", field.scrollTop > 1);
      const after = form.getBoundingClientRect().height;
      const width = form.clientWidth;
      if (
        before !== after &&
        lastWidth === width &&
        !matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        animation?.cancel();
        animation = form.animate(
          [{ height: `${before}px` }, { height: `${after}px` }],
          {
            duration: 160,
            easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
          },
        );
      }
      lastWidth = width;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(shape);
    };
    refresh.current = schedule;
    let observedWidth = "";
    const picker = form.querySelector(".qc-picker-trigger");
    const observer = new ResizeObserver(() => {
      const width = `${form.getBoundingClientRect().width}:${picker?.getBoundingClientRect().width ?? 0}`;
      if (width !== observedWidth) {
        observedWidth = width;
        schedule();
      }
    });
    observer.observe(form);
    if (picker) observer.observe(picker);
    field.addEventListener("input", schedule);
    schedule();
    return () => {
      refresh.current = null;
      cancelAnimationFrame(frame);
      animation?.cancel();
      observer.disconnect();
      field.removeEventListener("input", schedule);
    };
  }, []);
  // Covers clearing after send and switching residents as well as typing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: draft changes the controlled textarea's value
  React.useLayoutEffect(() => {
    refresh.current?.();
  }, [draft]);
  return ref;
}
