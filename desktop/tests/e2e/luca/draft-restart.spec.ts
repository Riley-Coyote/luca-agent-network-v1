import { expect, test, type Page } from "@playwright/test";

import type { DraftState } from "../../../src/features/messages/lib/useDrafts";
import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";

const GENERAL_CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const RANDOM_CHANNEL_ID = "9dae0116-799b-5071-a0a8-fdd30a91a35d";
const MOCK_RELAY = "ws://127.0.0.1:4299";
const STORE_KEY = `buzz-drafts.v2:${MOCK_RELAY}:${"deadbeef".repeat(8)}`;
const IMAGE = {
  url: "https://draft-fixture.invalid/restart.png",
  sha256: "a".repeat(64),
  size: 68,
  type: "image/png",
  uploaded: 1_800_000_000,
  filename: "draft-restart.png",
};

async function installDraftBridge(page: Page) {
  await installMockBridge(
    page,
    { uploadDescriptors: [IMAGE] },
    { relayWsUrl: MOCK_RELAY },
  );
  await page.route("https://draft-fixture.invalid/**", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
}

async function readDraft(page: Page, channelId = GENERAL_CHANNEL_ID) {
  return page.evaluate(
    ({ key, channel }) =>
      (
        JSON.parse(localStorage.getItem(key) ?? "{}") as Record<
          string,
          DraftState
        >
      )[channel] ?? null,
    { key: STORE_KEY, channel: channelId },
  );
}

async function enterMentionAndImage(page: Page) {
  const input = page.getByTestId("message-input");
  await input.fill("Keep this for @bo");
  await page
    .getByTestId(`mention-suggestion-${TEST_IDENTITIES.bob.pubkey}`)
    .click();
  await expect(input).toContainText("Keep this for @bob");
  await page.getByTestId("message-composer-add").click();
  await page.getByRole("menuitem", { name: "Attach files" }).click();
  const thumbnail = page
    .getByTestId("message-composer")
    .getByRole("img", { name: /^Attachment/ });
  await expect(thumbnail).toBeVisible();
  await expect
    .poll(() => thumbnail.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await thumbnail.click();
  await page.getByTestId("composer-attachment-spoiler").click();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-composer-media-spoiler]")).toHaveCount(1);
}

async function openEdit(page: Page, original: string) {
  const row = page.getByTestId("message-row").filter({ hasText: original });
  await row.hover();
  await row.getByLabel("More actions").click();
  await page.getByRole("menuitem", { name: "Edit message" }).click();
  await expect(page.getByTestId("edit-target")).toBeVisible();
  await expect(page.getByTestId("message-input")).toHaveText(original);
}

test.beforeEach(async ({ page }) => {
  await installDraftBridge(page);
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-general").click();
  await expect(
    page.locator('[data-testid="message-input"][contenteditable="true"]'),
  ).toBeEditable();
});

test("reload keeps the current unsent draft without navigating away", async ({
  page,
}) => {
  const input = page.getByTestId("message-input");
  await input.fill("Keep this draft through a restart.");

  // A real reload does not run React's component-unmount cleanup. Do not
  // navigate to another conversation or seed the draft store before reload.
  await page.reload();
  await expect(input).toHaveText("Keep this draft through a restart.");
});

test("mounted draft autosaves and reopens in a fresh page", async ({
  context,
  page,
}) => {
  await page.getByTestId("message-input").fill("A durable unsent thought.");
  await expect
    .poll(async () => (await readDraft(page))?.content)
    .toBe("A durable unsent thought.");
  const url = page.url();
  await page.close();
  const reopened = await context.newPage();
  await installDraftBridge(reopened);
  await reopened.goto(url);
  await expect(reopened.getByTestId("message-input")).toHaveText(
    "A durable unsent thought.",
  );
});

test("reload and conversation switches preserve media, spoilers, and mention routing", async ({
  page,
}, testInfo) => {
  await enterMentionAndImage(page);
  await page.reload();
  const input = page.getByTestId("message-input");
  await expect(input).toContainText("Keep this for @bob");
  await expect(page.locator("[data-composer-media-spoiler]")).toHaveCount(1);
  await expect
    .poll(() =>
      page
        .getByTestId("message-composer")
        .getByRole("img", { name: /^Attachment/ })
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  let saved = await readDraft(page);
  expect(saved?.pendingImeta).toMatchObject([IMAGE]);
  expect(saved?.spoileredAttachmentUrls).toEqual([IMAGE.url]);
  expect(saved?.mentionRefs).toEqual([
    { displayName: "bob", pubkey: TEST_IDENTITIES.bob.pubkey, isAgent: false },
  ]);

  await page.getByTestId("channel-random").click();
  await expect(input).toBeEmpty();
  await input.fill("A separate conversation draft.");
  await page.reload();
  await expect(input).toHaveText("A separate conversation draft.");
  await page.getByTestId("channel-general").click();
  await expect(input).toContainText("Keep this for @bob");
  await expect(page.locator("[data-composer-media-spoiler]")).toHaveCount(1);
  saved = await readDraft(page, RANDOM_CHANNEL_ID);
  expect(saved?.channelId).toBe(RANDOM_CHANNEL_ID);
  expect(saved?.content).toBe("A separate conversation draft.");

  await waitForAnimations(page);
  await page.getByTestId("message-composer").screenshot({
    path: testInfo.outputPath("restored-composer.png"),
  });

  await page.getByTestId("send-message").click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__BUZZ_E2E_COMMAND_PAYLOADS__?.find(
            (entry) => entry.command === "send_channel_message",
          )?.payload,
      ),
    )
    .toMatchObject({ mentionPubkeys: [TEST_IDENTITIES.bob.pubkey] });
  await page.reload();
  await expect(input).toBeEmpty();
  await expect(page.locator("[data-composer-media-spoiler]")).toHaveCount(0);
});

test("sent and manually cleared drafts stay cleared after reload", async ({
  page,
}) => {
  const input = page.getByTestId("message-input");
  const message = "Send this exactly once.";
  await input.fill(message);
  await expect.poll(async () => (await readDraft(page))?.content).toBe(message);
  await page.getByTestId("send-message").click();
  await expect(
    page.getByTestId("message-row").filter({ hasText: message }),
  ).toBeVisible();
  await expect(input).toBeEmpty();
  await page.reload();
  await expect(input).toBeEmpty();
  expect(await readDraft(page)).toBeNull();

  await input.fill("This draft is intentionally discarded.");
  await expect
    .poll(async () => (await readDraft(page))?.content)
    .toBe("This draft is intentionally discarded.");
  await input.fill("");
  await page.reload();
  await expect(input).toBeEmpty();
  expect(await readDraft(page)).toBeNull();
});

test("edit cancellation and reload retain the unsent draft underneath the edit", async ({
  page,
}) => {
  const original = "An existing message to edit.";
  const input = page.getByTestId("message-input");
  await input.fill(original);
  await page.getByTestId("send-message").click();
  await expect(
    page.getByTestId("message-row").filter({ hasText: original }),
  ).toBeVisible();
  await enterMentionAndImage(page);
  await openEdit(page, original);
  await input.fill("An edit that must not replace the draft.");
  await input.press("Escape");
  await expect(page.getByTestId("edit-target")).toHaveCount(0);
  await expect(input).toContainText("Keep this for @bob");
  await expect(page.locator("[data-composer-media-spoiler]")).toHaveCount(1);

  await openEdit(page, original);
  await input.fill("Another edit interrupted by reload.");
  await page.reload();
  await expect(input).toContainText("Keep this for @bob");
  await expect(page.getByTestId("edit-target")).toHaveCount(0);
  await expect(page.locator("[data-composer-media-spoiler]")).toHaveCount(1);
  expect((await readDraft(page))?.mentionRefs).toEqual([
    { displayName: "bob", pubkey: TEST_IDENTITIES.bob.pubkey, isAgent: false },
  ]);
});

test("leaving an edit keeps its draft in the original conversation", async ({
  page,
}) => {
  const original = "Existing message in the first conversation.";
  const input = page.getByTestId("message-input");
  await input.fill(original);
  await page.getByTestId("send-message").click();
  await expect(
    page.getByTestId("message-row").filter({ hasText: original }),
  ).toBeVisible();
  await input.fill("Unsent first-conversation draft.");
  await openEdit(page, original);
  await input.fill("Unfinished edit.");
  await page.getByTestId("channel-random").click();
  await expect(input).toBeEmpty();
  await input.fill("Unsent second-conversation draft.");
  await page.getByTestId("channel-general").click();
  await expect(input).toHaveText("Unsent first-conversation draft.");
  expect((await readDraft(page, RANDOM_CHANNEL_ID))?.content).toBe(
    "Unsent second-conversation draft.",
  );
});
