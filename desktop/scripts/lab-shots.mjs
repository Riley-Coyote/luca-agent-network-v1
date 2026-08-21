/**
 * Render the design lab at native resolution, per theme, and check the things
 * that go wrong silently: overlapped chrome, a date pill adrift from the
 * header, a strip that is not the composer's width, a broken plate, mono type
 * leaking into chrome. Screenshots land under test-results/lab-shots/<theme>/
 * at 2× so they can be judged by eye — the 2× clips are what to look at, not a
 * scaled pane image.
 *
 *   node scripts/lab-shots.mjs                 # build, then shoot 3 themes
 *   node scripts/lab-shots.mjs --no-build      # shoot the existing build
 *   node scripts/lab-shots.mjs --themes buzz   # one theme
 *
 * Exits 1 when any check fails, so a regression cannot pass unnoticed.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "@playwright/test";

const DESKTOP = path.resolve(import.meta.dirname, "..");
const REPO = path.resolve(DESKTOP, "..");
const LAB_DIR = path.join(REPO, "design-lab");
const OUT_ROOT = path.join(DESKTOP, "test-results", "lab-shots");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const themes = opt("--themes", "buzz,graphite,catppuccin-latte").split(",");

if (!flag("--no-build")) {
  execSync("node scripts/build-shell-lab.mjs", {
    cwd: DESKTOP,
    stdio: "inherit",
  });
}

// A throwaway static server: the lab is one file, but the pane and Playwright
// both want http, and a fixed port would collide across worktrees.
const server = http.createServer((req, res) => {
  const file = path.join(
    LAB_DIR,
    decodeURIComponent((req.url ?? "/").split("?")[0]),
  );
  if (
    !file.startsWith(LAB_DIR) ||
    !fs.existsSync(file) ||
    fs.statSync(file).isDirectory()
  ) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

const browser = await chromium.launch();
const failures = [];
const report = {};

for (const theme of themes) {
  const out = path.join(OUT_ROOT, theme);
  fs.mkdirSync(out, { recursive: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    // Resource 404s carry the URL on the location, not the text.
    const url = m.location()?.url ?? "";
    consoleErrors.push(`${m.text()} ${url}`.trim());
  });
  page.on("pageerror", (err) =>
    consoleErrors.push(`pageerror: ${err.message}`),
  );
  await page.goto(`http://127.0.0.1:${port}/shell-lab.html?theme=${theme}`);
  await page.waitForSelector('[data-testid="message-author"]', {
    timeout: 20000,
  });

  // Open the drawer if the scene did not already.
  if (!(await page.$('[data-testid="conversation-context-panel"]'))) {
    await page.click(
      '[data-testid="chat-header"] [aria-label="Open conversation details"]',
    );
    await page.waitForSelector('[data-testid="conversation-context-panel"]', {
      timeout: 8000,
    });
  }
  await page.waitForTimeout(700);

  const checks = await page.evaluate(() => {
    const rect = (el) => el?.getBoundingClientRect() ?? null;
    const q = (s) => document.querySelector(s);
    const qa = (s) => [...document.querySelectorAll(s)];
    const panel = q('[data-testid="conversation-context-panel"]');
    const aside = panel?.closest("aside") ?? null;
    const header =
      panel?.querySelector(":scope > [data-tauri-drag-region]") ?? null;
    const tablist = panel?.querySelector('[role="tablist"]') ?? null;
    const strip = q('[data-testid="exchange-strip"]');
    const composer = q('[data-testid="message-composer"]');
    const chatHeader = q('[data-testid="chat-header"]');
    // A day pill is sticky. It is STUCK when its section has been pushed
    // below the top of its own wrapper (the wrapper scrolls, the section
    // holds); only then must it hug the header. In-flow pills are wherever
    // the layout puts them.
    const timelineRect = rect(q('[data-testid="message-timeline"]'));
    const pill =
      qa('[data-testid="message-timeline-day-divider"]')
        .filter((section) => {
          const wrapper = section.parentElement;
          // Stuck (held below its wrapper's top) AND inside the viewport —
          // a pill parked at the end of its range above the fold is neither.
          return (
            wrapper &&
            timelineRect &&
            rect(section).top > rect(wrapper).top + 1 &&
            rect(section).top >= timelineRect.top - 1
          );
        })
        .map((section) => section.querySelector("p"))
        .filter(Boolean)
        .sort((a, b) => rect(a).top - rect(b).top)[0] ?? null;
    const spans = qa("[data-visit-span]")
      .map((el) => ({ ...rect(el).toJSON(), pos: el.dataset.visitSpan }))
      .sort((a, b) => a.top - b.top);
    const monoInDrawer = panel
      ? qa('[data-testid="conversation-context-panel"] *').filter((el) => {
          if (el.closest("code, pre, kbd, time")) return false;
          const ff = getComputedStyle(el).fontFamily;
          return (
            /Fragment Mono|SFMono|monospace/i.test(ff) &&
            el.childElementCount === 0 &&
            el.textContent.trim()
          );
        }).length
      : -1;
    const r = {};
    r.drawerPresent = !!panel;
    r.drawerWidth = aside ? Math.round(rect(aside).width) : null;
    r.headerInFlow =
      header && tablist ? rect(tablist).top >= rect(header).bottom - 1 : null;
    r.tabsVisible = tablist
      ? [...tablist.querySelectorAll('[role="tab"] span')].every(
          (s) => rect(s).width > 10,
        )
      : null;
    r.seamWidth = aside ? getComputedStyle(aside, "::before").width : null;
    r.asideIsCard = aside ? aside.hasAttribute("data-luca-card") : null;
    r.stripWidthDelta =
      strip && composer
        ? Math.round(rect(strip).width - rect(composer).width)
        : null;
    // The day pill is sticky: it only has to hug the header once the
    // timeline has scrolled; in flow its position is whatever the layout says.
    r.pillOffsetFromHeader =
      pill && chatHeader
        ? Math.round(rect(pill).top - rect(chatHeader).bottom)
        : null;
    r.visitSpanRows = spans.length;
    // Rows inside one plate must touch; a gap is only allowed between one
    // plate's end row and the next plate's start row.
    r.visitSpanContiguous = spans.length
      ? spans.every(
          (s, i) =>
            i === 0 ||
            s.top <= spans[i - 1].bottom + 1 ||
            (spans[i - 1].pos === "end" && s.pos === "start"),
        )
      : null;
    r.monoInDrawer = monoInDrawer;
    r.sidebarBg = getComputedStyle(
      q('[data-testid="app-sidebar"]'),
    ).backgroundColor;
    r.contentBg = getComputedStyle(
      q("[data-buzz-content-surface]"),
    ).backgroundColor;
    r.clips = {
      drawer: aside ? rect(aside).toJSON() : null,
      composer: q('[data-testid="channel-composer-overlay"]')
        ? rect(q('[data-testid="channel-composer-overlay"]')).toJSON()
        : null,
      // The most recent plate (the last run of span rows), which is the one
      // in view when the timeline sits at the bottom.
      plate: (() => {
        if (!spans.length) return null;
        let start = spans.length - 1;
        while (start > 0 && spans[start].pos !== "start") start -= 1;
        const run = spans.slice(start);
        return {
          x: run[0].left,
          y: run[0].top,
          width: run[0].width,
          height: run[run.length - 1].bottom - run[0].top,
        };
      })(),
      header: chatHeader ? rect(chatHeader).toJSON() : null,
    };
    return r;
  });

  await page.screenshot({ path: path.join(out, "shell.png") });
  const clip = async (name, box, pad = 12) => {
    if (!box) return;
    await page.screenshot({
      path: path.join(out, `${name}.png`),
      clip: {
        x: Math.max(0, box.x - pad),
        y: Math.max(0, box.y - pad),
        width: Math.min(1440 - Math.max(0, box.x - pad), box.width + pad * 2),
        height: Math.min(900 - Math.max(0, box.y - pad), box.height + pad * 2),
      },
    });
  };
  await clip("drawer", checks.clips.drawer, 10);
  await clip("composer", checks.clips.composer, 16);
  await clip("plate", checks.clips.plate, 16);
  await clip("header", checks.clips.header, 10);

  const expect = (name, ok, detail) => {
    if (ok === null || ok === undefined) return;
    if (!ok) failures.push(`${theme}: ${name} ${detail ?? ""}`.trim());
  };
  expect("drawer present", checks.drawerPresent);
  expect(
    "drawer width 360",
    checks.drawerWidth === 360,
    `(${checks.drawerWidth})`,
  );
  expect("drawer header in flow (tabs not under title)", checks.headerInFlow);
  expect("tab labels visible", checks.tabsVisible);
  expect("drawer is its own card", checks.asideIsCard);
  expect(
    "no seam on the drawer",
    checks.seamWidth === "auto" || checks.seamWidth === "0px",
    `(${checks.seamWidth})`,
  );
  expect(
    "strip width == composer width",
    checks.stripWidthDelta !== null
      ? Math.abs(checks.stripWidthDelta) <= 1
      : null,
    `(Δ${checks.stripWidthDelta})`,
  );
  expect(
    "day pill hugs the header",
    checks.pillOffsetFromHeader !== null
      ? checks.pillOffsetFromHeader >= -2 && checks.pillOffsetFromHeader <= 12
      : null,
    `(offset ${checks.pillOffsetFromHeader})`,
  );
  expect("visit plate contiguous", checks.visitSpanContiguous);
  expect(
    "no mono type in drawer chrome",
    checks.monoInDrawer === 0,
    `(${checks.monoInDrawer} nodes)`,
  );
  if (theme === "graphite") {
    expect(
      "graphite sidebar rgb(13, 13, 15)",
      checks.sidebarBg === "rgb(13, 13, 15)",
      `(${checks.sidebarBg})`,
    );
    expect(
      "graphite content rgb(16, 16, 18)",
      checks.contentBg === "rgb(16, 16, 18)",
      `(${checks.contentBg})`,
    );
  }
  const realErrors = consoleErrors.filter((e) => !/\/pow\//.test(e));
  expect(
    "no console errors",
    realErrors.length === 0,
    `\n      ${realErrors.slice(0, 5).join("\n      ")}`,
  );

  report[theme] = { ...checks, consoleErrors: realErrors, out };
  await page.close();
}

await browser.close();
server.close();
fs.mkdirSync(OUT_ROOT, { recursive: true });
fs.writeFileSync(
  path.join(OUT_ROOT, "report.json"),
  JSON.stringify(report, null, 2),
);

for (const [theme, r] of Object.entries(report)) {
  console.log(
    `${theme.padEnd(18)} drawer=${r.drawerWidth} inflow=${r.headerInFlow} card=${r.asideIsCard} seam=${r.seamWidth} stripΔ=${r.stripWidthDelta} pill=${r.pillOffsetFromHeader} span=${r.visitSpanRows}/${r.visitSpanContiguous} mono=${r.monoInDrawer} errs=${r.consoleErrors.length}  →${path.relative(DESKTOP, r.out)}`,
  );
}
if (failures.length) {
  console.log("\nFAILED CHECKS:");
  for (const f of failures) console.log("  ✗ " + f);
  process.exit(1);
}
console.log("\nall checks passed");
