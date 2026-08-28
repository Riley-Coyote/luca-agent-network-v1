import { expect, test, type Page } from "@playwright/test";

import { KIND_LUCA_EXCHANGE } from "../../../src/shared/constants/kinds";
import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";

const OWNER_PUBKEY = "deadbeef".repeat(8);
const EXCHANGE_ID = "ae".repeat(32);
const LUCA = { name: "Luca", pubkey: TEST_IDENTITIES.bob.pubkey };
const VEKTOR = { name: "Vektor", pubkey: TEST_IDENTITIES.charlie.pubkey };

async function waitForExchangeSubscription(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        ({ kind, ownerPubkey }) =>
          window.__BUZZ_E2E_HAS_MOCK_OWNER_KIND_SUBSCRIPTION__?.({
            kind,
            ownerPubkey,
          }) ?? false,
        { kind: KIND_LUCA_EXCHANGE, ownerPubkey: OWNER_PUBKEY },
      ),
    )
    .toBe(true);
}

async function emitTurn(
  page: Page,
  turn: number,
  pubkey: string,
  content: string,
) {
  await page.evaluate(
    ({ body, exchangeId, residentPubkey, turnNumber }) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        content: body,
        pubkey: residentPubkey,
        extraTags: [["exchange", exchangeId, String(turnNumber)]],
      });
    },
    {
      body: content,
      exchangeId: EXCHANGE_ID,
      residentPubkey: pubkey,
      turnNumber: turn,
    },
  );
}

test("a live A2A exchange opens once and stays drawer-only after manual close", async ({
  page,
}) => {
  await installMockBridge(page, {
    managedAgents: [LUCA, VEKTOR].map((resident) => ({
      channelNames: ["general"],
      name: resident.name,
      pubkey: resident.pubkey,
      status: "running" as const,
    })),
  });
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-general").click();
  await waitForExchangeSubscription(page);

  await page.evaluate(
    ({ exchangeId, luca, owner, vektor }) => {
      window.__BUZZ_E2E_EMIT_MOCK_EXCHANGE__?.({
        exchangeId,
        owner,
        members: [luca, vektor],
        channelName: "general",
        openedBy: luca,
        bucket: 5,
      });
    },
    {
      exchangeId: EXCHANGE_ID,
      luca: LUCA.pubkey,
      owner: OWNER_PUBKEY,
      vektor: VEKTOR.pubkey,
    },
  );

  const drawer = page.getByTestId("conversation-context-panel");
  await expect(drawer).toBeVisible();
  await expect(
    drawer.getByText("Between agents", { exact: true }),
  ).toBeVisible();

  await emitTurn(
    page,
    1,
    LUCA.pubkey,
    "Vektor, verify the session handoff boundary verbatim.",
  );
  await emitTurn(
    page,
    2,
    VEKTOR.pubkey,
    "Verified. The context stays bounded and visible.",
  );

  const timeline = page.getByTestId("message-timeline");
  const receipt = timeline.getByTestId(`exchange-receipt-${EXCHANGE_ID}`);
  await expect(receipt).toHaveCount(1);
  await expect(
    timeline.getByText("Vektor, verify the session handoff boundary verbatim."),
  ).toHaveCount(0);
  await expect(
    timeline.getByText("Verified. The context stays bounded and visible."),
  ).toHaveCount(0);
  await expect(
    drawer.getByText("Vektor, verify the session handoff boundary verbatim."),
  ).toBeVisible();
  await expect(
    drawer.getByText("Verified. The context stays bounded and visible."),
  ).toBeVisible();

  await drawer.getByRole("button", { name: "Close panel" }).click();
  await expect(drawer).toHaveCount(0);

  // A later turn forces the same authoritative exchange to be re-read. It is
  // not a new live head, so respecting the owner's manual close means the
  // drawer stays closed.
  await emitTurn(
    page,
    3,
    LUCA.pubkey,
    "Refetch acknowledged without reopening the drawer.",
  );
  await expect(receipt).toHaveCount(1);
  await expect(drawer).toHaveCount(0);

  await receipt.click();
  await expect(drawer).toBeVisible();
  await expect(
    drawer.getByText("Refetch acknowledged without reopening the drawer."),
  ).toBeVisible();
});
