import assert from "node:assert/strict";
import test from "node:test";

import {
  applyFrameVibrancy,
  CARD_SELECTOR,
  cardShadow,
  createGlassReporter,
  drawnFrame,
  FRAME_STORAGE_KEY,
  frameMessage,
  frameSentence,
  frostedVibrancyArgs,
  glassFrameName,
  glassFrameOffered,
  GLASS_SETTINGS,
  readFrame,
  solidFrameName,
  TRAFFIC_LIGHTS,
  writeFrame,
} from "./shellGlass.ts";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    values,
  };
}

const env = (overrides = {}) => ({
  tauri: true,
  mac: true,
  announced: false,
  reducedTransparency: false,
  ...overrides,
});

// ── the setting ─────────────────────────────────────────────────────────

test("frame setting is stored under polyphonic-frame", () => {
  assert.equal(FRAME_STORAGE_KEY, "polyphonic-frame");
  const storage = memoryStorage();
  writeFrame("glass", storage);
  assert.equal(storage.values.get("polyphonic-frame"), "glass");
  assert.equal(readFrame(storage), "glass");
  writeFrame("solid", storage);
  assert.equal(readFrame(storage), "solid");
});

test("frame setting defaults to solid", () => {
  assert.equal(readFrame(memoryStorage()), "solid");
  assert.equal(readFrame(null), "solid");
});

test("frame setting ignores anything but solid or glass", () => {
  assert.equal(
    readFrame(memoryStorage({ "polyphonic-frame": "liquid" })),
    "solid",
  );
  assert.equal(readFrame(memoryStorage({ "polyphonic-frame": "" })), "solid");
});

test("frame setting survives storage that throws", () => {
  const broken = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  assert.equal(readFrame(broken), "solid");
  assert.doesNotThrow(() => writeFrame("glass", broken));
});

// ── naming by platform ──────────────────────────────────────────────────

test("first choice is Black at night and Paper by day", () => {
  assert.equal(solidFrameName(true), "Black");
  assert.equal(solidFrameName(false), "Paper");
});

test("glass is Liquid Glass when the native glass announced, Glass otherwise", () => {
  assert.equal(glassFrameName({ announced: true }), "Liquid Glass");
  assert.equal(glassFrameName({ announced: false }), "Glass");
});

test("glass is not offered outside Tauri", () => {
  assert.equal(glassFrameOffered({ tauri: false }), false);
  assert.equal(glassFrameOffered({ tauri: true }), true);
});

test("the sentence says what each choice draws", () => {
  assert.equal(
    frameSentence("solid", { isDark: true, announced: false }),
    "Solid black, nothing showing through it.",
  );
  assert.equal(
    frameSentence("solid", { isDark: false, announced: true }),
    "Solid paper, nothing showing through it.",
  );
  assert.equal(
    frameSentence("glass", { isDark: true, announced: true }),
    "Liquid Glass, your desktop showing through it.",
  );
  assert.equal(
    frameSentence("glass", { isDark: false, announced: false }),
    "Glass, your desktop softly blurred behind it.",
  );
});

// ── what Glass draws ────────────────────────────────────────────────────

test("solid draws solid everywhere", () => {
  assert.equal(drawnFrame("solid", env({ announced: true })), "solid");
});

test("glass draws Liquid Glass when announced", () => {
  assert.equal(drawnFrame("glass", env({ announced: true })), "liquid");
});

test("glass draws the frosted glass on a Mac without the native glass", () => {
  assert.equal(drawnFrame("glass", env()), "frosted");
});

test("glass draws nothing in a browser", () => {
  assert.equal(
    drawnFrame("glass", env({ tauri: false, announced: true })),
    "solid",
  );
});

test("reduce transparency draws the solid frame everywhere", () => {
  assert.equal(
    drawnFrame("glass", env({ announced: true, reducedTransparency: true })),
    "solid",
  );
  assert.equal(
    drawnFrame("glass", env({ reducedTransparency: true })),
    "solid",
  );
});

test("glass stays solid in Tauri off the Mac until Windows glass comes", () => {
  assert.equal(drawnFrame("glass", env({ mac: false })), "solid");
});

// ── the frosted fallback ────────────────────────────────────────────────

test("frosted vibrancy: heads-up display at night, held active, corner 16", () => {
  assert.deepEqual(frostedVibrancyArgs(true), {
    enabled: true,
    material: "hud-window",
    state: "active",
    cornerRadius: 16,
  });
});

test("frosted vibrancy: under-window background by day", () => {
  assert.deepEqual(frostedVibrancyArgs(false), {
    enabled: true,
    material: "under-window-background",
    state: "active",
    cornerRadius: 16,
  });
});

test("applyFrameVibrancy calls set_window_vibrancy only for the frosted frame", async () => {
  const calls = [];
  const invoke = async (command, args) => {
    calls.push([command, args]);
    return null;
  };
  assert.equal(await applyFrameVibrancy("frosted", true, invoke), true);
  assert.equal(await applyFrameVibrancy("liquid", true, invoke), false);
  assert.equal(await applyFrameVibrancy("solid", false, invoke), false);
  assert.deepEqual(calls, [
    [
      "set_window_vibrancy",
      {
        enabled: true,
        material: "hud-window",
        state: "active",
        cornerRadius: 16,
      },
    ],
  ]);
});

test("applyFrameVibrancy passes a failed install on", async () => {
  const invoke = async () => {
    throw new Error("no vibrancy");
  };
  await assert.rejects(applyFrameVibrancy("frosted", false, invoke));
});

// ── the reporter ────────────────────────────────────────────────────────

const card = { x: 268, y: 36, w: 1166, h: 858, r: 10 };

test("frame message: the whole window, radius 16, dark tint, no floor, the card", () => {
  assert.deepEqual(
    frameMessage({
      width: 1440,
      height: 900,
      fullscreen: false,
      isDark: true,
      card,
    }),
    {
      card,
      floor: "none",
      row: null,
      clip: null,
      sheet: {
        x: 0,
        y: 0,
        w: 1440,
        h: 900,
        r: 16,
        style: "regular",
        tint: "#00000080",
        appearance: "dark",
      },
    },
  );
});

test("frame message: no tint and light appearance by day", () => {
  const message = frameMessage({
    width: 1280,
    height: 720,
    fullscreen: false,
    isDark: false,
    card,
  });
  assert.equal(message.sheet.tint, null);
  assert.equal(message.sheet.appearance, "light");
  assert.equal(message.sheet.style, "regular");
});

test("frame message: square corners in full screen", () => {
  const message = frameMessage({
    width: 1512,
    height: 982,
    fullscreen: true,
    isDark: true,
    card: null,
  });
  assert.equal(message.sheet.r, 0);
  assert.equal(message.card, null);
});

test("reporter: settings with cardGlass false, then frames, deduped", () => {
  const posted = [];
  const reporter = createGlassReporter(
    (body) => posted.push(body),
    () => 42,
  );
  reporter.start();
  const message = frameMessage({
    width: 1440,
    height: 900,
    fullscreen: false,
    isDark: true,
    card,
  });
  assert.equal(reporter.report(message), true);
  assert.equal(reporter.report({ ...message }), false);
  assert.equal(reporter.report({ ...message, card: { ...card, x: 48 } }), true);
  assert.deepEqual(posted[0], { ...GLASS_SETTINGS });
  assert.equal(posted[0].cardGlass, false);
  assert.deepEqual(posted[1], { type: "frame", ...message, t: 42 });
  assert.equal(posted.length, 3);
  assert.equal(posted[2].card.x, 48);
});

test("reporter: off stands the glass down, and the next frame is sent again", () => {
  const posted = [];
  const reporter = createGlassReporter(
    (body) => posted.push(body),
    () => 0,
  );
  const message = frameMessage({
    width: 800,
    height: 500,
    fullscreen: false,
    isDark: true,
    card,
  });
  reporter.start();
  reporter.report(message);
  reporter.stop();
  assert.deepEqual(posted.at(-1), { type: "off" });
  reporter.start();
  assert.equal(reporter.report(message), true);
});

test("reduce transparency sends off: the reporter stops when the frame leaves liquid", () => {
  // The reporter runs only while the frame draws Liquid Glass; Reduce
  // Transparency draws the solid frame, which stops it, and stopping is off.
  assert.equal(
    drawnFrame("glass", env({ announced: true, reducedTransparency: true })),
    "solid",
  );
  const posted = [];
  const reporter = createGlassReporter(
    (body) => posted.push(body),
    () => 0,
  );
  reporter.start();
  reporter.stop();
  assert.deepEqual(posted, [{ ...GLASS_SETTINGS }, { type: "off" }]);
});

// ── the traffic lights ──────────────────────────────────────────────────

test("traffic lights sit at 16 on the lip's line, 22", () => {
  assert.deepEqual({ ...TRAFFIC_LIGHTS }, { x: 16, centre: 22 });
});

// ── the cards on the glass ──────────────────────────────────────────────

test("the card set is glass-floor.css's, the frame's rail card and the runtime sessions card", () => {
  assert.equal(
    CARD_SELECTOR,
    '[data-luca-card], [data-luca-conversation-surface]:not(:has([data-luca-workspace-floor])), [data-frame] [data-sidebar="sidebar"], [data-luca-frame-row] > [data-luca-runtime-card]',
  );
});

test("a card's shadow lies where it is, cast in full", () => {
  assert.deepEqual(cardShadow({ x: 268, y: 36, w: 1166, h: 858 }, 10, null), {
    x: 268,
    y: 36,
    w: 1166,
    h: 858,
    r: 10,
    opacity: 1,
  });
});

test("the rail's shadow fades as its card narrows, gone when shut", () => {
  const rail = { full: 220 };
  const at = (w) => cardShadow({ x: 44, y: 36, w, h: 858 }, 10, rail).opacity;
  assert.equal(at(220), 1);
  assert.equal(at(110), 0.5);
  assert.equal(at(0), 0);
  // Peeking wider than its stored width never casts more than in full.
  assert.equal(at(260), 1);
  // A rail whose full width can't be read is cast in full.
  assert.equal(
    cardShadow({ x: 44, y: 36, w: 110, h: 858 }, 10, { full: Number.NaN })
      .opacity,
    1,
  );
});
