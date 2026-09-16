import { expect, type Page, test } from "@playwright/test";

import { installMockBridge } from "../../helpers/bridge";

/**
 * A resident's picture is not a new rendering path. The desktop puts a NIP-92
 * `imeta` tag and a `![image](url)` body line on the resident's own kind-9,
 * exactly as it does for a picture the owner attaches, and the message
 * renderer — which reads imeta for any author — draws it.
 *
 * These specs seed exactly that event and hold the renderer to it.
 */

const RESIDENT_PUBKEY = "5e".repeat(32);
const CHART_SHA = "a1".repeat(32);
const SECOND_SHA = "b2".repeat(32);
const CHART_URL = `http://localhost:3000/media/${CHART_SHA}.png`;
const SECOND_URL = `http://localhost:3000/media/${SECOND_SHA}.png`;
const CHART_DIM = { width: 320, height: 180 };

function imetaTag({
  dim,
  filename,
  sha,
  url,
}: {
  dim: string;
  filename: string;
  sha: string;
  url: string;
}) {
  // The exact shape `managed_message_tags_inner` emits: url and m first, then
  // x, size, dim, filename. No `luca_handle` — that is an owner upload handle.
  return [
    "imeta",
    `url ${url}`,
    "m image/png",
    `x ${sha}`,
    "size 4096",
    `dim ${dim}`,
    `filename ${filename}`,
  ];
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

/** Seed the event the managed publisher would have signed. */
async function seedResidentImageMessage(
  page: Page,
  input: { content: string; tags: string[][] },
) {
  await page.evaluate(
    ({ content, pubkey, tags }) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        content,
        extraTags: tags,
        pubkey,
      });
    },
    { content: input.content, pubkey: RESIDENT_PUBKEY, tags: input.tags },
  );
}

async function openGeneral(page: Page) {
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await waitForMockLiveSubscription(page, "general");
}

test.beforeEach(async ({ page }) => {
  await installMockBridge(page, {
    managedAgents: [
      {
        pubkey: RESIDENT_PUBKEY,
        name: "Vektor",
        status: "running",
        channelNames: ["general"],
      },
    ],
  });
});

test("a resident's image renders inside its own message", async ({ page }) => {
  await openGeneral(page);
  await seedResidentImageMessage(page, {
    content: `Here is the chart you asked for.\n![image](${CHART_URL})`,
    tags: [
      imetaTag({
        dim: `${CHART_DIM.width}x${CHART_DIM.height}`,
        filename: "chart.png",
        sha: CHART_SHA,
        url: CHART_URL,
      }),
    ],
  });

  const row = page
    .getByTestId("message-row")
    .filter({ hasText: "Here is the chart you asked for." })
    .last();
  await expect(row).toBeVisible();
  // The sentence and the picture are one message, not a message plus a link.
  await expect(row).toContainText("Here is the chart you asked for.");
  await expect(row).not.toContainText(CHART_URL);

  const trigger = row.getByTestId("message-image-lightbox-trigger");
  await expect(trigger).toHaveCount(1);
  const image = trigger.locator("img");
  await expect(image).toHaveAttribute("src", new RegExp(CHART_SHA));

  // `dim` reserves the box before any byte arrives, so the timeline does not
  // jump when the image decodes.
  const box = await trigger.boundingBox();
  if (!box) {
    throw new Error("Expected the resident's image to have a layout box");
  }
  expect(box.width / box.height).toBeCloseTo(
    CHART_DIM.width / CHART_DIM.height,
    1,
  );
});

test("clicking a resident's image opens the lightbox", async ({ page }) => {
  await openGeneral(page);
  await seedResidentImageMessage(page, {
    content: `A picture worth opening.\n![image](${CHART_URL})`,
    tags: [
      imetaTag({
        dim: `${CHART_DIM.width}x${CHART_DIM.height}`,
        filename: "chart.png",
        sha: CHART_SHA,
        url: CHART_URL,
      }),
    ],
  });

  const row = page
    .getByTestId("message-row")
    .filter({ hasText: "A picture worth opening." })
    .last();
  await row.getByTestId("message-image-lightbox-trigger").first().click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(`img[src*="${CHART_SHA}"]`)).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("a resident's image offers Download image and Copy image", async ({
  page,
}) => {
  await openGeneral(page);
  await seedResidentImageMessage(page, {
    content: `Right-click this one.\n![image](${CHART_URL})`,
    tags: [
      imetaTag({
        dim: `${CHART_DIM.width}x${CHART_DIM.height}`,
        filename: "chart.png",
        sha: CHART_SHA,
        url: CHART_URL,
      }),
    ],
  });

  const row = page
    .getByTestId("message-row")
    .filter({ hasText: "Right-click this one." })
    .last();
  await row.getByTestId("message-image-lightbox-trigger").first().click({
    button: "right",
  });

  const menu = page.locator("[data-image-context-menu]");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("button", { name: "Copy image" })).toBeVisible();
  await expect(
    menu.getByRole("button", { name: "Download image" }),
  ).toBeVisible();
});

test("two images from one turn render as one mosaic", async ({ page }) => {
  await openGeneral(page);
  await seedResidentImageMessage(page, {
    content: `Two takes on the same idea.\n![image](${CHART_URL})\n![image](${SECOND_URL})`,
    tags: [
      imetaTag({
        dim: "320x180",
        filename: "first.png",
        sha: CHART_SHA,
        url: CHART_URL,
      }),
      imetaTag({
        dim: "180x320",
        filename: "second.png",
        sha: SECOND_SHA,
        url: SECOND_URL,
      }),
    ],
  });

  const row = page
    .getByTestId("message-row")
    .filter({ hasText: "Two takes on the same idea." })
    .last();
  await expect(row.getByTestId("message-image-lightbox-trigger")).toHaveCount(
    2,
  );
  await expect(row.locator("[data-image-mosaic]")).toHaveAttribute(
    "data-image-mosaic-count",
    "2",
  );
});

test("a message with no imeta tag still renders its text", async ({ page }) => {
  // An upload that failed drops its attachment and publishes the sentence.
  await openGeneral(page);
  await seedResidentImageMessage(page, {
    content: "I made a chart but could not attach it.",
    tags: [],
  });

  const row = page
    .getByTestId("message-row")
    .filter({ hasText: "I made a chart but could not attach it." })
    .last();
  await expect(row).toBeVisible();
  await expect(row.getByTestId("message-image-lightbox-trigger")).toHaveCount(
    0,
  );
});
