import { expect, test } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";

const PROJECT_ID = "project-website-launch";
const AGENT = {
  pubkey: TEST_IDENTITIES.alice.pubkey,
  name: "Maya",
  status: "running" as const,
  channelNames: ["alice-tyler"],
};

async function openSeededApp(page: import("@playwright/test").Page) {
  await installMockBridge(page, {
    managedAgents: [AGENT],
    projects: [
      {
        id: PROJECT_ID,
        name: "Website launch",
        instructions: "Keep launch work coordinated and ready to ship.",
        workingFolder: "/mock/website-launch",
      },
    ],
    channelProjects: { "alice-tyler": PROJECT_ID },
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("sidebar-agents-section")).toBeVisible();
  await expect(page.getByTestId("sidebar-projects-section")).toBeVisible();
}

test.describe("Luca chat collections", () => {
  test("Agent and Project collections reference the same canonical chat", async ({
    page,
  }) => {
    await openSeededApp(page);

    await page.getByTestId(`agent-row-${AGENT.pubkey}`).click();
    const panel = page.getByTestId("luca-collection-panel");
    await expect(panel).toContainText("Maya");
    await expect(panel).toContainText("alice");

    await page.getByTestId(`project-row-${PROJECT_ID}`).click();
    await expect(panel).toContainText("Website launch");
    await expect(panel).toContainText("Folder connected");
    const chat = panel.getByTestId(
      "collection-chat-f48efb06-0c93-5025-aac9-2e646bb6bfa8",
    );
    await expect(chat).toBeVisible();
    await chat.click();
    await expect(page).toHaveURL(
      /channels\/f48efb06-0c93-5025-aac9-2e646bb6bfa8/,
    );
  });

  test("wide and narrow collection layouts stay within the current shell", async ({
    page,
  }, testInfo) => {
    await openSeededApp(page);
    await page.getByTestId(`agent-row-${AGENT.pubkey}`).click();
    await expect(page.getByTestId("luca-collection-panel")).toContainText(
      "Maya",
    );
    await waitForAnimations(page);
    await page.screenshot({
      path: testInfo.outputPath("luca-agent-collection-wide.png"),
    });

    await page.getByTestId(`project-row-${PROJECT_ID}`).click();
    await expect(page.getByTestId("luca-collection-panel")).toContainText(
      "Website launch",
    );
    await waitForAnimations(page);
    await page.screenshot({
      path: testInfo.outputPath("luca-project-collection-wide.png"),
    });

    await page.setViewportSize({ width: 720, height: 900 });
    await waitForAnimations(page);
    await page.screenshot({
      path: testInfo.outputPath("luca-project-collection-narrow.png"),
    });
  });
});
