import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { obscureTaskChatInspectors } from "./taskChatInspector.ts";

test("task handoff restores live managed presence and exact unmanaged attributes", () => {
  const originalElement = globalThis.HTMLElement;
  const originalObserver = globalThis.MutationObserver;
  let observer;
  class Element {
    children = [];
    attributes = new Map();
    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    }
    setAttribute(name, value) {
      this.attributes.set(name, value);
    }
    removeAttribute(name) {
      this.attributes.delete(name);
    }
  }
  globalThis.HTMLElement = Element;
  globalThis.MutationObserver = class {
    disconnected = false;
    targets = [];
    constructor(callback) {
      this.callback = callback;
      observer = this;
    }
    observe(target, options) {
      this.targets.push({ target, options });
    }
    disconnect() {
      this.disconnected = true;
    }
  };
  try {
    const slot = new Element();
    const pane = new Element();
    const inspector = new Element();
    inspector.setAttribute("aria-hidden", "false");
    const entering = new Element();
    entering.setAttribute("data-panel-open", "false");
    entering.setAttribute("inert", "");
    entering.setAttribute("aria-hidden", "true");
    const closing = new Element();
    closing.setAttribute("data-panel-open", "true");
    slot.children = [inspector, entering, closing, pane];
    const restore = obscureTaskChatInspectors(slot, pane);
    assert.equal(inspector.getAttribute("inert"), "");
    assert.equal(inspector.getAttribute("aria-hidden"), "true");
    assert.equal(pane.getAttribute("inert"), null);
    assert.equal(pane.getAttribute("aria-hidden"), null);
    // Its own React presence lifecycle must not unlock the obscured inspector.
    inspector.removeAttribute("inert");
    observer.callback();
    assert.equal(inspector.getAttribute("inert"), "");
    // Regression: an inspector initially entering finishes while task chat
    // covers it. Restoring its captured inert=true would strand it on close.
    entering.setAttribute("data-panel-open", "true");
    entering.removeAttribute("inert");
    closing.setAttribute("data-panel-open", "false");
    observer.callback();
    assert.equal(entering.getAttribute("inert"), "");
    const arriving = new Element();
    arriving.setAttribute("inert", "already-inert");
    arriving.setAttribute("aria-hidden", "true");
    slot.children.push(arriving);
    observer.callback();
    assert.equal(arriving.getAttribute("inert"), "");
    assert.equal(
      observer.targets.some(
        ({ target, options }) =>
          target === inspector && options.attributes && !options.subtree,
      ),
      true,
    );
    restore();
    assert.equal(observer.disconnected, true);
    assert.equal(inspector.getAttribute("inert"), null);
    assert.equal(inspector.getAttribute("aria-hidden"), "false");
    assert.equal(arriving.getAttribute("inert"), "already-inert");
    assert.equal(arriving.getAttribute("aria-hidden"), "true");
    assert.equal(entering.getAttribute("inert"), null);
    assert.equal(entering.getAttribute("aria-hidden"), null);
    assert.equal(closing.getAttribute("inert"), "");
    assert.equal(closing.getAttribute("aria-hidden"), "true");
  } finally {
    globalThis.HTMLElement = originalElement;
    globalThis.MutationObserver = originalObserver;
  }
});

test("task exits retain scoped reads without mounting new correspondence or changing execution", async () => {
  const pane = await readFile(
    new URL("./TaskChatPane.tsx", import.meta.url),
    "utf8",
  );
  const correspondence = await readFile(
    new URL("./CorrespondenceWindow.tsx", import.meta.url),
    "utf8",
  );
  const css = await readFile(
    new URL("./task-chat.css", import.meta.url),
    "utf8",
  );
  assert.match(pane, /<PanelPresence key=\{scope\}>/);
  assert.match(pane, /enabled: Boolean\(active && owner && taskId\)/);
  assert.match(pane, /const displayed = active \? read : visibleRead.current/);
  assert.match(pane, /useTaskChatWindowSpace\(Boolean\(taskId\)\)/);
  assert.match(
    correspondence,
    /enabled: Boolean\(active && ownerPubkey && selectedTaskId\)/,
  );
  assert.match(
    correspondence,
    /if \(!active \|\| !ownerPubkey \|\| !liveMembers\) return/,
  );
  assert.match(correspondence, /if \(!active \|\| !end \|\| !root/);
  assert.doesNotMatch(
    pane,
    /resolveExchange|sendAgentInbox|cancelQueries|stopExchange/,
  );
  assert.doesNotMatch(css, /display: none/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /transform: none/);
  assert.match(css, /visibility: hidden/);
  assert.match(css, /visibility 0s linear var\(--motion-duration-standard\)/);
});
