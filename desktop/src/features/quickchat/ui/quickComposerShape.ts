/**
 * The mini chat's composer takes the app's one composer shape (Riley,
 * 2026-10-27): one line, a capsule with the add button and Send on either side
 * of the words; past one line the words take the whole width above and the
 * buttons keep their row beneath. Back to the capsule only when the words fit
 * the capsule's own line again, so a line at the edge never flickers.
 *
 * A ref callback for the form, so the shape lives with the form alone: it
 * marks the form `data-composer-open` and cleans up when the form goes.
 */
export function shapeQuickComposer(form: HTMLFormElement | null) {
  const field = form?.querySelector("textarea");
  if (!form || !field) return;
  const measure = document.createElement("canvas").getContext("2d");
  /** The capsule's line for the words, measured while it is the capsule. */
  let capsuleLine = 0;
  let frame = 0;
  const shape = () => {
    frame = 0;
    const open = form.hasAttribute("data-composer-open");
    const style = getComputedStyle(field);
    const inner =
      field.clientWidth -
      Number.parseFloat(style.paddingLeft) -
      Number.parseFloat(style.paddingRight);
    if (!open) capsuleLine = inner;
    const words = field.value;
    let next = false;
    if (words.includes("\n")) {
      next = true;
    } else if (words.length > 0 && measure) {
      measure.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      next = measure.measureText(words).width > capsuleLine - 2;
    }
    if (next !== open) form.toggleAttribute("data-composer-open", next);
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(shape);
  };
  const observer = new ResizeObserver(schedule);
  observer.observe(form);
  field.addEventListener("input", schedule);
  schedule();
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    field.removeEventListener("input", schedule);
  };
}
