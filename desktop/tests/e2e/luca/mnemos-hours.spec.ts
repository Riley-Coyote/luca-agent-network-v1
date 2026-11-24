import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";
import { BOARD_PICTURES, kestrelBoard } from "./mnemos-board-fixture";
import { KESTREL_HELLO } from "./mnemos-newer-fixture";

/**
 * WP-54, quiet hours each on its own, and what an hour read online
 * (polyphonic-beta14-finish.md). Kestrel is a made-up mind on Mnemos 0.7.0.
 * Every Mnemos command is played by this spec, in the page: nothing here
 * reaches a real engine, so no `hours` request can schedule anything. The
 * outside-link opener is played here too: nothing opens.
 */

const SHOTS = process.env.WP54_SHOTS ?? "test-results/wp54";
type Mode = "dark" | "light";
type Quiet = "fixture" | "all-off" | "all-on" | "cant" | "hermes" | "none";

type Call = { cmd: string; args?: Record<string, unknown> };
type Probe = {
  calls: Call[];
  opened: string[];
  open: string | null;
  /** How the next `hours` write goes. */
  hoursMode: "ok" | "refuse" | "fail";
  /** How long the next `hours` write takes, in ms. */
  hoursDelay: number;
  token: string;
};

test.use({ deviceScaleFactor: 2, trace: "off", video: "off" });
test.describe.configure({ timeout: 120_000 });

/** A refusal in the engine's own words (made up, in its shape). */
const REFUSAL = "Its own hour is off: turn it on to change it.";
/** Why none can be turned on here, as the engine says it (made up). */
const CANT =
  "None can be turned on here: Claude Code isn't installed on this Mac.";

async function boot(
  page: Page,
  {
    hash = "/mnemos?mind=kestrel&room=settings",
    mode = "dark",
    quiet = "fixture",
    reducedMotion = false,
    size = { width: 1440, height: 900 },
    markupWeb = false,
  }: {
    hash?: string;
    mode?: Mode;
    quiet?: Quiet;
    reducedMotion?: boolean;
    size?: { width: number; height: number };
    /** The newest hour's record holds words that look like markup. */
    markupWeb?: boolean;
  } = {},
) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.setViewportSize(size);
  if (reducedMotion) await page.emulateMedia({ reducedMotion: "reduce" });
  const kestrel = kestrelBoard(Date.now());
  const life = kestrel.life as Record<string, unknown>;
  const hours = (on: boolean, online: boolean) => ({
    mine: { on, at: "08:00", minutes: 60, online },
    ours: { on, at: "19:00", minutes: 30, online: false },
    dream: { on, at: "03:30", minutes: 20, online: false },
  });
  if (quiet === "none") delete life.quietHours;
  if (markupWeb) {
    const newest = kestrel.life.hours[0] as Record<string, unknown>;
    newest.web = {
      read: [
        '<img src=x onerror="window.__wp54=1">',
        "https://tides.example.org/<b>bold</b>",
      ],
      searched: ["<script>window.__wp54=2</script> tides"],
    };
  }
  if (quiet === "all-off")
    life.quietHours = { where: "here", hours: hours(false, false), cant: null };
  if (quiet === "all-on")
    life.quietHours = { where: "here", hours: hours(true, true), cant: null };
  if (quiet === "cant")
    life.quietHours = { where: "here", hours: hours(false, false), cant: CANT };
  if (quiet === "hermes")
    life.quietHours = {
      where: "hermes",
      hours: {
        mine: {
          at: "08:00",
          on: true,
          online: true,
          limited: true,
          made_by: "mnemos",
        },
        ours: null,
        dream: {
          at: "03:30",
          on: true,
          online: false,
          limited: true,
          made_by: "mnemos",
        },
      },
    };
  await page.addInitScript(
    ({ kestrel, hello, pictures, refusal }) => {
      type Invoke = (
        cmd: string,
        args?: Record<string, unknown>,
        opts?: unknown,
      ) => Promise<unknown>;
      type Hour = {
        on: boolean;
        at: string;
        minutes: number;
        online: boolean;
      };
      const win = window as unknown as {
        __TAURI_INTERNALS__?: { invoke?: Invoke };
        hoursProbe: Probe;
      };
      const bridge = win.__TAURI_INTERNALS__ ?? {};
      win.__TAURI_INTERNALS__ = bridge;
      const probe: Probe = {
        calls: [],
        opened: [],
        open: null,
        hoursMode: "ok",
        hoursDelay: 0,
        token: "ht1",
      };
      win.hoursProbe = probe;
      const iso = (ms: number) => new Date(ms).toISOString();
      const fail = (code: string) => Promise.reject(code);
      let changes = 1;
      const life = kestrel.life as unknown as {
        quietHours?: { where: string; hours: Record<string, Hour> };
        studio: { path: string }[];
        notes: { author: string; read?: string | null }[];
        hours: unknown[];
      };
      const NAMES: Record<string, string> = {
        mine: "its own hour",
        ours: "our hour",
        dream: "the dream",
      };
      // The engine's `hours`, played: each named hour changed by itself,
      // and what changed said back in its words.
      const hoursWrite = (write: Record<string, unknown>) => {
        const asked = write.hours as Record<string, Partial<Hour>>;
        const quiet = life.quietHours;
        if (quiet?.where !== "here" || !asked) return fail("invalid_request");
        const said: string[] = [];
        for (const kind of ["mine", "ours", "dream"]) {
          const change = asked[kind];
          const hour = quiet.hours[kind];
          if (!change || !hour) continue;
          const name = NAMES[kind] ?? kind;
          if (change.on === false) {
            hour.on = false;
            said.push(`${name}: off`);
            continue;
          }
          Object.assign(hour, change);
          said.push(
            `${name}: on, daily at ${hour.at}, up to ${hour.minutes} minutes, ${kind === "dream" ? "never online" : hour.online ? "online" : "offline"}`,
          );
        }
        changes += 1;
        probe.token = `ht${changes}`;
        return {
          kind: "hours",
          said: said
            .map((l) => `${l.charAt(0).toUpperCase()}${l.slice(1)}.`)
            .join(" "),
        };
      };
      const read = (request: Record<string, unknown>) => {
        if (request.command === "summary")
          return {
            kind: "summary",
            summary: {
              missing: false,
              counts: {
                memories: kestrel.memories.length,
                hours: life.hours.length,
                made: life.studio.length,
              },
              unread: life.notes.filter((n) => n.author === "agent" && !n.read)
                .length,
              waiting: 1,
              change_token: probe.token,
            },
          };
        if (request.command === "notebook" && request.part === "life")
          return {
            kind: "notebook",
            part: "life",
            document: JSON.parse(JSON.stringify(kestrel.life)),
            page: null,
            pictures: life.studio.map((s) => s.path),
          };
        if (request.command === "notebook" && request.part === "memories") {
          const offset = Number(request.offset ?? 0);
          const limit = Number(request.limit ?? kestrel.memories.length);
          const slice = kestrel.memories.slice(offset, offset + limit);
          const end = offset + slice.length;
          return {
            kind: "notebook",
            part: "memories",
            document: {
              version: kestrel.version,
              made: iso(Date.now()),
              memories: slice,
              ...(offset === 0 ? { recalled: kestrel.recalled } : {}),
            },
            page: {
              offset,
              limit,
              total: kestrel.memories.length,
              next: end < kestrel.memories.length ? end : null,
            },
            pictures: [],
          };
        }
        return fail(`unexpected ${String(request.command)}`);
      };
      const place = async (cmd: string, args: Record<string, unknown> = {}) => {
        if (cmd === "mnemos_place_minds")
          return {
            mnemosReady: true,
            minds: [
              {
                id: "kestrel",
                name: "Kestrel",
                memories: 12,
                newest: iso(Date.now()).slice(0, 10),
                linked: [],
              },
            ],
            withoutMemory: [],
          };
        if (cmd === "open_mnemos_mind") {
          probe.open = String(args.mind);
          return true;
        }
        if (cmd === "mnemos_place_hello")
          return args.mind === "kestrel" ? hello : null;
        if (cmd === "read_mnemos_place") {
          if (probe.open !== args.mind) return fail("not_open");
          return read(args.request as Record<string, unknown>);
        }
        if (cmd === "write_mnemos_place") {
          if (probe.open !== args.mind) return fail("not_open");
          const write = args.write as Record<string, unknown>;
          if (write.command !== "hours") return fail("invalid_request");
          if (probe.hoursDelay)
            await new Promise((r) => setTimeout(r, probe.hoursDelay));
          if (probe.hoursMode === "refuse")
            return fail(`mnemos_refused:${refusal}`);
          if (probe.hoursMode === "fail") return fail("mnemos_failed");
          return hoursWrite(write);
        }
        if (cmd === "mnemos_place_picture") {
          const bytes = Uint8Array.from(
            atob(pictures[String(args.path)] ?? ""),
            (c) => c.charCodeAt(0),
          );
          return bytes.buffer;
        }
        if (cmd === "mnemos_place_item")
          return JSON.stringify([kestrel.memories, kestrel.life]).includes(
            `"id":"${String(args.id)}"`,
          );
        if (cmd === "close_mnemos_place") {
          probe.open = null;
          return null;
        }
        if (cmd === "mnemos_place_shown") return null;
        return fail(`unexpected ${cmd}`);
      };
      let delegate: Invoke | undefined;
      Object.defineProperty(bridge, "invoke", {
        configurable: true,
        set(next: Invoke) {
          delegate = next;
        },
        get:
          () =>
          async (
            cmd: string,
            args?: Record<string, unknown>,
            opts?: unknown,
          ) => {
            // The app's one way to open a link outside itself: recorded,
            // and nothing opens.
            if (cmd === "plugin:opener|open_url") {
              probe.opened.push(String(args?.url));
              return null;
            }
            if (!cmd.includes("mnemos")) return delegate?.(cmd, args, opts);
            probe.calls.push({
              cmd,
              args: args ? JSON.parse(JSON.stringify(args)) : undefined,
            });
            return place(cmd, args);
          },
      });
    },
    {
      kestrel,
      hello: KESTREL_HELLO,
      pictures: BOARD_PICTURES,
      refusal: REFUSAL,
    },
  );
  await installMockBridge(page, {});
  await page.addInitScript(
    ({ key, light }) => {
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

const probeOf = (page: Page) =>
  page.evaluate(() => (window as unknown as { hoursProbe: Probe }).hoursProbe);

/** The `hours` writes sent to the engine, each as the bridge got it. */
async function hoursSent(page: Page) {
  return (await probeOf(page)).calls
    .filter((c) => c.cmd === "write_mnemos_place")
    .map((c) => c.args?.write as Record<string, unknown>);
}

function consoleClean(errors: string[]) {
  return errors.filter((e) => !/ResizeObserver loop/.test(e));
}

function measure(key: string, value: unknown) {
  mkdirSync(`${SHOTS}/measures`, { recursive: true });
  writeFileSync(
    `${SHOTS}/measures/${key}.json`,
    JSON.stringify(value, null, 2),
  );
}

// The two gaps between an hour's three line labels, label top to label top.
async function linePitch(page: Page, kind: string) {
  return page.getByTestId(`mnemos-set-${kind}-lines`).evaluate((el) => {
    const tops = [
      ...el.querySelectorAll(
        ":scope > .luca-mnemos-hour-line > .luca-mnemos-hour-k",
      ),
    ].map((k) => k.getBoundingClientRect().top);
    return tops.slice(1).map((t, i) => Math.round((t - tops[i]) * 100) / 100);
  });
}

async function shot(page: Page, name: string) {
  // A double click's stray text selection is the test's, not the page's.
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await waitForAnimations(page);
  await page.waitForTimeout(300);
  mkdirSync(SHOTS, { recursive: true });
  const path = `${SHOTS}/${name}.png`;
  await page.screenshot({ path });
  const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
  let all: Record<string, string> = {};
  try {
    all = JSON.parse(readFileSync(`${SHOTS}/hashes.json`, "utf8"));
  } catch {
    all = {};
  }
  all[name] = hash;
  writeFileSync(`${SHOTS}/hashes.json`, JSON.stringify(all, null, 2));
}

const group = (page: Page) => page.getByTestId("mnemos-settings-hours");
const on = (page: Page, kind: string) =>
  page.getByTestId(`mnemos-set-${kind}-on`);
const lines = (page: Page, kind: string) =>
  page.getByTestId(`mnemos-set-${kind}-lines`);

/** Save, then the ask's yes: the ask's words. Nothing goes before the yes
 *  (`before`: what was sent already). */
async function saveAndSay(page: Page, before = 0) {
  await page.getByTestId("mnemos-hours-save").click();
  const ask = page.getByTestId("mnemos-hours-ask");
  await expect(ask).toBeVisible();
  const words = {
    lines: await page.getByTestId("mnemos-hours-ask-line").allTextContents(),
    sentences: await page
      .getByTestId("mnemos-hours-ask-sentence")
      .allTextContents(),
  };
  expect(await hoursSent(page), "nothing before the yes").toHaveLength(before);
  await page.getByTestId("mnemos-hours-ask-yes").click();
  await expect(ask).toBeHidden();
  return words;
}

test("(1, 2, 8) all off: a row for each hour, its own switch, and no switch for all three", async ({
  page,
}) => {
  const errors = await boot(page, { quiet: "all-off" });
  await expect(group(page)).toBeVisible();
  await expect(page.getByTestId("mnemos-hours-lede")).toHaveText(
    "Time between conversations that’s Kestrel’s own. They run Claude on its own and use Pat’s Claude plan.",
  );
  const rows = group(page).locator(".luca-mnemos-hour");
  await expect(rows).toHaveCount(3);
  expect(await rows.locator(".luca-place-row-title").allTextContents()).toEqual(
    ["Its own hour", "Our hour", "The dream"],
  );
  // Each has its own switch, named for its hour; none for all three.
  for (const [kind, name] of [
    ["mine", "Its own hour"],
    ["ours", "Our hour"],
    ["dream", "The dream"],
  ]) {
    await expect(on(page, kind)).toHaveAttribute("role", "switch");
    await expect(on(page, kind)).toHaveAccessibleName(name);
    await expect(on(page, kind)).not.toBeChecked();
    await expect(lines(page, kind)).toHaveCount(0);
  }
  await expect(group(page).getByRole("switch")).toHaveCount(3);
  await expect(page.getByTestId("mnemos-hours-switch")).toHaveCount(0);
  await expect(page.getByTestId("mnemos-hours-on")).toHaveCount(0);
  await expect(page.getByTestId("mnemos-hours-hint")).toHaveText(
    "All off. Nothing runs between conversations.",
  );
  await expect(page.getByTestId("mnemos-hours-save")).toHaveCount(0);
  await shot(page, "01-hours-all-off-dark");

  // Its own hour on: its lines appear, with the time and length it has,
  // online off as it was saved.
  await on(page, "mine").click();
  await expect(lines(page, "mine")).toBeVisible();
  await expect(page.getByTestId("mnemos-set-mine-at")).toHaveValue("08:00");
  await expect(page.getByTestId("mnemos-set-mine-minutes")).toHaveValue("60");
  await expect(lines(page, "mine")).toContainText("Starts at");
  await expect(lines(page, "mine")).toContainText("How long");
  await expect(lines(page, "mine")).toContainText("An hour");
  await expect(lines(page, "mine")).toContainText("Can go online");
  await expect(page.getByTestId("mnemos-set-mine-online")).not.toBeChecked();
  await expect(page.getByTestId("mnemos-set-mine-online-line")).toHaveText(
    "It can’t search or read the web in this hour.",
  );
  await expect(page.getByTestId("mnemos-hours-hint")).toHaveText(
    "Not saved yet.",
  );
  await expect(lines(page, "ours")).toHaveCount(0);
  await shot(page, "02-own-hour-on-dark");

  // Online on: the line changes.
  await page.getByTestId("mnemos-set-mine-online").click();
  await expect(page.getByTestId("mnemos-set-mine-online")).toBeChecked();
  await expect(page.getByTestId("mnemos-set-mine-online-line")).toHaveText(
    "It can search and read the web in this hour. Every page it reads is listed in Hours.",
  );
  await shot(page, "03-own-hour-online-dark");

  // The layout (8): the lines at the row's text edge, a step quieter and
  // at the summary's size; the online line under its label, never beside
  // the switch; one hairline between hours, none inside one.
  const look = await page.evaluate(() => {
    const q = (s: string) => document.querySelector(s) as HTMLElement;
    const row = q("[data-testid='mnemos-set-mine'] > .luca-place-row");
    const title = row.querySelector(".luca-place-row-title") as HTMLElement;
    const summary = row.querySelector(".luca-place-row-summary") as HTMLElement;
    const linesEl = q("[data-testid='mnemos-set-mine-lines']");
    const label = linesEl.querySelector(".luca-mnemos-hour-k") as HTMLElement;
    const say = q("[data-testid='mnemos-set-mine-online-line']");
    const online = q("[data-testid='mnemos-set-mine-online']");
    const sayBox = say.getBoundingClientRect();
    const switchBox = online.getBoundingClientRect();
    const before = (el: Element) => getComputedStyle(el, "::before").content;
    const hours = [...document.querySelectorAll(".luca-mnemos-hour")];
    return {
      titleLeft: Math.round(title.getBoundingClientRect().left),
      labelLeft: Math.round(label.getBoundingClientRect().left),
      titleSize: getComputedStyle(title).fontSize,
      summarySize: getComputedStyle(summary).fontSize,
      labelSize: getComputedStyle(label).fontSize,
      titleColor: getComputedStyle(title).color,
      labelColor: getComputedStyle(label).color,
      summaryColor: getComputedStyle(summary).color,
      sayBelowSwitch: sayBox.top >= switchBox.bottom - 1,
      timeNums: getComputedStyle(q("[data-testid='mnemos-set-mine-at']"))
        .fontVariantNumeric,
      menuNums: getComputedStyle(
        linesEl.querySelector(".luca-mnemos-menu") as HTMLElement,
      ).fontVariantNumeric,
      hairlines: hours.map((h) => before(h)),
      boxesInside: [...linesEl.querySelectorAll("*")].filter((el) => {
        const cs = getComputedStyle(el);
        return (
          cs.borderTopWidth !== "0px" &&
          cs.borderStyle !== "none" &&
          !el.matches("button, input, select")
        );
      }).length,
    };
  });
  const pitch = await linePitch(page, "mine");
  measure("layout", { ...look, linePitch: pitch });
  expect(pitch).toHaveLength(2);
  expect(pitch[0]).toBe(pitch[1]);
  expect(look.labelLeft).toBe(look.titleLeft);
  expect(look.labelSize).toBe(look.summarySize);
  expect(look.labelColor).not.toBe(look.titleColor);
  expect(look.sayBelowSwitch).toBe(true);
  expect(look.timeNums).toContain("tabular-nums");
  expect(look.menuNums).toContain("tabular-nums");
  expect(look.hairlines).toEqual(["none", '""', '""']);
  expect(look.boxesInside).toBe(0);

  // Save asks first; nothing goes before the yes.
  await page.getByTestId("mnemos-hours-save").click();
  const ask = page.getByTestId("mnemos-hours-ask");
  await expect(ask).toBeVisible();
  await expect(ask.locator("#mnemos-hours-ask-title")).toHaveText(
    "Save these quiet hours?",
  );
  await expect(page.getByTestId("mnemos-hours-ask-line")).toHaveText([
    "Its own hour: on, daily at 8:00 am, up to an hour, online.",
  ]);
  await expect(page.getByTestId("mnemos-hours-ask-sentence")).toHaveText([
    "Turning an hour on sets a small job on this Mac that wakes Kestrel at that time.",
    "Online, it can search and read the web in that hour. Every page it reads is listed in Hours.",
  ]);
  await expect(page.getByTestId("mnemos-hours-ask-no")).toHaveText("Not now");
  await expect(page.getByTestId("mnemos-hours-ask-yes")).toHaveText("Save");
  await page.waitForTimeout(400);
  expect(await hoursSent(page)).toEqual([]);
  await shot(page, "04-confirm-dark");
  // Placed directly under the group it speaks for.
  const gap = await group(page).evaluate((el) => {
    const plate = el.querySelector(".luca-place-plate") as HTMLElement;
    const askEl = el.querySelector(
      "[data-testid='mnemos-hours-ask']",
    ) as HTMLElement;
    return Math.round(
      askEl.getBoundingClientRect().top - plate.getBoundingClientRect().bottom,
    );
  });
  measure("confirm-gap", gap);
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThanOrEqual(10);

  // Not now: nothing.
  await page.getByTestId("mnemos-hours-ask-no").click();
  expect(await hoursSent(page)).toEqual([]);
  // Yes, twice quickly: exactly one request, only what changed.
  await page.evaluate(() => {
    (window as unknown as { hoursProbe: Probe }).hoursProbe.hoursDelay = 600;
  });
  await page.getByTestId("mnemos-hours-save").click();
  await page.getByTestId("mnemos-hours-ask-yes").dblclick();
  // While it's out, every control is off.
  await expect(on(page, "ours")).toBeDisabled();
  await expect(page.getByTestId("mnemos-set-mine-at")).toBeDisabled();
  await expect(page.getByTestId("mnemos-set-mine-minutes")).toBeDisabled();
  await expect(page.getByTestId("mnemos-set-mine-online")).toBeDisabled();
  await expect(page.getByTestId("mnemos-hours-ask-yes")).toBeDisabled();
  await expect(page.getByTestId("mnemos-hours-ask-yes")).toHaveText("Saving…");
  await expect(page.getByTestId("mnemos-hours-hint")).toHaveText(
    "Its own hour: on, daily at 08:00, up to 60 minutes, online.",
  );
  const sent = await hoursSent(page);
  expect(sent).toEqual([
    { command: "hours", hours: { mine: { on: true, online: true } } },
  ]);
  measure("one-hour-on-online", sent);
  await expect(on(page, "mine")).toBeChecked();
  await expect(page.getByTestId("mnemos-set-mine-online")).toBeChecked();
  await expect(page.getByTestId("mnemos-hours-save")).toHaveCount(0);
  await shot(page, "05-saved-dark");
  // Read again, the notebook agrees, and the engine's words stay.
  await page.waitForTimeout(6_000);
  await expect(on(page, "mine")).toBeChecked();
  await expect(page.getByTestId("mnemos-hours-hint")).toHaveText(
    "Its own hour: on, daily at 08:00, up to 60 minutes, online.",
  );
  expect(await hoursSent(page)).toHaveLength(1);
  expect(consoleClean(errors)).toEqual([]);
});

const CASES: {
  name: string;
  change: (page: Page) => Promise<void>;
  sent: Record<string, unknown>;
  lines: string[];
  sentences: string[];
}[] = [
  {
    name: "one hour on, offline",
    change: async (page) => {
      await on(page, "dream").click();
      await expect(page.getByTestId("mnemos-set-dream-never")).toHaveText(
        "Never online.",
      );
      await expect(page.getByTestId("mnemos-set-dream-online")).toHaveCount(0);
    },
    sent: { dream: { on: true } },
    lines: ["The dream: on, daily at 3:30 am, up to 20 minutes, never online."],
    sentences: [
      "Turning an hour on sets a small job on this Mac that wakes Kestrel at that time.",
    ],
  },
  {
    name: "one hour on, online",
    change: async (page) => {
      await page.getByTestId("mnemos-set-ours-online").click();
    },
    sent: { ours: { on: true, online: true } },
    lines: ["Our hour: on, daily at 7:00 pm, up to 30 minutes, online."],
    sentences: [
      "Online, it can search and read the web in that hour. Every page it reads is listed in Hours.",
    ],
  },
  {
    name: "a time change alone",
    change: async (page) => {
      await page.getByTestId("mnemos-set-mine-at").fill("07:15");
    },
    sent: { mine: { on: true, at: "07:15" } },
    lines: ["Its own hour: on, daily at 7:15 am, up to an hour, online."],
    sentences: [],
  },
  {
    name: "a length change alone",
    change: async (page) => {
      await page.getByTestId("mnemos-set-ours-minutes").selectOption("45");
    },
    sent: { ours: { on: true, minutes: 45 } },
    lines: ["Our hour: on, daily at 7:00 pm, up to 45 minutes, offline."],
    sentences: [],
  },
  {
    name: "one hour off",
    change: async (page) => {
      // Touched first, then turned off: only on: false goes.
      await page.getByTestId("mnemos-set-ours-minutes").selectOption("90");
      await on(page, "ours").click();
      await expect(lines(page, "ours")).toHaveCount(0);
    },
    sent: { ours: { on: false } },
    lines: ["Our hour: off."],
    sentences: ["Turning one off takes its job away."],
  },
  {
    name: "two hours changed at once",
    change: async (page) => {
      await page.getByTestId("mnemos-set-mine-online").click();
      await on(page, "dream").click();
      await page.getByTestId("mnemos-set-dream-minutes").selectOption("10");
    },
    sent: {
      mine: { on: true, online: false },
      dream: { on: true, minutes: 10 },
    },
    lines: [
      "Its own hour: on, daily at 8:00 am, up to an hour, offline.",
      "The dream: on, daily at 3:30 am, up to 10 minutes, never online.",
    ],
    sentences: [
      "Turning an hour on sets a small job on this Mac that wakes Kestrel at that time.",
    ],
  },
];

for (const c of CASES)
  test(`(5) exactly one request, with exactly what changed: ${c.name}`, async ({
    page,
  }) => {
    const errors = await boot(page);
    await expect(on(page, "mine")).toBeChecked();
    await c.change(page);
    await page.waitForTimeout(300);
    expect(await hoursSent(page), "nothing as it changes").toEqual([]);
    const said = await saveAndSay(page);
    expect(said.lines).toEqual(c.lines);
    expect(said.sentences).toEqual(c.sentences);
    await expect(page.getByTestId("mnemos-hours-hint")).not.toHaveText(
      "Not saved yet.",
    );
    const sent = await hoursSent(page);
    expect(sent).toEqual([{ command: "hours", hours: c.sent }]);
    measure(`sent-${c.name.replace(/\W+/g, "-")}`, sent);
    expect(consoleClean(errors)).toEqual([]);
  });

test("(5) a second change right after a save sends only itself", async ({
  page,
}) => {
  const errors = await boot(page);
  await on(page, "dream").click();
  await saveAndSay(page);
  await expect(page.getByTestId("mnemos-hours-hint")).toHaveText(
    "The dream: on, daily at 03:30, up to 20 minutes, never online.",
  );
  // At once, before the notebook is read again.
  await page.getByTestId("mnemos-set-ours-minutes").selectOption("20");
  await saveAndSay(page, 1);
  expect(await hoursSent(page)).toEqual([
    { command: "hours", hours: { dream: { on: true } } },
    { command: "hours", hours: { ours: { on: true, minutes: 20 } } },
  ]);
  expect(consoleClean(errors)).toEqual([]);
});

test("(4) Undo puts it back as it's saved, and sends nothing", async ({
  page,
}) => {
  const errors = await boot(page);
  await on(page, "ours").click();
  await page.getByTestId("mnemos-set-mine-at").fill("06:45");
  await expect(page.getByTestId("mnemos-hours-hint")).toHaveText(
    "Not saved yet.",
  );
  await page.getByTestId("mnemos-hours-undo").click();
  await expect(on(page, "ours")).toBeChecked();
  await expect(page.getByTestId("mnemos-set-mine-at")).toHaveValue("08:00");
  await expect(page.getByTestId("mnemos-hours-hint")).toHaveText(
    "Scheduled on this Mac.",
  );
  await expect(on(page, "mine")).toBeFocused();
  await expect(page.getByTestId("mnemos-hours-undo")).toHaveCount(0);
  expect(await hoursSent(page)).toEqual([]);
  expect(consoleClean(errors)).toEqual([]);
});

test("(5) a refusal is shown as given; a failure is one plain line; the change stays", async ({
  page,
}) => {
  const errors = await boot(page);
  await page.evaluate(() => {
    (window as unknown as { hoursProbe: Probe }).hoursProbe.hoursMode =
      "refuse";
  });
  await page.getByTestId("mnemos-set-mine-at").fill("09:00");
  await saveAndSay(page);
  await expect(page.getByTestId("mnemos-hours-refused")).toHaveText(REFUSAL);
  await expect(page.getByTestId("mnemos-set-mine-at")).toHaveValue("09:00");
  await expect(page.getByTestId("mnemos-hours-hint")).toHaveText(
    "Not saved yet.",
  );
  expect(await hoursSent(page)).toHaveLength(1);
  await page.evaluate(() => {
    (window as unknown as { hoursProbe: Probe }).hoursProbe.hoursMode = "fail";
  });
  await saveAndSay(page, 1);
  await expect(page.getByTestId("mnemos-hours-refused")).toHaveText(
    "The quiet hours couldn’t be changed just now.",
  );
  expect(await hoursSent(page)).toHaveLength(2);
  expect(consoleClean(errors)).toEqual([]);
});

// Where the keyboard is once the confirm has closed: its test id, or the
// tag of what has focus when nothing with an id does (BODY: lost).
const focusedId = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    return a?.getAttribute("data-testid") ?? a?.tagName ?? null;
  });

async function askByKeys(page: Page, mode: Probe["hoursMode"] = "ok") {
  const errors = await boot(page, { quiet: "all-off" });
  await page.evaluate((mode) => {
    (window as unknown as { hoursProbe: Probe }).hoursProbe.hoursMode = mode;
  }, mode);
  await on(page, "mine").focus();
  await page.keyboard.press("Space");
  await expect(on(page, "mine")).toBeChecked();
  await page.getByTestId("mnemos-hours-save").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("mnemos-hours-ask-yes")).toBeFocused();
  return errors;
}

test("(keyboard) Not now: the keyboard is back on the foot's Save", async ({
  page,
}) => {
  const errors = await askByKeys(page);
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByTestId("mnemos-hours-ask-no")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("mnemos-hours-ask")).toHaveCount(0);
  await expect.poll(() => focusedId(page)).toBe("mnemos-hours-save");
  expect(await hoursSent(page)).toEqual([]);
  expect(consoleClean(errors)).toEqual([]);
});

// Escape never closed the confirm; it still doesn't, and the keyboard
// stays on it.
test("(keyboard) Escape on the confirm leaves it open, with the keyboard in it", async ({
  page,
}) => {
  const errors = await askByKeys(page);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("mnemos-hours-ask")).toBeVisible();
  await expect.poll(() => focusedId(page)).toBe("mnemos-hours-ask-yes");
  expect(await hoursSent(page)).toEqual([]);
  expect(consoleClean(errors)).toEqual([]);
});

test("(keyboard) Save, taken: the keyboard is on the first hour's switch, and the engine's words are said", async ({
  page,
}) => {
  const errors = await askByKeys(page);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("mnemos-hours-ask")).toHaveCount(0);
  await expect(page.getByTestId("mnemos-hours-save")).toHaveCount(0);
  await expect(page.getByTestId("mnemos-hours-hint")).toHaveAttribute(
    "aria-live",
    "polite",
  );
  await expect(page.getByTestId("mnemos-hours-hint")).not.toHaveText(
    "Not saved yet.",
  );
  await expect.poll(() => focusedId(page)).toBe("mnemos-set-mine-on");
  expect(await hoursSent(page)).toHaveLength(1);
  expect(consoleClean(errors)).toEqual([]);
});

for (const mode of ["refuse", "fail"] as const)
  test(`(keyboard) Save, ${mode === "refuse" ? "refused" : "failed"}: the keyboard is back on the foot's Save, and the line is said`, async ({
    page,
  }) => {
    const errors = await askByKeys(page, mode);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("mnemos-hours-ask")).toHaveCount(0);
    await expect(page.getByTestId("mnemos-hours-refused")).toHaveAttribute(
      "role",
      "status",
    );
    await expect(page.getByTestId("mnemos-hours-refused")).toHaveText(
      mode === "refuse"
        ? REFUSAL
        : "The quiet hours couldn’t be changed just now.",
    );
    await expect.poll(() => focusedId(page)).toBe("mnemos-hours-save");
    expect(await hoursSent(page)).toHaveLength(1);
    expect(consoleClean(errors)).toEqual([]);
  });

test("(3) inside Hermes: the rows only to read, no switches, and where they're changed", async ({
  page,
}) => {
  const errors = await boot(page, { quiet: "hermes" });
  await expect(group(page).locator(".luca-mnemos-hour")).toHaveCount(3);
  await expect(group(page).getByRole("switch")).toHaveCount(0);
  await expect(group(page).locator("input, select")).toHaveCount(0);
  await expect(page.getByTestId("mnemos-hours-save")).toHaveCount(0);
  await expect(page.getByTestId("mnemos-set-mine-state")).toHaveText(
    "On (Its own hour)",
  );
  await expect(page.getByTestId("mnemos-set-ours-state")).toHaveText(
    "Off (Our hour)",
  );
  await expect(lines(page, "mine")).toContainText("Starts at8:00 am");
  await expect(lines(page, "mine")).toContainText(
    "Can go onlineIt can search and read the web in this hour.",
  );
  await expect(lines(page, "dream")).toContainText("Never online.");
  await expect(lines(page, "ours")).toHaveCount(0);
  await expect(page.getByTestId("mnemos-hours-hermes")).toHaveText(
    "Hermes runs these as its own scheduled jobs. To change them, ask Kestrel.",
  );
  await shot(page, "07-hermes-dark");
  expect(await hoursSent(page)).toEqual([]);
  expect(consoleClean(errors)).toEqual([]);
});

test("(3) where none can be turned on here, the engine's line, as given, and the switches held", async ({
  page,
}) => {
  const errors = await boot(page, { quiet: "cant" });
  await expect(page.getByTestId("mnemos-hours-cant")).toHaveText(CANT);
  for (const kind of ["mine", "ours", "dream"])
    await expect(on(page, kind)).toBeDisabled();
  await shot(page, "08-cant-dark");
  expect(await hoursSent(page)).toEqual([]);
  expect(consoleClean(errors)).toEqual([]);
});

test("(3) a Mnemos from before 0.7.0: the one line, and nothing else", async ({
  page,
}) => {
  const errors = await boot(page, { quiet: "none" });
  await expect(page.getByTestId("mnemos-needs-newer")).toHaveText(
    "Choosing each quiet hour needs a newer Mnemos. Updating Mnemos brings it.",
  );
  await expect(group(page).getByRole("switch")).toHaveCount(0);
  await expect(group(page).locator(".luca-mnemos-hour")).toHaveCount(0);
  await expect(page.getByTestId("mnemos-hours-hint")).toHaveCount(0);
  await expect(page.getByTestId("mnemos-hours-lede")).toHaveCount(0);
  // Jev and About still stand.
  await expect(page.getByTestId("mnemos-settings-jev")).toBeVisible();
  await shot(page, "09-older-engine-dark");
  expect(consoleClean(errors)).toEqual([]);
});

test("(7) an opened hour: online, what it read and searched, and only http(s) opens", async ({
  page,
}) => {
  const errors = await boot(page, { hash: "/mnemos?mind=kestrel&room=hours" });
  const opened = page.getByTestId("mnemos-hour-opened");
  await expect(opened).toBeVisible();
  await expect(page.getByTestId("mnemos-hour-head")).toContainText(
    "nothing refused · online",
  );
  const read = page.getByTestId("mnemos-hour-read");
  await expect(
    opened.getByRole("heading", { name: "Read online" }),
  ).toBeVisible();
  await expect(opened.getByRole("heading", { name: "Searched" })).toBeVisible();
  // After what it made.
  const order = await opened.evaluate((el) =>
    [...el.querySelectorAll("h3")].map((h) => h.textContent),
  );
  measure("opened-order", order);
  expect(order.indexOf("Read online")).toBe(order.indexOf("What it made") + 1);
  expect(order.indexOf("Searched")).toBe(order.indexOf("Read online") + 1);
  const page1 = read.getByTestId("mnemos-hour-read-page");
  await expect(page1).toHaveText("tides.example.org/north-harbour/spring");
  await expect(page1).toHaveAttribute(
    "title",
    "https://tides.example.org/north-harbour/spring?week=48",
  );
  const other = read.getByTestId("mnemos-hour-read-written");
  await expect(other).toHaveText("ftp://charts.example.net/old-sandbar.pdf");
  await expect(page.getByTestId("mnemos-hour-searched")).toHaveText(
    "spring tide times north harbour",
  );
  // Text only: no link element, nothing rendered as markup.
  await expect(opened.locator("a")).toHaveCount(0);
  await opened
    .getByRole("heading", { name: "Searched" })
    .scrollIntoViewIfNeeded();
  await shot(page, "10-hour-opened-web-dark");
  // The https page opens once, through the app's outside link; the other
  // opens nothing.
  await page1.click();
  await other.click();
  await page.waitForTimeout(300);
  const opener = (await probeOf(page)).opened;
  measure("opened-links", opener);
  expect(opener).toEqual([
    "https://tides.example.org/north-harbour/spring?week=48",
  ]);
  // By keyboard too.
  await page1.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  expect((await probeOf(page)).opened).toHaveLength(2);
  // An hour that stayed offline shows nothing more.
  await page.getByTestId("mnemos-hours-row-kes-h2").getByRole("button").click();
  await expect(page.getByTestId("mnemos-hour-head")).toContainText("offline");
  await expect(page.getByTestId("mnemos-hour-read")).toHaveCount(0);
  await expect(page.getByTestId("mnemos-hour-searched")).toHaveCount(0);
  expect(consoleClean(errors)).toEqual([]);
});

test("(7) the web group is text only: markup in what it read is shown as written", async ({
  page,
}) => {
  const errors = await boot(page, {
    hash: "/mnemos?mind=kestrel&room=hours",
    markupWeb: true,
  });
  const opened = page.getByTestId("mnemos-hour-opened");
  await expect(opened).toBeVisible();
  await expect(page.getByTestId("mnemos-hour-read-written")).toHaveText(
    '<img src=x onerror="window.__wp54=1">',
  );
  // An https address with markup in its path: opens, shown as text.
  await expect(page.getByTestId("mnemos-hour-read-page")).toHaveText(
    "tides.example.org/%3Cb%3Ebold%3C/b%3E",
  );
  await expect(page.getByTestId("mnemos-hour-searched")).toHaveText(
    "<script>window.__wp54=2</script> tides",
  );
  const inside = await opened.evaluate((el) => ({
    img: el.querySelectorAll(".luca-mnemos-web img").length,
    b: el.querySelectorAll(".luca-mnemos-web b").length,
    script: el.querySelectorAll("script").length,
    ran: (window as unknown as { __wp54?: number }).__wp54 ?? null,
  }));
  measure("text-only", inside);
  expect(inside).toEqual({ img: 0, b: 0, script: 0, ran: null });
  expect(consoleClean(errors)).toEqual([]);
});

test("(keyboard) every control by keys: switches, the time, the menu, the confirm", async ({
  page,
}) => {
  const errors = await boot(page, { quiet: "all-off" });
  await on(page, "mine").focus();
  await page.keyboard.press("Space");
  await expect(on(page, "mine")).toBeChecked();
  // Tab into its lines: the time (typed, segment by segment), then the
  // menu (its type-ahead), then online.
  await page.keyboard.press("Tab");
  const time = page.getByTestId("mnemos-set-mine-at");
  await expect(time).toBeFocused();
  await page.keyboard.type("0715A");
  await expect(time).toHaveValue("07:15");
  const menu = page.getByTestId("mnemos-set-mine-minutes");
  for (
    let i = 0;
    i < 4 && !(await menu.evaluate((el) => el === document.activeElement));
    i++
  )
    await page.keyboard.press("Tab");
  await expect(menu).toBeFocused();
  await page.keyboard.type("4");
  await expect(menu).toHaveValue("45");
  await expect(lines(page, "mine")).toContainText("45 minutes");
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("mnemos-set-mine-online")).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.getByTestId("mnemos-set-mine-online")).toBeChecked();
  // On to our hour's switch.
  await page.keyboard.press("Tab");
  await expect(on(page, "ours")).toBeFocused();
  // Each control's spoken name says its hour.
  for (const [id, name] of [
    ["mnemos-set-mine-at", "Its own hour, starts at"],
    ["mnemos-set-mine-minutes", "Its own hour, how long"],
    ["mnemos-set-mine-online", "Its own hour, can go online"],
  ])
    await expect(page.getByTestId(id)).toHaveAccessibleName(name);
  // Each control's focus ring, by keyboard: a switch, the time, the menu.
  const ring = async (testId: string, of: "self" | "menu" = "self") => {
    const read = () =>
      page.getByTestId(testId).evaluate((el, of) => {
        const host =
          of === "menu" ? (el.closest(".luca-mnemos-menu") as HTMLElement) : el;
        const cs = getComputedStyle(host);
        return `${cs.boxShadow} | ${cs.outlineStyle} ${cs.outlineWidth}`;
      }, of);
    await page.getByTestId("mnemos-hours-lede").click();
    const resting = await read();
    await page.getByTestId(testId).focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(page.getByTestId(testId)).toBeFocused();
    return { resting, focused: await read() };
  };
  const rings = {
    switch: await ring("mnemos-set-ours-on"),
    online: await ring("mnemos-set-mine-online"),
    time: await ring("mnemos-set-mine-at"),
    menu: await ring("mnemos-set-mine-minutes", "menu"),
  };
  measure("focus-rings", rings);
  for (const [what, r] of Object.entries(rings))
    expect(r.focused, what).not.toBe(r.resting);
  // Save, the ask, Not now, Save again and yes: all by keys.
  await page.getByTestId("mnemos-hours-save").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("mnemos-hours-ask-yes")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByTestId("mnemos-hours-ask-no")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("mnemos-hours-ask")).toBeHidden();
  expect(await hoursSent(page)).toEqual([]);
  await page.getByTestId("mnemos-hours-save").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("mnemos-hours-ask-yes")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("mnemos-hours-ask")).toBeHidden();
  const sent = await hoursSent(page);
  measure("keyboard-sent", sent);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toEqual({
    command: "hours",
    hours: { mine: { on: true, at: "07:15", minutes: 45, online: true } },
  });
  expect(consoleClean(errors)).toEqual([]);
});

test("(motion) under reduced motion, opening an hour's lines moves nothing", async ({
  page,
}) => {
  const errors = await boot(page, { quiet: "all-off", reducedMotion: true });
  await on(page, "mine").click();
  await expect(lines(page, "mine")).toBeVisible();
  const moving = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => {
        const target = (a.effect as KeyframeEffect | null)?.target;
        return (
          target instanceof Element &&
          target.closest("[data-testid='mnemos-settings-hours']") &&
          a.playState === "running"
        );
      })
      .map((a) => {
        const target = (a.effect as KeyframeEffect | null)?.target as Element;
        return `${(a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty} on ${target.tagName.toLowerCase()}.${String(target.className).slice(0, 80)}`;
      }),
  );
  measure("reduced-motion-running", moving);
  expect(moving).toEqual([]);
  // And none of our own in the lines with motion allowed: no animation is
  // named on them.
  const named = await lines(page, "mine").evaluate(
    (el) => getComputedStyle(el).animationName,
  );
  expect(named).toBe("none");
  expect(consoleClean(errors)).toEqual([]);
});

for (const [mode, size, name] of [
  ["light", { width: 1440, height: 900 }, "06-all-on-light"],
  ["dark", { width: 1100, height: 720 }, "11-settings-1100-dark"],
  ["light", { width: 1100, height: 720 }, "settings-1100-light"],
  ["dark", { width: 1440, height: 900 }, "settings-1440-dark"],
] as const)
  test(`(look) ${name}`, async ({ page }) => {
    const errors = await boot(page, {
      mode,
      quiet: name === "06-all-on-light" ? "all-on" : "fixture",
      size,
    });
    await expect(lines(page, "mine")).toBeVisible();
    // Nothing runs past the group's edge at this size.
    const over = await group(page).evaluate((el) => {
      const edge = el.getBoundingClientRect().right;
      return [...el.querySelectorAll<HTMLElement>("*")]
        .filter((c) => c.getBoundingClientRect().right > edge + 0.5)
        .map((c) => c.className);
    });
    measure(`overflow-${name}`, over);
    expect(over).toEqual([]);
    // The three lines under each hour that's on fall at one even pitch.
    const pitches: Record<string, number[]> = {};
    for (const kind of ["mine", "ours"]) {
      if ((await lines(page, kind).count()) === 0) continue;
      pitches[kind] = await linePitch(page, kind);
    }
    measure(`pitch-${name}`, pitches);
    for (const pitch of Object.values(pitches)) {
      expect(pitch).toHaveLength(2);
      expect(pitch[0]).toBe(pitch[1]);
    }
    await shot(page, name);
    expect(consoleClean(errors)).toEqual([]);
  });
