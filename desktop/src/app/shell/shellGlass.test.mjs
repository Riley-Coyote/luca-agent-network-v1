import assert from "node:assert/strict";
import test from "node:test";

import {
  applyFrameVibrancy,
  CARD_SELECTOR,
  ONE_CARD_SELECTOR,
  cardShadow,
  conversationCard,
  createGlassReporter,
  drawnFrame,
  FRAME_STORAGE_KEY,
  frameMessage,
  frameCards,
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

test("fresh frame setting defaults to glass without writing a preference", () => {
  const storage = memoryStorage();
  assert.equal(readFrame(storage), "glass");
  assert.equal(storage.values.size, 0);
  assert.equal(readFrame(null), "glass");
});

test("frame setting ignores anything but solid or glass", () => {
  assert.equal(
    readFrame(memoryStorage({ "polyphonic-frame": "liquid" })),
    "glass",
  );
  assert.equal(readFrame(memoryStorage({ "polyphonic-frame": "" })), "glass");
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
  assert.equal(readFrame(broken), "glass");
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

test("glass is offered only where it can be drawn: Tauri on a Mac", () => {
  assert.equal(glassFrameOffered({ tauri: false, mac: true }), false);
  assert.equal(glassFrameOffered({ tauri: true, mac: true }), true);
  // Windows' own glass comes with the app's Windows build.
  assert.equal(glassFrameOffered({ tauri: true, mac: false }), false);
  assert.equal(glassFrameOffered({ tauri: false, mac: false }), false);
});

test("under Reduce Transparency the glass stays chosen and says it is drawn solid", () => {
  assert.equal(
    frameSentence("glass", {
      isDark: true,
      announced: true,
      reducedTransparency: true,
    }),
    "Liquid Glass, drawn solid while Reduce Transparency is on.",
  );
  assert.equal(
    frameSentence("glass", {
      isDark: false,
      announced: false,
      reducedTransparency: true,
    }),
    "Glass, drawn solid while Reduce Transparency is on.",
  );
  assert.equal(
    frameSentence("solid", {
      isDark: true,
      announced: true,
      reducedTransparency: true,
    }),
    "Solid black, nothing showing through it.",
  );
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

test("frosted vibrancy: square corners in full screen", () => {
  assert.equal(frostedVibrancyArgs(true, true).cornerRadius, 0);
  assert.equal(frostedVibrancyArgs(false, true).cornerRadius, 0);
  assert.equal(frostedVibrancyArgs(true, false).cornerRadius, 16);
});

test("applyFrameVibrancy sends the full-screen corner", async () => {
  const calls = [];
  const invoke = async (command, args) => {
    calls.push([command, args]);
    return null;
  };
  await applyFrameVibrancy("frosted", true, invoke, true);
  await applyFrameVibrancy("frosted", true, invoke, false);
  assert.deepEqual(
    calls.map(([, args]) => args.cornerRadius),
    [0, 16],
  );
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
  assert.equal("tint" in message.sheet, false);
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

test("the card set is the one card, glass-floor.css's, the frame's rail and the runtime sessions card", () => {
  assert.equal(
    CARD_SELECTOR,
    '[data-luca-one-card], [data-luca-card], [data-luca-conversation-surface]:not(:has([data-luca-workspace-floor])), [data-frame] [data-sidebar="sidebar"], [data-luca-frame-row] > [data-luca-runtime-card]',
  );
  assert.equal(ONE_CARD_SELECTOR, "[data-luca-one-card]");
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

test("conversation measurement reads each eligible card once and preserves leftmost/non-runtime selection", () => {
  const original = globalThis.getComputedStyle;
  const counts = new Map();
  const makeCard = (
    name,
    x,
    { rail = false, runtime = false, width = 100, hidden = false } = {},
  ) => {
    const card = {
      matches: (selector) =>
        selector.includes("data-luca-runtime-card") && runtime,
      contains: () => false,
      closest: () => (rail ? {} : null),
      getBoundingClientRect: () => {
        counts.set(name, (counts.get(name) ?? 0) + 1);
        return { x, y: 20, width, height: 200 };
      },
      hidden,
    };
    return card;
  };
  const rail = makeCard("rail", 0, { rail: true });
  const runtime = makeCard("runtime", 100, { runtime: true });
  const right = makeCard("right", 600);
  const conversation = makeCard("conversation", 300);
  const hidden = makeCard("hidden", -10, { hidden: true });
  const collapsed = makeCard("collapsed", -20, { width: 0 });
  const doc = {
    querySelectorAll: () => [
      rail,
      runtime,
      right,
      conversation,
      hidden,
      collapsed,
    ],
  };
  globalThis.getComputedStyle = (element) => ({
    visibility: element.hidden ? "hidden" : "visible",
  });
  try {
    assert.equal(conversationCard(doc), conversation);
    assert.deepEqual([...counts.values()], [1, 1, 1, 1, 1, 1]);
    counts.clear();
    assert.deepEqual(frameCards(doc), [rail, runtime, right, conversation]);
    assert.deepEqual([...counts.values()], [1, 1, 1, 1, 1, 1]);
  } finally {
    if (original) globalThis.getComputedStyle = original;
    else delete globalThis.getComputedStyle;
  }
});
