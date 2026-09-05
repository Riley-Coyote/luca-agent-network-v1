import { expect, test } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";

async function openAliceConversation(page: import("@playwright/test").Page) {
  await installMockBridge(page, {
    managedAgents: [
      {
        channelNames: ["alice-tyler"],
        name: "Alice",
        pubkey: TEST_IDENTITIES.alice.pubkey,
        status: "running",
      },
      {
        channelNames: ["general"],
        name: "Charlie",
        pubkey: TEST_IDENTITIES.charlie.pubkey,
        status: "running",
      },
    ],
  });
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-alice-tyler").click();
  await expect(page.getByTestId("message-input")).toBeVisible();
}

test("a direct conversation scopes capability selection to its resident", async ({
  page,
}) => {
  await openAliceConversation(page);
  await expect(
    page.getByRole("button", {
      name: "1 resident companion. Change companion size.",
    }),
  ).toBeVisible();

  await page.getByTestId("message-input").fill("/");
  const palette = page.getByTestId("composer-capability-palette");
  await expect(palette).toBeVisible();
  await expect(palette.getByLabel("Resident")).toHaveCount(0);
  await expect(
    palette.getByText("Choose a resident to see what this session can use."),
  ).toHaveCount(0);
  await expect(palette.getByLabel("Search skills and tools")).toBeFocused();
});

test("the closed capability palette does not fetch or poll", async ({
  page,
}) => {
  await openAliceConversation(page);
  await page.evaluate(() => {
    window.__BUZZ_E2E_COMMAND_LOG__ = [];
  });

  await page.waitForTimeout(2_250);
  const closedCapabilityCalls = await page.evaluate(
    () =>
      window.__BUZZ_E2E_COMMAND_LOG__?.filter(
        ({ command }) =>
          command === "get_resident_session_capabilities" ||
          command === "list_capability_skills",
      ).length ?? 0,
  );
  expect(closedCapabilityCalls).toBe(0);

  await page.getByTestId("message-input").fill("/");
  await expect(page.getByTestId("composer-capability-palette")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__BUZZ_E2E_COMMAND_LOG__?.filter(
            ({ command }) =>
              command === "get_resident_session_capabilities" ||
              command === "list_capability_skills",
          ).length ?? 0,
      ),
    )
    .toBeGreaterThan(0);

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("composer-capability-palette")).toBeHidden();
  await page.evaluate(() => {
    window.__BUZZ_E2E_COMMAND_LOG__ = [];
  });
  await page.waitForTimeout(2_250);
  const callsAfterClose = await page.evaluate(
    () =>
      window.__BUZZ_E2E_COMMAND_LOG__?.filter(
        ({ command }) =>
          command === "get_resident_session_capabilities" ||
          command === "list_capability_skills",
      ).length ?? 0,
  );
  expect(callsAfterClose).toBe(0);
});

test("the capability palette meets its throttled interaction budget", async ({
  page,
}) => {
  await openAliceConversation(page);
  const input = page.getByTestId("message-input");
  const palette = page.getByTestId("composer-capability-palette");
  const client = await page.context().newCDPSession(page);

  await input.fill("/");
  await expect(palette).toBeVisible();
  const normalAnimationDuration = await palette.evaluate((element) => {
    const animation = element.getAnimations()[0];
    const duration = animation?.effect?.getTiming().duration;
    return typeof duration === "number" ? duration : null;
  });
  // A keyboard-opened palette should be immediately available, without a fade.
  expect(normalAnimationDuration ?? 0).toBe(0);
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();

  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.evaluate(() => {
    const perfWindow = window as typeof window & {
      __P0_CAPABILITY_LONG_TASKS__?: Array<{
        duration: number;
        startTime: number;
      }>;
      __P0_CAPABILITY_OBSERVER__?: PerformanceObserver;
    };
    perfWindow.__P0_CAPABILITY_LONG_TASKS__ = [];
    perfWindow.__P0_CAPABILITY_OBSERVER__ = new PerformanceObserver((list) => {
      perfWindow.__P0_CAPABILITY_LONG_TASKS__?.push(
        ...list.getEntries().map((entry) => ({
          duration: entry.duration,
          startTime: entry.startTime,
        })),
      );
    });
    perfWindow.__P0_CAPABILITY_OBSERVER__.observe({
      type: "longtask",
      buffered: false,
    });
  });

  const samples: number[] = [];
  const interactionWindows: Array<{ end: number; start: number }> = [];
  try {
    for (let index = 0; index < 12; index += 1) {
      await input.click();
      await page.keyboard.press("Meta+A");
      await page.keyboard.press("Backspace");
      await expect(input).toHaveText("");
      await page.evaluate(() => {
        const perfWindow = window as typeof window & {
          __P0_CAPABILITY_ARRIVAL__?: number | null;
          __P0_CAPABILITY_ARRIVED_AT__?: number | null;
          __P0_CAPABILITY_STARTED_AT__?: number | null;
        };
        perfWindow.__P0_CAPABILITY_ARRIVAL__ = null;
        perfWindow.__P0_CAPABILITY_ARRIVED_AT__ = null;
        perfWindow.__P0_CAPABILITY_STARTED_AT__ = null;
        let startedAt: number | null = null;
        document.addEventListener(
          "keydown",
          (event) => {
            if (event.key === "/") {
              startedAt = performance.now();
              perfWindow.__P0_CAPABILITY_STARTED_AT__ = startedAt;
            }
          },
          { capture: true, once: true },
        );
        const observer = new MutationObserver(() => {
          const paletteElement = document.querySelector(
            '[data-testid="composer-capability-palette"]',
          );
          if (
            startedAt !== null &&
            paletteElement &&
            !paletteElement.hasAttribute("hidden")
          ) {
            observer.disconnect();
            const arrivedAt = performance.now();
            perfWindow.__P0_CAPABILITY_ARRIVED_AT__ = arrivedAt;
            perfWindow.__P0_CAPABILITY_ARRIVAL__ = arrivedAt - startedAt;
          }
        });
        observer.observe(document.body, {
          attributeFilter: ["hidden"],
          attributes: true,
          childList: true,
          subtree: true,
        });
      });
      await page.keyboard.press("/");
      await expect(palette).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (
                window as typeof window & {
                  __P0_CAPABILITY_ARRIVAL__?: number | null;
                }
              ).__P0_CAPABILITY_ARRIVAL__ ?? null,
          ),
        )
        .not.toBeNull();
      samples.push(
        (await page.evaluate(
          () =>
            (
              window as typeof window & {
                __P0_CAPABILITY_ARRIVAL__?: number | null;
              }
            ).__P0_CAPABILITY_ARRIVAL__,
        )) ?? Number.POSITIVE_INFINITY,
      );
      interactionWindows.push(
        await page.evaluate(() => {
          const perfWindow = window as typeof window & {
            __P0_CAPABILITY_ARRIVED_AT__?: number | null;
            __P0_CAPABILITY_STARTED_AT__?: number | null;
          };
          const now = performance.now();
          return {
            end: perfWindow.__P0_CAPABILITY_ARRIVED_AT__ ?? now,
            start: perfWindow.__P0_CAPABILITY_STARTED_AT__ ?? now,
          };
        }),
      );
      // Separate samples from deferred editor transactions. The interaction
      // window ends at the palette DOM commit; subsequent editor work must not
      // be misattributed to opening the palette.
      await page.waitForTimeout(220);
      await page.keyboard.press("Escape");
      await expect(palette).toBeHidden();
    }
  } finally {
    await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  }

  const longTasks = await page.evaluate(() => {
    const perfWindow = window as typeof window & {
      __P0_CAPABILITY_LONG_TASKS__?: Array<{
        duration: number;
        startTime: number;
      }>;
      __P0_CAPABILITY_OBSERVER__?: PerformanceObserver;
    };
    perfWindow.__P0_CAPABILITY_OBSERVER__?.disconnect();
    return perfWindow.__P0_CAPABILITY_LONG_TASKS__ ?? [];
  });
  const sortedSamples = samples.toSorted((left, right) => left - right);
  const p95 = sortedSamples[Math.ceil(sortedSamples.length * 0.95) - 1] ?? 0;
  const attributableLongTasks = longTasks.filter(
    (task) =>
      task.duration > 50 &&
      interactionWindows.some(
        (window) =>
          task.startTime < window.end &&
          task.startTime + task.duration > window.start,
      ),
  );

  expect(p95).toBeLessThanOrEqual(50);
  expect(attributableLongTasks).toEqual([]);
});

test("reduced motion removes capability palette translation", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openAliceConversation(page);
  await page.getByTestId("message-input").fill("/");
  const palette = page.getByTestId("composer-capability-palette");
  await expect(palette).toBeVisible();

  const treatment = await palette.evaluate((element) => {
    const animation = element.getAnimations()[0];
    const duration = animation?.effect?.getTiming().duration;
    return {
      duration: typeof duration === "number" ? duration : null,
      transform: getComputedStyle(element).transform,
    };
  });
  expect(treatment.duration ?? 0).toBeLessThanOrEqual(60);
  expect(treatment.transform).toBe("none");
});
