import assert from "node:assert/strict";
import test from "node:test";
import { attachVideoGlow } from "./videoGlowScheduler.ts";

function setup(
  t,
  {
    decoded = true,
    readyState = 2,
    paused = true,
    throwRequest = false,
    reducedMotion = false,
  } = {},
) {
  const originals = new Map();
  const frames = new Map();
  const videoFrames = new Map();
  const draws = [];
  let nextId = 0;
  let now = 0;
  let failDraw = false;
  const target = (properties = {}) => ({
    listeners: new Map(),
    ...properties,
    addEventListener(name, callback) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set());
      this.listeners.get(name).add(callback);
    },
    removeEventListener(name, callback) {
      this.listeners.get(name)?.delete(callback);
    },
    emit(name) {
      for (const callback of this.listeners.get(name) ?? []) callback();
    },
  });
  const video = target({
    paused,
    readyState,
    ended: false,
    seeking: false,
    currentTime: 0,
  });
  if (decoded) {
    video.requestVideoFrameCallback = (callback) => {
      if (throwRequest) throw new Error("Unsupported source");
      const id = ++nextId;
      videoFrames.set(id, callback);
      return id;
    };
    video.cancelVideoFrameCallback = (id) => videoFrames.delete(id);
  }
  const document = target({ hidden: false });
  const motion = target({ matches: reducedMotion });
  const set = (key, value) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  };
  set("document", document);
  set("performance", { now: () => now });
  set("matchMedia", () => motion);
  set("requestAnimationFrame", (callback) => {
    const id = ++nextId;
    frames.set(id, callback);
    return id;
  });
  set("cancelAnimationFrame", (id) => frames.delete(id));
  const cleanup = attachVideoGlow(video, () => {
    if (failDraw) throw new Error("Frame not decoded");
    draws.push(video.currentTime);
  });
  t.after(() => {
    cleanup();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return {
    video,
    document,
    motion,
    frames,
    videoFrames,
    draws,
    cleanup,
    set failDraw(value) {
      failDraw = value;
    },
    advance(timestamp, mediaTime = timestamp / 1000) {
      now = timestamp;
      video.currentTime = mediaTime;
      const pending = [
        ...(decoded && !throwRequest ? videoFrames : frames).values(),
      ];
      (decoded && !throwRequest ? videoFrames : frames).clear();
      for (const callback of pending) callback(timestamp, { mediaTime });
    },
  };
}

test("paused decoded video paints once without a recurring callback", (t) => {
  const s = setup(t);
  assert.deepEqual(s.draws, [0]);
  assert.equal(s.frames.size, 0);
  assert.equal(s.videoFrames.size, 0);
  s.video.emit("timeupdate");
  assert.deepEqual(s.draws, [0]);
});

test("playing follows decoded frames, keeps the 15fps cap, and stops on pause/end", (t) => {
  const s = setup(t, { paused: false });
  assert.equal(s.videoFrames.size, 1);
  assert.equal(s.frames.size, 0);
  s.advance(20);
  assert.equal(s.draws.length, 1);
  s.advance(70);
  assert.equal(s.draws.length, 2);
  s.advance(140, 0.07);
  assert.equal(s.draws.length, 2);
  s.advance(210);
  assert.equal(s.draws.length, 3);
  s.video.paused = true;
  s.video.emit("pause");
  assert.equal(s.draws.length, 4);
  assert.equal(s.videoFrames.size, 0);
  s.video.paused = false;
  s.video.emit("playing");
  assert.equal(s.videoFrames.size, 1);
  s.video.ended = true;
  s.video.paused = true;
  s.video.emit("ended");
  assert.equal(s.videoFrames.size, 0);
  assert.equal(s.frames.size, 0);
});

test("paused loading waits for the first decoded frame without losing its glow", (t) => {
  const s = setup(t, { readyState: 0 });
  assert.deepEqual(s.draws, []);
  assert.equal(s.videoFrames.size, 1);
  assert.equal(s.frames.size, 0);
  s.video.readyState = 2;
  s.advance(30, 0);
  assert.deepEqual(s.draws, [0]);
  assert.equal(s.videoFrames.size, 0);
});

test("loadeddata handles an initially undecodable paused frame in fallback engines", (t) => {
  const s = setup(t, { decoded: false, readyState: 0 });
  assert.deepEqual(s.draws, []);
  assert.equal(s.frames.size, 0);
  s.video.readyState = 2;
  s.video.emit("loadeddata");
  assert.deepEqual(s.draws, [0]);
  assert.equal(s.frames.size, 0);
});

test("paused seeking draws the new decoded frame once and retries decoding failure", (t) => {
  const s = setup(t);
  s.video.seeking = true;
  s.video.currentTime = 8;
  s.video.emit("seeking");
  s.video.emit("timeupdate");
  assert.deepEqual(s.draws, [0]);
  s.failDraw = true;
  s.video.seeking = false;
  s.video.emit("seeked");
  assert.equal(s.videoFrames.size, 1);
  s.failDraw = false;
  s.advance(90, 8);
  assert.deepEqual(s.draws, [0, 8]);
  assert.equal(s.videoFrames.size, 0);
});

test("document hiding cancels work; returning draws current frame and resumes playback", (t) => {
  const s = setup(t, { paused: false });
  const stale = [...s.videoFrames.values()][0];
  s.document.hidden = true;
  s.document.emit("visibilitychange");
  assert.equal(s.videoFrames.size, 0);
  stale(100, { mediaTime: 0.1 });
  assert.equal(s.draws.length, 1);
  assert.equal(s.videoFrames.size, 0);
  s.video.currentTime = 4;
  s.document.hidden = false;
  s.document.emit("visibilitychange");
  assert.deepEqual(s.draws, [0, 4]);
  assert.equal(s.videoFrames.size, 1);
});

test("reduced-motion changes stop work and restore a paused still without polling", (t) => {
  const s = setup(t, { paused: false });
  s.motion.matches = true;
  s.motion.emit("change");
  assert.equal(s.videoFrames.size, 0);
  s.video.currentTime = 2;
  s.video.emit("seeked");
  assert.deepEqual(s.draws, [0, 0, 2]);
  s.video.paused = true;
  s.motion.matches = false;
  s.motion.emit("change");
  assert.deepEqual(s.draws, [0, 0, 2, 2]);
  assert.equal(s.videoFrames.size, 0);
  assert.equal(s.frames.size, 0);
});

test("initial reduced motion preserves decoded stills on load, seek, pause and return", (t) => {
  const s = setup(t, { reducedMotion: true, readyState: 0, paused: false });
  assert.deepEqual(s.draws, []);
  assert.equal(s.videoFrames.size, 0);
  assert.equal(s.frames.size, 0);
  s.video.readyState = 2;
  s.video.emit("loadeddata");
  assert.deepEqual(s.draws, [0]);
  s.video.currentTime = 1;
  s.video.emit("timeupdate");
  assert.deepEqual(s.draws, [0]);
  s.video.emit("seeked");
  assert.deepEqual(s.draws, [0, 1]);
  s.video.paused = true;
  s.video.emit("pause");
  s.document.hidden = true;
  s.document.emit("visibilitychange");
  s.video.currentTime = 2;
  s.video.emit("loadeddata");
  assert.deepEqual(s.draws, [0, 1, 1]);
  s.document.hidden = false;
  s.document.emit("visibilitychange");
  assert.deepEqual(s.draws, [0, 1, 1, 2]);
  assert.equal(s.videoFrames.size, 0);
  assert.equal(s.frames.size, 0);
});

test("initial reduced motion draws an already-decoded still without scheduling", (t) => {
  const s = setup(t, { reducedMotion: true, paused: false });
  assert.deepEqual(s.draws, [0]);
  assert.equal(s.videoFrames.size, 0);
  assert.equal(s.frames.size, 0);
});

test("delivered decoded callbacks respect reduction before its change event", (t) => {
  const s = setup(t, { paused: false });
  s.motion.matches = true;
  s.advance(100, 0.1);
  assert.deepEqual(s.draws, [0]);
  assert.equal(s.videoFrames.size, 0);
  assert.equal(s.frames.size, 0);
});

test("delivered fallback callbacks respect reduction before its change event", (t) => {
  const s = setup(t, { decoded: false, paused: false });
  s.motion.matches = true;
  s.advance(100, 0.1);
  assert.deepEqual(s.draws, [0]);
  assert.equal(s.frames.size, 0);
});

test("rAF fallback paints changed playback time only and cancels while paused or buffering", (t) => {
  const s = setup(t, { decoded: false, paused: false });
  assert.equal(s.frames.size, 1);
  s.advance(100, 0);
  assert.deepEqual(s.draws, [0]);
  s.advance(200, 0.2);
  assert.deepEqual(s.draws, [0, 0.2]);
  s.video.emit("waiting");
  assert.equal(s.frames.size, 0);
  s.video.emit("playing");
  assert.equal(s.frames.size, 1);
  s.video.paused = true;
  s.video.emit("pause");
  assert.equal(s.frames.size, 0);
  s.document.hidden = true;
  s.document.emit("visibilitychange");
  s.video.paused = false;
  s.video.emit("playing");
  assert.equal(s.frames.size, 0);
});

test("an exposed but unusable decoded-frame API falls back without throwing", (t) => {
  const s = setup(t, { paused: false, throwRequest: true });
  assert.equal(s.frames.size, 1);
  assert.equal(s.videoFrames.size, 0);
  s.advance(100, 0.1);
  assert.deepEqual(s.draws, [0, 0.1]);
});

test("cleanup cancels every handle/listener and ignores late decoded callbacks", (t) => {
  const s = setup(t, { paused: false });
  const stale = [...s.videoFrames.values()][0];
  s.cleanup();
  s.cleanup();
  assert.equal(s.videoFrames.size, 0);
  assert.equal(s.frames.size, 0);
  stale(100, { mediaTime: 0.1 });
  assert.deepEqual(s.draws, [0]);
  for (const target of [s.video, s.document, s.motion]) {
    for (const listeners of target.listeners.values())
      assert.equal(listeners.size, 0);
  }
});

test("fallback teardown cancels its animation frame", (t) => {
  const s = setup(t, { decoded: false, paused: false });
  const stale = [...s.frames.values()][0];
  s.cleanup();
  assert.equal(s.frames.size, 0);
  stale(100);
  assert.deepEqual(s.draws, [0]);
});
