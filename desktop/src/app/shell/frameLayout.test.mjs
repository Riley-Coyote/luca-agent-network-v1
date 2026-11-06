import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  createFrameLayoutWatcher,
  isFrameGeometryProperty,
} from "./frameLayout.ts";

function environment(run) {
  const names = [
    "document",
    "window",
    "Element",
    "ResizeObserver",
    "MutationObserver",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "performance",
  ];
  const originals = new Map(
    names.map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
  );
  let now = 0;
  let serial = 0;
  const frames = new Map();
  const resizeObservers = [];
  const mutationObservers = [];
  class Events {
    listeners = new Map();
    addEventListener(name, callback) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set());
      this.listeners.get(name).add(callback);
    }
    removeEventListener(name, callback) {
      this.listeners.get(name)?.delete(callback);
    }
    emit(name, detail = {}) {
      for (const callback of this.listeners.get(name) ?? [])
        callback({ type: name, ...detail });
    }
  }
  class Element {}
  const document = new Events();
  document.documentElement = new Element();
  document.body = new Element();
  document.hidden = false;
  const window = new Events();
  class ResizeObserver {
    observed = new Set();
    disconnected = false;
    constructor(callback) {
      this.callback = callback;
      resizeObservers.push(this);
    }
    observe(element) {
      this.observed.add(element);
    }
    unobserve(element) {
      this.observed.delete(element);
    }
    disconnect() {
      this.disconnected = true;
      this.observed.clear();
    }
  }
  class MutationObserver {
    disconnected = false;
    constructor(callback) {
      this.callback = callback;
      mutationObservers.push(this);
    }
    observe() {}
    disconnect() {
      this.disconnected = true;
    }
  }
  const globals = {
    document,
    window,
    Element,
    ResizeObserver,
    MutationObserver,
    requestAnimationFrame: (callback) => {
      const id = ++serial;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    performance: { now: () => now },
  };
  for (const [name, value] of Object.entries(globals))
    Object.defineProperty(globalThis, name, {
      value,
      configurable: true,
      writable: true,
    });
  const frame = (at = now + 16) => {
    now = at;
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback(now);
  };
  try {
    return run({
      ...globals,
      frame,
      frames,
      resizeObservers,
      mutationObservers,
    });
  } finally {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

test("geometry filter excludes paint but includes rail gap, pane and huddle geometry", () => {
  for (const name of [
    "color",
    "background-color",
    "opacity",
    "filter",
    "box-shadow",
  ])
    assert.equal(isFrameGeometryProperty(name), false, name);
  for (const name of [
    "width",
    "min-width",
    "padding-left",
    "transform",
    "translate",
    "border-top-left-radius",
    "--luca-huddle-band",
  ])
    assert.equal(isFrameGeometryProperty(name), true, name);
});

test("button color/transform and frame opacity transitions schedule zero follow frames", () =>
  environment(({ document, Element, frame, frames }) => {
    let reads = 0;
    const boundary = new Element();
    const button = new Element();
    const watcher = createFrameLayoutWatcher({
      read: () => ++reads,
      watched: () => [],
      motionTarget: (target) => target === boundary,
      ignoreMutation: () => false,
    });
    const stop = watcher.subscribe(() => {});
    frame();
    for (const [target, propertyName] of [
      [button, "color"],
      [button, "transform"],
      [boundary, "opacity"],
      [boundary, "filter"],
    ])
      document.emit("transitionrun", { target, propertyName });
    assert.equal(frames.size, 0);
    assert.equal(reads, 1);
    stop();
  }));

test("real geometry shares one read/RO/rAF across consumers and samples the final rail frame", () =>
  environment(
    ({ document, window, Element, frame, frames, resizeObservers }) => {
      let reads = 0;
      const boundary = new Element();
      const sequence = [];
      const watcher = createFrameLayoutWatcher({
        read: () => {
          sequence.push("read");
          return { serial: ++reads };
        },
        watched: () => [boundary],
        motionTarget: (target) => target === boundary,
        ignoreMutation: () => false,
      });
      const native = [];
      const shadows = [];
      const first = watcher.subscribe((snapshot) => {
        sequence.push("native");
        native.push(snapshot);
      });
      const second = watcher.subscribe((snapshot) => {
        sequence.push("shadow");
        shadows.push(snapshot);
      });
      assert.equal(frames.size, 1);
      assert.equal(resizeObservers.length, 1);
      frame(0);
      assert.deepEqual(sequence, ["read", "native", "shadow"]);
      assert.equal(native[0], shadows[0]);
      document.emit("transitionrun", {
        target: boundary,
        propertyName: "width",
      });
      window.emit("resize");
      resizeObservers[0].callback();
      assert.equal(frames.size, 1);
      for (let at = 16; at <= 528; at += 16) frame(at);
      assert.equal(frames.size, 0);
      assert.equal(native.length, 34);
      assert.equal(shadows.length, 34);
      assert.equal(reads, 34);
      document.emit("transitionend", {
        target: boundary,
        propertyName: "width",
      });
      frame(550);
      assert.equal(reads, 35);
      first();
      assert.equal(resizeObservers[0].disconnected, false);
      second();
      assert.equal(resizeObservers[0].disconnected, true);
    },
  ));

test("animation work is frame-scoped and excludes paint-only card keyframes", () =>
  environment(({ document, Element, frame, frames }) => {
    const boundary = new Element();
    const button = new Element();
    boundary.getAnimations = () => [
      {
        animationName: "breathe",
        effect: { getKeyframes: () => [{ opacity: 0 }, { opacity: 1 }] },
      },
    ];
    const watcher = createFrameLayoutWatcher({
      read: () => null,
      watched: () => [],
      motionTarget: (target) => target === boundary,
      ignoreMutation: () => false,
    });
    const stop = watcher.subscribe(() => {});
    frame();
    document.emit("animationstart", {
      target: button,
      animationName: "bounce",
    });
    document.emit("animationstart", {
      target: boundary,
      animationName: "breathe",
    });
    assert.equal(frames.size, 0);
    boundary.getAnimations = () => [
      {
        animationName: "slide",
        effect: {
          getKeyframes: () => [
            { transform: "translateX(16px)" },
            { transform: "none" },
          ],
        },
      },
    ];
    document.emit("animationstart", {
      target: boundary,
      animationName: "slide",
    });
    assert.equal(frames.size, 1);
    stop();
  }));

test("shadow mutations and resize delivery do not create a feedback loop; observers restart cleanly", () =>
  environment(
    ({
      document,
      window,
      Element,
      frame,
      frames,
      mutationObservers,
      resizeObservers,
    }) => {
      let reads = 0;
      let watched = new Element();
      const initial = watched;
      const watcher = createFrameLayoutWatcher({
        read: () => ++reads,
        watched: () => [watched],
        motionTarget: () => true,
        ignoreMutation: (record) => record.shadow,
      });
      const stop = watcher.subscribe(() =>
        mutationObservers.at(-1).callback([{ shadow: true }]),
      );
      frame();
      assert.equal(frames.size, 0);
      resizeObservers[0].callback();
      assert.equal(
        reads,
        1,
        "RO delivery does not synchronously read/write geometry",
      );
      frame();
      assert.equal(frames.size, 0);
      watched = new Element();
      mutationObservers[0].callback([{ shadow: false }]);
      frame();
      assert.equal(resizeObservers[0].observed.has(initial), false);
      assert.equal(resizeObservers[0].observed.has(watched), true);
      window.emit("resize");
      stop();
      assert.equal(frames.size, 0);
      assert.equal(mutationObservers[0].disconnected, true);
      resizeObservers[0].callback();
      assert.equal(frames.size, 0);
      const restart = watcher.subscribe(() => {});
      assert.equal(resizeObservers.length, 2);
      frame();
      assert.equal(reads, 4);
      restart();
      assert.equal(document.listeners.get("transitionrun").size, 0);
    },
  ));

test("hidden documents do no geometry work and remeasure on return", () =>
  environment(
    ({
      document,
      window,
      Element,
      frame,
      frames,
      resizeObservers,
      mutationObservers,
    }) => {
      let reads = 0;
      const target = new Element();
      const watcher = createFrameLayoutWatcher({
        read: () => ++reads,
        watched: () => [],
        motionTarget: () => true,
        ignoreMutation: () => false,
      });
      const stop = watcher.subscribe(() => {});
      frame();
      document.emit("transitionrun", { target, propertyName: "width" });
      document.hidden = true;
      document.emit("visibilitychange");
      window.emit("resize");
      resizeObservers[0].callback();
      mutationObservers[0].callback([{}]);
      assert.equal(frames.size, 0);
      frame(1000);
      assert.equal(reads, 1);
      document.hidden = false;
      document.emit("visibilitychange");
      frame(1016);
      assert.equal(reads, 2);
      stop();
    },
  ));

test("shell keeps lip-managed one-card RO exclusion and uses shared measured snapshots", async () => {
  const source = await readFile(
    new URL("./shellGlass.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /if \(!card.matches\(ONE_CARD_SELECTOR\)\) return \[card\]/,
  );
  assert.match(source, /document.querySelector\(ONE_CARD_FOLLOWS_SELECTOR\)/);
  assert.match(source, /frameLayout.subscribe\(report\)/);
  assert.match(source, /frameLayout.subscribe\(draw\)/);
  assert.match(source, /shadows: cards.map\(measureShadow\)/);
  assert.doesNotMatch(source, /watchLayout\(|measureCard\(conversationCard/);
});
