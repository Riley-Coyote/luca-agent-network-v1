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

  // Scroll the timeline so a visit passage straddles the top of the viewport:
  // the presence rail only has a job once the door has scrolled away.
  await page.evaluate(() => {
    const scroller = document.querySelector("[data-buzz-conversation-scroll]");
    const rows = [...document.querySelectorAll("[data-visit-span]")];
    if (!scroller || rows.length === 0) return;
    const last = rows[rows.length - 1];
    scroller.scrollTop +=
      last.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top -
      4;
  });
  await page.waitForTimeout(400);

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
      .map((el) => ({
        ...rect(el).toJSON(),
        pos: el.dataset.visitSpan,
        padLeft: Number.parseFloat(getComputedStyle(el).paddingLeft),
        padRight: Number.parseFloat(getComputedStyle(el).paddingRight),
      }))
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
    // Rows inside one passage must touch; a gap is only allowed where one
    // passage ends and the next begins.
    r.visitSpanContiguous = spans.length
      ? spans.every(
          (s, i) =>
            i === 0 ||
            s.top <= spans[i - 1].bottom + 1 ||
            (["last", "only"].includes(spans[i - 1].pos) &&
              ["first", "only"].includes(s.pos)),
        )
      : null;
    // The doors keep the reading plane's full measure; the passage between
    // them is inset from both sides. Padding, not box width — the rows are all
    // the same element, so only the padding tells them apart.
    const doors = qa("[data-visit-threshold]").map((el) => ({
      pad: Number.parseFloat(getComputedStyle(el).paddingLeft),
      ruleCount: el.querySelectorAll(".luca-visit-threshold__rule").length,
      ruleWidth: Math.min(
        ...[...el.querySelectorAll(".luca-visit-threshold__rule")].map(
          (n) => rect(n).width,
        ),
      ),
    }));
    r.doorCount = doors.length;
    r.doorsFullWidth = doors.length
      ? doors.every((d) => d.pad < 12 && d.ruleCount === 2 && d.ruleWidth > 40)
      : null;
    r.passageInset = spans.length
      ? spans.every((s) => s.padLeft >= 20 && s.padRight >= 20)
      : null;
    const rail = q('[data-testid="visit-presence-rail"]');
    r.railPresent = rail ? rail.hasAttribute("data-visit-present") : null;
    const railMark = rail?.querySelector("[data-resident-mark-kind]");
    const scroller = q("[data-buzz-conversation-scroll]");
    // It must sit inside the viewport and clear of the message column.
    r.railInView =
      railMark && scroller
        ? rect(railMark).top >= rect(scroller).top - 1 &&
          rect(railMark).bottom <= rect(scroller).bottom + 1
        : null;
    r.railClearOfRows =
      railMark && spans.length
        ? spans.every((s) => rect(railMark).right <= s.left + s.padLeft + 1)
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
      // The most recent passage (the last run of span rows), which is the one
      // in view when the timeline sits at the bottom.
      plate: (() => {
        if (!spans.length) return null;
        let start = spans.length - 1;
        while (start > 0 && !["first", "only"].includes(spans[start].pos))
          start -= 1;
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

  // The other half of the drawer: a 1:1 with a resident turns it into their
  // card — model selector, instructions, last handoff, open-agent. Capture it
  // and assert the controls are still there, so a restyle cannot quietly drop
  // one of them. Done before the assertions so they can read it.
  const resident = {};
  // Same card from a room, one tab along: the agent tabs must open the
  // resident's card in place, not something different from the 1:1.
  try {
    await page.click('[role="tab"][data-testid^="drawer-context-agent-"]');
    await page.waitForSelector('[data-testid="resident-drawer"]', {
      timeout: 6000,
    });
    await page.waitForTimeout(400);
    resident.fromRoomTab = await page
      .locator('[data-testid="resident-drawer-model-trigger"]')
      .count();
    const tabBox = await page
      .locator('[data-testid="conversation-context-panel"]')
      .boundingBox();
    if (tabBox) {
      await page.screenshot({
        path: path.join(out, "drawer-agent-tab.png"),
        clip: {
          x: Math.max(0, tabBox.x - 10),
          y: Math.max(0, tabBox.y - 10),
          width: tabBox.width + 20,
          height: Math.min(900 - tabBox.y + 10, tabBox.height + 20),
        },
      });
    }
    await page.click('[data-testid="drawer-context-conversation"]');
    await page.waitForTimeout(300);
  } catch {
    resident.fromRoomTab = 0;
  }
  try {
    const dmLink = page
      .locator('[data-testid="app-sidebar"]')
      .getByText("Luca", { exact: true })
      .first();
    if (await dmLink.count()) await dmLink.click();
    // Switching conversations closes the drawer; open it again there.
    await page.waitForTimeout(400);
    if (!(await page.$('[data-testid="conversation-context-panel"]'))) {
      await page.click(
        '[data-testid="chat-header"] [aria-label="Open conversation details"]',
      );
    }
    await page.waitForSelector('[data-testid="resident-drawer"]', {
      timeout: 6000,
    });
    await page.waitForTimeout(500);
    resident.present = true;
    resident.model = await page
      .locator('[data-testid="resident-drawer-model-trigger"]')
      .count();
    // Section headings, not the filled-in bodies: a resident with no
    // instructions yet still has to show the section (and its Write link).
    resident.instructions = await page
      .locator("#resident-drawer-instructions")
      .count();
    resident.handoff = await page.locator("#resident-drawer-handoff").count();
    resident.openAgent = await page
      .locator('[data-testid="resident-drawer-open-agent"]')
      .count();
    const box = await page
      .locator('[data-testid="conversation-context-panel"]')
      .boundingBox();
    if (box) {
      await page.screenshot({
        path: path.join(out, "drawer-resident.png"),
        clip: {
          x: Math.max(0, box.x - 10),
          y: Math.max(0, box.y - 10),
          width: box.width + 20,
          height: Math.min(900 - box.y + 10, box.height + 20),
        },
      });
    }
  } catch {
    resident.present = false;
  }

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
  expect("visit passage contiguous", checks.visitSpanContiguous);
  expect("both doors present", checks.doorCount >= 2, `(${checks.doorCount})`);
  expect(
    "doors keep the full measure, with rules on both sides",
    checks.doorsFullWidth,
  );
  expect("passage is inset from the plane", checks.passageInset);
  expect("presence rail pins while a visit is on screen", checks.railPresent);
  expect("presence rail stays in the viewport", checks.railInView);
  expect("presence rail clears the message column", checks.railClearOfRows);
  expect(
    "no mono type in drawer chrome",
    checks.monoInDrawer === 0,
    `(${checks.monoInDrawer} nodes)`,
  );
  expect(
    "an agent tab opens the same resident card",
    resident.fromRoomTab === 1,
    `(${resident.fromRoomTab})`,
  );
  expect("resident drawer renders in a 1:1", resident.present);
  if (resident.present) {
    expect(
      "resident drawer keeps the model selector",
      resident.model === 1,
      `(${resident.model})`,
    );
    expect(
      "resident drawer keeps instructions",
      resident.instructions === 1,
      `(${resident.instructions})`,
    );
    expect(
      "resident drawer keeps last handoff",
      resident.handoff === 1,
      `(${resident.handoff})`,
    );
    expect(
      "resident drawer keeps open-agent",
      resident.openAgent === 1,
      `(${resident.openAgent})`,
    );
  }
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

  report[theme] = { ...checks, resident, consoleErrors: realErrors, out };
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
    `${theme.padEnd(18)} drawer=${r.drawerWidth} inflow=${r.headerInFlow} card=${r.asideIsCard} seam=${r.seamWidth} stripΔ=${r.stripWidthDelta} pill=${r.pillOffsetFromHeader} span=${r.visitSpanRows}/${r.visitSpanContiguous} doors=${r.doorCount} inset=${r.passageInset} rail=${r.railPresent} mono=${r.monoInDrawer} resident=${r.resident.present ? `model:${r.resident.model}` : "MISSING"} errs=${r.consoleErrors.length}  →${path.relative(DESKTOP, r.out)}`,
  );
}
if (failures.length) {
  console.log("\nFAILED CHECKS:");
  for (const f of failures) console.log("  ✗ " + f);
  process.exit(1);
}
console.log("\nall checks passed");
