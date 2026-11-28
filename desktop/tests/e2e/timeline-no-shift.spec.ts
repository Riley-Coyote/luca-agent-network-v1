import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

const FIRST_PASS_PREPEND_DRIFT_PX = 20;
const LATE_REFLOW_DRIFT_PX = 4;

type AnchorSnapshot = {
  anchorId: string;
  anchorTop: number;
  visibleIds: string[];
  rowsFromAnchor: string[];
  oldestOlderIndex: number | null;
  scrollHeight: number;
};

async function waitForMockTimelineBridge(page: Page) {
  await page.waitForFunction(
    () =>
      typeof window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__ === "function" &&
      typeof window.__BUZZ_E2E_PREPEND_MOCK_HISTORY__ === "function",
  );
}

async function seedNoShiftTimeline(page: Page) {
  await page.evaluate(() => {
    for (let index = 0; index < 40; index += 1) {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        content: `no-shift current ${index}\nsecond line ${index}\nthird line ${index}`,
        createdAt: 1_700_100_000 + index,
      });
    }

    window.__BUZZ_E2E_PREPEND_MOCK_HISTORY__?.({
      channelName: "general",
      count: 600,
      lineCount: 3,
      createdAtStart: 1_700_000_000,
    });
  });
}

async function snapshotAnchor(timeline: Locator): Promise<AnchorSnapshot> {
  return timeline.evaluate((element) => {
    const scroller = element as HTMLDivElement;
    const scrollerRect = scroller.getBoundingClientRect();
    const rows = Array.from(
      scroller.querySelectorAll<HTMLElement>("[data-message-id]"),
    );
    const visibleRows = rows.filter((row) => {
      const rect = row.getBoundingClientRect();
      return rect.bottom > scrollerRect.top && rect.top < scrollerRect.bottom;
    });
    const anchor =
      visibleRows.find((row) => {
        const rect = row.getBoundingClientRect();
        return rect.top - scrollerRect.top >= 0;
      }) ?? visibleRows[0];

    if (!anchor) {
      throw new Error("no visible message row to anchor");
    }

    const anchorIndex = rows.indexOf(anchor);
    const oldestOlderIndex = rows.reduce<number | null>((oldest, row) => {
      const match = row.textContent?.match(/mock older (\d+) line/);
      if (!match) return oldest;
      const index = Number(match[1]);
      return oldest === null ? index : Math.min(oldest, index);
    }, null);

    return {
      anchorId: anchor.dataset.messageId ?? "",
      anchorTop: anchor.getBoundingClientRect().top - scrollerRect.top,
      visibleIds: visibleRows
        .map((row) => row.dataset.messageId ?? "")
        .filter(Boolean),
      rowsFromAnchor: rows
        .slice(anchorIndex, anchorIndex + 5)
        .map((row) => row.dataset.messageId ?? "")
        .filter(Boolean),
      oldestOlderIndex,
      scrollHeight: scroller.scrollHeight,
    };
  });
}

async function getAnchorTop(
  timeline: Locator,
  anchorId: string,
): Promise<number | null> {
  return timeline.evaluate((element, id) => {
    const scroller = element as HTMLDivElement;
    const anchor = scroller.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(id)}"]`,
    );
    if (!anchor) return null;
    return (
      anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    );
  }, anchorId);
}

async function startAnchorDriftSampler(
  timeline: Locator,
  anchorId: string,
  baselineTop: number,
) {
  await timeline.evaluate(
    (element, input) => {
      const scroller = element as HTMLDivElement;
      const win = window as typeof window & {
        __TIMELINE_NO_SHIFT_PROBE__?: {
          stop: boolean;
          maxDrift: number;
          missingSamples: number;
          samples: number;
        };
      };
      const probe = {
        stop: false,
        maxDrift: 0,
        missingSamples: 0,
        samples: 0,
      };
      win.__TIMELINE_NO_SHIFT_PROBE__ = probe;

      const sample = () => {
        if (probe.stop) return;
        const anchor = scroller.querySelector<HTMLElement>(
          `[data-message-id="${CSS.escape(input.anchorId)}"]`,
        );
        if (!anchor) {
          probe.missingSamples += 1;
        } else {
          const top =
            anchor.getBoundingClientRect().top -
            scroller.getBoundingClientRect().top;
          probe.maxDrift = Math.max(
            probe.maxDrift,
            Math.abs(top - input.baselineTop),
          );
        }
        probe.samples += 1;
        requestAnimationFrame(sample);
      };

      requestAnimationFrame(sample);
    },
    { anchorId, baselineTop },
  );
}

async function stopAnchorDriftSampler(timeline: Locator) {
  return timeline.evaluate((element) => {
    const win = window as typeof window & {
      __TIMELINE_NO_SHIFT_PROBE__?: {
        stop: boolean;
        maxDrift: number;
        missingSamples: number;
        samples: number;
      };
    };
    const probe = win.__TIMELINE_NO_SHIFT_PROBE__;
    if (!probe) throw new Error("no timeline no-shift sampler installed");
    probe.stop = true;
    return {
      maxDrift: probe.maxDrift,
      missingSamples: probe.missingSamples,
      samples: probe.samples,
      scrollTop: (element as HTMLDivElement).scrollTop,
    };
  });
}

async function growRowAboveAnchor(timeline: Locator, anchorId: string) {
  return timeline.evaluate((element, id) => {
    const scroller = element as HTMLDivElement;
    const rows = Array.from(
      scroller.querySelectorAll<HTMLElement>("[data-message-id]"),
    );
    const anchorIndex = rows.findIndex((row) => row.dataset.messageId === id);
    if (anchorIndex <= 0) return false;

    const target = rows[Math.max(0, anchorIndex - 2)];
    if (!target) return false;

    const currentHeight = target.getBoundingClientRect().height;
    target.style.minHeight = `${currentHeight + 96}px`;
    target.dataset.noShiftReflowTarget = "true";
    return true;
  }, anchorId);
}

function expectAnchorOrderUnchanged(
  before: AnchorSnapshot,
  after: AnchorSnapshot,
) {
  expect(after.visibleIds).toContain(before.anchorId);
  expect(after.rowsFromAnchor).toEqual(before.rowsFromAnchor);
}

test("timeline does not recompute row estimates during ordinary scroll", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");
  await waitForMockTimelineBridge(page);
  await page.evaluate(() => {
    for (let index = 0; index < 120; index += 1) {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        content: `estimate memo row ${index}\nsecond line ${index}`,
        createdAt: 1_700_500_000 + index,
      });
    }
  });

  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  const timeline = page.getByTestId("message-timeline");
  await expect(timeline).toContainText("estimate memo row 119");
  await page.waitForFunction(() => {
    const element = document.querySelector<HTMLDivElement>(
      '[data-testid="message-timeline"]',
    );
    return element && element.scrollHeight > element.clientHeight * 3;
  });

  const estimateCallsBefore = await timeline.evaluate((element) =>
    Number((element as HTMLDivElement).dataset.virtuaEstimateCallCount ?? "0"),
  );
  expect(estimateCallsBefore).toBeGreaterThan(0);

  await timeline.evaluate(async (element) => {
    const scroller = element as HTMLDivElement;
    const maxOffset = scroller.scrollHeight - scroller.clientHeight;
    for (const fraction of [0.75, 0.5, 0.25, 0.6, 0.4]) {
      scroller.scrollTop = maxOffset * fraction;
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    }
  });

  const estimateCallsAfter = await timeline.evaluate((element) =>
    Number((element as HTMLDivElement).dataset.virtuaEstimateCallCount ?? "0"),
  );
  expect(estimateCallsAfter).toBe(estimateCallsBefore);
});

test("timeline reserves mixed-media rows before fast scrollback", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(45_000);
  const noDimImageUrl = "https://example.com/e2e/timeline-mixed-no-dim.png";

  await installMockBridge(page);
  await page.route(noDimImageUrl, (route) => {
    route.fulfill({
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240"><rect width="100%" height="100%" fill="#7c3aed"/></svg>',
      contentType: "image/svg+xml",
    });
  });
  await page.goto("/");
  await waitForMockTimelineBridge(page);
  await page.evaluate(() => {
    window.__BUZZ_E2E__ = {
      ...window.__BUZZ_E2E__,
      mock: { ...window.__BUZZ_E2E__?.mock, channelWindowDelayMs: 10_000 },
    };
  });
  await page.evaluate((imageUrl) => {
    for (let index = 0; index < 18; index += 1) {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        content: `mixed-scroll lead-in ${index}\nplain lead-in line ${index}`,
        createdAt: 1_700_600_000 + index,
      });
    }
    const dimmedUrl =
      "http://localhost:3000/media/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.png";
    window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
      channelName: "general",
      content: ["mixed-scroll dimmed media", `![dimmed](${dimmedUrl})`].join(
        "\n",
      ),
      extraTags: [
        [
          "imeta",
          `url ${dimmedUrl}`,
          "m image/png",
          "x eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
          "size 1234",
          "dim 320x180",
          "filename mixed-dimmed.png",
        ],
      ],
      createdAt: 1_700_600_100,
    });
    window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
      channelName: "general",
      content: ["mixed-scroll no-dim media", `![no dim](${imageUrl})`].join(
        "\n",
      ),
      createdAt: 1_700_600_101,
    });
    window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
      channelName: "general",
      content: [
        "mixed-scroll fenced code",
        "```ts",
        "function teleportProbe(input: string) {",
        "  const rows = input.split(/\\n/);",
        "  return rows.map((row, index) => ({ row, index }));",
        "}",
        "const result = teleportProbe('one\\ntwo\\nthree');",
        "console.log(result);",
        "console.log(result.length);",
        "```",
      ].join("\n"),
      createdAt: 1_700_600_102,
    });
    window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
      channelName: "general",
      content: [
        "mixed-scroll link preview",
        "https://github.com/block/sprout/pull/1334",
      ].join("\n"),
      createdAt: 1_700_600_103,
    });
    window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
      channelName: "general",
      content: [
        "mixed-scroll tall text",
        "alpha beta gamma delta epsilon zeta eta theta iota kappa",
        "lambda mu nu xi omicron pi rho sigma tau upsilon",
        "phi chi psi omega plus extra words to wrap across lines",
        "another paragraph with enough text to create a tall row",
        "final tall text line for the intrinsic height estimate",
      ].join("\n"),
      createdAt: 1_700_600_104,
    });
    for (let index = 0; index < 36; index += 1) {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        content: `mixed-scroll tail ${index}\nplain tail line ${index}`,
        createdAt: 1_700_600_200 + index,
      });
    }
  }, noDimImageUrl);

  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  const timeline = page.getByTestId("message-timeline");
  await expect(timeline.locator("[data-message-id]").first()).toBeVisible();
  await page.waitForFunction(() => {
    const element = document.querySelector(
      '[data-testid="message-timeline"]',
    ) as HTMLDivElement | null;
    return element && element.scrollHeight > element.clientHeight + 2_000;
  });

  const anchorId = await timeline
    .locator("[data-message-id]")
    .filter({ hasText: "mixed-scroll tail 28" })
    .first()
    .evaluate((row) => row.dataset.messageId ?? "");
  expect(anchorId).not.toBe("");

  const drift = await timeline.evaluate(async (element, id) => {
    const scroller = element as HTMLDivElement;
    const anchor = scroller.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(id)}"]`,
    );
    if (!anchor) throw new Error("mixed-scroll anchor row missing");
    const currentTop =
      anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    scroller.scrollTop += currentTop - 280;
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    let baseline: number | null = null;
    let maxDrift = 0;
    let missingSamples = 0;
    let samples = 0;
    const contentTop = () => {
      const row = scroller.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(id)}"]`,
      );
      if (!row) return null;
      return (
        row.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop
      );
    };
    const sample = () => {
      const top = contentTop();
      if (top === null) missingSamples += 1;
      else {
        if (baseline === null) baseline = top;
        maxDrift = Math.max(maxDrift, Math.abs(top - baseline));
      }
      samples += 1;
    };
    sample();
    // Stop before the top-edge history loader takes over; this case is scoped
    // to rows realizing during fast mixed-media scrollback, not prepend anchoring.
    for (let frame = 0; frame < 24 && scroller.scrollTop > 0; frame += 1) {
      const PX = 95;
      scroller.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaY: -PX,
        }),
      );
      scroller.scrollTop = Math.max(0, scroller.scrollTop - PX);
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      sample();
    }
    await new Promise<void>((r) => setTimeout(r, 250));
    sample();
    return {
      baseline,
      maxDrift,
      missingSamples,
      samples,
      scrollTop: scroller.scrollTop,
    };
  }, anchorId);

  console.info("timeline-mixed-media-scrollback result", JSON.stringify(drift));
  expect(drift.samples).toBeGreaterThan(0);
  expect(drift.missingSamples).toBe(0);
  expect(drift.maxDrift).toBeLessThanOrEqual(120);
});

test("timeline prepend plus late row reflow keeps the reading row stable", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(45_000);

  await installMockBridge(page);
  await page.goto("/");
  await waitForMockTimelineBridge(page);
  await seedNoShiftTimeline(page);

  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");

  const timeline = page.getByTestId("message-timeline");
  await expect(timeline.locator("[data-message-id]").first()).toBeVisible();
  await page.waitForFunction(() => {
    const element = document.querySelector(
      '[data-testid="message-timeline"]',
    ) as HTMLDivElement | null;
    return element && element.scrollHeight > element.clientHeight + 1_000;
  });
  await expect
    .poll(async () => (await snapshotAnchor(timeline)).oldestOlderIndex, {
      timeout: 8_000,
    })
    .not.toBeNull();

  await page.evaluate(() => {
    window.__BUZZ_E2E__ = {
      ...window.__BUZZ_E2E__,
      mock: { ...window.__BUZZ_E2E__?.mock, channelWindowDelayMs: 1_000 },
    };
    (
      window as unknown as { __CHANNEL_WINDOW_INFLIGHT__?: number }
    ).__CHANNEL_WINDOW_INFLIGHT__ = 0;
  });

  await page.mouse.wheel(0, 1_000);
  await page.waitForTimeout(100);
  await timeline.evaluate((element) => {
    const scroller = element as HTMLDivElement;
    scroller.scrollTop = 150;
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
  });

  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            (window as unknown as { __CHANNEL_WINDOW_INFLIGHT__?: number })
              .__CHANNEL_WINDOW_INFLIGHT__ ?? 0,
        ),
      { timeout: 5_000 },
    )
    .toBeGreaterThan(0);

  const before = await snapshotAnchor(timeline);
  expect(before.anchorId).not.toBe("");
  expect(before.oldestOlderIndex).not.toBeNull();
  await timeline.evaluate((element, anchorId) => {
    const anchor = element.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(anchorId)}"]`,
    );
    if (!anchor) throw new Error("prepend mount-identity anchor missing");
    (
      window as typeof window & { __PREPEND_MOUNT_IDENTITY__?: HTMLElement }
    ).__PREPEND_MOUNT_IDENTITY__ = anchor;
  }, before.anchorId);
  await startAnchorDriftSampler(timeline, before.anchorId, before.anchorTop);

  await expect
    .poll(
      async () => {
        const snapshot = await snapshotAnchor(timeline);
        return snapshot.oldestOlderIndex !== null &&
          before.oldestOlderIndex !== null &&
          snapshot.oldestOlderIndex < before.oldestOlderIndex &&
          snapshot.scrollHeight > before.scrollHeight + 1_000
          ? "landed"
          : "pending";
      },
      { timeout: 6_000 },
    )
    .toBe("landed");

  const afterPrepend = await snapshotAnchor(timeline);
  expect(afterPrepend.anchorId).toBe(before.anchorId);
  expect(
    await timeline.evaluate((element, anchorId) => {
      const anchor = element.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(anchorId)}"]`,
      );
      return (
        anchor ===
        (
          window as typeof window & {
            __PREPEND_MOUNT_IDENTITY__?: HTMLElement;
          }
        ).__PREPEND_MOUNT_IDENTITY__
      );
    }, before.anchorId),
    "prepend must preserve the mounted anchor DOM node",
  ).toBe(true);
  expect(
    Math.abs(afterPrepend.anchorTop - before.anchorTop),
    // First-pass prepended rows realize from content-visibility estimates to
    // true height over a few frames. Keep this bound tight enough to catch the
    // old teleport class; a measured-height cache is the future lever for
    // sub-2px first-pass precision.
  ).toBeLessThanOrEqual(FIRST_PASS_PREPEND_DRIFT_PX);
  expectAnchorOrderUnchanged(before, afterPrepend);

  const prependDrift = await stopAnchorDriftSampler(timeline);
  console.info(
    "timeline-prepend-no-shift result",
    JSON.stringify(prependDrift),
  );
  expect(prependDrift.samples).toBeGreaterThan(0);
  expect(prependDrift.missingSamples).toBe(0);
  expect(prependDrift.maxDrift).toBeLessThanOrEqual(
    FIRST_PASS_PREPEND_DRIFT_PX,
  );

  await startAnchorDriftSampler(
    timeline,
    before.anchorId,
    afterPrepend.anchorTop,
  );

  const grew = await growRowAboveAnchor(timeline, before.anchorId);
  expect(grew).toBe(true);

  await expect
    .poll(
      async () => {
        const top = await getAnchorTop(timeline, before.anchorId);
        return top === null
          ? Number.POSITIVE_INFINITY
          : Math.abs(top - afterPrepend.anchorTop);
      },
      { timeout: 3_000 },
    )
    .toBeLessThanOrEqual(LATE_REFLOW_DRIFT_PX);

  const afterReflow = await snapshotAnchor(timeline);
  expect(afterReflow.anchorId).toBe(before.anchorId);
  expectAnchorOrderUnchanged(before, afterReflow);

  const drift = await stopAnchorDriftSampler(timeline);
  console.info("timeline-reflow-no-shift result", JSON.stringify(drift));
  expect(drift.samples).toBeGreaterThan(0);
  expect(drift.missingSamples).toBe(0);
  expect(drift.maxDrift).toBeLessThanOrEqual(LATE_REFLOW_DRIFT_PX);
});
