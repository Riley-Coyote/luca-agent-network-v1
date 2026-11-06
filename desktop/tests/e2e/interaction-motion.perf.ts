import { expect, test, type Page } from "@playwright/test";
import { openMotionShell } from "../helpers/motionShell";

// Identical fixtures/probes for baseline and candidate. Native optical glass is
// not available here; reporter/shadow scheduling is real. Not an INP/FPS score.
const baseline = process.env.POLYPHONIC_MOTION_BASELINE === "1";
test.use({
  viewport: { width: 1440, height: 900 },
  trace: "off",
  video: "off",
});
type Probe = { geometry: number; offscreen: number; longtasks: number[] };

async function probe(page: Page) {
  await page.evaluate(() => {
    const host = window as typeof window & { __motionProbe?: Probe };
    const stats: Probe = { geometry: 0, offscreen: 0, longtasks: [] };
    host.__motionProbe = stats;
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      if (
        this.matches(
          "[data-luca-one-card], [data-luca-card], [data-buzz-content-surface]",
        )
      )
        stats.geometry++;
      if (this.hasAttribute("data-motion-offscreen")) stats.offscreen++;
      return original.call(this);
    };
    new PerformanceObserver((entries) => {
      for (const item of entries.getEntries())
        stats.longtasks.push(item.duration);
    }).observe({ type: "longtask" });
  });
}
async function reset(page: Page) {
  await page.evaluate(() => {
    const stats = (window as typeof window & { __motionProbe: Probe })
      .__motionProbe;
    stats.geometry = 0;
    stats.offscreen = 0;
    stats.longtasks = [];
  });
}
async function read(page: Page) {
  return page.evaluate(
    () => (window as typeof window & { __motionProbe: Probe }).__motionProbe,
  );
}

for (const theme of ["dark", "light"]) {
  test(`current shell avoids invisible work: ${theme}`, async ({
    page,
  }, info) => {
    await openMotionShell(page, theme);
    await probe(page);
    await page.waitForTimeout(800);
    await reset(page);
    await page.locator(".luca-rail-add").first().hover();
    await page.waitForTimeout(700);
    const hover = await read(page);
    await page.evaluate(() => {
      const group = document.querySelector(
        '[data-testid="message-timeline-day-group"]',
      );
      if (!group?.parentElement)
        throw new Error("Current timeline host is missing");
      const word = document.createElement("span");
      word.setAttribute("data-expression-wet-word", "");
      word.setAttribute("data-motion-offscreen", "");
      word.setAttribute("data-ink-text", "Offscreen fixture");
      word.textContent = "Offscreen fixture";
      word.style.cssText = "position:absolute;top:-10000px;left:0";
      group.parentElement.append(word);
    });
    await page.waitForTimeout(200);
    await reset(page);
    await page.waitForTimeout(700);
    const offscreen = await read(page);
    const report = {
      revision: process.env.POLYPHONIC_MOTION_REVISION ?? "working",
      baseline,
      theme,
      hover,
      offscreen,
    };
    console.log("MOTION_IDLE", JSON.stringify(report));
    await info.attach(`idle-${theme}.json`, {
      body: JSON.stringify(report),
      contentType: "application/json",
    });
    if (!baseline) {
      expect(
        hover.geometry,
        "unrelated hover must not follow frame geometry",
      ).toBeLessThan(8);
      expect(offscreen.offscreen, "offscreen word must stop scheduling").toBe(
        0,
      );
    }
  });
}

test("current shell interaction frame intervals", async ({ page }, info) => {
  await openMotionShell(page);
  await probe(page);
  await page.waitForTimeout(800);
  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");
  const measures: unknown[] = [];
  for (let run = 0; run < 3; run++) {
    const before = (await client.send("Performance.getMetrics")).metrics;
    await reset(page);
    const intervals = await page.evaluate(async () => {
      const frames: number[] = [];
      let last = performance.now();
      const end = last + 800;
      window.dispatchEvent(
        new CustomEvent("polyphonic:open-task-chat", {
          detail: "ab".repeat(32),
        }),
      );
      await new Promise<void>((resolve) => {
        const frame = (now: number) => {
          frames.push(now - last);
          last = now;
          if (now < end) requestAnimationFrame(frame);
          else resolve();
        };
        requestAnimationFrame(frame);
      });
      return frames;
    });
    await expect(
      page.getByTestId("task-chat-pane").getByTestId("message-input"),
    ).toBeEditable();
    const after = (await client.send("Performance.getMetrics")).metrics;
    const delta = (name: string) =>
      (after.find((x) => x.name === name)?.value ?? 0) -
      (before.find((x) => x.name === name)?.value ?? 0);
    const sorted = [...intervals].sort((a, b) => a - b);
    measures.push({
      run,
      frames: intervals.length,
      p95Interval: sorted[Math.floor((sorted.length - 1) * 0.95)],
      maxInterval: Math.max(...intervals),
      layoutCount: delta("LayoutCount"),
      styleCount: delta("RecalcStyleCount"),
      scriptMs: delta("ScriptDuration") * 1000,
      ...(await read(page)),
    });
    await page.getByRole("button", { name: "Close task conversation" }).click();
    await expect(page.getByTestId("task-chat-pane")).toHaveCount(0);
    await page.waitForTimeout(600);
  }
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  await page
    .getByRole("button", { name: "Settings", exact: true })
    .last()
    .click();
  await page
    .getByRole("button", { name: /^Chats/ })
    .first()
    .click();
  const input = page.getByTestId("message-input").last();
  await input.pressSequentially("Motion check draft", { delay: 25 });
  await expect(input).toHaveText("Motion check draft");
  await input.press("Meta+A");
  await input.press("Backspace");
  const report = {
    revision: process.env.POLYPHONIC_MOTION_REVISION ?? "working",
    baseline,
    measures,
  };
  console.log("MOTION_INTERACTIONS", JSON.stringify(report));
  await info.attach("interactions.json", {
    body: JSON.stringify(report),
    contentType: "application/json",
  });
  await client.detach();
});
