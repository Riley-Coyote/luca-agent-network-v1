import type { QuickChatContext } from "./types";

const targets: Record<string, string> = {
  "open-settings-view": "Settings",
  "open-artifacts-view": "Library",
  "open-agents-view": "Agents",
  "open-new-conversation": "New conversation",
  "open-brain-setup": "Brain",
  "open-activity-view": "Activity",
};
const excluded =
  "[data-quickchat], [data-utility-overlay-host], [aria-hidden='true'], [hidden], [inert], input, textarea, [contenteditable='true'], [data-sensitive], [data-private], pre, code, script, style";

function visible(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement) || element.closest(excluded))
    return false;
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return (
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < innerHeight &&
    rect.left < innerWidth &&
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    element.getClientRects().length > 0
  );
}

export function quickChatTarget(id: string): HTMLElement | null {
  if (!(id in targets)) return null;
  const element = document.querySelector(`[data-testid="${id}"]`);
  return element && visible(element) ? element : null;
}

/** Snapshot only visible app content; never enumerate input values or hidden DOM. */
export function captureQuickChatContext(): QuickChatContext {
  const root =
    Array.from(
      document.querySelectorAll(
        "[role='dialog'][data-state='open'],[role='alertdialog'][data-state='open']",
      ),
    )
      .filter(visible)
      .at(-1) ?? document.body;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const fragments: string[] = [];
  let size = 0;
  while (walker.nextNode() && size < 6000) {
    const node = walker.currentNode;
    const parent = node.parentElement;
    if (!parent || !visible(parent)) continue;
    const text = node.textContent?.replace(/\s+/g, " ").trim();
    if (
      !text ||
      /(?:api[ _-]?key|password|secret|bearer\s|private[ _-]?key|nsec1[a-z0-9]+|token\s*:)/i.test(
        text,
      )
    )
      continue;
    fragments.push(text.slice(0, 6000 - size));
    size += text.length + 1;
  }
  const selection = window.getSelection();
  const parent = selection?.anchorNode?.parentElement;
  const selected =
    parent &&
    root.contains(parent) &&
    visible(parent) &&
    !/(?:api[ _-]?key|password|secret|bearer\s|private[ _-]?key|nsec1)/i.test(
      selection?.toString() ?? "",
    )
      ? selection?.toString().slice(0, 1500)
      : "";
  const heading = Array.from(root.querySelectorAll("h1,h2,[role='heading']"))
    .find(visible)
    ?.textContent?.trim();
  const text = `${selected ? `Selected text: ${selected}\n` : ""}${fragments.join("\n")}`;
  // Bound UTF-8 as well as characters for the native context envelope.
  let bounded = "";
  let bytes = 0;
  const encoder = new TextEncoder();
  for (const character of text) {
    bytes += encoder.encode(character).length;
    if (bytes > 7500) break;
    bounded += character;
  }
  return {
    route: location.hash || location.pathname,
    screen:
      heading ||
      (root !== document.body ? "Open dialog" : "Current app screen"),
    capturedAt: new Date().toISOString(),
    text: bounded,
    targets: Object.entries(targets)
      .filter(([id]) => quickChatTarget(id))
      .map(([id, label]) => ({ id, label })),
  };
}
