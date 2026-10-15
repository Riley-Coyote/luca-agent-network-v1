import { expect, test } from "@playwright/test";
import { installMockBridge } from "../../helpers/bridge";
import { waitForAnimations } from "../../helpers/animations";
const LUCA = "a".repeat(64),
  ATLAS = "b".repeat(64),
  LOWER = "c".repeat(64);
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => console.log("PAGE ERROR", error.message));
  page.on("console", (message) => {
    if (message.type() === "error")
      console.log("BROWSER ERROR", message.text());
  });
  await installMockBridge(page, {
    managedAgents: [
      {
        name: "Luca",
        pubkey: LUCA,
        personaId: "builtin:fizz",
        status: "running",
      },
      {
        name: "Atlas",
        pubkey: ATLAS,
        status: "running",
        channelNames: ["engineering", "general"],
      },
      { name: "luca", pubkey: LOWER, status: "running" },
    ],
  });
  await page.goto("/?e2e=mock");
  await expect(page.getByTestId("agent-rail-atlas")).toBeVisible({
    timeout: 20000,
  });
});

test("primary Luca has its own direct row and same-name identities remain distinct", async ({
  page,
}) => {
  const primary = page.getByTestId("primary-companion").getByRole("button");
  await expect(primary).toHaveCount(1);
  await expect(primary).not.toHaveAttribute("aria-expanded");
  const lower = page
    .locator(`[data-agent-pubkey="${LOWER}"]`)
    .getByRole("button");
  await expect(lower).toHaveAttribute("aria-expanded", "false");
  expect((await primary.boundingBox())?.y ?? Infinity).toBeLessThan(
    (await page.getByTestId("agent-rail-atlas").boundingBox())?.y ?? -Infinity,
  );
  await primary.dblclick();
  await expect(page).toHaveURL(/#\/channels\//);
  const canonical = new URL(page.url()).hash;
  await page.getByTestId("open-agents-view").click();
  await primary.click();
  await expect.poll(() => new URL(page.url()).hash).toBe(canonical);
  await expect(page.getByTestId("agent-chats-column")).toHaveCount(0);
  await expect(primary).toHaveAttribute("aria-current", "page");
});

test("inline sessions switch directly, persist expansion and support keyboard collapse", async ({
  page,
}) => {
  const agent = page.getByTestId("agent-rail-atlas");
  await agent.press("ArrowRight");
  const sessions = page.getByRole("group", { name: "Sessions with Atlas" });
  await expect(sessions).toBeVisible();
  await sessions.getByRole("button", { name: /^engineering/ }).click();
  await expect(page.getByTestId("chat-title")).toHaveText("engineering");
  await sessions.getByRole("button", { name: /^general/ }).click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await page.getByTestId("open-agents-view").click();
  await expect(sessions).toBeVisible();
  await page.reload();
  await expect(sessions).toBeVisible();
  await sessions.getByRole("button", { name: /^general/ }).press("ArrowLeft");
  await expect(agent).toBeFocused();
  await expect(sessions).toHaveCount(0);
  await page.reload();
  await expect(agent).toHaveAttribute("aria-expanded", "false");
});

test("non-primary sessions are private, distinct and immediately selectable", async ({
  page,
}) => {
  await page.getByTestId("agent-rail-atlas").click();
  const sessions = page.getByRole("group", { name: "Sessions with Atlas" });
  for (const title of [
    "First design session",
    "A very long second session title for checking truncation in a narrow rail",
  ]) {
    await sessions
      .getByRole("button", { name: "New session", exact: true })
      .click();
    await page.getByLabel("Session name").fill(title);
    await page
      .getByRole("button", { name: "Start session", exact: true })
      .click();
    await expect(page.getByTestId("chat-title")).toHaveText(title);
    await expect(
      sessions.getByRole("button", { name: new RegExp(`^${title}`) }),
    ).toBeVisible();
  }
  await sessions.getByRole("button", { name: /^First design session/ }).click();
  await expect(page.getByTestId("chat-title")).toHaveText(
    "First design session",
  );
  const rows = await page.evaluate(async () =>
    window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.("get_channels"),
  );
  const created = (
    rows as Array<{ name: string; visibility: string; id: string }>
  ).filter((row) => row.name.includes("session"));
  expect(created).toHaveLength(2);
  expect(new Set(created.map((row) => row.id)).size).toBe(2);
  expect(created.every((row) => row.visibility === "private")).toBe(true);
  await waitForAnimations(page);
  await page.screenshot({ path: "test-results/inline-agent-sessions.png" });
});

test("Luca Quick Chat reuses main conversation and preserves separate drafts", async ({
  page,
}) => {
  const primary = page.getByTestId("primary-companion").getByRole("button");
  await primary.click();
  await expect(page).toHaveURL(/#\/channels\//);
  const id = new URL(page.url()).hash.split("/").pop();
  const composer = page.locator('[contenteditable="true"]').first();
  await composer.fill("Main conversation draft");
  await page.getByTestId("quickchat-launcher").click();
  await page.getByTestId("quickchat-input").fill("Quick Chat draft");
  await page
    .getByRole("button", { name: "Quick Chat options", exact: true })
    .click();
  await expect(page.getByTestId("quickchat-new-chat")).toHaveCount(0);
  await page.getByTestId("quickchat-open-full").click();
  await expect.poll(() => new URL(page.url()).hash.split("/").pop()).toBe(id);
  await expect(composer).toHaveText("Main conversation draft");
  await page.getByTestId("quickchat-launcher").click();
  await expect(page.getByTestId("quickchat-input")).toHaveValue(
    "Quick Chat draft",
  );
});

test("phone keeps sessions inline and closes the sheet after selection", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Toggle Sidebar" }).first().click();
  await page.getByTestId("agent-rail-atlas").click();
  const sessions = page.getByRole("group", { name: "Sessions with Atlas" });
  await expect(sessions).toBeVisible();
  await sessions.getByRole("button", { name: /^engineering/ }).click();
  await expect(
    page.getByRole("dialog", { name: "Sidebar", exact: true }),
  ).toBeHidden();
  await expect(page.getByTestId("chat-title")).toHaveText("engineering");
  await expect(page.getByTestId("agent-chats-column")).toHaveCount(0);
});

test("narrow rail contains long titles without horizontal scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.getByTestId("agent-rail-atlas").click();
  const sessions = page.getByRole("group", { name: "Sessions with Atlas" });
  await sessions
    .getByRole("button", { name: "New session", exact: true })
    .click();
  await page
    .getByLabel("Session name")
    .fill(
      "A very long session title that should never widen the main navigation rail",
    );
  await page
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await expect(page.getByTestId("chat-title")).toContainText(
    "A very long session",
  );
  const handle = page.getByRole("button", {
    name: "Resize or toggle sidebar",
    exact: true,
  });
  const box = await handle.boundingBox();
  if (!box) throw new Error("Missing resize handle");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(194, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await waitForAnimations(page);
  const geometry = await sessions.evaluate((el) => ({
    width: el.clientWidth,
    content: el.scrollWidth,
    x: el.getBoundingClientRect().x,
  }));
  expect(geometry.content).toBeLessThanOrEqual(geometry.width + 1);
  expect(geometry.x).toBeGreaterThanOrEqual(0);
  await expect(page.getByTestId("agent-chats-column")).toHaveCount(0);
  await page.screenshot({
    path: "test-results/inline-agent-sessions-narrow.png",
  });
});

test("earlier Luca Quick Chat and its unsent draft remain accessible", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const key = `luca:quickchat:v1:${encodeURIComponent(localStorage.getItem("buzz-active-community-id") ?? "default")}:${"deadbeef".repeat(8)}`;
    localStorage.setItem(
      key,
      JSON.stringify({
        selectedPubkey: "a".repeat(64),
        rooms: {
          ["a".repeat(64)]: {
            channelId: "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50",
            ready: true,
            draft: "Keep this earlier unsent draft",
          },
        },
      }),
    );
  });
  await page.reload();
  await page.getByTestId("quickchat-launcher").click();
  await page
    .getByRole("button", { name: "Quick Chat options", exact: true })
    .click();
  await page.getByText("Earlier Quick Chat", { exact: true }).click();
  await expect(page.getByLabel("Earlier unsent draft")).toHaveValue(
    "Keep this earlier unsent draft",
  );
  await expect(page.getByTestId("quickchat-input")).toHaveValue("");
  await expect(page.getByTestId("quickchat-new-chat")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Open earlier conversation", exact: true })
    .click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
});
