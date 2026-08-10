import { expect, test } from "@playwright/test";

import { installMockBridge } from "../../helpers/bridge";

const AGENTS_CHANNEL_ID = "94a444a4-c0a3-5966-ab05-530c6ddc2301";
const OWNED_AGENT_PUBKEY =
  "554cef57437abac34522ac2c9f0490d685b72c80478cf9f7ed6f9570ee8624ea";

test.beforeEach(async ({ page }) => {
  await installMockBridge(page, {
    managedAgents: [
      {
        channelNames: ["agents"],
        name: "Luca",
        pubkey: OWNED_AGENT_PUBKEY,
        status: "running",
      },
    ],
  });
});

test("manual native creation commits only after its review sheet", async ({
  page,
}) => {
  await page.goto("/?e2e=mock#/agents");
  await page.getByRole("button", { name: "Add agent", exact: true }).click();
  await page.getByRole("button", { name: "New Hermes agent…" }).click();

  await page.getByLabel("Name").fill("Researcher");
  await page
    .getByLabel("Purpose and instructions")
    .fill("Research product questions and preserve source attribution.");
  await page.getByRole("button", { name: "Review changes" }).click();
  await expect(
    page.getByRole("region", { name: "Provisioning review" }),
  ).toContainText("Hermes profile");

  let commands = await page.evaluate(() => window.__BUZZ_E2E_COMMANDS__ ?? []);
  expect(commands).toContain("preview_native_agent_provisioning");
  expect(commands).not.toContain("execute_native_agent_provisioning");

  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(
    page.getByRole("heading", { name: "Create a native agent" }),
  ).not.toBeVisible();
  commands = await page.evaluate(() => window.__BUZZ_E2E_COMMANDS__ ?? []);
  expect(commands).toContain("execute_native_agent_provisioning");
});

test("an owned Luca chat proposal uses the same native review sheet", async ({
  page,
}) => {
  await page.goto(`/?e2e=mock#/channels/${AGENTS_CHANNEL_ID}`);
  await page.waitForFunction(
    () => typeof window.__BUZZ_E2E_SEED_OBSERVER_EVENTS__ === "function",
  );
  await expect(page.getByRole("heading", { name: "agents" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Luca present/ }),
  ).toBeVisible();
  await page.waitForTimeout(100);
  await page.evaluate(
    ({ agentPubkey, channelId }) => {
      window.__BUZZ_E2E_SEED_OBSERVER_EVENTS__?.({
        agentPubkey,
        events: [
          {
            seq: 1,
            timestamp: new Date().toISOString(),
            kind: "agent_management_request",
            agentIndex: 0,
            channelId,
            sessionId: "operator-forge-session",
            turnId: "operator-forge-turn",
            payload: {
              type: "agent_management_request",
              action: "create",
              requestId: "operator-forge-request-1",
              request: {
                channelId,
                displayName: "Scout",
                systemPrompt:
                  "Investigate a question and report sourced findings.",
                requestedRuntimeFamily: "openclaw",
                provisioningIntent: "fresh",
              },
            },
          },
        ],
      });
    },
    { agentPubkey: OWNED_AGENT_PUBKEY, channelId: AGENTS_CHANNEL_ID },
  );

  await expect(
    page.getByRole("heading", { name: "Create a native agent" }),
  ).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("Scout");
  await expect(page.getByLabel("Runtime")).toHaveValue("openclaw");
  await page.getByRole("button", { name: "Review changes" }).click();
  await expect(
    page.getByRole("region", { name: "Provisioning review" }),
  ).toContainText("OpenClaw agent");
  await page.getByRole("button", { name: "Cancel" }).click();

  const commands = await page.evaluate(
    () => window.__BUZZ_E2E_COMMANDS__ ?? [],
  );
  expect(commands).toContain("preview_native_agent_provisioning");
  expect(commands).not.toContain("execute_native_agent_provisioning");
});
