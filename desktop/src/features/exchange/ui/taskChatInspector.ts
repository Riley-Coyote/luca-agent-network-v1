/** Keep sibling inspectors mounted but unavailable during the task handoff. */
export function obscureTaskChatInspectors(
  slot: HTMLElement,
  pane: HTMLElement,
) {
  const originals = new Map<HTMLElement, [string | null, string | null]>();
  const lock = (element: HTMLElement) => {
    if (element.getAttribute("inert") !== "") element.setAttribute("inert", "");
    if (element.getAttribute("aria-hidden") !== "true")
      element.setAttribute("aria-hidden", "true");
  };
  const observer = new MutationObserver(() => {
    for (const child of slot.children) {
      if (!(child instanceof HTMLElement) || child === pane) continue;
      if (!originals.has(child)) {
        originals.set(child, [
          child.getAttribute("inert"),
          child.getAttribute("aria-hidden"),
        ]);
        observer.observe(child, {
          attributes: true,
          attributeFilter: ["inert", "aria-hidden"],
        });
      }
      lock(child);
    }
  });
  observer.observe(slot, { childList: true });
  for (const child of slot.children) {
    if (!(child instanceof HTMLElement) || child === pane) continue;
    originals.set(child, [
      child.getAttribute("inert"),
      child.getAttribute("aria-hidden"),
    ]);
    observer.observe(child, {
      attributes: true,
      attributeFilter: ["inert", "aria-hidden"],
    });
    lock(child);
  }
  return () => {
    observer.disconnect();
    for (const [element, values] of originals) {
      // Presence may have finished entering (or started closing) while covered.
      // React can remove its inert attribute, which our lock must reapply, so
      // the captured attribute is not the managed panel's current intention.
      const presence = element.getAttribute("data-panel-open");
      const restored =
        presence === null
          ? values
          : presence === "true"
            ? [null, values[1] === "false" ? "false" : null]
            : ["", "true"];
      for (const [index, name] of ["inert", "aria-hidden"].entries()) {
        const value = restored[index];
        if (value === null) element.removeAttribute(name);
        else element.setAttribute(name, value);
      }
    }
  };
}
