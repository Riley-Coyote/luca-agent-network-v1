import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import ts from "typescript";

type Original = typeof import("../../../src/shared/ui/dendrite/original");
type Panel = InstanceType<Original["DotPanel"]>;
type TestWindow = Window & {
  __original: Original;
  LucaDots: {
    registerScene(name: string, scene: () => void): void;
    registerPanel(canvas: HTMLCanvasElement, options: { cell: number }): Panel;
    dlaScene: Original["dlaScene"];
    MAGNITUDE_LUT_INKFLOOR: Uint8Array;
  };
  __now: number;
  __next: number;
  __frames: Map<number, FrameRequestCallback>;
};

const reference = readFileSync(
  new URL("../../fixtures/original-72/luca-sigil-engine.js", import.meta.url),
  "utf8",
);
const port = ts.transpileModule(
  readFileSync(
    new URL("../../../src/shared/ui/dendrite/original.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
    },
  },
).outputText;

async function load(page: Page) {
  await page.setContent(
    `<style>canvas{display:block;width:72px;height:72px;box-sizing:border-box;background:rgb(10,11,12);border:1px solid rgb(40,42,44);border-radius:50%}</style><canvas id="reference"></canvas><canvas id="port"></canvas>`,
  );
  await page.evaluate(() => {
    const w = window as unknown as TestWindow;
    Object.defineProperty(window, "ResizeObserver", { value: undefined });
    Object.defineProperty(window, "IntersectionObserver", { value: undefined });
    w.__now = 0;
    w.__next = 0;
    w.__frames = new Map();
    w.requestAnimationFrame = (callback: FrameRequestCallback) => {
      const id = ++w.__next;
      w.__frames.set(id, callback);
      return id;
    };
    w.cancelAnimationFrame = (id: number) => w.__frames.delete(id);
    Object.defineProperty(performance, "now", { value: () => w.__now });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });
  });
  await page.addScriptTag({ content: reference });
  await page.addScriptTag({
    content: `(function(exports){${port}\n})(window.__original = {});`,
  });
}

for (const dpr of [1, 2]) {
  test(`Aug 10 original pixels match exactly at DPR ${dpr}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ deviceScaleFactor: dpr });
    const page = await context.newPage();
    await load(page);
    const result = await page.evaluate(() => {
      const w = window as unknown as TestWindow;
      const D = w.LucaDots;
      const P = w.__original;
      const seed = () => {
        let state = 42;
        Math.random = () => {
          state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
          return state / 4294967296;
        };
      };
      const savedRandom = Math.random;
      D.registerScene("parity-noop", () => {});
      const a = document.querySelector("#reference") as HTMLCanvasElement;
      const b = document.querySelector("#port") as HTMLCanvasElement;
      a.dataset.scene = "parity-noop";
      seed();
      const original = D.registerPanel(a, { cell: 1 });
      original.enableMagnitude(D.MAGNITUDE_LUT_INKFLOOR);
      for (let i = 0; i < 620; i++) D.dlaScene(original);
      original.draw();
      seed();
      const candidate = new P.DotPanel(b);
      candidate.enableMagnitude(P.MAGNITUDE_LUT_INKFLOOR);
      for (let i = 0; i < 620; i++) P.dlaScene(candidate);
      candidate.draw();
      Math.random = savedRandom;
      const leftContext = a.getContext("2d");
      const rightContext = b.getContext("2d");
      if (!leftContext || !rightContext)
        throw new Error("2d context unavailable");
      const left = leftContext.getImageData(0, 0, a.width, a.height).data;
      const right = rightContext.getImageData(0, 0, b.width, b.height).data;
      return {
        size: [a.width, b.width],
        differences: left.reduce(
          (n, value, i) => n + Number(value !== right[i]),
          0,
        ),
        lit: left.filter((_, i) => i % 4 === 3 && left[i] > 0).length,
        cells: [original.W, candidate.W],
      };
    });
    expect(result.size).toEqual([72 * dpr, 72 * dpr]);
    expect(result.cells).toEqual([36 * dpr, 36 * dpr]);
    expect(result.lit).toBeGreaterThan(40);
    expect(result.differences).toBe(0);
    await context.close();
  });
}

for (const hz of [60, 120, 240]) {
  test(`original clock runs 600 steps in 10 seconds at ${hz} Hz`, async ({
    page,
  }) => {
    await load(page);
    const result = await page.evaluate((hz) => {
      const w = window as unknown as TestWindow;
      const P = w.__original;
      let steps = 0;
      let draws = 0;
      const fade = P.DotPanel.prototype.fade;
      const draw = P.DotPanel.prototype.draw;
      P.DotPanel.prototype.fade = function (k: number) {
        steps++;
        fade.call(this, k);
      };
      P.DotPanel.prototype.draw = function () {
        draws++;
        draw.call(this);
      };
      const renderer = new P.OriginalRenderer();
      const handle = renderer.register(
        document.querySelector("#port") as HTMLCanvasElement,
      );
      const mount = { steps, draws };
      for (let i = 1; i <= hz * 10; i++) {
        w.__now = (i * 1000) / hz;
        const callbacks = [...w.__frames.values()];
        w.__frames.clear();
        for (const callback of callbacks)
          (callback as FrameRequestCallback)(w.__now);
      }
      handle.dispose();
      return { mount, steps, draws, pending: w.__frames.size };
    }, hz);
    expect(result.mount).toEqual({ steps: 20, draws: 1 });
    expect(result.steps).toBe(620);
    expect(result.draws).toBe(601);
    expect(result.pending).toBe(0);
  });
}

test("original Reduce Motion holds the 20-step mount frame with no loop", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await load(page);
  const result = await page.evaluate(() => {
    const w = window as unknown as TestWindow;
    const P = w.__original;
    let steps = 0;
    let draws = 0;
    const fade = P.DotPanel.prototype.fade;
    const draw = P.DotPanel.prototype.draw;
    P.DotPanel.prototype.fade = function (k: number) {
      steps++;
      fade.call(this, k);
    };
    P.DotPanel.prototype.draw = function () {
      draws++;
      draw.call(this);
    };
    const handle = new P.OriginalRenderer().register(
      document.querySelector("#port") as HTMLCanvasElement,
    );
    const result = { steps, draws, pending: w.__frames.size };
    handle.dispose();
    return result;
  });
  expect(result).toEqual({ steps: 20, draws: 1, pending: 0 });
});
