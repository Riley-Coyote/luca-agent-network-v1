import { expect, test, type Page } from "@playwright/test";

import {
  installMockBridge,
  TEST_IDENTITIES,
  type MockExchangeSeed,
} from "../../helpers/bridge";

const OWNER_PUBKEY = "deadbeef".repeat(8);
const GENERAL_CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
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

test("the strip counts the bucket from the relay and pauses at the cap", async ({
  page,
}) => {
  await openGeneral(page, [openExchange()]);

  const strip = page.getByTestId("exchange-strip");
  await expect(strip).toBeVisible();
  await expect(strip).toContainText("Luca");
  await expect(strip).toContainText("Vektor");
  await expect(page.getByTestId("exchange-strip-count")).toHaveText("1 of 3");
  // Nothing to decide while turns remain.
  await expect(page.getByTestId("exchange-stop")).toHaveCount(0);
  await expect(page.getByTestId("exchange-go")).toHaveCount(0);

  await spendTheBucket(page);

  await expect(page.getByTestId("exchange-strip-count")).toHaveText(
    "Paused at 3 of 3",
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
  await expect(page.getByTestId("exchange-strip-count")).toHaveText("3 of 6");
  await expect(page.getByTestId("exchange-strip")).toHaveAttribute(
    "data-exchange-phase",
    "open",
  );
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
});

test("no signature raises the ceiling", async ({ page }) => {
  await openGeneral(page, [openExchange({ bucket: 10, spent: 10 })]);

  await expect(page.getByTestId("exchange-strip-count")).toHaveText(
    "Paused at 10 of 10",
  );
  await expect(page.getByTestId("exchange-stop")).toBeEnabled();
  const go = page.getByTestId("exchange-go");
  await expect(go).toBeDisabled();
  await expect(go).toHaveAttribute("title", "at the ceiling");
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
