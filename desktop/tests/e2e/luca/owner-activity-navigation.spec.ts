import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";

const CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const RESIDENTS = [
  {
    channelNames: ["general"],
    name: "Anima",
    pubkey: TEST_IDENTITIES.bob.pubkey,
    status: "stopped" as const,
  },
  {
    channelNames: ["general"],
    name: "Vektor",
    pubkey: TEST_IDENTITIES.alice.pubkey,
    status: "running" as const,
  },
] as const;

async function openActivity(page: Page) {
  await installMockBridge(page, { managedAgents: [...RESIDENTS] });
  await page.goto("/?e2e=mock");
  await page.getByTestId("open-activity-view").click();
  await expect(page).toHaveURL(/\/pulse$/);
  await expect(page.getByTestId("owner-activity-view")).toBeVisible();
  await page.waitForTimeout(300);
}

async function captureActivity(page: Page, testInfo: TestInfo, name: string) {
  // View-transition pseudo-elements are not consistently exposed through
  // document.getAnimations(); wait past Luca's longest navigation transition
  // before collecting visual evidence.
  await page.waitForTimeout(450);
  await waitForAnimations(page);
  await expectActivityScrollAtRest(page);
  await expect
    .poll(() =>
      page.getByTestId("owner-activity-scroll").evaluate((element) => {
        const heading = element.querySelector("h1");
        if (!(heading instanceof HTMLElement)) return null;
        return Math.round(
          heading.getBoundingClientRect().top -
            element.getBoundingClientRect().top,
        );
      }),
    )
    .toBeGreaterThanOrEqual(24);
  const evidenceDirectory = process.env.LUCA_VISUAL_EVIDENCE_DIR?.trim();
  await page.screenshot({
    animations: "allow",
    path: evidenceDirectory
      ? `${evidenceDirectory}/${name}.png`
      : testInfo.outputPath(`${name}.png`),
  });
  await expectActivityScrollAtRest(page);
}

async function expectActivityScrollAtRest(page: Page) {
  await expect
    .poll(() =>
      page.getByTestId("owner-activity-scroll").evaluate((element) => {
        const scrolled: Array<{
          className: string;
          scrollTop: number;
          tagName: string;
          testId: string | null;
        }> = [];
        let current: HTMLElement | null = element;
        while (current) {
          if (Math.abs(current.scrollTop) > 1) {
            scrolled.push({
              className: current.className,
              scrollTop: current.scrollTop,
              tagName: current.tagName,
              testId: current.getAttribute("data-testid"),
            });
          }
          current = current.parentElement;
        }
        const documentScroll = document.scrollingElement?.scrollTop ?? 0;
        if (Math.abs(documentScroll) > 1) {
          scrolled.push({
            className: "",
            scrollTop: documentScroll,
            tagName: "DOCUMENT",
            testId: null,
          });
        }
        return scrolled;
      }),
    )
    .toEqual([]);
}

test("Activity shows deterministic truthful resident state without legacy Pulse records", async ({
  page,
}, testInfo) => {
  await openActivity(page);

  const list = page.getByTestId("owner-activity-list");
  await expect(list).toBeVisible();
  const anima = page.getByTestId(
    `owner-activity-resident-${TEST_IDENTITIES.bob.pubkey}`,
  );
  const vektor = page.getByTestId(
    `owner-activity-resident-${TEST_IDENTITIES.alice.pubkey}`,
  );
  await expect(anima).toContainText("Anima");
  await expect(vektor).toContainText("Vektor");
  await expect
    .poll(() =>
      page.evaluate(
        ([animaId, vektorId]) => {
          const cards = [
            ...document.querySelectorAll(
              "[data-testid^='owner-activity-resident-']",
            ),
          ];
          return (
            cards.findIndex(
              (card) => card.getAttribute("data-testid") === animaId,
            ) <
            cards.findIndex(
              (card) => card.getAttribute("data-testid") === vektorId,
            )
          );
        },
        [
          `owner-activity-resident-${TEST_IDENTITIES.bob.pubkey}`,
          `owner-activity-resident-${TEST_IDENTITIES.alice.pubkey}`,
        ],
      ),
    )
    .toBe(true);
  await expect(list).toContainText("Runtime stopped");
  await expect(list).toContainText("Runtime ready");
  await expect(page.getByTestId("owner-activity-empty-history")).toBeVisible();
  await expect(page.getByTestId("owner-activity-group-idle")).toBeVisible();
  await expect(page.getByTestId("owner-activity-group-active")).toBeHidden();
  await expect(page.getByTestId("owner-activity-group-recent")).toBeHidden();
  await expect(page.getByText("No recorded activity")).toHaveCount(0);
  await expect(page.getByText("Everyone", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Liked", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: /post/i })).toHaveCount(0);
  await captureActivity(page, testInfo, "01-activity-quiet");
});

test("Activity projects working and completed or failed resident updates without bodies", async ({
  page,
}, testInfo) => {
  await openActivity(page);
  await page.waitForFunction(
    () => typeof window.__BUZZ_E2E_SEED_ACTIVE_TURNS__ === "function",
  );
  await page.evaluate(
    ({ channelId, pubkey }) => {
      window.__BUZZ_E2E_SEED_ACTIVE_TURNS__?.({
        agentPubkey: pubkey,
        channelId,
        turnId: "activity-turn",
      });
      window.__BUZZ_E2E_SEED_ACTIVE_TURNS__?.({
        agentPubkey: pubkey,
        channelId,
        turnId: "activity-turn",
        kind: "acp_read",
        payload: {
          method: "session/update",
          params: {
            update: {
              kind: "search",
              sessionUpdate: "tool_call",
              toolCallId: "activity-tool",
              title: "Sensitive owner query must not appear",
            },
          },
        },
      });
    },
    { channelId: CHANNEL_ID, pubkey: TEST_IDENTITIES.alice.pubkey },
  );

  const resident = page.getByTestId(
    `owner-activity-resident-${TEST_IDENTITIES.alice.pubkey}`,
  );
  await expect(resident).toHaveAttribute("data-activity-state", "working");
  await expect(resident).toContainText("Working now");
  await expect(resident).not.toContainText("Sensitive owner query");
  await expect(page.getByTestId("owner-activity-empty-history")).toBeHidden();
  await expect(page.getByTestId("owner-activity-group-active")).toBeVisible();
  await expectActivityScrollAtRest(page);
  await captureActivity(page, testInfo, "02-activity-active");

  await page.evaluate(
    ({ channelId, pubkey }) => {
      window.__BUZZ_E2E_SEED_ACTIVE_TURNS__?.({
        agentPubkey: pubkey,
        channelId,
        turnId: "activity-turn",
        kind: "acp_read",
        payload: {
          method: "session/update",
          params: {
            update: {
              kind: "search",
              sessionUpdate: "tool_call_update",
              status: "completed",
              toolCallId: "activity-tool",
            },
          },
        },
      });
      window.__BUZZ_E2E_SEED_ACTIVE_TURNS__?.({
        agentPubkey: pubkey,
        channelId,
        turnId: "activity-turn",
        kind: "turn_completed",
      });
    },
    { channelId: CHANNEL_ID, pubkey: TEST_IDENTITIES.alice.pubkey },
  );
  await expect(resident).toHaveAttribute("data-activity-state", "success");
  await expect(resident).toContainText("Action completed");
  await expect(page.getByTestId("owner-activity-group-active")).toBeHidden();
  await expect(page.getByTestId("owner-activity-group-recent")).toBeVisible();
  await expectActivityScrollAtRest(page);
  await captureActivity(page, testInfo, "03-activity-recent");
});

test("Activity survives reload and opens the existing protected activity destination", async ({
  page,
}) => {
  await openActivity(page);
  await page.reload();
  await expect(page.getByTestId("owner-activity-view")).toBeVisible();
  await expect(
    page.getByTestId(`owner-activity-resident-${TEST_IDENTITIES.bob.pubkey}`),
  ).toContainText("Anima");
  await expect(
    page.getByTestId(`owner-activity-resident-${TEST_IDENTITIES.alice.pubkey}`),
  ).toContainText("Vektor");

  const resident = page.getByTestId(
    `owner-activity-resident-${TEST_IDENTITIES.alice.pubkey}`,
  );
  await resident.getByRole("button", { name: "Open activity" }).click();
  await expect(page).toHaveURL(
    new RegExp(
      `/channels/${CHANNEL_ID}\\?agentSession=${TEST_IDENTITIES.alice.pubkey}`,
    ),
  );
  const activityPanel = page.getByRole("complementary");
  await expect(activityPanel).toBeVisible();
  await expect(activityPanel).toHaveAttribute(
    "data-testid",
    "agent-session-thread-panel",
  );

  await page.reload();
  const restoredActivityPanel = page.getByRole("complementary");
  await expect(restoredActivityPanel).toBeVisible();
  await expect(restoredActivityPanel).toHaveAttribute(
    "data-testid",
    "agent-session-thread-panel",
  );
});
