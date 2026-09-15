import { expect, test, type Page } from "@playwright/test";

import type {
  ActivityTrace,
  ActivityTraceEntry,
} from "../../../src/features/messages/activity/activityTraceTypes";
import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";

const ROOM = "general";
const ROOM_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const DM = "alice-tyler";
const DM_ID = "f48efb06-0c93-5025-aac9-2e646bb6bfa8";
const LUCA = TEST_IDENTITIES.alice.pubkey;
const RESIDENTS = [
  { name: "Luca", pubkey: LUCA },
  { name: "Sol", pubkey: TEST_IDENTITIES.charlie.pubkey },
  { name: "Aster Fieldwright", pubkey: TEST_IDENTITIES.bob.pubkey },
];

// Deliberately small synthetic public snapshots. No captured resident transcript
// is bundled into the application or this test fixture.
const ENTRIES: ActivityTraceEntry[] = [
  {
    id: "voice-two",
    sequence: 4,
    kind: "narration",
    status: "done",
    text: "I found the section to update.",
    roomText: "Work update",
  },
  {
    id: "read",
    sequence: 1,
    kind: "activity",
    status: "done",
    text: "Reading task-notes.md",
    roomText: "Reading a file",
  },
  {
    id: "search",
    sequence: 3,
    kind: "activity",
    status: "done",
    text: "Searching task-notes.md",
    roomText: "Searching files",
  },
  {
    id: "voice-one",
    sequence: 2,
    kind: "narration",
    status: "done",
    text: "I am checking the first section.",
    roomText: "Work update",
  },
];

function snapshot(overrides: Partial<ActivityTrace> = {}): ActivityTrace {
  const endedAt = Date.now();
  return {
    conversationId: ROOM_ID,
    residentPubkey: LUCA,
    dispatchReceiptId: "activity-test-dispatch",
    turnId: "activity-test-turn",
    finalMessageId: null,
    responseSurface: "timeline",
    startedAt: endedAt - 499_000,
    endedAt,
    status: "completed",
    entries: ENTRIES,
    truncated: false,
    ...overrides,
  };
}

async function open(
  page: Page,
  activityTraces: ActivityTrace[] = [],
  channel = DM,
) {
  const mock = {
    activityTraces,
    managedAgents: RESIDENTS.map((resident, index) => ({
      ...resident,
      channelNames: index === 0 ? [ROOM, DM] : [ROOM],
      status: "running" as const,
    })),
    searchProfiles: RESIDENTS.map((resident) => ({
      pubkey: resident.pubkey,
      displayName: resident.name,
      isAgent: true,
    })),
  };
  await installMockBridge(page, mock);
  if (channel === DM) {
    // Resident DMs live in the agent's chat column, not the person-DM rail.
    await page.goto(`/?e2e=mock#/channels/${DM_ID}`);
  } else {
    await page.goto("/?e2e=mock");
    await page.getByTestId(`channel-${channel}`).click();
  }
  await expect
    .poll(() =>
      page.evaluate(
        (channelName) =>
          window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({ channelName }) ??
          false,
        channel,
      ),
    )
    .toBe(true);
}

async function publishSnapshots(page: Page, traces: ActivityTrace[]) {
  await page.evaluate((next) => {
    const mock = window.__BUZZ_E2E__?.mock;
    if (!mock)
      throw new Error("Mock native command configuration is unavailable.");
    mock.activityTraces = next;
    // The real event is body-free; hydration must read the native command.
    window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.(
      "luca://activity-trace-changed",
      null,
    );
  }, traces);
}

async function presentation(
  page: Page,
  receiptId: string,
  kind: string,
  sequence: number,
) {
  await page.evaluate(
    ({
      dispatchReceiptId,
      frameKind,
      frameSequence,
      resident,
      conversationId,
    }) => {
      window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.("luca://managed-presentation", {
        protocol: "luca.managed.presentation.v1",
        kind: frameKind,
        phase: "working",
        resident_pubkey: resident,
        conversation_id: conversationId,
        turn_id: "activity-test-turn",
        dispatch_receipt_id: dispatchReceiptId,
        session_epoch: 7,
        sequence: frameSequence,
      });
    },
    {
      dispatchReceiptId: receiptId,
      frameKind: kind,
      frameSequence: sequence,
      resident: LUCA,
      conversationId: DM_ID,
    },
  );
}

async function capture(page: Page, name: string) {
  await waitForAnimations(page);
  await page.screenshot({
    path: `test-results/activity/${name}.png`,
    fullPage: false,
  });
}

test("live native activity replaces narration in place and stops the exact resident turn", async ({
  page,
}) => {
  await open(page);
  const request = "Check the activity presentation.";
  await page.getByTestId("message-input").fill(request);
  await page.getByTestId("send-message").click();
  const ownerRow = page
    .getByTestId("message-row")
    .filter({ hasText: request })
    .last();
  await expect(ownerRow).toBeVisible();
  const receiptId = await ownerRow.getAttribute("data-message-id");
  if (!receiptId) throw new Error("Owner dispatch receipt is missing.");
  await presentation(page, receiptId, "turn_started", 1);
  await presentation(page, receiptId, "phase", 2);
  const live = snapshot({
    conversationId: DM_ID,
    dispatchReceiptId: receiptId,
    status: "working",
    startedAt: Date.now() - 125_000,
    endedAt: null,
  });
  await publishSnapshots(page, [live]);
  const trace = page.locator(`[data-activity-trace="${receiptId}"]`);
  await expect(trace).toBeVisible();
  await expect(trace.locator("[data-activity-status]")).toHaveText(
    "Searching task-notes.md",
  );
  await expect(trace.locator("[data-activity-narration]")).toHaveText(
    "I found the section to update.",
  );
  await expect(page.locator("[data-sandpile-activity]")).toHaveCount(1);
  const indicator = trace.locator("[data-sandpile-activity]");
  await expect(indicator).toBeVisible();
  const indicatorBox = await indicator.boundingBox();
  const statusBox = await trace.locator("[data-activity-status]").boundingBox();
  if (!indicatorBox || !statusBox)
    throw new Error("Activity row is not laid out");
  // The mark is one token (--resident-activity-mark-size) that sizes both the
  // slot and the canvas inside it; the row, not the mark, sets the line.
  expect(indicatorBox?.width).toBe(22);
  expect(indicatorBox?.height).toBe(22);
  expect(indicatorBox.x + indicatorBox.width).toBeLessThan(statusBox.x);
  expect(
    Math.abs(
      indicatorBox.y +
        indicatorBox.height / 2 -
        statusBox.y -
        statusBox.height / 2,
    ),
  ).toBeLessThan(1);
  await page.screenshot({ path: "/private/tmp/luca-activity-aligned.png" });
  await expect(page.getByTestId("resident-activity-word")).toHaveCount(0);
  await expect(page.getByTestId("resident-elapsed")).toHaveCount(0);
  await expect(page.getByTestId("resident-stop")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Stop Luca", exact: true }),
  ).toHaveCount(1);
  await expect(trace).toHaveAttribute("data-activity-animating", "true");
  const before = await trace.boundingBox();
  await publishSnapshots(page, [
    {
      ...live,
      entries: [
        ...ENTRIES,
        {
          id: "voice-three",
          sequence: 5,
          kind: "narration",
          status: "done",
          text: "I am preparing the update now.",
          roomText: "Work update",
        },
      ],
    },
  ]);
  await expect(trace.locator("[data-activity-narration]")).toHaveText(
    "I am preparing the update now.",
  );
  expect((await trace.boundingBox())?.height).toBeCloseTo(
    before?.height ?? 0,
    1,
  );
  await capture(page, "trace-live-private");
  await page.getByRole("button", { name: "Stop Luca", exact: true }).click();
  const cancelPayload = await page.evaluate(
    () =>
      window.__BUZZ_E2E_COMMAND_PAYLOADS__
        ?.filter((item) => item.command === "cancel_managed_turn")
        .at(-1)?.payload,
  );
  expect(cancelPayload).toEqual({
    conversationId: DM_ID,
    dispatchReceiptId: receiptId,
    residentPubkey: LUCA,
    sessionEpoch: 7,
  });
  await presentation(page, receiptId, "cancelled", 3);
  await publishSnapshots(page, [
    { ...live, status: "cancelled", endedAt: Date.now() },
  ]);
  await expect(trace.locator("[data-activity-trace-summary]")).toContainText(
    "Luca stopped after",
  );
  await expect(
    trace.locator("[data-activity-stop], .buzz-shimmer"),
  ).toHaveCount(0);
  await expect(page.locator("[data-sandpile-activity]")).toHaveCount(0);
});

test("a settled record stays above its signed reply and hydrates again after reload", async ({
  page,
}) => {
  const unexpectedThought = {
    id: "untrusted-kind",
    sequence: 6,
    kind: "thought",
    status: "done",
    text: "PRIVATE THOUGHT MUST NOT RENDER",
    roomText: "PRIVATE THOUGHT MUST NOT RENDER",
  } as unknown as ActivityTraceEntry;
  const settled = snapshot({
    finalMessageId: "mock-general-alice",
    entries: [...ENTRIES, unexpectedThought],
  });
  await open(page, [settled], ROOM);
  const trace = page.locator('[data-activity-trace="activity-test-dispatch"]');
  const summary = trace.locator("[data-activity-trace-summary]");
  const row = page.getByTestId("message-row").filter({ has: trace });
  await expect(summary).toHaveText("Luca worked for 8m 19s · 2 steps");
  await expect(row).toContainText("Hey team — checking in.");
  await expect(trace.locator("details")).not.toHaveAttribute("open");
  await summary.focus();
  await page.keyboard.press("Enter");
  const record = trace.locator("[data-activity-trace-list]");
  await expect(record).toBeVisible();
  const expected = [
    "Reading a file",
    "Work update",
    "Searching files",
    "Work update",
  ];
  await expect(record.locator("li")).toHaveText(expected);
  await expect(trace).not.toContainText("task-notes.md");
  await expect(page.locator("body")).not.toContainText(
    "PRIVATE THOUGHT MUST NOT RENDER",
  );
  await expect(record.locator("[data-activity-elapsed], time")).toHaveCount(0);
  await expect(row.locator("[data-managed-work-duration]")).toHaveCount(0);
  await capture(page, "trace-settled-expanded");
  await page.reload();
  await page.getByTestId(`channel-${ROOM}`).click();
  await expect(summary).toHaveText("Luca worked for 8m 19s · 2 steps");
  await expect(row).toContainText("Hey team — checking in.");
  await expect(trace.locator("details")).not.toHaveAttribute("open");
  await summary.click();
  await expect(record.locator("li")).toHaveText(expected);
  expect(
    await page.evaluate(() =>
      window.__BUZZ_E2E_COMMANDS__?.includes("luca_list_activity_traces"),
    ),
  ).toBe(true);
});

test("restored cancelled, failed and interrupted turns keep honest records without live controls", async ({
  page,
}) => {
  const statuses = ["cancelled", "failed", "interrupted"] as const;
  const traces = RESIDENTS.map((resident, index) =>
    snapshot({
      residentPubkey: resident.pubkey,
      dispatchReceiptId: `recovered-${statuses[index]}`,
      status: statuses[index],
      startedAt: Date.now() - 4_000,
    }),
  );
  await open(page, traces, ROOM);
  const summaries = page.locator("[data-activity-trace-summary]");
  await expect(summaries).toHaveCount(3);
  await expect(summaries).toContainText([
    "Luca stopped after",
    "Sol's work failed after",
    "Aster Fieldwright's work was interrupted after",
  ]);
  await expect(
    page.locator("[data-activity-stop], [data-sandpile-activity]"),
  ).toHaveCount(0);
  await expect(page.getByTestId("stop-all-working-residents")).toHaveCount(0);
  await page
    .locator('[data-activity-trace="recovered-failed"] summary')
    .click();
  await expect(
    page.locator('[data-activity-trace="recovered-failed"] ol'),
  ).toBeVisible();
  await page
    .locator('[data-activity-trace="recovered-failed"] summary')
    .click();
  await capture(page, "trace-recovered-outcomes");
});

test("the same native objects stay private when the owner moves from a DM to a room", async ({
  page,
}) => {
  await open(page, [
    snapshot({
      conversationId: DM_ID,
      dispatchReceiptId: "private-record",
      status: "working",
      endedAt: null,
    }),
    snapshot({
      dispatchReceiptId: "room-record",
      status: "working",
      endedAt: null,
    }),
  ]);
  await expect(
    page.locator(
      '[data-activity-trace="private-record"] [data-activity-status]',
    ),
  ).toHaveText("Searching task-notes.md");
  await page.getByTestId(`channel-${ROOM}`).click();
  await expect(
    page.locator('[data-activity-trace="room-record"] [data-activity-status]'),
  ).toHaveText("Searching files");
  await expect(page.locator("body")).not.toContainText("task-notes.md");
  await expect(page.locator("[data-sandpile-activity]")).toHaveCount(1);
});

test("a narrow zoomed row keeps controls within bounds and honors reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, [
    snapshot({ conversationId: DM_ID, status: "working", endedAt: null }),
  ]);
  const trace = page.locator('[data-activity-trace="activity-test-dispatch"]');
  await expect(trace).toBeVisible();
  await expect(trace).toHaveAttribute("data-activity-animating", "false");
  await expect(trace.locator(".buzz-shimmer")).toHaveCount(0);
  const initialTextSize = await trace
    .locator("[data-activity-status]")
    .evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize),
    );
  await page.setViewportSize({ width: 640, height: 860 });
  await page.keyboard.press("ControlOrMeta+Equal");
  await page.keyboard.press("ControlOrMeta+Equal");
  await expect
    .poll(() =>
      trace
        .locator("[data-activity-status]")
        .evaluate((element) =>
          Number.parseFloat(getComputedStyle(element).fontSize),
        ),
    )
    .toBeGreaterThan(initialTextSize);
  const geometry = await trace.evaluate((element) => {
    const row = element.getBoundingClientRect();
    const status = element
      .querySelector("[data-activity-status]")
      ?.getBoundingClientRect();
    const stop = element
      .querySelector("[data-activity-stop]")
      ?.getBoundingClientRect();
    const elapsed = element
      .querySelector("[data-activity-elapsed]")
      ?.getBoundingClientRect();
    return {
      right: row.right,
      viewport: window.innerWidth,
      stopRight: stop?.right ?? Infinity,
      statusRight: status?.right ?? Infinity,
      elapsedLeft: elapsed?.left ?? 0,
    };
  });
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.stopRight).toBeLessThanOrEqual(geometry.right + 1);
  expect(geometry.statusRight).toBeLessThanOrEqual(geometry.elapsedLeft);
  await capture(page, "trace-narrow-zoom-reduced-motion");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(trace).toHaveAttribute("data-activity-animating", "true");
  await expect(trace.locator(".buzz-shimmer")).toHaveCount(1);
});

test("only simultaneous working names align, and light mode retains readable activity", async ({
  page,
}) => {
  const traces = RESIDENTS.map((resident, index) =>
    snapshot({
      residentPubkey: resident.pubkey,
      dispatchReceiptId: `alignment-${index}`,
      status: index < 2 ? "working" : "completed",
      startedAt: Date.now() - 4_000,
      endedAt: index < 2 ? null : Date.now(),
    }),
  );
  await open(page, traces, ROOM);
  const workingNames = page.locator(
    '[data-activity-state="working"] [data-activity-name]',
  );
  await expect(workingNames).toHaveCount(2);
  const columns = () =>
    workingNames.evaluateAll((elements) =>
      elements.map((element) => ({
        nameWidth: element.getBoundingClientRect().width,
        statusLeft:
          element
            .closest("[data-activity-trace]")
            ?.querySelector("[data-activity-status]")
            ?.getBoundingClientRect().left ?? 0,
      })),
    );
  await expect
    .poll(async () => {
      const values = await columns();
      return Math.abs(values[0].statusLeft - values[1].statusLeft);
    })
    .toBeLessThan(1);
  await expect(
    page.locator('[data-testid="message-row"] [data-testid="chat-agent-mark"]'),
  ).toHaveCount(0);
  const initial = await columns();
  expect(initial[0].nameWidth).toBeCloseTo(initial[1].nameWidth, 1);
  const settledName = page.locator(
    '[data-activity-trace="alignment-2"] [data-activity-name]',
  );
  expect(
    await settledName.evaluate((element) =>
      element.style.getPropertyValue("--resident-activity-name-width"),
    ),
  ).toBe("");
  expect((await settledName.boundingBox())?.width ?? 0).toBeGreaterThan(
    initial[0].nameWidth,
  );
  await page.keyboard.press("ControlOrMeta+Equal");
  await expect
    .poll(async () => (await columns())[0].nameWidth)
    .toBeGreaterThan(initial[0].nameWidth);
  await expect
    .poll(async () => {
      const values = await columns();
      return Math.abs(values[0].statusLeft - values[1].statusLeft);
    })
    .toBeLessThan(1);
  await capture(page, "trace-aligned-working-names");
  await publishSnapshots(
    page,
    traces.map((trace, index) =>
      index === 0
        ? {
            ...trace,
            status: "completed",
            endedAt: Date.now(),
          }
        : trace,
    ),
  );
  await expect(workingNames).toHaveCount(1);
  await expect
    .poll(() =>
      workingNames.evaluate((element) =>
        element.style.getPropertyValue("--resident-activity-name-width"),
      ),
    )
    .toBe("");

  await page.evaluate(() => localStorage.setItem("buzz-theme", "paper"));
  await page.reload();
  await page.getByTestId(`channel-${ROOM}`).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-luca-theme",
    "paper",
  );
  await expect(page.locator("[data-activity-trace]")).toHaveCount(3);
  const contrastRatios = await page
    .locator("[data-activity-trace]")
    .evaluateAll((traces) => {
      const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
      const luminance = (channels: number[]) =>
        channels
          .slice(0, 3)
          .map((value) => {
            const channel = value / 255;
            return channel <= 0.04045
              ? channel / 12.92
              : ((channel + 0.055) / 1.055) ** 2.4;
          })
          .reduce(
            (total, value, index) =>
              total + value * [0.2126, 0.7152, 0.0722][index],
            0,
          );
      return traces.flatMap((trace) =>
        [
          ...trace.querySelectorAll<HTMLElement>(
            "[data-activity-status], [data-activity-narration], [data-activity-elapsed], [data-activity-stop], [data-activity-trace-summary]",
          ),
        ].map((element) => {
          let parent: HTMLElement | null = element;
          let background = [255, 255, 255];
          while (parent) {
            const color = rgb(getComputedStyle(parent).backgroundColor);
            if (color.length === 3 || color[3] === 1) {
              background = color;
              break;
            }
            parent = parent.parentElement;
          }
          const ink = luminance(rgb(getComputedStyle(element).color));
          const ground = luminance(background);
          return (
            (Math.max(ink, ground) + 0.05) / (Math.min(ink, ground) + 0.05)
          );
        }),
      );
    });
  expect(contrastRatios.length).toBeGreaterThan(0);
  expect(Math.min(...contrastRatios)).toBeGreaterThanOrEqual(4.5);
  await capture(page, "trace-light-readable");
});
