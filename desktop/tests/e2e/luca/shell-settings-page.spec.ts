import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { type Browser, expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";

/**
 * WP-17, Settings on the shared page (docs/luca/rail-system/SHELL_BUILD.md;
 * from the final design review H1, M1, M2, M8, L4 and the final flows
 * review). Every section is read on the real page, dark and light: its head
 * and axis (the place page's 30 / 28, 640, the 22 title), its boxes, its
 * solid buttons, the lip's name, Mode's segment, the places column held
 * mounted and its mark, the page transition, Sign Out, the app's own name,
 * the shortcut list against the keys themselves, the sections as history,
 * and the right-hand safe area at 800 × 500.
 *
 * SHELL_SHOTS: where the screenshots and checks.json go. SHELL_BASE_URL: the
 * base build for the flag-off hashes and the before readings (default
 * http://127.0.0.1:4320); unreachable, those are "not run". CENSUS_ORIGIN:
 * when set, only the census runs, against that origin.
 */

const BASE_URL = process.env.SHELL_BASE_URL ?? "http://127.0.0.1:4320";
const CENSUS_ORIGIN = process.env.CENSUS_ORIGIN;
const GENERAL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";

test.use({ deviceScaleFactor: 2 });
test.describe.configure({ mode: "default" });

type Mode = "dark" | "light";

const SECTIONS = [
  ["profile", "Account", "Profile & identity"],
  ["security", "Account", "Security & backup"],
  ["appearance", "Experience", "Appearance"],
  ["notifications", "Experience", "Notifications"],
  ["mobile", "Experience", "Mobile & devices"],
  ["shortcuts", "Experience", "Shortcuts"],
  ["agents", "Agent system", "Agents"],
  ["connections", "Agent system", "Connections & MCP"],
  ["defaults", "Agent system", "Defaults & permissions"],
  ["diagnostics", "Application", "Diagnostics"],
  ["updates", "Application", "Updates"],
  ["about", "Application", "About"],
] as const;

/** Where "Luca" is the companion (a mind, its name), not the app. */
const COMPANION = [
  /^Luca$/,
  /Luca and native agents/,
  /inherited by Luca and future agents/,
  /Luca can organize the app/,
  /^Add Luca…$/,
  /^Luca managed$/,
];

const checks: Record<string, unknown> = {};

// Each spec writes to its own folder under SHELL_SHOTS, so its hash checks
// compare its own shots and no other spec's (WP-28, Decided 6).
const SHELL_SHOTS = process.env.SHELL_SHOTS
  ? path.join(process.env.SHELL_SHOTS, "shell-settings-page")
  : undefined;

function shotsDir() {
  const dir = SHELL_SHOTS ?? test.info().project.outputDir ?? "test-results";
  mkdirSync(dir, { recursive: true });
  return dir;
}

function saveChecks() {
  const file = path.join(shotsDir(), "checks.json");
  let saved: Record<string, unknown> = {};
  try {
    saved = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    saved = {};
  }
  writeFileSync(file, `${JSON.stringify({ ...saved, ...checks }, null, 2)}\n`);
}

async function reachable(url: string) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function open(
  page: Page,
  {
    mode = "dark",
    flag = true,
    origin = "",
    route = "/#/settings?section=profile",
    size = { width: 1440, height: 900 },
    tauri = false,
    fixedTime = false,
  }: {
    mode?: Mode;
    /** Stands in for the app's window, where Frame offers its glass. */
    tauri?: boolean;
    /** One moment for both builds, so "8:46 AM" reads the same in each. */
    fixedTime?: boolean;
    flag?: boolean;
    origin?: string;
    route?: string;
    size?: { width: number; height: number };
  } = {},
) {
  page.on("pageerror", (error) => console.log(`[pageerror] ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") console.log(`[console] ${message.text()}`);
  });
  await page.setViewportSize(size);
  await page.emulateMedia({ colorScheme: mode });
  if (fixedTime) await page.clock.setFixedTime(new Date("2026-10-26T09:00:00"));
  if (tauri) {
    await page.addInitScript(() => {
      (window as typeof window & { isTauri?: boolean }).isTauri = true;
    });
  }
  await installMockBridge(page);
  await page.addInitScript(
    ({ key, on, light }) => {
      let overrides: Record<string, boolean> = {};
      try {
        overrides = JSON.parse(localStorage.getItem(key) ?? "{}");
      } catch {
        overrides = {};
      }
      overrides["shell-frame"] = on;
      localStorage.setItem(key, JSON.stringify(overrides));
      if (light) {
        localStorage.setItem("buzz-theme", "paper");
        localStorage.setItem("buzz-follow-system", "false");
      }
    },
    { key: FEATURE_OVERRIDES_STORAGE_KEY, on: flag, light: mode === "light" },
  );
  await page.goto(`${origin}${route}`, { waitUntil: "domcontentloaded" });
}

/** A fresh page in its own context, so one mode's storage never leaks. */
async function fresh(browser: Browser) {
  const context = await browser.newContext({ deviceScaleFactor: 2 });
  return { context, page: await context.newPage() };
}

async function showSection(page: Page, section: string) {
  await page.getByTestId(`settings-nav-${section}`).click();
  await expect(page.getByTestId(`settings-panel-${section}`)).toBeVisible();
  await page.waitForTimeout(400);
  await waitForAnimations(page);
}

async function openGeneral(page: Page) {
  await page.waitForSelector(
    '[data-testid="app-sidebar"] :is([data-channel-id], [data-place-rail]), [data-testid="settings-view"]',
    { timeout: 20_000 },
  );
  await expect(async () => {
    await page.evaluate((id) => {
      location.hash = `#/channels/${id}`;
    }, GENERAL);
    await expect(page.getByTestId("shell-lip-name")).toHaveText("general", {
      timeout: 3_000,
    });
  }).toPass({ timeout: 30_000 });
}

/**
 * #general opened as the owner opens it, from its row on the Chats rail, so
 * the router makes its history entry (an address set by hand makes one the
 * router can't count).
 */
async function openGeneralFromRail(page: Page) {
  await page.getByTestId("shell-place-conversations").click();
  const row = page.locator(
    `[data-testid="app-sidebar"] [data-channel-id="${GENERAL}"]`,
  );
  await expect(row.first()).toBeVisible({ timeout: 20_000 });
  await row.first().click();
  await expect(page.getByTestId("shell-lip-name")).toHaveText("general");
}

/**
 * One reading of the settings card: the page's head and axis, every box
 * (an element half the axis wide or more and 40 tall, with a fill, an edge
 * on all four sides or a shadow; form controls and choice tiles aside),
 * every solid button (a fill at 3:1 or more against the card), and every
 * "Luca" in the page's words.
 */
function read(page: Page) {
  return page.evaluate(() => {
    type C = { r: number; g: number; b: number; a: number };
    const parse = (value: string): C => {
      const m = value.match(/rgba?\(([^)]+)\)/);
      if (m) {
        const p = m[1]
          .split(/[ ,/]+/)
          .filter(Boolean)
          .map(Number);
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
      }
      if (value === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
      // Anything else (oklab, color()) is read through a canvas.
      const ctx = document.createElement("canvas").getContext("2d");
      if (!ctx) return { r: 0, g: 0, b: 0, a: 0 };
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a: a / 255 };
    };
    const lin = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const lum = (c: C) =>
      0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    const ratio = (a: C, b: C) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const over = (top: C, under: C): C => ({
      r: top.r * top.a + under.r * (1 - top.a),
      g: top.g * top.a + under.g * (1 - top.a),
      b: top.b * top.a + under.b * (1 - top.a),
      a: 1,
    });
    const r1 = (n: number) => Math.round(n * 10) / 10;
    const box = (el: Element | null) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: r1(b.x), y: r1(b.y), w: r1(b.width), h: r1(b.height) };
    };
    const card = document.querySelector<HTMLElement>(
      '[data-testid="settings-content-surface"]',
    );
    const panel = document.querySelector<HTMLElement>(
      '[data-testid^="settings-panel-"]',
    );
    if (!card || !panel) return null;
    // The card's own ground: the one card beneath (WP-12) paints
    // --mn-surface, so the page's fill is read from that token.
    const probe = document.createElement("div");
    probe.style.background = "hsl(var(--mn-surface))";
    card.append(probe);
    const cardFill = parse(getComputedStyle(probe).backgroundColor);
    probe.remove();
    const cardBox = card.getBoundingClientRect();
    const page = card.querySelector<HTMLElement>("[data-luca-settings-page]");
    const axis = card.querySelector<HTMLElement>(".luca-place-page-axis");
    const eyebrow = card.querySelector(".luca-place-page-eyebrow");
    const title = card.querySelector("h1");
    const visible = (el: Element) => {
      const b = el.getBoundingClientRect();
      if (b.width < 1 || b.height < 1) return false;
      const s = getComputedStyle(el);
      return s.visibility !== "hidden" && s.display !== "none";
    };
    const controls =
      "input, textarea, select, button, label, [role=switch], img, canvas, svg, kbd, [role=img], [role=radio], [role=option]";
    const axisWidth = axis?.getBoundingClientRect().width ?? 640;
    const boxes = [...panel.querySelectorAll<HTMLElement>("*")]
      .filter((el) => {
        if (!visible(el) || el.matches(controls) || el.closest("button"))
          return false;
        // A choice is a control, however it is drawn (a theme's tile).
        if (el.querySelector("button, input") && el.children.length === 1)
          return false;
        const b = el.getBoundingClientRect();
        if (b.width < axisWidth / 2 || b.height < 40) return false;
        const s = getComputedStyle(el);
        const fill = parse(s.backgroundColor).a > 0.02;
        const edged = ["top", "right", "bottom", "left"].every(
          (side) =>
            Number.parseFloat(s.getPropertyValue(`border-${side}-width`)) > 0 &&
            parse(s.getPropertyValue(`border-${side}-color`)).a > 0.02,
        );
        return fill || edged || s.boxShadow !== "none";
      })
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        testid: el.dataset.testid ?? null,
        cls: el.className.toString().slice(0, 90),
        box: box(el),
      }));
    const solid = [...panel.querySelectorAll<HTMLElement>("button, a")]
      .filter((el) => {
        if (!visible(el)) return false;
        if (el.matches('[role=switch], [data-testid^="accent-color-"]'))
          return false;
        const fill = parse(getComputedStyle(el).backgroundColor);
        return fill.a >= 0.5 && ratio(over(fill, cardFill), cardFill) >= 3;
      })
      .map((el) => {
        const s = getComputedStyle(el);
        return {
          text: (el.textContent ?? "").trim().slice(0, 40),
          label: el.getAttribute("aria-label"),
          h: r1(el.getBoundingClientRect().height),
          font: s.fontSize,
          radius: s.borderTopLeftRadius,
        };
      });
    const text = panel.innerText;
    const luca = [...text.matchAll(/[^.\n]*\bLuca\b[^.\n]*/g)].map((m) =>
      m[0].trim().slice(0, 100),
    );
    return {
      card: box(card),
      page: page
        ? {
            padTop: getComputedStyle(page).paddingTop,
            padLeft: getComputedStyle(page).paddingLeft,
            transitionName: getComputedStyle(page).viewTransitionName,
          }
        : null,
      axis: box(axis),
      axisCentreOffset: axis
        ? r1(
            axis.getBoundingClientRect().x +
              axis.getBoundingClientRect().width / 2 -
              (cardBox.x + cardBox.width / 2),
          )
        : null,
      eyebrow: eyebrow?.textContent ?? null,
      title: title?.textContent ?? null,
      titleSize: title ? getComputedStyle(title).fontSize : null,
      titleTop: title ? r1(title.getBoundingClientRect().y - cardBox.y) : null,
      lip: document.querySelector('[data-testid="shell-lip-name"]')
        ?.textContent,
      boxes,
      solid,
      luca,
      // Every control the section offers, by its name, for the capability
      // map (before and after).
      controls: [
        ...panel.querySelectorAll<HTMLElement>(
          "button, a, input, select, textarea, [role=switch], summary",
        ),
      ]
        .filter(visible)
        .map((el) =>
          (
            el.getAttribute("aria-label") ??
            el.dataset.testid ??
            el.textContent ??
            el.tagName
          )
            .trim()
            .slice(0, 40),
        ),
      // The page scrolls sideways. Read on the page, which scrolls, not the
      // panel: Settings > Agents' rows are the shared place rows (WP-24,
      // Decided 1), whose hover reaches 10 past the axis by design
      // (shell-place-rails.css), inside the page.
      overflowX: page
        ? page.scrollWidth > page.clientWidth + 1
        : panel.scrollWidth > panel.clientWidth + 1,
    };
  });
}

test("census of every section", async ({ page }) => {
  test.skip(!CENSUS_ORIGIN, "census only on request");
  const out: Record<string, unknown> = {};
  for (const mode of ["dark", "light"] as const) {
    await open(page, { mode, origin: CENSUS_ORIGIN });
    await expect(page.getByTestId("settings-panel-profile")).toBeVisible({
      timeout: 20_000,
    });
    for (const [section] of SECTIONS) {
      await showSection(page, section);
      out[`${mode}:${section}`] = await read(page);
    }
  }
  writeFileSync(
    path.join(shotsDir(), `census-${new URL(CENSUS_ORIGIN ?? "").port}.json`),
    JSON.stringify(out, null, 2),
  );
});

test.describe("WP-17", () => {
  test.skip(!!CENSUS_ORIGIN, "census run");
  test.setTimeout(180_000);

  for (const mode of ["dark", "light"] as const) {
    test(`every section on the shared page, ${mode}`, async ({ browser }) => {
      const { context, page } = await fresh(browser);
      await open(page, { mode });
      await expect(page.getByTestId("settings-panel-profile")).toBeVisible({
        timeout: 20_000,
      });
      const failures: string[] = [];
      const readings: Record<string, unknown> = {};
      for (const [section, group, label] of SECTIONS) {
        await showSection(page, section);
        const r = await read(page);
        readings[section] = r;
        if (mode === "dark" && section === "agents")
          await page.screenshot({
            path: path.join(shotsDir(), "1440-dark-agents.png"),
          });
        if (!r) {
          failures.push(`${section}: no reading`);
          continue;
        }
        const fail = (what: string) => failures.push(`${section}: ${what}`);
        if (r.eyebrow !== group) fail(`eyebrow ${r.eyebrow}`);
        if (r.title !== label) fail(`title ${r.title}`);
        if (r.titleSize !== "22px") fail(`title size ${r.titleSize}`);
        if (r.page?.padTop !== "30px" || r.page?.padLeft !== "28px")
          fail(`padding ${JSON.stringify(r.page)}`);
        if (r.axis?.w !== 640) fail(`axis ${r.axis?.w}`);
        if (Math.abs(r.axisCentreOffset ?? 99) > 0.5)
          fail(`axis off centre ${r.axisCentreOffset}`);
        if (r.boxes.length) fail(`boxes ${JSON.stringify(r.boxes)}`);
        if (r.overflowX) fail("overflows sideways");
        if (r.lip !== label) fail(`lip ${r.lip}`);
        for (const s of r.solid) {
          if (s.h !== 30 || s.font !== "13px" || s.radius !== "9px")
            fail(`solid button ${JSON.stringify(s)}`);
        }
        const app = r.luca.filter(
          (line) => !COMPANION.some((pattern) => pattern.test(line)),
        );
        if (app.length) fail(`names the app Luca: ${JSON.stringify(app)}`);
      }

      await showSection(page, "appearance");
      await page.screenshot({
        path: path.join(shotsDir(), `1440-${mode}-appearance.png`),
      });
      // d3: Mode is Frame's segment, on its own row of the same group. In
      // the app's window, where Frame offers its choice.
      const app = await fresh(browser);
      await open(app.page, {
        mode,
        route: "/#/settings?section=appearance",
        tauri: true,
      });
      await expect(app.page.getByTestId("appearance-frame-solid")).toBeVisible({
        timeout: 20_000,
      });
      await app.page.waitForTimeout(400);
      const appearance = await app.page.evaluate(() => {
        const q = (s: string) => document.querySelector<HTMLElement>(s);
        const modeRow = q('[data-testid="appearance-mode"]');
        const modeChoice = q('[data-testid="appearance-mode-system"]')
          ?.parentElement as HTMLElement | null;
        const frameChoice = q('[data-testid="appearance-frame-solid"]')
          ?.parentElement as HTMLElement | null;
        const label = modeRow?.querySelector("p");
        const chosen = (group: HTMLElement | null) =>
          group?.querySelector<HTMLElement>('[aria-pressed="true"]') ?? null;
        const look = (el: HTMLElement | null) => {
          if (!el) return null;
          const s = getComputedStyle(el);
          return {
            bg: s.backgroundColor,
            radius: s.borderTopLeftRadius,
            font: s.fontSize,
            h: Math.round(el.getBoundingClientRect().height * 10) / 10,
            pad: s.padding,
            shadow: s.boxShadow,
          };
        };
        const centre = (el: Element | null | undefined) => {
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return Math.round((b.y + b.height / 2) * 10) / 10;
        };
        return {
          options: [...(modeChoice?.querySelectorAll("button") ?? [])].map(
            (b) => b.textContent,
          ),
          sameGroup:
            !!modeRow &&
            !!frameChoice &&
            modeRow.parentElement ===
              frameChoice.closest("[data-settings-option-row]")?.parentElement,
          labelCentre: centre(label),
          choiceCentre: centre(modeChoice),
          modeTrack: look(modeChoice),
          frameTrack: look(frameChoice),
          modeChosen: look(chosen(modeChoice)),
          frameChosen: look(chosen(frameChoice)),
          accentTiles: document.querySelectorAll(
            '[data-testid^="appearance-mode-"].border-primary',
          ).length,
        };
      });
      const d3 =
        JSON.stringify(appearance.options) ===
          JSON.stringify(["System", "Light", "Dark"]) &&
        appearance.sameGroup &&
        Math.abs(
          (appearance.labelCentre ?? 0) - (appearance.choiceCentre ?? 99),
        ) <= 1 &&
        JSON.stringify(appearance.modeTrack) ===
          JSON.stringify(appearance.frameTrack) &&
        JSON.stringify(appearance.modeChosen) ===
          JSON.stringify(appearance.frameChosen) &&
        appearance.accentTiles === 0;
      if (!d3) failures.push(`appearance: ${JSON.stringify(appearance)}`);
      await app.context.close();

      // d5: Sign Out is red words, no fill.
      await showSection(page, "profile");
      const signOut = await page
        .getByTestId("signout-open-dialog")
        .evaluate((el) => {
          const s = getComputedStyle(el);
          return { bg: s.backgroundColor, color: s.color };
        });
      const red = /rgba?\((\d+), (\d+), (\d+)/.exec(signOut.color);
      const d5SignOut =
        /rgba\(0, 0, 0, 0\)|transparent/.test(signOut.bg) &&
        !!red &&
        Number(red[1]) > Number(red[2]) + 40;
      if (!d5SignOut) failures.push(`sign out ${JSON.stringify(signOut)}`);
      if (mode === "light") {
        await page.screenshot({
          path: path.join(shotsDir(), "1440-light-profile.png"),
        });
      }

      checks[`sections_${mode}`] = {
        failures,
        appearance,
        signOut,
        readings,
      };
      saveChecks();
      await context.close();
      expect(failures).toEqual([]);
    });
  }

  test("one places column: mounted through Settings, its mark slides, the page arrives", async ({
    browser,
  }) => {
    const sample = async (page: Page, click: string) =>
      page.evaluate(
        (selector) =>
          new Promise<{
            ys: number[];
            pseudo: string[];
            motions: string[];
          }>((resolve) => {
            const ys: number[] = [];
            const pseudo = new Set<string>();
            const motions: string[] = [];
            const observer = new MutationObserver(() => {
              const motion = document.documentElement.dataset.navMotion;
              if (motion) motions.push(motion);
            });
            observer.observe(document.documentElement, {
              attributeFilter: ["data-nav-motion"],
            });
            const start = performance.now();
            document.querySelector<HTMLElement>(selector)?.click();
            const step = () => {
              const mark = document.querySelector(
                '[data-testid="shell-places-marks"] .luca-mark--place',
              );
              if (mark) ys.push(Math.round(mark.getBoundingClientRect().y));
              for (const animation of document.documentElement.getAnimations({
                subtree: true,
              })) {
                const name = (animation.effect as KeyframeEffect | null)
                  ?.pseudoElement;
                if (name) pseudo.add(name);
              }
              if (performance.now() - start < 1400) requestAnimationFrame(step);
              else {
                observer.disconnect();
                resolve({ ys, pseudo: [...pseudo], motions });
              }
            };
            requestAnimationFrame(step);
          }),
        click,
      );
    const run = async (origin: string) => {
      const { context, page } = await fresh(browser);
      await open(page, { origin, route: "/#/" });
      await openGeneral(page);
      await page.waitForTimeout(600);
      await page.evaluate(() => {
        (window as unknown as { __column?: Element | null }).__column =
          document.querySelector('[data-testid="shell-places"]');
      });
      const into = await sample(page, '[data-testid="open-settings-view"]');
      await expect(page.getByTestId("settings-panel-profile")).toBeVisible();
      const keptIn = await page.evaluate(
        () =>
          (window as unknown as { __column?: Element | null }).__column ===
          document.querySelector('[data-testid="shell-places"]'),
      );
      await page.waitForTimeout(400);
      const out = await sample(
        page,
        '[data-testid="shell-place-conversations"]',
      );
      await page.waitForTimeout(500);
      const landed = await page.getByTestId("shell-lip-name").textContent();
      const keptOut = await page.evaluate(
        () =>
          (window as unknown as { __column?: Element | null }).__column ===
          document.querySelector('[data-testid="shell-places"]'),
      );
      // From another place, by the places' order: Agents is above
      // Settings, so the page arrives from below, and leaves upward.
      await page.getByTestId("open-agents-view").click();
      await page.waitForTimeout(900);
      const fromAgents = await sample(
        page,
        '[data-testid="open-settings-view"]',
      );
      await page.waitForTimeout(400);
      const toAgents = await sample(page, '[data-testid="open-agents-view"]');
      await context.close();
      // A slide passes through places between its ends; a jump doesn't.
      const between = (ys: number[]) => {
        const first = ys[0];
        const last = ys[ys.length - 1];
        const [lo, hi] = [Math.min(first, last), Math.max(first, last)];
        return new Set(ys.filter((y) => y > lo + 2 && y < hi - 2)).size;
      };
      return {
        fromAgents: { motions: fromAgents.motions, pseudo: fromAgents.pseudo },
        toAgents: { motions: toAgents.motions, pseudo: toAgents.pseudo },
        keptIn,
        keptOut,
        landed,
        into: {
          ...into,
          between: between(into.ys),
          ends: [into.ys[0], into.ys.at(-1)],
        },
        out: {
          ...out,
          between: between(out.ys),
          ends: [out.ys[0], out.ys.at(-1)],
        },
      };
    };
    const after = await run("");
    const before = (await reachable(BASE_URL)) ? await run(BASE_URL) : null;
    const strip = (r: typeof after | null) =>
      r
        ? {
            keptIn: r.keptIn,
            keptOut: r.keptOut,
            landed: r.landed,
            fromAgents: r.fromAgents,
            toAgents: r.toAgents,
            into: {
              between: r.into.between,
              ends: r.into.ends,
              pseudo: r.into.pseudo,
              motions: r.into.motions,
            },
            out: {
              between: r.out.between,
              ends: r.out.ends,
              pseudo: r.out.pseudo,
              motions: r.out.motions,
            },
          }
        : "not run";
    const arrives = after.into.pseudo.includes(
      "::view-transition-new(luca-content)",
    );
    checks.d4 = {
      pass:
        after.keptIn &&
        after.keptOut &&
        after.landed === "general" &&
        after.into.between >= 3 &&
        after.out.between >= 3 &&
        arrives &&
        after.out.pseudo.includes("::view-transition-new(luca-content)") &&
        after.fromAgents.motions.includes("down") &&
        after.fromAgents.pseudo.includes(
          "::view-transition-new(luca-content)",
        ) &&
        after.toAgents.motions.includes("up"),
      after: strip(after),
      before: strip(before),
    };
    saveChecks();
    expect(after.keptIn && after.keptOut).toBe(true);
    expect(after.into.between).toBeGreaterThanOrEqual(3);
    expect(after.out.between).toBeGreaterThanOrEqual(3);
    expect(arrives).toBe(true);
  });

  test("Chats by the keyboard: where focus lands, from Library and from Settings", async ({
    browser,
  }) => {
    const run = async (origin: string) => {
      const { context, page } = await fresh(browser);
      await open(page, { origin, route: "/#/" });
      await openGeneralFromRail(page);
      const out: Record<string, string | null> = {};
      for (const place of ["open-artifacts-view", "open-settings-view"]) {
        await page.getByTestId(place).focus();
        await page.keyboard.press("Enter");
        await page.waitForTimeout(800);
        await page.getByTestId("shell-place-conversations").focus();
        await page.keyboard.press("Enter");
        await page.waitForTimeout(900);
        out[place] = await page.evaluate(
          () =>
            document.activeElement
              ?.closest("[data-testid]")
              ?.getAttribute("data-testid") ?? null,
        );
      }
      await context.close();
      return out;
    };
    const after = await run("");
    const before = (await reachable(BASE_URL)) ? await run(BASE_URL) : null;
    checks.d4_focus = {
      pass: after["open-settings-view"] === after["open-artifacts-view"],
      after,
      before: before ?? "not run",
    };
    saveChecks();
    expect(after["open-settings-view"]).toBe(after["open-artifacts-view"]);
  });

  test("the shortcut list is the keys the app answers", async ({ browser }) => {
    const { context, page } = await fresh(browser);
    await open(page, { route: "/#/settings?section=shortcuts" });
    await expect(page.getByTestId("settings-panel-shortcuts")).toBeVisible({
      timeout: 20_000,
    });
    const listed = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("[data-shortcut]")].map(
        (row) => ({
          id: row.dataset.shortcut,
          text: (row.textContent ?? "").replace(/\s+/g, " ").trim(),
        }),
      ),
    );
    const text = listed.map((row) => row.text).join(" | ");
    const listChecks = {
      newConversation: /New conversation.*⌘N/.test(text),
      shiftK: /Also opens New conversation.*⇧⌘K/.test(text),
      quickChat: /Quick Chat.*⇧⌘L/.test(text),
      browseRooms: /Browse rooms.*⇧⌘O/.test(text),
      startRoom: /Start a room.*⇧⌘N/.test(text),
      strikethrough: /Strikethrough.*⇧⌘S/.test(text),
      noChannel: !/channel/i.test(text),
      noPublishNote: !/Publish note/.test(text),
    };

    // Each key, pressed in the app.
    const keys: Record<string, boolean | string> = {};
    const press = async (combo: string) => {
      await page.keyboard.press(combo);
      await page.waitForTimeout(350);
    };
    const hash = () => page.evaluate(() => location.hash);
    // A dialog closes with Escape, or its own Close when its field keeps
    // Escape for itself.
    const closeDialog = async () => {
      await press("Escape");
      if (await page.getByTestId("dialog-overlay").count()) {
        await page
          .getByRole("button", { name: "Close" })
          .first()
          .click({ timeout: 5_000 });
        await page.waitForTimeout(300);
      }
    };
    await openGeneral(page);
    await page.locator("body").click({ position: { x: 700, y: 400 } });
    await press("Meta+k");
    keys.search = await page.getByTestId("search-dialog-input").isVisible();
    await closeDialog();
    await press("Meta+n");
    keys.newConversation = (await hash()).includes("/messages/new");
    await openGeneral(page);
    await page.locator("body").click({ position: { x: 700, y: 400 } });
    await press("Meta+Shift+k");
    keys.shiftK = (await hash()).includes("/messages/new");
    await openGeneral(page);
    await page.locator("body").click({ position: { x: 700, y: 400 } });
    await press("Meta+Shift+l");
    keys.quickChat = await page.getByTestId("quickchat-panel").isVisible();
    await press("Meta+Shift+l");
    await press("Meta+Shift+n");
    keys.startRoom = await page
      .getByTestId("create-channel-dialog")
      .isVisible();
    await closeDialog();
    await press("Meta+Shift+o");
    keys.browseRooms = await page
      .getByTestId("channel-browser-search")
      .isVisible();
    await closeDialog();
    await page.locator("body").click({ position: { x: 700, y: 400 } });
    await press("Meta+Shift+a");
    // Chats' first screen (here New conversation, with no conversation of
    // Luca's in the mock), with Chats the place marked.
    keys.chatsHash = await hash();
    keys.chats =
      (await page
        .getByTestId("shell-place-conversations")
        .getAttribute("data-current")) === "true" &&
      !(await hash()).includes("/settings");
    await openGeneral(page);
    const railOpen = () =>
      page.evaluate(
        () =>
          document
            .querySelector('[data-testid="app-sidebar"]')
            ?.closest("[data-state]")
            ?.getAttribute("data-state") ?? "none",
      );
    const railBefore = await railOpen();
    await page.locator("body").click({ position: { x: 700, y: 400 } });
    await press("Meta+s");
    keys.rail = `${railBefore}→${await railOpen()}`;
    await press("Meta+s");
    const rootSize = () =>
      page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
    const size0 = await rootSize();
    await press("Meta+Equal");
    keys.zoom = `${size0}→${await rootSize()}`;
    await press("Meta+0");
    // The composer's marks.
    const input = page.getByTestId("message-input");
    await input.click();
    await page.keyboard.type("strike me");
    await page.keyboard.press("Meta+a");
    await press("Meta+Shift+s");
    keys.strikethrough = await input
      .locator("s")
      .count()
      .then((n) => n > 0);
    await press("Meta+b");
    keys.bold = await input
      .locator("strong")
      .count()
      .then((n) => n > 0);
    await press("Meta+e");
    keys.code = await input
      .locator("code")
      .count()
      .then((n) => n > 0);
    await context.close();

    // Settings, Back and Forward, on a page where the router made every
    // entry (an address set by hand makes one it can't count).
    const second = await fresh(browser);
    const p2 = second.page;
    await open(p2, { route: "/#/" });
    await openGeneralFromRail(p2);
    const hash2 = () => p2.evaluate(() => location.hash);
    const press2 = async (combo: string) => {
      await p2.keyboard.press(combo);
      await p2.waitForTimeout(400);
    };
    // Back and Forward stand down in a text field (the composer has focus
    // on a conversation), so focus leaves it first.
    const blur = () =>
      p2.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await blur();
    await press2("Meta+,");
    keys.settings = (await hash2()).includes("/settings");
    await press2("Meta+,");
    keys.settingsCloses = (await hash2()).includes(GENERAL);
    // Closing stepped back, so Forward is Settings again, and Back returns.
    await blur();
    await press2("Meta+]");
    keys.forward = (await hash2()).includes("/settings");
    await press2("Meta+[");
    keys.back = (await hash2()).includes(GENERAL);
    await second.context.close();

    const keysPass =
      keys.search === true &&
      keys.newConversation === true &&
      keys.shiftK === true &&
      keys.quickChat === true &&
      keys.startRoom === true &&
      keys.browseRooms === true &&
      keys.chats === true &&
      keys.settings === true &&
      keys.settingsCloses === true &&
      keys.back === true &&
      keys.forward === true &&
      keys.strikethrough === true &&
      keys.bold === true &&
      keys.code === true &&
      String(keys.rail).split("→")[0] !== String(keys.rail).split("→")[1] &&
      String(keys.zoom).split("→")[0] !== String(keys.zoom).split("→")[1];
    checks.d7 = {
      pass: Object.values(listChecks).every(Boolean) && keysPass,
      list: listChecks,
      keys,
      notRun: [
        "⌃Space (push to talk): a global shortcut in Rust, only while a huddle is live",
        "Escape and ⇧Escape (mark as read): their handler is unchanged and not pressed here",
      ],
      listed: listed.map((row) => row.text),
    };
    saveChecks();
    expect(listChecks).toEqual({
      newConversation: true,
      shiftK: true,
      quickChat: true,
      browseRooms: true,
      startRoom: true,
      strikethrough: true,
      noChannel: true,
      noPublishNote: true,
    });
    expect(keysPass).toBe(true);
  });

  test("Settings' sections are history steps", async ({ browser }) => {
    const run = async (origin: string) => {
      const { context, page } = await fresh(browser);
      await open(page, { origin, route: "/#/" });
      await openGeneralFromRail(page);
      const section = () =>
        page.evaluate(() => {
          if (!location.hash.includes("/settings")) return location.hash;
          return new URLSearchParams(location.hash.split("?")[1]).get(
            "section",
          );
        });
      const lip = (id: string) =>
        page.evaluate(
          (testId) =>
            document
              .querySelector(`[data-testid="${testId}"]`)
              ?.hasAttribute("disabled") ?? null,
          id,
        );
      const back = async () => {
        if (await lip("global-back")) return;
        await page.getByTestId("global-back").click({ timeout: 5_000 });
        await page.waitForTimeout(500);
      };
      const forward = async () => {
        if (await lip("global-forward")) return;
        await page.getByTestId("global-forward").click({ timeout: 5_000 });
        await page.waitForTimeout(500);
      };
      const steps: Record<string, unknown> = {};
      await page.getByTestId("open-settings-view").click();
      await expect(page.getByTestId("settings-panel-profile")).toBeVisible();
      await showSection(page, "appearance");
      await showSection(page, "shortcuts");
      await back();
      steps.back1 = await section();
      await back();
      steps.back2 = await section();
      await forward();
      steps.forward = await section();
      await page.getByTestId("shell-place-conversations").click();
      await page.waitForTimeout(500);
      steps.chats = await section();
      await back();
      steps.backFromChats = await section();
      await page.locator("body").click({ position: { x: 900, y: 500 } });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(600);
      steps.escape = await section();
      // A step back leaves the Settings entries ahead: Forward is lit.
      steps.forwardAfterEscape = !(await page
        .getByTestId("global-forward")
        .isDisabled());
      await context.close();
      return steps;
    };
    const after = await run("");
    const before = (await reachable(BASE_URL)) ? await run(BASE_URL) : null;
    const pass =
      after.back1 === "appearance" &&
      after.back2 === "profile" &&
      after.forward === "appearance" &&
      String(after.chats).includes(GENERAL) &&
      after.backFromChats === "appearance" &&
      String(after.escape).includes(GENERAL) &&
      after.forwardAfterEscape === true;
    checks.d8 = { pass, after, before: before ?? "not run" };
    saveChecks();
    expect(pass).toBe(true);
  });

  test("Quick Chat never covers a Settings control at 800 × 500", async ({
    browser,
  }) => {
    const { context, page } = await fresh(browser);
    await open(page, { size: { width: 800, height: 500 } });
    await expect(page.getByTestId("settings-panel-profile")).toBeVisible({
      timeout: 20_000,
    });
    const overlaps: Record<string, unknown[]> = {};
    for (const [section] of SECTIONS) {
      if (section !== "profile") {
        // The section list is a sheet at this width: go by the address.
        await page.evaluate((s) => {
          location.hash = `#/settings?section=${s}`;
        }, section);
        await expect(
          page.getByTestId(`settings-panel-${section}`),
        ).toBeVisible();
        await page.waitForTimeout(400);
      }
      overlaps[section] = await page.evaluate(() => {
        const launcher = document
          .querySelector('[data-testid="quickchat-launcher"]')
          ?.getBoundingClientRect();
        if (!launcher) return ["no launcher"];
        const scroll = document.querySelector<HTMLElement>(
          "[data-luca-settings-page]",
        );
        const found: unknown[] = [];
        // Every position of the page's scroll, so a control further down
        // is read where it passes the launcher too.
        const max = scroll ? scroll.scrollHeight - scroll.clientHeight : 0;
        for (let top = 0; top <= max + 1; top += 120) {
          if (scroll) scroll.scrollTop = Math.min(top, max);
          for (const el of document.querySelectorAll<HTMLElement>(
            '[data-testid^="settings-panel-"] :is(button, a, input, textarea, select, [role=switch])',
          )) {
            const b = el.getBoundingClientRect();
            if (b.width < 1 || b.height < 1) continue;
            const hit =
              b.right > launcher.left &&
              b.left < launcher.right &&
              b.bottom > launcher.top &&
              b.top < launcher.bottom;
            if (hit)
              found.push({
                text: (el.textContent ?? el.getAttribute("aria-label") ?? "")
                  .trim()
                  .slice(0, 30),
                scroll: top,
              });
          }
        }
        if (scroll) scroll.scrollTop = 0;
        return found;
      });
    }
    await page.evaluate(() => {
      location.hash = "#/settings?section=profile";
    });
    await page.waitForTimeout(500);
    await waitForAnimations(page);
    const edit = await page.evaluate(() => {
      const r = (s: string) =>
        document.querySelector(s)?.getBoundingClientRect() ?? null;
      const e = r('[data-testid="profile-metadata-edit"]');
      const l = r('[data-testid="quickchat-launcher"]');
      return {
        edit: e && { x: e.x, y: e.y, right: e.right, bottom: e.bottom },
        launcher: l && { x: l.x, y: l.y, right: l.right, bottom: l.bottom },
        gap: e && l ? Math.round((l.x - e.right) * 10) / 10 : null,
      };
    });
    await page.screenshot({
      path: path.join(shotsDir(), "800-dark-profile.png"),
    });
    await context.close();
    const total = Object.values(overlaps).flat().length;
    checks.d9 = { pass: total === 0, overlaps, edit };
    saveChecks();
    expect(total).toBe(0);
  });

  test("flag off draws the base build exactly", async ({ browser }) => {
    test.skip(!(await reachable(BASE_URL)), "base build unreachable");
    const shots: Record<string, { mine: string; base: string; bytes: number }> =
      {};
    // Only the small animated marks are masked (a mind's sphere, under
    // 200 × 200), never a canvas that fills the window.
    const shot = async (page: Page) => {
      await page.evaluate(() => {
        for (const canvas of document.querySelectorAll("canvas")) {
          const b = canvas.getBoundingClientRect();
          if (b.width < 200 && b.height < 200)
            canvas.setAttribute("data-wp17-mask", "");
        }
      });
      return page.screenshot({
        animations: "disabled",
        mask: [page.locator("canvas[data-wp17-mask]")],
      });
    };
    // FLAG_OFF_DUMP: a folder for every shot, to see a difference.
    const dump = (name: string, png: Buffer) => {
      const dir = process.env.FLAG_OFF_DUMP;
      if (!dir) return;
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, name), png);
    };
    for (const origin of ["", BASE_URL]) {
      const { context, page } = await fresh(browser);
      await open(page, { flag: false, origin, fixedTime: true });
      await expect(page.getByTestId("settings-panel-profile")).toBeVisible({
        timeout: 20_000,
      });
      for (const [section] of SECTIONS) {
        await showSection(page, section);
        await page.waitForTimeout(300);
        const png = await shot(page);
        dump(`${origin ? "base" : "mine"}-${section}.png`, png);
        const key = section;
        const digest = createHash("sha256").update(png).digest("hex");
        shots[key] ??= { mine: "", base: "", bytes: 0 };
        if (origin === "") {
          shots[key].mine = digest;
          shots[key].bytes = png.length;
        } else shots[key].base = digest;
      }
      await page.evaluate((id) => {
        location.hash = `#/channels/${id}`;
      }, GENERAL);
      await expect(page.getByTestId("message-input")).toBeVisible({
        timeout: 20_000,
      });
      await page.waitForTimeout(1200);
      await waitForAnimations(page);
      // The conversation settles (its timeline, its read state): the shot
      // that counts is the first that matches the one before it.
      let png = await shot(page);
      for (let tries = 0; tries < 6; tries += 1) {
        await page.waitForTimeout(500);
        const next = await shot(page);
        if (next.equals(png)) break;
        png = next;
      }
      dump(`${origin ? "base" : "mine"}-general.png`, png);
      shots.general ??= { mine: "", base: "", bytes: 0 };
      const digest = createHash("sha256").update(png).digest("hex");
      if (origin === "") {
        shots.general.mine = digest;
        shots.general.bytes = png.length;
      } else shots.general.base = digest;
      await context.close();
    }
    const differ = Object.entries(shots)
      .filter(([, s]) => s.mine !== s.base)
      .map(([k]) => k);
    // A blank window compresses to almost nothing; every shot must hold a page.
    const blank = Object.entries(shots)
      .filter(([, s]) => s.bytes < 40_000)
      .map(([k]) => k);
    checks.flag_off_identical = {
      pass: differ.length === 0 && blank.length === 0,
      compared: Object.keys(shots).length,
      differ,
      blank,
      unique: new Set(Object.values(shots).map((s) => s.mine)).size,
    };
    saveChecks();
    expect(differ).toEqual([]);
    expect(blank).toEqual([]);
  });
});
