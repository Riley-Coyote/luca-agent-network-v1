import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../../helpers/bridge";

/**
 * Luca creates a specialist end to end, with the owner's chat answer as the
 * consent. There is no creation window: the moment the owner agrees, the
 * resident's record exists and it appears in the rail — saying "Waking…",
 * because its process, profile and conversation are still being set up. When
 * the bring-up finishes the word goes away. If it fails, the row says so
 * rather than looking ordinary.
 */

const LUCA_PUBKEY = "a".repeat(64);
const CONSENT_EVENT_ID = "c".repeat(64);

type CreatedResident = { resident: { residentPubkey: string } };

test.beforeEach(async ({ page }) => {
  await installMockBridge(page, {
    managedAgents: [{ name: "Luca", pubkey: LUCA_PUBKEY, status: "running" }],
  });
  await page.addInitScript(() => {
    window.__BUZZ_E2E_LUCA_RESIDENT_WAKES_AFTER_CREATE__ = true;
  });
  await page.goto("/?e2e=mock");
  await expect(page.getByTestId("agent-rail-luca")).toBeVisible();
});

/**
 * What the native consent path does once it has verified the owner's agreeing
 * message: create the definition's resident without waiting for its process.
 */
async function createOnConsent(page: Page) {
  return page.evaluate(
    async ({ consentEventId }) => {
      // The definition first, exactly as the consent path writes it: the
      // runtime and the exact model the owner named.
      const persona = (await window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.(
        "create_persona",
        {
          input: {
            displayName: "Vektor",
            model: "gpt-5.6-sol",
            runtime: "codex",
            systemPrompt: "Research the assigned project.",
          },
        },
      )) as { id: string };
      const created = (await window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.(
        "create_luca_resident",
        {
          input: {
            name: "Vektor",
            personaId: persona.id,
            systemPrompt: "Research the assigned project.",
            acpCommand: "buzz-acp",
            agentCommand: "codex",
            agentArgs: ["acp"],
            model: "gpt-5.6-sol",
            harnessOverride: true,
            parallelism: 1,
            // The record must exist before the call returns; the process is
            // started afterwards, which is what "waking" means.
            spawnAfterCreate: false,
            startOnAppLaunch: true,
            backend: { type: "local" },
            consentEventId,
          },
        },
      )) as { resident: { residentPubkey: string } };
      return created;
    },
    { consentEventId: CONSENT_EVENT_ID },
  );
}

test("a resident the owner agreed to in chat appears at once, waking, then ready", async ({
  page,
}) => {
  const created: CreatedResident = await createOnConsent(page);
  const residentPubkey = created.resident.residentPubkey;

  const row = page.getByTestId("agent-rail-vektor");
  await expect(row).toBeVisible();
  await expect(page.getByTestId("agent-rail-status-vektor")).toHaveText(
    "Waking…",
  );
  await expect(row).toHaveAttribute("aria-label", "Vektor, Waking");
  // No creation window opened for any of this: the answer in chat was the
  // review.
  await expect(page.getByTestId("persona-dialog")).toHaveCount(0);

  await page.evaluate(
    (pubkey) => window.__BUZZ_E2E_SETTLE_RESIDENT_WAKE__?.({ pubkey }),
    residentPubkey,
  );

  await expect(page.getByTestId("agent-rail-status-vektor")).toHaveCount(0);
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("aria-label", "Vektor");
});

test("a bring-up that fails says so on the row instead of looking ordinary", async ({
  page,
}) => {
  const created: CreatedResident = await createOnConsent(page);
  await expect(page.getByTestId("agent-rail-status-vektor")).toHaveText(
    "Waking…",
  );

  await page.evaluate(
    (pubkey) =>
      window.__BUZZ_E2E_SETTLE_RESIDENT_WAKE__?.({
        error: "codex is not signed in",
        pubkey,
      }),
    created.resident.residentPubkey,
  );

  await expect(page.getByTestId("agent-rail-status-vektor")).toHaveText(
    "Needs attention",
  );
});

test("an ordinary running resident's row carries no bring-up word", async ({
  page,
}) => {
  await expect(page.getByTestId("agent-rail-status-luca")).toHaveCount(0);
});
