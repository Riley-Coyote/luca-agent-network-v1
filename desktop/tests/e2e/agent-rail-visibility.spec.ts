import { expect, type Page, test } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../helpers/features";

const LUCA = "a".repeat(64);
const VEKTOR = "b".repeat(64);
const ANIMA = "c".repeat(64);
const MIRA = "d".repeat(64);
const CODA = "e".repeat(64);
const agents = [
  { name: "Luca", pubkey: LUCA, personaId: "builtin:fizz" },
  { name: "Vektor", pubkey: VEKTOR, personaId: "builtin:honey" },
  { name: "Anima", pubkey: ANIMA, personaId: "builtin:bumble" },
  { name: "Mira", pubkey: MIRA, personaId: "builtin:mira" },
  { name: "Coda", pubkey: CODA, personaId: "builtin:coda" },
];
const home = (pubkey: string) => `rail-home-agent:${pubkey}`;

async function boot(page: Page, light = false) {
  await page.emulateMedia({
    colorScheme: light ? "light" : "dark",
    reducedMotion: "reduce",
  });
  await page.addInitScript(
    ({ key, light }) => {
      localStorage.setItem(key, JSON.stringify({ "shell-frame": true }));
      localStorage.setItem("buzz-theme", light ? "paper" : "vitesse-black");
      localStorage.setItem("buzz-follow-system", "false");
    },
    { key: FEATURE_OVERRIDES_STORAGE_KEY, light },
  );
  await installMockBridge(page, {
    managedAgents: agents.map((agent) => ({ ...agent, status: "running" })),
    personas: agents.map((agent) => ({
      id: agent.personaId,
      displayName: agent.name,
      systemPrompt: "A test resident.",
      runtime: "claude",
    })),
  });
  await page.goto("/#/");
  await expect(page.locator("[data-shell-rail]")).toBeVisible();
  await expect(page.getByTestId("message-input")).toBeVisible();
  await waitForAnimations(page);
}

test("core defaults, manual visibility, persistence and direct chat reveal", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await boot(page);
  await expect(page.getByTestId(home(VEKTOR))).toBeVisible();
  await expect(page.getByTestId(home(ANIMA))).toBeVisible();
  await expect(page.getByTestId(home(MIRA))).toHaveCount(0);
  await expect(page.getByTestId(home(CODA))).toHaveCount(0);

  // Agents lists everyone, even those omitted from Chats.
  await page.getByTestId("rail-browse-agents").click();
  await expect(page.getByTestId(`place-row-mind:${MIRA}`)).toBeVisible();
  await expect(page.getByTestId(`place-row-mind:${CODA}`)).toBeVisible();
  await page.goto(`/#/agents?profile=${MIRA}&page=settings`);
  const show = page.getByTestId("agent-show-in-chats");
  await expect(show).not.toBeChecked();
  await show.click();
  await expect(show).toBeChecked();
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/agent-rail-visibility/agent-setting.png",
  });
  await page.goto("/#/");
  await expect(page.getByTestId(home(MIRA))).toBeVisible();
  await page.reload();
  await expect(page.getByTestId(home(MIRA))).toBeVisible();

  // Removing a row is not removing an agent or its conversations.
  await page.getByTestId(home(MIRA)).click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Remove from Chats", exact: true })
    .click();
  await expect(page.getByTestId(home(MIRA))).toHaveCount(0);
  await page.goto(`/#/agents?profile=${MIRA}`);
  await page.getByTestId("mind-talk").click();
  await expect(page.getByTestId(home(MIRA))).toBeVisible();
  await expect(page.getByTestId(home(CODA))).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("an explicit owner tag reveals a specialist only after sending", async ({
  page,
}) => {
  await boot(page);
  await page.goto("/#/channels/9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50");
  const input = page.getByTestId("message-input");
  await input.fill("Hello @Cod");
  await page
    .getByTestId("mention-autocomplete")
    .getByText("Coda", { exact: true })
    .click();
  await expect(page.getByTestId(home(CODA))).toHaveCount(0);
  await input.press("Enter");
  await expect(page.getByTestId(home(CODA))).toBeVisible();
  await expect(page.getByTestId(home(MIRA))).toHaveCount(0);
});

for (const light of [false, true]) {
  test(`quiet rail stays readable at desktop widths — ${light ? "day" : "night"}`, async ({
    page,
  }) => {
    await boot(page, light);
    for (const width of [1440, 1280, 1024, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await waitForAnimations(page);
      await page.screenshot({
        path: `test-results/agent-rail-visibility/${light ? "day" : "night"}-${width}.png`,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  });
}
