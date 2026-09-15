import * as fs from "node:fs";
import * as path from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";

/**
 * Bringing a resident into a conversation must not repaint the room.
 *
 * Opening the resident drawer, switching to a resident's session, a resident
 * arriving, and a resident leaving are all auxiliary-panel state: they patch
 * search params on the route that is already showing. A whole-document view
 * transition for one of those freezes the shell and crossfades the timeline
 * behind the drawer — the flicker.
 *
 * The evidence is programmatic. `document.startViewTransition` is wrapped at
 * page start and counted (pass-through, so a count of zero means no
 * transition was started at all), a rAF sampler records the timeline's box
 * every frame, and console errors are collected for the whole run.
 */

const RESIDENT = TEST_IDENTITIES.alice.pubkey;
const DM_CHANNEL_ID = "f48efb06-0c93-5025-aac9-2e646bb6bfa8";
const SHOT_DIR = "/private/tmp/luca-beta7-flicker/.wp-flicker-shots";
const EXCHANGE_ID = "b".repeat(64);

type Rect = [number, number, number, number];

declare global {
  interface Window {
    __FLICKER__?: {
      consoleErrors: string[];
      historyWrites: number;
      samples: Array<{ t: number; vt: number; rect: Rect | null }>;
      sampling: boolean;
      vtCalls: number;
      vtSupported: boolean;
    };
    __FLICKER_SAMPLE_START__?: () => void;
    __FLICKER_SAMPLE_STOP__?: () => Array<{
      t: number;
      vt: number;
      rect: Rect | null;
    }>;
  }
}

async function instrument(page: Page) {
  await page.addInitScript(() => {
    const state = {
      consoleErrors: [] as string[],
      historyWrites: 0,
      samples: [] as Array<{ t: number; vt: number; rect: Rect | null }>,
      sampling: false,
      vtCalls: 0,
      vtSupported: typeof document.startViewTransition === "function",
    };
    window.__FLICKER__ = state;

    if (state.vtSupported) {
      const original = document.startViewTransition.bind(document);
      document.startViewTransition = ((...args: unknown[]) => {
        state.vtCalls += 1;
        return (original as (...a: unknown[]) => ViewTransition)(...args);
      }) as typeof document.startViewTransition;
    }

    for (const name of ["pushState", "replaceState"] as const) {
      const original = history[name].bind(history);
      history[name] = ((...args: unknown[]) => {
        state.historyWrites += 1;
        return (original as (...a: unknown[]) => void)(...args);
      }) as typeof history.pushState;
    }

    const error = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      state.consoleErrors.push(args.map((item) => String(item)).join(" "));
      error(...args);
    };
    window.addEventListener("unhandledrejection", (event) => {
      state.consoleErrors.push(`unhandledrejection: ${String(event.reason)}`);
    });

    let frame = 0;
    const sample = () => {
      if (!state.sampling) return;
      const element = document.querySelector(
        '[data-testid="message-timeline"]',
      );
      const box = element?.getBoundingClientRect();
      state.samples.push({
        t: Math.round(performance.now()),
        vt: state.vtCalls,
        rect: box
          ? [
              Math.round(box.x),
              Math.round(box.y),
              Math.round(box.width),
              Math.round(box.height),
            ]
          : null,
      });
      frame = requestAnimationFrame(sample);
    };
    window.__FLICKER_SAMPLE_START__ = () => {
      state.samples.length = 0;
      state.sampling = true;
      frame = requestAnimationFrame(sample);
    };
    window.__FLICKER_SAMPLE_STOP__ = () => {
      state.sampling = false;
      cancelAnimationFrame(frame);
      return state.samples;
    };
  });
}

async function readState(page: Page) {
  return page.evaluate(() => ({
    consoleErrors: window.__FLICKER__?.consoleErrors ?? [],
    historyWrites: window.__FLICKER__?.historyWrites ?? 0,
    vtCalls: window.__FLICKER__?.vtCalls ?? 0,
    vtSupported: window.__FLICKER__?.vtSupported ?? false,
  }));
}

/** Distinct timeline boxes seen while a phase ran — one means it never moved. */
function distinctRects(
  samples: Array<{ rect: Rect | null }>,
): Array<Rect | null> {
  const seen = new Map<string, Rect | null>();
  for (const sample of samples) {
    seen.set(JSON.stringify(sample.rect), sample.rect);
  }
  return [...seen.values()];
}

async function burst(page: Page, label: string, frames: number) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  for (let index = 0; index < frames; index += 1) {
    await page.screenshot({
      path: path.join(
        SHOT_DIR,
        `${label}-${String(index).padStart(2, "0")}.png`,
      ),
    });
    await page.waitForTimeout(100);
  }
}

test("bringing a resident in and letting them go never transitions the shell", async ({
  page,
}) => {
  await instrument(page);
  await installMockBridge(page, {
    managedAgents: [
      {
        channelNames: ["alice-tyler"],
        name: "alice",
        pubkey: RESIDENT,
        status: "running",
      },
    ],
    searchProfiles: [{ displayName: "alice", isAgent: true, pubkey: RESIDENT }],
  });
  // Arrive with a resident's session already in the drawer: the panel params
  // must be live, or clearing them is a no-op and nothing navigates.
  await page.goto(
    `/?e2e=mock#/channels/${DM_CHANNEL_ID}?agentSession=${RESIDENT}`,
  );
  await expect(page.getByTestId("chat-title")).toHaveText("alice-tyler");
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(
          window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
            channelName: "alice-tyler",
            kind: 40099,
          }),
        ),
      ),
    )
    .toBe(true);
  await page.waitForTimeout(600);

  const settled = await readState(page);
  const report: Record<string, unknown> = { vtSupported: settled.vtSupported };

  const phase = async (
    label: string,
    frames: number,
    act: () => Promise<void>,
  ) => {
    const before = await readState(page);
    await page.evaluate(() => window.__FLICKER_SAMPLE_START__?.());
    const shots = burst(page, label, frames);
    await act();
    await shots;
    await page.waitForTimeout(300);
    const after = await readState(page);
    const samples = await page.evaluate(
      () => window.__FLICKER_SAMPLE_STOP__?.() ?? [],
    );
    const result = {
      history: after.historyWrites - before.historyWrites,
      rects: distinctRects(samples),
      viewTransitions: after.vtCalls - before.vtCalls,
    };
    report[label] = result;
    console.log(`[flicker] ${label}:`, JSON.stringify(result));
    return result;
  };

  await expect(
    page.getByTestId("agent-session-thread-panel").first(),
  ).toBeVisible();

  // The resident arrives: the room's exchange goes live and takes the drawer.
  const join = await phase("join", 10, async () => {
    await page.evaluate((resident) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "alice-tyler",
        content: JSON.stringify({
          type: "visit_arrived",
          resident,
          exchange_id: "b".repeat(64),
          text: "alice is visiting.",
        }),
        kind: 40099,
      });
    }, RESIDENT);
    await page.evaluate(
      ({ conversationId, exchangeId, resident }) => {
        window.__BUZZ_E2E_EMIT_MOCK_EXCHANGE__?.({
          conversationId,
          exchangeId,
          members: [resident],
          openedBy: resident,
        });
      },
      {
        conversationId: DM_CHANNEL_ID,
        exchangeId: EXCHANGE_ID,
        resident: RESIDENT,
      },
    );
    await expect(page.getByText("alice stepped in")).toBeVisible();
  });

  // …and leaves again.
  const leave = await phase("leave", 8, async () => {
    await page.evaluate((resident) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "alice-tyler",
        content: JSON.stringify({
          type: "visit_left",
          resident,
          exchange_id: "b".repeat(64),
          text: "alice stepped out.",
        }),
        kind: 40099,
      });
    }, RESIDENT);
    await expect(page.getByText("alice stepped out")).toBeVisible();
  });

  // Closing the drawer on the conversation.
  const close = await phase("close", 6, async () => {
    await page
      .getByRole("button", { name: "Open conversation details" })
      .click();
  });

  // …while a real route change keeps its choreography: the opt-out is scoped
  // to search-param patches, not the whole router.
  const route = await phase("route", 0, async () => {
    await page.getByTestId("channel-general").click();
    await expect(page.getByTestId("chat-title")).toHaveText("general");
  });

  const finalState = await readState(page);
  report.consoleErrors = finalState.consoleErrors;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(SHOT_DIR, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  // Panel state is not a route change: none of these may snapshot the shell.
  expect(join.viewTransitions).toBe(0);
  expect(leave.viewTransitions).toBe(0);
  expect(close.viewTransitions).toBe(0);
  // The timeline keeps its box while the resident comes and goes.
  expect(join.rects).toHaveLength(1);
  expect(leave.rects).toHaveLength(1);
  expect(finalState.consoleErrors).toEqual([]);
  expect(route.viewTransitions).toBeGreaterThan(0);
});
