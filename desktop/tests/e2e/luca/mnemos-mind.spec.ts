import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import {
  chromium,
  expect,
  type Frame,
  type Page,
  type Request,
  test,
} from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";
import { HERON_HELLO, heronNotebook } from "./mnemos-mind-fixture";

/**
 * WP-50, The mind (polyphonic-beta14-finish.md): Mnemos's own picture of a
 * mind, copied unchanged into the app's files and drawn in a frame fed only
 * from what the place holds. Heron is made up; its engine is played by this
 * spec, in the page. The picture needs a graphics card: the runs that look
 * at it use Playwright's full Chromium, headless, on the Mac's own GPU
 * through Metal (WP-50, Decided 9); the default headless shell draws in
 * software, which is the engine's own refusal (Decided 6).
 */

const SHOTS = process.env.WP50_SHOTS ?? "test-results/wp50";
const LUCA = "a".repeat(64);
type Mode = "dark" | "light";

const GPU = {
  channel: "chromium",
  launchOptions: {
    args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
  },
} as const;

test.use({
  ...GPU,
  deviceScaleFactor: 2,
  trace: "off",
  video: "off",
  viewport: { width: 1440, height: 900 },
});
test.describe.configure({ timeout: 180_000 });

type Probe = {
  calls: { cmd: string; part?: string; since?: string }[];
  pulses: number;
};

function measure(key: string, value: unknown) {
  mkdirSync(`${SHOTS}/measures`, { recursive: true });
  writeFileSync(
    `${SHOTS}/measures/${key}.json`,
    JSON.stringify(value, null, 2),
  );
}

async function boot(
  page: Page,
  {
    hash = "/mnemos?room=mind",
    mode = "dark",
    count = 360,
    older = false,
  }: { hash?: string; mode?: Mode; count?: number; older?: boolean } = {},
) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.addInitScript(
    ({ luca, notebook, hello, older }) => {
      // The app's window only: the mind's own frame is the page's, not ours.
      if (window !== window.top) return;
      type Call = (
        cmd: string,
        args?: Record<string, unknown>,
        opts?: unknown,
      ) => Promise<unknown>;
      const win = window as unknown as {
        __TAURI_INTERNALS__?: { invoke?: Call };
        mindProbe: Probe;
        /** Something comes to the mind: these memories, recalled. */
        mindRecall: (ids: string[]) => void;
      };
      const bridge = win.__TAURI_INTERNALS__ ?? {};
      win.__TAURI_INTERNALS__ = bridge;
      const probe: Probe = { calls: [], pulses: 0 };
      win.mindProbe = probe;
      const events: {
        key: string;
        kind: string;
        at: string;
        ids: string[];
      }[] = [];
      win.mindRecall = (ids) =>
        events.push({
          key: `ev${events.length + 1}`,
          kind: "recall",
          at: new Date().toISOString(),
          ids,
        });
      const ids = new Set(notebook.memories.map((m) => m.id));
      const fail = (code: string) => Promise.reject(code);
      let open = false;
      const summary = () => ({
        missing: false,
        counts: {
          memories: notebook.memories.length,
          shared: 0,
          beliefs: 0,
          questions: 0,
          answered: 0,
          journal: notebook.life.journal.length,
          notes: 0,
          replies: 0,
          hours: notebook.life.hours.length,
          made: notebook.life.studio.length,
          carrying: 0,
        },
        unread: 0,
        waiting: 0,
        change_token: "ht1",
      });
      const place = async (cmd: string, args: Record<string, unknown> = {}) => {
        if (cmd === "mnemos_place_minds")
          return {
            mnemosReady: true,
            minds: [
              {
                id: "heron",
                name: "Heron",
                memories: notebook.memories.length,
                newest: new Date().toISOString().slice(0, 10),
                linked: [{ pubkey: luca, name: "Luca" }],
              },
            ],
            withoutMemory: [],
          };
        if (cmd === "open_mnemos_mind") {
          open = true;
          return true;
        }
        if (cmd === "close_mnemos_place") {
          open = false;
          return null;
        }
        if (cmd === "mnemos_place_shown") return null;
        if (cmd === "mnemos_place_hello") return older ? null : hello;
        if (cmd === "mnemos_place_item") return ids.has(String(args.id));
        if (cmd === "mnemos_place_picture") return fail("unknown_item");
        if (cmd === "mnemos_view_status")
          return {
            grant: null,
            scope: null,
            readerReady: false,
            linked: false,
            mnemosReady: true,
          };
        if (cmd === "read_mnemos_place") {
          if (!open) return fail("not_open");
          const request = args.request as Record<string, unknown>;
          if (older) {
            if (request.command === "memories")
              return {
                kind: "memories",
                memories: [],
                counts: { active: 0, dormant: 0, archived: 0 },
              };
            if (request.command === "journal")
              return { kind: "journal", entries: [] };
            if (request.command === "notes")
              return { kind: "notes", notes: [] };
            return fail("invalid_request");
          }
          if (request.command === "summary")
            return { kind: "summary", summary: summary() };
          if (request.command === "notebook" && request.part === "life")
            return {
              kind: "notebook",
              part: "life",
              document: notebook.life,
              page: null,
              pictures: [],
            };
          if (request.command === "notebook" && request.part === "memories") {
            const offset = Number(request.offset ?? 0);
            const limit = Number(request.limit ?? notebook.memories.length);
            const slice = notebook.memories.slice(offset, offset + limit);
            const end = offset + slice.length;
            return {
              kind: "notebook",
              part: "memories",
              document: {
                version: notebook.version,
                made: new Date().toISOString(),
                memories: slice,
                ...(offset === 0 ? { recalled: [] } : {}),
              },
              page: {
                offset,
                limit,
                total: notebook.memories.length,
                next: end < notebook.memories.length ? end : null,
              },
              pictures: [],
            };
          }
          if (request.command === "notebook" && request.part === "pulse") {
            probe.pulses += 1;
            const since =
              typeof request.since === "string"
                ? Date.parse(request.since)
                : Date.now() - 60_000;
            return {
              kind: "notebook",
              part: "pulse",
              document: {
                now: new Date().toISOString(),
                events: events.filter((e) => Date.parse(e.at) >= since),
              },
              page: null,
              pictures: [],
            };
          }
          return fail("invalid_request");
        }
        return fail(`unexpected ${cmd}`);
      };
      let delegate: Call | undefined;
      Object.defineProperty(bridge, "invoke", {
        configurable: true,
        set(next: Call) {
          delegate = next;
        },
        get:
          () =>
          async (
            cmd: string,
            args?: Record<string, unknown>,
            opts?: unknown,
          ) => {
            if (!cmd.includes("mnemos")) return delegate?.(cmd, args, opts);
            const request = args?.request as
              | { part?: string; since?: string }
              | undefined;
            probe.calls.push({
              cmd,
              part: request?.part,
              since: request?.since,
            });
            return place(cmd, args);
          },
      });
    },
    {
      luca: LUCA,
      notebook: heronNotebook(Date.now(), count),
      hello: HERON_HELLO,
      older,
    },
  );
  await installMockBridge(page, {
    managedAgents: [
      {
        channelNames: ["agents"],
        name: "Luca",
        pubkey: LUCA,
        personaId: "builtin:fizz",
        status: "running",
        backend: { type: "local" },
      },
    ],
  });
  await page.addInitScript(
    ({ key, light }) => {
      if (window !== window.top) return;
      let overrides: Record<string, boolean> = {};
      try {
        overrides = JSON.parse(localStorage.getItem(key) ?? "{}");
      } catch {
        overrides = {};
      }
      overrides["shell-frame"] = true;
      localStorage.setItem(key, JSON.stringify(overrides));
      if (light) {
        localStorage.setItem("buzz-theme", "paper");
        localStorage.setItem("buzz-follow-system", "false");
      }
    },
    { key: FEATURE_OVERRIDES_STORAGE_KEY, light: mode === "light" },
  );
  await expect(async () => {
    await page.goto(`/#${hash}`);
    await expect(page.getByTestId("app-sidebar").first()).toBeVisible({
      timeout: 20_000,
    });
  }).toPass({ timeout: 60_000 });
  return errors;
}

/** Every request the mind's frame makes, as the browser saw them. */
function watchFrameRequests(page: Page) {
  const seen: { url: string; type: string; from: string }[] = [];
  page.on("request", (request: Request) => {
    const from = request.frame()?.url() ?? "";
    if (
      !from.includes("/mnemos-mind/") &&
      !request.url().includes("/mnemos-mind/")
    )
      return;
    seen.push({
      url: new URL(request.url()).pathname,
      type: request.resourceType(),
      from: from.includes("/mnemos-mind/") ? "frame" : "app",
    });
  });
  return seen;
}

const mindFrame = (page: Page): Frame | null =>
  page.frames().find((f) => f.url().includes("/mnemos-mind/mind/")) ?? null;

async function drawn(page: Page) {
  await expect(page.getByTestId("mnemos-mind-frame")).toHaveAttribute(
    "data-drawn",
    "",
    { timeout: 120_000 },
  );
  const frame = mindFrame(page);
  if (!frame) throw new Error("no frame");
  return frame;
}

async function shot(page: Page, name: string) {
  await waitForAnimations(page);
  await page.waitForTimeout(400);
  mkdirSync(SHOTS, { recursive: true });
  const path = `${SHOTS}/${name}.png`;
  await page.screenshot({ path });
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const probeOf = (page: Page) =>
  page.evaluate(() => (window as unknown as { mindProbe: Probe }).mindProbe);

/** The frame's own reading: its renderer, its count line, what it drew. */
const frameFacts = (frame: Frame) =>
  frame.evaluate(() => {
    const c = document.getElementById("mind") as HTMLCanvasElement | null;
    const gl = c?.getContext("webgl2");
    const e = gl?.getExtension("WEBGL_debug_renderer_info");
    const api = (window as unknown as { __mind?: Record<string, unknown> })
      .__mind;
    return {
      renderer: gl
        ? String(gl.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : gl.RENDERER))
        : "none",
      counts: document.getElementById("who-sub")?.textContent?.trim() ?? "",
      cells: Number(api?.N ?? 0),
      selected: Number(api?.selected ?? -1),
      // Everything the frame shows besides the picture, by what it is.
      shown: [...document.querySelectorAll("body *")]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return (
            r.width > 0 &&
            r.height > 0 &&
            s.visibility !== "hidden" &&
            s.display !== "none" &&
            el.closest("#room") === null &&
            (el.textContent ?? "").trim() !== "" &&
            el.children.length === 0
          );
        })
        .map((el) => `${el.id || el.className}: ${el.textContent?.trim()}`),
    };
  });

/** Presses the cell of one memory, where the engine draws it. */
async function press(page: Page, frame: Frame, id: string) {
  const at = await frame.evaluate((id) => {
    const api = (
      window as unknown as {
        __mind: {
          byId: (id: string) => number | undefined;
          where: (i: number) => { x: number; y: number } | null;
        };
      }
    ).__mind;
    const i = api.byId(id);
    return i === undefined ? null : api.where(i);
  }, id);
  if (!at) throw new Error(`no cell for ${id}`);
  const box = await page.getByTestId("mnemos-mind-frame").boundingBox();
  if (!box) throw new Error("no frame box");
  await page.mouse.click(box.x + at.x, box.y + at.y);
}

/** A row of the place's rail, by its name. */
const railRow = (page: Page, name: string) =>
  page.locator(`[data-shell-rail] button[aria-label="${name}"]`).first();

const itemInAddress = (page: Page) =>
  new URLSearchParams(page.url().split("?")[1] ?? "").get("item");

const frameLog = (page: Page) =>
  page.getByTestId("mnemos-mind-frame").getAttribute("data-feed");

test.describe("The mind, on the Mac's graphics card", () => {
  for (const mode of ["dark", "light"] as const)
    test(`draws Mnemos's own picture, fed from memory only, ${mode}`, async ({
      page,
    }) => {
      const requests = watchFrameRequests(page);
      const errors = await boot(page, { mode });
      // In the rail, right after At a glance.
      const rows = page.locator("[data-shell-rail] .luca-rail-row-name");
      const names = await rows.allTextContents();
      expect(names.indexOf("The mind")).toBe(names.indexOf("At a glance") + 1);
      const frame = await drawn(page);
      await page.waitForTimeout(2500);
      const facts = await frameFacts(frame);
      // The head's count is the engine's own line.
      await expect(page.getByTestId("mnemos-mind-count")).toHaveText(
        facts.counts,
      );
      expect(facts.counts).toMatch(/memories awake/);
      // Only the picture: nothing of the page's own shows but the way back
      // to its middle, which shows only once you've moved.
      expect(facts.shown.filter((s) => !s.startsWith("ui recenter"))).toEqual(
        [],
      );
      // Its light follows the app's.
      const ink = await page
        .getByTestId("mnemos-mind-frame")
        .evaluate((el) => ({
          ink: el.hasAttribute("data-ink"),
          blend: getComputedStyle(el).mixBlendMode,
          filter: getComputedStyle(el).filter,
        }));
      expect(ink.ink).toBe(mode === "light");
      const hash = await shot(page, `0${mode === "dark" ? 1 : 2}-mind-${mode}`);
      const log = await frameLog(page);
      const leaked = requests.filter(
        (r) =>
          /\/mnemos-mind\/(data\/|act)/.test(r.url) ||
          r.type === "fetch" ||
          r.type === "xhr",
      );
      expect(leaked).toEqual([]);
      expect(requests.every((r) => r.url.startsWith("/mnemos-mind/"))).toBe(
        true,
      );
      const fedInTime = await page
        .getByTestId("mnemos-mind-frame")
        .getAttribute("data-fed-in-time");
      expect(fedInTime).toBe("true");
      expect(errors).toEqual([]);
      measure(`look-${mode}`, {
        renderer: facts.renderer,
        counts: facts.counts,
        cells: facts.cells,
        light: ink,
        feed: log,
        fedInTime,
        requests,
        errors,
        hash,
      });
    });

  for (const mode of ["dark", "light"] as const)
    test(`a memory pressed opens beside it, ${mode}`, async ({ page }) => {
      const errors = await boot(page, { mode });
      const frame = await drawn(page);
      await page.waitForTimeout(1500);
      const id = "her-m0347";
      await press(page, frame, id);
      const picked = page.getByTestId("mnemos-mind-picked");
      await expect(picked).toBeVisible();
      const chosen = itemInAddress(page);
      expect(chosen).toMatch(/^her-m\d{4}$/);
      // The panel holds the memory the address holds, and the engine marks it.
      await expect(picked).toContainText(
        `(note ${Number(chosen?.slice(5)) + 1})`,
      );
      await expect
        .poll(async () => (await frameFacts(frame)).selected, {
          timeout: 10_000,
        })
        .toBeGreaterThanOrEqual(0);
      const drawing = page.getByTestId("mnemos-memory-drawing");
      await expect(drawing).toHaveAttribute("role", "img");
      const alt = await drawing.getAttribute("aria-label");
      expect(alt).toMatch(/^(A lesson|An experience), /);
      // The person's press puts them in the panel.
      await expect(picked).toBeFocused();
      await page.waitForTimeout(1800);
      const hash = await shot(
        page,
        `0${mode === "dark" ? 3 : 4}-mind-picked-${mode}`,
      );
      // The keyboard reaches its two links.
      await page.keyboard.press("Tab");
      await expect(page.getByTestId("mnemos-mind-open-it")).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.getByTestId("mnemos-mind-whole")).toBeFocused();
      let close = "";
      if (mode === "dark") {
        // The drawing alone, three times its size.
        await drawing.evaluate((el) => {
          const box = el.parentElement as HTMLElement;
          const panel = el.closest("aside") as HTMLElement;
          panel.style.width = "400px";
          box.style.width = "336px";
          box.style.height = "336px";
        });
        await page.waitForTimeout(1200);
        mkdirSync(SHOTS, { recursive: true });
        await drawing.screenshot({
          path: `${SHOTS}/07-drawing-close-dark.png`,
        });
        close = createHash("sha256")
          .update(readFileSync(`${SHOTS}/07-drawing-close-dark.png`))
          .digest("hex");
        await drawing.evaluate((el) => {
          const box = el.parentElement as HTMLElement;
          box.style.width = "";
          box.style.height = "";
        });
      }
      // "The whole mind" lets go of the pick.
      await page.getByTestId("mnemos-mind-whole").press("Enter");
      await expect(picked).toHaveCount(0);
      expect(itemInAddress(page)).toBeNull();
      await expect
        .poll(async () => (await frameFacts(frame)).selected, {
          timeout: 10_000,
        })
        .toBe(-1);
      // Back brings the pick back, from the address.
      await page.goBack();
      await expect(picked).toBeVisible();
      expect(itemInAddress(page)).toBe(chosen);
      // "Open it": Memories, with it open.
      await page.getByTestId("mnemos-mind-open-it").click();
      await expect(page.getByTestId("mnemos-memory-opened")).toBeVisible();
      expect(new URLSearchParams(page.url().split("?")[1]).get("room")).toBe(
        "memories",
      );
      expect(itemInAddress(page)).toBe(chosen);
      expect(errors).toEqual([]);
      measure(`pick-${mode}`, { chosen, alt, hash, close });
    });

  test("the address holds a pick, and lands on it", async ({ page }) => {
    const errors = await boot(page, {
      hash: "/mnemos?room=mind&item=her-m0042",
    });
    const frame = await drawn(page);
    const picked = page.getByTestId("mnemos-mind-picked");
    await expect(picked).toBeVisible();
    await expect(picked).toContainText("(note 43)");
    await expect
      .poll(
        () =>
          frame.evaluate(
            () =>
              (
                window as unknown as {
                  __mind: { selected: number; byId: (id: string) => number };
                }
              ).__mind.selected ===
              (
                window as unknown as {
                  __mind: { byId: (id: string) => number };
                }
              ).__mind.byId("her-m0042"),
          ),
        { timeout: 10_000 },
      )
      .toBe(true);
    // Escape in the picture lets go of it, as everywhere.
    await page
      .getByTestId("mnemos-mind-frame")
      .click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Escape");
    await expect(picked).toHaveCount(0);
    expect(itemInAddress(page)).toBeNull();
    // An address naming no memory of this mind lets go of it.
    await page.goto("/#/mnemos?room=mind&item=nobody");
    await drawn(page);
    await expect(picked).toHaveCount(0);
    await expect.poll(() => itemInAddress(page)).toBeNull();
    expect(errors).toEqual([]);
  });

  test("alive while shown; gone, and costing nothing, when not", async ({
    page,
  }) => {
    const errors = await boot(page);
    const frame = await drawn(page);
    // What comes to the mind is passed in at the page's own pace.
    const before = (await probeOf(page)).pulses;
    await page.waitForTimeout(3000);
    const during = (await probeOf(page)).pulses - before;
    expect(during).toBeGreaterThanOrEqual(2);
    await page.evaluate(() =>
      (window as unknown as { mindRecall: (ids: string[]) => void }).mindRecall(
        ["her-m0100", "her-m0112"],
      ),
    );
    await expect
      .poll(
        () =>
          frame.evaluate(
            () => document.getElementById("now-text")?.textContent ?? "",
          ),
        { timeout: 10_000 },
      )
      .toContain("recalled 2 memories");
    // Each lights where it lives.
    await expect
      .poll(
        () =>
          frame.evaluate(() => {
            const api = (
              window as unknown as {
                __mind: { lit: { i: number }[]; byId: (id: string) => number };
              }
            ).__mind;
            const want = [api.byId("her-m0100"), api.byId("her-m0112")];
            return want.every((i) => api.lit.some((l) => l.i === i));
          }),
        { timeout: 10_000, intervals: [100] },
      )
      .toBe(true);
    // Another section: the frame is gone, and nothing is asked any more.
    await railRow(page, "Log").click();
    await expect(page.getByTestId("mnemos-mind-frame")).toHaveCount(0);
    expect(mindFrame(page)).toBeNull();
    const off = (await probeOf(page)).pulses;
    await page.waitForTimeout(5000);
    const whileOff = (await probeOf(page)).pulses - off;
    expect(whileOff).toBe(0);
    // Back: built again.
    await railRow(page, "The mind").click();
    await drawn(page);
    const again = await page
      .getByTestId("mnemos-mind-frame")
      .getAttribute("data-first-picture-ms");
    // The window hidden: under the place's rule for words the frame is
    // destroyed, not hidden, at once (the place lets its words go the
    // moment the window hides; the two minutes are the engine's process).
    const hide = (state: "hidden" | "visible") =>
      page.evaluate((state) => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => state,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      }, state);
    await hide("hidden");
    await expect(page.getByTestId("mnemos-mind-frame")).toHaveCount(0);
    const hiddenAt = (await probeOf(page)).pulses;
    await page.clock.install();
    await page.clock.fastForward("02:10");
    expect(mindFrame(page)).toBeNull();
    expect((await probeOf(page)).pulses - hiddenAt).toBe(0);
    await hide("visible");
    await drawn(page);
    expect(errors).toEqual([]);
    measure("alive", {
      pulsesIn3s: during,
      pulsesWhileOff5s: whileOff,
      reopenFirstPictureMs: Number(again),
    });
  });

  test("reduced motion: the engine's own still way", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors = await boot(page);
    const frame = await drawn(page);
    const reduce = await frame.evaluate(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    expect(reduce).toBe(true);
    // It settles and stops drawing: no turn, no walk.
    await expect
      .poll(
        () =>
          frame.evaluate(
            () =>
              (window as unknown as { __mind: { looping: boolean } }).__mind
                .looping,
          ),
        { timeout: 20_000 },
      )
      .toBe(false);
    const frames = () =>
      frame.evaluate(
        () =>
          (window as unknown as { __mind: { frames: number } }).__mind.frames,
      );
    const a = await frames();
    await page.waitForTimeout(3000);
    const b = await frames();
    expect(b - a).toBe(0);
    expect(errors).toEqual([]);
    measure("reduced-motion", { framesIn3sAtRest: b - a });
  });

  test("an older Mnemos: the foundation's plain line", async ({ page }) => {
    const errors = await boot(page, { older: true });
    await expect(page.getByTestId("mnemos-needs-newer")).toHaveText(
      "The mind needs a newer Mnemos. Updating Mnemos brings it.",
    );
    await expect(page.getByTestId("mnemos-mind-frame")).toHaveCount(0);
    await shot(page, "06-old-engine-dark");
    expect(errors).toEqual([]);
  });

  test("3,000 memories: first picture, frame rate, memory", async ({
    page,
  }) => {
    const errors = await boot(page, {
      count: 3000,
      hash: "/mnemos?room=glance",
    });
    await expect(page.getByTestId("mnemos-glance")).toBeVisible({
      timeout: 60_000,
    });
    const heap = () =>
      page.evaluate(
        () =>
          (performance as unknown as { memory?: { usedJSHeapSize: number } })
            .memory?.usedJSHeapSize ?? 0,
      );
    const without = await heap();
    await railRow(page, "The mind").click();
    const frame = await drawn(page);
    const first = Number(
      await page
        .getByTestId("mnemos-mind-frame")
        .getAttribute("data-first-picture-ms"),
    );
    const facts = await frameFacts(frame);
    const frames = () =>
      frame.evaluate(
        () =>
          (window as unknown as { __mind: { frames: number } }).__mind.frames,
      );
    // Ten seconds turning on its own, as it does after it's drawn.
    let a = await frames();
    let t = Date.now();
    await page.waitForTimeout(10_000);
    const idleFps = ((await frames()) - a) / ((Date.now() - t) / 1000);
    // Ten seconds with a hand on it: dragged round and round.
    const box = await page.getByTestId("mnemos-mind-frame").boundingBox();
    if (!box) throw new Error("no box");
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    a = await frames();
    t = Date.now();
    for (let k = 0; Date.now() - t < 10_000; k++) {
      await page.mouse.move(
        cx + Math.cos(k / 12) * 160,
        cy + Math.sin(k / 12) * 90,
      );
      await page.waitForTimeout(16);
    }
    const dragFps = ((await frames()) - a) / ((Date.now() - t) / 1000);
    await page.mouse.up();
    const withMind = await heap();
    const frameHeap = await frame.evaluate(
      () =>
        (performance as unknown as { memory?: { usedJSHeapSize: number } })
          .memory?.usedJSHeapSize ?? 0,
    );
    const built = await frame.evaluate(
      () => (window as unknown as { __mind: { built: unknown } }).__mind.built,
    );
    await page.waitForTimeout(1500);
    await shot(page, "08-mind-3000-dark");
    const stored = await page.evaluate(
      async () => (await navigator.storage.estimate()).usage ?? 0,
    );
    // Shown again: the drawing kept by the engine opens it.
    await railRow(page, "Log").click();
    await expect(page.getByTestId("mnemos-mind-frame")).toHaveCount(0);
    await page.waitForTimeout(1000);
    const afterGone = await heap();
    await railRow(page, "The mind").click();
    await drawn(page);
    const again = Number(
      await page
        .getByTestId("mnemos-mind-frame")
        .getAttribute("data-first-picture-ms"),
    );
    expect(errors).toEqual([]);
    measure("three-thousand", {
      renderer: facts.renderer,
      counts: facts.counts,
      cells: facts.cells,
      firstPictureMs: first,
      firstPictureAgainMs: again,
      idleFps: Math.round(idleFps * 10) / 10,
      dragFps: Math.round(dragFps * 10) / 10,
      jsHeapMbWithoutMind: Math.round(without / 1e5) / 10,
      jsHeapMbWithMind: Math.round(withMind / 1e5) / 10,
      jsHeapMbFrameRealm: Math.round(frameHeap / 1e5) / 10,
      jsHeapMbAfterGone: Math.round(afterGone / 1e5) / 10,
      storedMb: Math.round(stored / 1e5) / 10,
      built,
    });
  });
});

test("drawn in software: the one line, and the way to the Log", async ({
  baseURL,
}) => {
  // Chromium drawing without a graphics card (SwiftShader), as a Mac
  // without one would.
  const browser = await chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const context = await browser.newContext({
    baseURL,
    deviceScaleFactor: 2,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  try {
    const errors = await boot(page);
    const line = page.getByTestId("mnemos-mind-cannot");
    await expect(line).toHaveText(
      "This Mac can’t draw the mind just now. Everything in it is in the Log.",
      { timeout: 60_000 },
    );
    // The frame is let go: nothing is left drawing or asking.
    await expect(page.getByTestId("mnemos-mind-frame")).toHaveCount(0);
    await expect(page.getByTestId("mnemos-mind-count")).toHaveText("");
    await shot(page, "05-cannot-draw-dark");
    await page.getByTestId("mnemos-mind-to-log").click();
    expect(new URLSearchParams(page.url().split("?")[1]).get("room")).toBe(
      "log",
    );
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
});
