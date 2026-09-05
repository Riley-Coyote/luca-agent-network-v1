import { expect, test, type Page } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import {
  installMockBridge,
  TEST_IDENTITIES,
  type MockExchangeSeed,
} from "../../helpers/bridge";

const OWNER_PUBKEY = "deadbeef".repeat(8);
const GENERAL_CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
// The mock bridge's "random" channel, standing in for a pair DM the note
// points at — the door only needs a real room on the other side.
const RANDOM_CHANNEL_ID = "9dae0116-799b-5071-a0a8-fdd30a91a35d";
const EXCHANGE_ID = "ab".repeat(32);
const OTHER_EXCHANGE_ID = "cd".repeat(32);

const LUCA = { name: "Luca", pubkey: TEST_IDENTITIES.bob.pubkey };
const VEKTOR = { name: "Vektor", pubkey: TEST_IDENTITIES.charlie.pubkey };

function residents(channelNames: string[]) {
  return [LUCA, VEKTOR].map((resident) => ({
    channelNames,
    name: resident.name,
    pubkey: resident.pubkey,
    status: "running" as const,
  }));
}

function openExchange(overrides: Partial<MockExchangeSeed> = {}) {
  return {
    exchangeId: EXCHANGE_ID,
    owner: OWNER_PUBKEY,
    members: [LUCA.pubkey, VEKTOR.pubkey],
    conversationId: GENERAL_CHANNEL_ID,
    openedBy: LUCA.pubkey,
    bucket: 3,
    spent: 1,
    ...overrides,
  } satisfies MockExchangeSeed;
}

async function openGeneral(page: Page, exchanges: MockExchangeSeed[]) {
  await installMockBridge(page, {
    managedAgents: residents(["general"]),
    exchanges,
  });
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
}

async function waitForMockLiveSubscription(page: Page, channelName: string) {
  await expect
    .poll(async () =>
      page.evaluate(
        (name) =>
          window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
            channelName: name,
          }) ?? false,
        channelName,
      ),
    )
    .toBe(true);
}

/** Two resident turns land in the room, spending the rest of the bucket. */
async function spendTheBucket(page: Page) {
  await waitForMockLiveSubscription(page, "general");
  await page.evaluate(
    ({ exchangeId, luca, vektor }) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        content: "Vektor — does the runtime atlas cover Hermes profiles?",
        pubkey: vektor,
        extraTags: [["exchange", exchangeId, "2"]],
      });
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        content: "It does, for the profiles we ship.",
        pubkey: luca,
        extraTags: [["exchange", exchangeId, "3"]],
      });
    },
    { exchangeId: EXCHANGE_ID, luca: LUCA.pubkey, vektor: VEKTOR.pubkey },
  );
}

async function resolveExchangeCalls(page: Page) {
  return page.evaluate(() =>
    (window.__BUZZ_E2E_COMMAND_LOG__ ?? [])
      .filter((entry) => entry.command === "resolve_exchange")
      .map((entry) => entry.payload),
  );
}

test("the composer only surfaces an exchange when it needs the owner", async ({
  page,
}) => {
  await openGeneral(page, [openExchange()]);

  const strip = page.getByTestId("exchange-strip");
  await expect(strip).toHaveCount(0);

  await spendTheBucket(page);

  await expect(strip).toBeVisible();
  await expect(strip).toContainText("Luca");
  await expect(strip).toContainText("Vektor");
  await expect(page.getByTestId("exchange-strip-status")).toHaveText(
    "Waiting for you",
  );
  await expect(strip).toHaveAttribute("data-exchange-phase", "paused");
  await expect(page.getByTestId("exchange-stop")).toBeVisible();
  await expect(page.getByTestId("exchange-go")).toBeEnabled();
});

test("Let them go on grants three more turns", async ({ page }) => {
  await openGeneral(page, [openExchange()]);
  await spendTheBucket(page);
  await expect(page.getByTestId("exchange-go")).toBeEnabled();

  await page.getByTestId("exchange-go").click();

  await expect
    .poll(async () => resolveExchangeCalls(page))
    .toEqual([{ exchangeId: EXCHANGE_ID, action: "go" }]);
  await expect(page.getByTestId("exchange-strip")).toHaveCount(0);
});

test("Stop here closes the exchange and the strip leaves the room", async ({
  page,
}) => {
  await openGeneral(page, [openExchange()]);
  await spendTheBucket(page);
  await expect(page.getByTestId("exchange-stop")).toBeVisible();

  await page.getByTestId("exchange-stop").click();

  await expect
    .poll(async () => resolveExchangeCalls(page))
    .toEqual([{ exchangeId: EXCHANGE_ID, action: "stop" }]);
  await expect(page.getByTestId("exchange-strip")).toHaveCount(0);
});

test("an exchange note reads as a sentence in the room", async ({ page }) => {
  await openGeneral(page, [openExchange()]);
  await waitForMockLiveSubscription(page, "general");

  await page.evaluate(
    ({ exchangeId, owner, luca }) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        kind: 40099,
        pubkey: owner,
        content: JSON.stringify({
          type: "exchange-note",
          exchange_id: exchangeId,
          resident: luca,
          text: "Luca mentioned Vektor, who isn't here — asking across rooms comes next.",
        }),
      });
    },
    { exchangeId: EXCHANGE_ID, owner: OWNER_PUBKEY, luca: LUCA.pubkey },
  );

  await expect(
    page.getByText(
      "Luca mentioned Vektor, who isn't here — asking across rooms comes next.",
    ),
  ).toBeVisible();
  await expect(page.getByTestId("exchange-note-room-link")).toHaveCount(0);
});

test("a placed exchange's note carries a door to the pair DM", async ({
  page,
}) => {
  await openGeneral(page, [openExchange()]);
  await waitForMockLiveSubscription(page, "general");

  await page.evaluate(
    ({ exchangeId, owner, luca, pairDmId }) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        kind: 40099,
        pubkey: owner,
        content: JSON.stringify({
          type: "exchange-note",
          exchange_id: exchangeId,
          resident: luca,
          text: "Luca asked Vektor — in their DM.",
          conversation_id: pairDmId,
        }),
      });
    },
    {
      exchangeId: EXCHANGE_ID,
      owner: OWNER_PUBKEY,
      luca: LUCA.pubkey,
      pairDmId: RANDOM_CHANNEL_ID,
    },
  );

  await expect(
    page.getByText("Luca asked Vektor — in their DM."),
  ).toBeVisible();
  const door = page.getByTestId("exchange-note-room-link");
  await expect(door).toBeVisible();
  await door.click();
  await expect(page.getByTestId("chat-title")).toHaveText("random");
});

test("no signature raises the ceiling", async ({ page }) => {
  await openGeneral(page, [openExchange({ bucket: 10, spent: 10 })]);

  await expect(page.getByTestId("exchange-strip-status")).toHaveText(
    "Conversation limit reached",
  );
  await expect(page.getByTestId("exchange-stop")).toBeEnabled();
  const go = page.getByTestId("exchange-go");
  await expect(go).toBeDisabled();
  await expect(go).toHaveAttribute("title", "Conversation limit reached");
});

/** The Luca sidebar shows one dot per unread room; the count lives on the app
 *  badge, which is where "does this badge?" is actually observable. */
async function appBadgeState(page: Page) {
  return page.evaluate(() => ({
    state: window.__BUZZ_E2E_APP_BADGE_STATE__ ?? "none",
    count: window.__BUZZ_E2E_APP_BADGE_COUNT__ ?? 0,
  }));
}

test("a volley never badges its room, but a paused exchange does", async ({
  page,
}) => {
  await installMockBridge(page, {
    managedAgents: residents(["general", "announcements", "engineering"]),
    exchanges: [
      // Spent, waiting on the owner. `announcements` has no history and no
      // unread of its own, so anything that appears on it came from here.
      {
        exchangeId: EXCHANGE_ID,
        owner: OWNER_PUBKEY,
        members: [LUCA.pubkey, VEKTOR.pubkey],
        channelName: "announcements",
        openedBy: LUCA.pubkey,
        bucket: 3,
        spent: 3,
      },
      // Still speaking — its turns are visible, not a summons.
      {
        exchangeId: OTHER_EXCHANGE_ID,
        owner: OWNER_PUBKEY,
        members: [LUCA.pubkey, VEKTOR.pubkey],
        channelName: "engineering",
        openedBy: LUCA.pubkey,
        bucket: 3,
        spent: 0,
      },
    ],
  });
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await waitForMockLiveSubscription(page, "engineering");

  // A paused exchange is the one exchange signal that asks for the owner:
  // `announcements` is otherwise silent and unread only because of it.
  await expect(page.getByTestId("channel-unread-announcements")).toBeVisible();

  // Let startup settle before measuring what the volley adds.
  await page.waitForTimeout(2000);
  const baseline = await appBadgeState(page);
  // ...and it counts: an unread dot for a room nobody spoke in would be too
  // quiet for a decision the residents are blocked on.
  expect(baseline.count).toBeGreaterThan(0);

  // A volley that also @-mentions the owner: without the exchange tag this
  // would raise the app badge count, so the tag is doing the work here.
  await page.evaluate(
    ({ exchangeId, owner, vektor }) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "engineering",
        content: "Luca — picking this up now.",
        pubkey: vektor,
        mentionPubkeys: [owner],
        extraTags: [["exchange", exchangeId, "1"]],
      });
    },
    {
      exchangeId: OTHER_EXCHANGE_ID,
      owner: OWNER_PUBKEY,
      vektor: VEKTOR.pubkey,
    },
  );

  // Recorded — the room reads unread — but it never raises the count.
  await expect(page.getByTestId("channel-unread-engineering")).toBeVisible();
  await page.waitForTimeout(1000);
  expect(await appBadgeState(page)).toEqual(baseline);
});

test("a background-room exchange badges when unseen turns pause it", async ({
  page,
}) => {
  await installMockBridge(page, {
    managedAgents: residents(["general", "announcements"]),
    exchanges: [
      {
        exchangeId: EXCHANGE_ID,
        owner: OWNER_PUBKEY,
        members: [LUCA.pubkey, VEKTOR.pubkey],
        channelName: "announcements",
        openedBy: LUCA.pubkey,
        bucket: 3,
        spent: 1,
      },
    ],
  });
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await waitForMockLiveSubscription(page, "announcements");
  await expect(page.getByTestId("channel-unread-announcements")).toHaveCount(0);

  await page.evaluate(
    ({ exchangeId, luca, vektor }) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "announcements",
        content: "Checking the runtime boundary.",
        pubkey: vektor,
        extraTags: [["exchange", exchangeId, "2"]],
      });
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "announcements",
        content: "The boundary holds.",
        pubkey: luca,
        extraTags: [["exchange", exchangeId, "3"]],
      });
    },
    { exchangeId: EXCHANGE_ID, luca: LUCA.pubkey, vektor: VEKTOR.pubkey },
  );

  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await expect(page.getByTestId("channel-unread-announcements")).toBeVisible();
});

const RETURN_TEXT =
  "Hermes profiles are covered. You can keep the existing setup.";

/** Exercise the existing signed-event bridge, retaining the counted turn. */
async function emitOwnerReturnJourney(page: Page, parentEventId?: string) {
  await waitForMockLiveSubscription(page, "general");
  return page.evaluate(
    ({ owner, luca, sibling, exchangeId, parent, answer }) => {
      const now = Math.floor(Date.now() / 1000);
      const emit = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
      if (!emit) throw new Error("Mock relay emitter is unavailable");
      // The native publisher preserves NIP-10 placement with only the routed
      // recipients. The generic mock reply helper adds an extra self p-tag.
      const threadTags = parent ? [["e", parent, "", "reply"]] : [];
      const request = emit({
        channelName: "general",
        content: "Please check the Hermes profile boundary.",
        pubkey: luca,
        mentionPubkeys: [owner, sibling],
        extraTags: [["exchange", exchangeId, "1"], ...threadTags],
        createdAt: now,
      });
      const response = emit({
        channelName: "general",
        content: "The existing profiles remain native and read-only.",
        pubkey: sibling,
        mentionPubkeys: [luca],
        extraTags: [["exchange", exchangeId, "2"], ...threadTags],
        createdAt: now + 1,
      });
      const returned = emit({
        channelName: "general",
        content: answer,
        pubkey: luca,
        mentionPubkeys: [owner],
        extraTags: [["exchange", exchangeId, "3"], ...threadTags],
        createdAt: now + 2,
      });
      return {
        requestId: request.id,
        responseId: response.id,
        returnId: returned.id,
      };
    },
    {
      owner: OWNER_PUBKEY,
      luca: LUCA.pubkey,
      sibling: VEKTOR.pubkey,
      exchangeId: EXCHANGE_ID,
      parent: parentEventId,
      answer: RETURN_TEXT,
    },
  );
}

async function publishClosedHead(
  page: Page,
  channelName = "general",
  rootEventId?: string,
) {
  const seed = openExchange({
    channelName,
    conversationId: undefined,
    rootEventId,
    state: "closed",
    spent: 3,
  });
  await page.evaluate((head) => {
    if (!window.__BUZZ_E2E_EMIT_MOCK_EXCHANGE__)
      throw new Error("Mock exchange emitter is unavailable");
    window.__BUZZ_E2E_EMIT_MOCK_EXCHANGE__(head);
  }, seed);
}

for (const arrival of ["head first", "return first"] as const) {
  test(`counted owner return is ordinary chat with complete history: ${arrival}`, async ({
    page,
  }, testInfo) => {
    await openGeneral(
      page,
      arrival === "head first"
        ? [openExchange({ state: "closed", spent: 3 })]
        : [],
    );
    const ids = await emitOwnerReturnJourney(page);
    const timeline = page.getByTestId("message-timeline");
    const returned = timeline.locator(
      `[data-testid="message-row"][data-message-id="${ids.returnId}"]`,
    );
    if (arrival === "return first") {
      await expect(
        page.getByTestId(`exchange-receipt-${EXCHANGE_ID}`),
      ).toBeVisible();
      await expect(returned).toHaveCount(0);
      await publishClosedHead(page);
    }
    await expect(returned).toHaveCount(1);
    await expect(returned).toContainText(RETURN_TEXT);
    await expect(returned).toBeInViewport();
    await expect(
      timeline.locator(
        `[data-testid="message-row"][data-message-id="${ids.requestId}"]`,
      ),
    ).toHaveCount(0);
    await expect(
      timeline.locator(
        `[data-testid="message-row"][data-message-id="${ids.responseId}"]`,
      ),
    ).toHaveCount(0);
    const receipt = page.getByTestId(`exchange-receipt-${EXCHANGE_ID}`);
    await expect(receipt).toHaveCount(1);
    await expect(receipt).toContainText("3 turns");
    expect(
      await receipt.evaluate((el, returnId) => {
        const answer = document.querySelector(
          `[data-message-id="${returnId}"]`,
        );
        return Boolean(
          answer &&
            el.compareDocumentPosition(answer) &
              Node.DOCUMENT_POSITION_FOLLOWING,
        );
      }, ids.returnId),
    ).toBe(true);
    await expect(page.getByTestId("exchange-strip")).toHaveCount(0);
    await waitForAnimations(page);
    await page.screenshot({
      path: testInfo.outputPath("owner-return-main.png"),
    });
    await receipt.click();
    const history = page.getByTestId(`exchange-history-${EXCHANGE_ID}`);
    await expect(history).toHaveAttribute("data-exchange-phase", "closed");
    for (const text of [
      "Please check the Hermes profile boundary.",
      "The existing profiles remain native and read-only.",
      RETURN_TEXT,
    ]) {
      await expect(history.getByText(text, { exact: true })).toBeVisible();
    }
    await waitForAnimations(page);
    await page.screenshot({
      path: testInfo.outputPath("owner-return-history.png"),
    });
    expect(await resolveExchangeCalls(page)).toEqual([]);
  });
}

test("a delayed verified head restores the owner-return badge without badging internal speech", async ({
  page,
}, testInfo) => {
  await installMockBridge(page, {
    managedAgents: residents(["general", "engineering"]),
  });
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-general").click();
  await waitForMockLiveSubscription(page, "engineering");
  await page.waitForTimeout(2000);
  const baseline = await appBadgeState(page);
  const returned = await page.evaluate(
    ({ owner, luca, sibling, exchangeId, answer }) => {
      const emit = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
      if (!emit) throw new Error("Mock relay emitter is unavailable");
      emit({
        channelName: "engineering",
        content: "Internal owner mention stays quiet.",
        pubkey: sibling,
        mentionPubkeys: [owner],
        extraTags: [["exchange", exchangeId, "2"]],
      });
      return emit({
        channelName: "engineering",
        content: answer,
        pubkey: luca,
        mentionPubkeys: [owner],
        extraTags: [["exchange", exchangeId, "3"]],
      }).id;
    },
    {
      owner: OWNER_PUBKEY,
      luca: LUCA.pubkey,
      sibling: VEKTOR.pubkey,
      exchangeId: EXCHANGE_ID,
      answer: RETURN_TEXT,
    },
  );
  await expect(page.getByTestId("channel-unread-engineering")).toBeVisible();
  await page.waitForTimeout(500);
  expect(await appBadgeState(page)).toEqual(baseline);
  await publishClosedHead(page, "engineering");
  await expect
    .poll(async () => (await appBadgeState(page)).count)
    .toBe(baseline.count + 1);
  await waitForAnimations(page);
  await page.screenshot({
    path: testInfo.outputPath("owner-return-unread.png"),
  });
  await page.getByTestId("channel-engineering").click();
  const answer = page
    .getByTestId("message-timeline")
    .locator(`[data-testid="message-row"][data-message-id="${returned}"]`);
  await expect(answer).toBeVisible();
  await expect(answer).toContainText(RETURN_TEXT);
  await expect
    .poll(async () => (await appBadgeState(page)).count)
    .toBe(baseline.count);
});

test("owner return stays in its focused thread and jump to latest reaches its original event", async ({
  page,
}, testInfo) => {
  await openGeneral(page, []);
  await waitForMockLiveSubscription(page, "general");
  const rootId = await page.evaluate(() => {
    const emit = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
    if (!emit) throw new Error("Mock relay emitter is unavailable");
    const start = Math.floor(Date.now() / 1000) - 60;
    const root = emit({
      channelName: "general",
      content: "Check this project with Vektor.",
      id: "ef".repeat(32),
      createdAt: start,
    });
    for (let index = 0; index < 48; index += 1) {
      emit({
        channelName: "general",
        content: `Project detail ${index}: preserve this reading position while the residents finish their check.`,
        parentEventId: root.id,
        createdAt: start + index + 1,
      });
    }
    return root.id;
  });
  const summary = page.locator(
    `[data-testid="message-thread-summary"][data-thread-head-id="${rootId}"]`,
  );
  await summary.click();
  await expect(page.getByTestId("focused-thread-bar")).toBeVisible();
  const timeline = page.getByTestId("message-timeline");
  await expect(
    timeline.getByText(
      "Project detail 47: preserve this reading position while the residents finish their check.",
      { exact: true },
    ),
  ).toBeInViewport();
  await waitForAnimations(page);
  // Real owner input cancels the thread's entrance settle before reading history.
  await timeline.hover();
  await page.mouse.wheel(0, -2000);
  await expect
    .poll(() =>
      timeline.evaluate(
        (el) => el.scrollHeight - el.clientHeight - el.scrollTop,
      ),
    )
    .toBeGreaterThan(500);
  await expect(
    timeline.getByText(
      "Project detail 47: preserve this reading position while the residents finish their check.",
      { exact: true },
    ),
  ).not.toBeInViewport();
  const readingPosition = await timeline.evaluate(async (el) => {
    const before = el.scrollTop;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    return {
      before,
      after: el.scrollTop,
      distance: el.scrollHeight - el.clientHeight - el.scrollTop,
    };
  });
  expect(readingPosition.after).toBeCloseTo(readingPosition.before, 0);
  expect(readingPosition.distance).toBeGreaterThan(500);
  await expect(
    page.getByRole("button", { name: "Jump to latest", exact: true }),
  ).toBeVisible();
  const ids = await emitOwnerReturnJourney(page, rootId);
  await publishClosedHead(page, "general", rootId);
  await page.getByTestId("message-scroll-to-latest").click();
  const answer = timeline.locator(
    `[data-testid="message-row"][data-message-id="${ids.returnId}"]`,
  );
  await expect(answer).toHaveCount(1);
  await expect(answer).toBeInViewport();
  await expect(answer).toContainText(RETURN_TEXT);
  await expect(page).toHaveURL(new RegExp(`thread=${rootId}`));
  await waitForAnimations(page);
  await page.screenshot({
    path: testInfo.outputPath("owner-return-focused-thread.png"),
  });
  await page.getByRole("button", { name: "Show all messages" }).click();
  await expect(page).not.toHaveURL(/thread=/);
  await expect(
    timeline.locator(
      `[data-testid="message-row"][data-message-id="${ids.returnId}"]`,
    ),
  ).toHaveCount(0);
  await summary.click();
  await expect(
    timeline.locator(
      `[data-testid="message-row"][data-message-id="${ids.returnId}"]`,
    ),
  ).toHaveCount(1);
});
