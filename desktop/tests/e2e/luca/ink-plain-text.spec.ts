import { expect, type Locator, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";

/**
 * Coloured phrases (`[words](ink:warmth)`, `[words](color:amber)`) are drawn
 * by the conversation; every place that shows a message as plain text, or
 * hands it to a person, shows the words alone (WP-58).
 */

const LUCA = "a".repeat(64);
const ALICE =
  "953d3363262e86b770419834c53d2446409db6d918a57f8f339d495d54ab001f";
const GENERAL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const MESSAGE_ID = "5e".repeat(32);
const CONTENT =
  "[Good to see you.](ink:warmth?hush) The [quiet](ink:hush) part, the [warm](ink:warmth) part, and the [amber](color:amber) part.";
const WORDS =
  "Good to see you. The quiet part, the warm part, and the amber part.";
const CODE = ["](ink:", "](color:", "(ink:", "(color:"];

function clean(text: string | null | undefined) {
  for (const code of CODE) expect(text ?? "").not.toContain(code);
}

/** Visible text and every accessible name and title inside, all clean. */
async function expectWords(place: Locator, words: string) {
  const read = await place.evaluate((root) => {
    const names: string[] = [];
    for (const el of [root, ...root.querySelectorAll("*")]) {
      for (const attribute of ["aria-label", "title", "aria-description"])
        names.push(el.getAttribute(attribute) ?? "");
    }
    return { text: (root as HTMLElement).innerText, names };
  });
  expect(read.text.replace(/\s+/g, " ")).toContain(words);
  clean(read.text);
  for (const name of read.names) clean(name);
}

test.use({
  viewport: { width: 1440, height: 900 },
  permissions: ["clipboard-read", "clipboard-write"],
});

async function boot(page: Page, hash = `/channels/${GENERAL}`) {
  await page.addInitScript((key) => {
    localStorage.setItem(key, JSON.stringify({ "shell-frame": true }));
    localStorage.setItem("buzz-theme", "obsidian");
    localStorage.setItem("buzz-follow-system", "false");
  }, FEATURE_OVERRIDES_STORAGE_KEY);
  await installMockBridge(page, {
    managedAgents: [
      {
        name: "Luca",
        personaId: "builtin:fizz",
        pubkey: LUCA,
        status: "running",
      },
    ],
  });
  await page.goto(`/#${hash}`);
  await expect(page.getByTestId("app-sidebar")).toBeVisible({
    timeout: 20_000,
  });
}

async function say(page: Page, channelName = "general", pubkey = LUCA) {
  await page.evaluate(
    ({ content, id, channelName, pubkey }) => {
      const emit = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
      if (!emit) throw new Error("Expected the mock bridge.");
      emit({ channelName, content, id, kind: 9, pubkey });
    },
    { content: CONTENT, id: MESSAGE_ID, channelName, pubkey },
  );
}

const messageRow = (page: Page) =>
  page.locator(`[data-message-id="${MESSAGE_ID}"]`);

async function openActions(page: Page) {
  const row = messageRow(page);
  await row.hover();
  await row.getByRole("button", { name: "More actions" }).click();
}

test("the conversation still draws the phrases coloured", async ({ page }) => {
  await boot(page);
  await say(page);
  const row = messageRow(page);
  await expect(row).toContainText("Good to see you.");
  await expect(
    row.locator("[data-expression-color='amber']", { hasText: /^amber$/ }),
  ).toBeVisible();
  await expect(
    row.locator("[data-expression-pressure='hush']").first(),
  ).toBeVisible();
  clean(await row.innerText());
});

test("Activity: the row and its name hold the words", async ({ page }) => {
  await boot(page);
  await say(page);
  await expect(messageRow(page)).toBeVisible();
  // Activity reads the signed record when it opens.
  await page.evaluate(() => {
    window.location.hash = "/pulse";
  });
  await expect(page.getByTestId("all-activity-card")).toBeVisible({
    timeout: 20_000,
  });
  const row = page.getByTestId(`all-activity-record:${MESSAGE_ID}`);
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expectWords(row, "Good to see you. The quiet part");
});

test("search finds a word inside a phrase and shows the words", async ({
  page,
}) => {
  await boot(page);
  await say(page);
  await page.getByTestId("open-search").click();
  await page.getByTestId("search-dialog-input").fill("quiet");
  const results = page.getByTestId("search-results");
  await expect(results).toContainText("Good to see you.", { timeout: 10_000 });
  await expectWords(results, "Good to see you. The quiet part");
});

test("a reply's quoted line holds the words", async ({ page }) => {
  await boot(page);
  await say(page);
  const row = messageRow(page);
  await row.hover();
  await row.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(page.getByTestId("reply-target")).toBeVisible();
  await page.getByTestId("message-input").fill("Glad you think so.");
  await page.getByTestId("send-message").click();
  const quote = page
    .getByTestId("message-row")
    .filter({ hasText: "Glad you think so." })
    .getByTestId("quoted-parent");
  await expect(quote).toBeVisible();
  await expectWords(quote, "Good to see you.");
});

test("desktop notifications carry the words", async ({ page }) => {
  await boot(page);
  await page.evaluate(
    ({ content, channelId, owner, sender }) => {
      const push = (
        window as Window & {
          __BUZZ_E2E_PUSH_MOCK_FEED_ITEM__?: (item: unknown) => unknown;
        }
      ).__BUZZ_E2E_PUSH_MOCK_FEED_ITEM__;
      if (!push) throw new Error("Expected the mock feed.");
      push({
        category: "mention",
        channel_id: channelId,
        channel_name: "general",
        content,
        created_at: Math.floor(Date.now() / 1000) + 5,
        id: "6f".repeat(32),
        kind: 9,
        pubkey: sender,
        tags: [
          ["h", channelId],
          ["p", owner],
        ],
      });
    },
    {
      content: CONTENT,
      channelId: GENERAL,
      owner: "deadbeef".repeat(8),
      sender: ALICE,
    },
  );
  await say(page, "alice-tyler", ALICE);
  const logged = () =>
    page.evaluate(
      () =>
        (
          window as Window & {
            __BUZZ_E2E_NOTIFICATIONS__?: { body: string | null }[];
          }
        ).__BUZZ_E2E_NOTIFICATIONS__ ?? [],
    );
  await expect.poll(async () => (await logged()).length).toBeGreaterThan(1);
  for (const { body } of await logged()) {
    clean(body);
    expect(body).toContain("Good to see you.");
  }
});

test("Copy message puts the words on the clipboard", async ({ page }) => {
  await boot(page);
  await say(page);
  await openActions(page);
  await page.getByRole("menuitem", { name: "Copy message" }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(WORDS);
});

test("reminders: saved as words, shown as words, old cut-off code reads clean", async ({
  page,
}) => {
  await boot(page);
  // The coloured phrase crosses the 100th character of the message.
  const long =
    "Here is a longer note, long enough that the coloured phrase lands right on the cut: [Good to see you again.](ink:warmth?hush) after.";
  await page.evaluate(
    ({ content, id, pubkey }) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        content,
        id,
        kind: 9,
        pubkey,
      });
    },
    { content: long, id: MESSAGE_ID, pubkey: LUCA },
  );
  expect(long.indexOf("](ink:")).toBeGreaterThan(100);
  expect(long.indexOf("[Good")).toBeLessThan(100);
  await openActions(page);
  await page.getByRole("menuitem", { name: "Remind me later" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "In 30 minutes" })
    .click();
  // What the reminder holds, as handed to encryption on its way to the relay.
  const saved = () =>
    page.evaluate(() =>
      (window.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? [])
        .filter((entry) => entry.command === "nip44_encrypt_to_self")
        .map(
          (entry) =>
            (
              JSON.parse(
                (entry.payload as { plaintext: string }).plaintext,
              ) as { target?: { preview: string } }
            ).target?.preview,
        ),
    );
  await expect.poll(saved).toHaveLength(1);
  const [preview] = await saved();
  expect(preview).toBe(
    "Here is a longer note, long enough that the coloured phrase lands right on the cut: Good to see you again. after.".slice(
      0,
      100,
    ),
  );
  expect(preview).not.toContain("[");

  // A reminder saved raw in the past, cut inside the address.
  await page.evaluate(() => {
    window.__BUZZ_E2E_SEED_MOCK_REMINDERS__?.([
      {
        id: "7a".repeat(32),
        pubkey: "deadbeef".repeat(8),
        created_at: Math.floor(Date.now() / 1000) - 300,
        kind: 30300,
        tags: [
          ["d", "rem-old-raw"],
          ["not_before", String(Math.floor(Date.now() / 1000) + 3600)],
        ],
        content: JSON.stringify({
          target: {
            eventId: "mock-general-welcome",
            channelId: "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50",
            preview: "An older one. [Good to see](ink:war",
            authorPubkey: "deadbeef".repeat(8),
          },
          status: "pending",
        }),
        sig: "mocksig".repeat(20).slice(0, 128),
      },
    ] as never);
    window.__BUZZ_E2E_QUERY_CLIENT__?.invalidateQueries({
      queryKey: ["reminders"],
    });
  });
  await page.goto("/#/inbox");
  await page.getByTestId("inbox-filter-trigger").click();
  await page.getByRole("menuitemradio", { name: "Reminders" }).click();
  const panel = page.getByTestId("home-inbox-reminders");
  await expect(panel).toContainText("An older one. Good to see");
  await waitForAnimations(page);
  clean(await panel.innerText());
});
