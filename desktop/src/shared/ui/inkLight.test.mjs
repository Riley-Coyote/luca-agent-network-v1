import assert from "node:assert/strict";
import test from "node:test";

import {
  INK_LIGHT_IDLE_MS,
  INK_LIGHT_SLOPE,
  inkLightAlong,
  inkLightTarget,
  stepInkLight,
  attachInkLight,
} from "./inkLight.ts";

const light = (overrides = {}) => ({
  x: 0,
  y: 0,
  targetX: 300,
  targetY: 200,
  at: 1_000,
  ...overrides,
});

test("the light goes where the pointer is", () => {
  assert.deepEqual(inkLightTarget(light(), 1_500, 800, 600), {
    x: 300,
    y: 200,
  });
  assert.deepEqual(
    inkLightTarget(light(), 1_000 + INK_LIGHT_IDLE_MS, 800, 600),
    {
      x: 300,
      y: 200,
    },
  );
});

test("left alone, it wanders slowly across the window", () => {
  const later = 1_000 + INK_LIGHT_IDLE_MS + 1;
  const a = inkLightTarget(light(), later, 800, 600);
  const b = inkLightTarget(light(), later + 1_000, 800, 600);
  assert.notDeepEqual(a, { x: 300, y: 200 });
  for (const point of [a, b]) {
    assert.ok(point.x >= 800 * 0.08 && point.x <= 800 * 0.92, `${point.x}`);
    assert.ok(point.y >= 600 * 0.1 && point.y <= 600 * 0.6, `${point.y}`);
  }
  // A second of wandering moves it only a little.
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 80);
});

test("it follows a little behind, never jumping", () => {
  const moving = light();
  stepInkLight(moving, { x: 100, y: 0 }, 0.016);
  assert.ok(moving.x > 0 && moving.x < 10, `${moving.x}`);
  // A long frame is capped: it never overshoots.
  stepInkLight(moving, { x: 100, y: 0 }, 10);
  assert.equal(moving.x, 100);
});

test("the gloss leans at 104 degrees, the same on every line", () => {
  assert.equal(inkLightAlong({ x: 150, y: 40 }, { left: 100, top: 40 }), 50);
  assert.equal(
    inkLightAlong({ x: 150, y: 140 }, { left: 100, top: 40 }),
    50 + 100 * INK_LIGHT_SLOPE,
  );
  assert.ok(Math.abs(Math.atan(INK_LIGHT_SLOPE) * (180 / Math.PI) - 15) < 1);
});

function scene(t, { intersection = true } = {}) {
  const originals = new Map();
  const events = new Map();
  const frames = new Map();
  const readsWrites = [];
  const queries = new Map();
  const cleanups = [];
  let nextFrame = 0;
  let mutation;
  let observer;
  const set = (key, value) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  };
  const add = (name, callback) => {
    if (!events.has(name)) events.set(name, new Set());
    events.get(name).add(callback);
  };
  const remove = (name, callback) => events.get(name)?.delete(callback);
  const emit = (name, event = {}) => {
    for (const callback of events.get(name) ?? []) callback(event);
  };
  const element = (name, parentElement = null, box = {}) => {
    const item = {
      name,
      parentElement,
      isConnected: true,
      hidden: false,
      attributes: {},
      children: [],
      clientLeft: 0,
      clientTop: 0,
      clientWidth: 800,
      clientHeight: 600,
      css: {
        display: "block",
        visibility: "visible",
        opacity: "1",
        overflowX: "visible",
        overflowY: "visible",
        contentVisibility: "visible",
      },
      box: {
        left: 10,
        right: 110,
        top: 10,
        bottom: 30,
        width: 100,
        height: 20,
        ...box,
      },
      contains(other) {
        for (let node = other; node; node = node.parentElement)
          if (node === item) return true;
        return false;
      },
      closest() {
        for (let node = item; node; node = node.parentElement) {
          if (
            "data-ink-answered" in node.attributes ||
            "data-md-stream-effect" in node.attributes
          )
            return node;
        }
        return null;
      },
      getAttribute(name) {
        return item.attributes[name] ?? null;
      },
      querySelectorAll() {
        readsWrites.push(`query:${name}`);
        return item.children
          .flatMap((child) => [child, ...child.querySelectorAll()])
          .filter((child) => child.wet);
      },
      getBoundingClientRect() {
        readsWrites.push(`read:${name}`);
        return item.box;
      },
      style: {
        setProperty(key, value) {
          readsWrites.push(`write:${name}`);
          item.attributes.style = `${key}: ${value};`;
        },
      },
    };
    parentElement?.children.push(item);
    return item;
  };
  const root = element("root");
  const document = {
    hidden: false,
    documentElement: root,
    addEventListener: add,
    removeEventListener: remove,
  };
  set("document", document);
  set("innerWidth", 800);
  set("innerHeight", 600);
  set("addEventListener", add);
  set("removeEventListener", remove);
  set("getComputedStyle", (item) => {
    readsWrites.push(`style:${item.name}`);
    return item.css;
  });
  set("requestAnimationFrame", (callback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  });
  set("cancelAnimationFrame", (id) => frames.delete(id));
  set("matchMedia", (query) => {
    if (!queries.has(query))
      queries.set(query, {
        matches: false,
        callbacks: new Set(),
        addEventListener(_, cb) {
          this.callbacks.add(cb);
        },
        removeEventListener(_, cb) {
          this.callbacks.delete(cb);
        },
        change(value) {
          this.matches = value;
          for (const cb of this.callbacks) cb();
        },
      });
    return queries.get(query);
  });
  set(
    "MutationObserver",
    class {
      constructor(callback) {
        this.callback = callback;
        mutation = this;
      }
      observe() {}
      disconnect() {
        this.disconnected = true;
      }
    },
  );
  set(
    "IntersectionObserver",
    intersection
      ? class {
          targets = new Set();
          constructor(callback) {
            this.callback = callback;
            observer = this;
          }
          observe(target) {
            this.targets.add(target);
          }
          unobserve(target) {
            this.targets.delete(target);
          }
          disconnect() {
            this.targets.clear();
            this.disconnected = true;
          }
        }
      : undefined,
  );
  t.after(() => {
    for (const cleanup of cleanups) cleanup();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return {
    frames,
    events,
    readsWrites,
    queries,
    root,
    document,
    element,
    emit,
    get observer() {
      return observer;
    },
    get mutation() {
      return mutation;
    },
    host(name = "host") {
      return element(name, root);
    },
    word(host, name = "word", box = {}) {
      const word = element(name, host, box);
      word.wet = true;
      return word;
    },
    attach(host) {
      const cleanup = attachInkLight(host);
      cleanups.push(cleanup);
      return cleanup;
    },
    tick(now = nextFrame * 16) {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(now);
    },
    intersect(word, visible) {
      observer.callback([
        {
          target: word,
          isIntersecting: visible,
          intersectionRect: {
            width: visible ? 100 : 0,
            height: visible ? 20 : 0,
          },
        },
      ]);
    },
    mutate(target, attributeName = "class", oldValue = null) {
      mutation.callback([{ target, attributeName, oldValue }]);
    },
  };
}

test("offscreen ink stops and intersection or inner-scroll return wakes it", (t) => {
  const s = scene(t);
  const host = s.host();
  const word = s.word(host, "offscreen", { top: -100, bottom: -80 });
  s.attach(host);
  s.tick();
  assert.equal(s.frames.size, 0);
  s.intersect(word, false);
  s.readsWrites.length = 0;
  s.emit("pointermove", { clientX: 10, clientY: 20 });
  assert.equal(s.frames.size, 0);
  assert.deepEqual(s.readsWrites, []);
  word.box.top = 20;
  word.box.bottom = 40;
  s.intersect(word, true);
  s.tick();
  assert.equal(s.frames.size, 1);
  s.intersect(word, false);
  assert.equal(s.frames.size, 0);
  s.emit("scroll");
  s.tick();
  assert.equal(s.frames.size, 1);
});

test("a word clipped inside an inner scroller sleeps even inside the viewport", (t) => {
  const s = scene(t);
  const host = s.host();
  host.css.overflowY = "auto";
  host.clientHeight = 100;
  host.box.top = 20;
  const word = s.word(host, "clipped", { top: 200, bottom: 220 });
  s.attach(host);
  s.tick();
  assert.equal(s.frames.size, 0);
  assert.ok(!s.readsWrites.some((event) => event.startsWith("write:")));
  word.box.top = 50;
  word.box.bottom = 70;
  s.emit("scroll");
  s.tick();
  assert.equal(s.frames.size, 1);
});

test("hidden documents, live reduced motion and forced colors cancel and resume", (t) => {
  const s = scene(t);
  const host = s.host();
  s.word(host);
  s.attach(host);
  s.tick();
  s.document.hidden = true;
  s.emit("visibilitychange");
  assert.equal(s.frames.size, 0);
  s.emit("pointermove", { clientX: 1, clientY: 1 });
  assert.equal(s.frames.size, 0);
  s.document.hidden = false;
  s.emit("visibilitychange");
  s.tick();
  assert.equal(s.frames.size, 1);
  for (const query of s.queries.values()) {
    query.change(true);
    assert.equal(s.frames.size, 0);
    query.change(false);
    s.tick();
    assert.equal(s.frames.size, 1);
  }
});

test("answered, streaming and invisible ink sleep and wake on attribute changes", (t) => {
  const s = scene(t);
  const host = s.host();
  const word = s.word(host);
  s.attach(host);
  s.tick();
  for (const attribute of ["data-ink-answered", "data-md-stream-effect"]) {
    host.attributes[attribute] = "";
    s.mutate(host, attribute);
    assert.equal(s.frames.size, 0);
    delete host.attributes[attribute];
    s.mutate(host, attribute);
    s.tick();
    assert.equal(s.frames.size, 1);
  }
  for (const [key, value] of [
    ["display", "none"],
    ["visibility", "hidden"],
    ["opacity", "0"],
    ["contentVisibility", "hidden"],
  ]) {
    const old = host.css[key];
    host.css[key] = value;
    s.mutate(host);
    s.tick();
    assert.equal(s.frames.size, 0);
    host.css[key] = old;
    s.mutate(host);
    s.tick();
    assert.equal(s.frames.size, 1);
  }
  s.readsWrites.length = 0;
  s.mutate(word, "style", "--ink-light: 20px;");
  assert.deepEqual(s.readsWrites, []);
});

test("multiple hosts share one frame, read before writes, and clean up once", (t) => {
  const s = scene(t);
  const a = s.host("a");
  const b = s.host("b");
  const first = s.word(a, "one");
  s.word(b, "two");
  const detachA = s.attach(a);
  const detachB = s.attach(b);
  assert.equal(s.frames.size, 1);
  s.readsWrites.length = 0;
  s.tick();
  const firstWrite = s.readsWrites.findIndex((event) =>
    event.startsWith("write:"),
  );
  assert.ok(firstWrite > 0);
  assert.ok(
    s.readsWrites
      .slice(firstWrite)
      .every((event) => event.startsWith("write:")),
  );
  assert.ok(!s.readsWrites.some((event) => event.startsWith("query:")));
  detachA();
  assert.equal(s.frames.size, 1);
  assert.ok(!s.observer.targets.has(first));
  detachB();
  detachB();
  assert.equal(s.frames.size, 0);
  assert.equal(s.observer.disconnected, true);
  assert.equal(s.mutation.disconnected, true);
  for (const listeners of s.events.values()) assert.equal(listeners.size, 0);
  for (const query of s.queries.values()) assert.equal(query.callbacks.size, 0);
});

test("a CSS-only opacity reveal wakes on settling without following unrelated transitions", (t) => {
  const s = scene(t);
  const host = s.host();
  s.word(host);
  host.css.opacity = "0";
  s.attach(host);
  s.tick();
  assert.equal(s.frames.size, 0);
  const unrelated = s.element("button", s.root);
  s.emit("transitionend", { target: unrelated });
  assert.equal(s.frames.size, 0);
  host.css.opacity = "1";
  s.emit("transitionend", { target: host });
  s.tick();
  assert.equal(s.frames.size, 1);
});

test("scroll fallback resumes without IntersectionObserver and duplicate refs are safe", (t) => {
  const s = scene(t, { intersection: false });
  const host = s.host();
  const word = s.word(host, "word", { left: 900, right: 1000 });
  const first = s.attach(host);
  const second = s.attach(host);
  s.tick();
  assert.equal(s.frames.size, 0);
  first();
  word.box.left = 10;
  word.box.right = 110;
  s.emit("scroll");
  s.tick();
  assert.equal(s.frames.size, 1);
  second();
  assert.equal(s.frames.size, 0);
});
