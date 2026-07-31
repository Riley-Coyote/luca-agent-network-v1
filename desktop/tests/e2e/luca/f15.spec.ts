import { expect, test } from "@playwright/test";

import { installMockBridge } from "../../helpers/bridge";

const READY_RUNTIME = {
  id: "buzz-agent",
  label: "Luca Runtime",
  avatar_url: "",
  availability: "available",
  command: "buzz-agent",
  binary_path: "/synthetic/bin/buzz-agent",
  default_args: [],
  mcp_command: null,
  model_env_var: null,
  provider_env_var: null,
  thinking_env_var: null,
  install_hint: "Included with Luca",
  install_instructions_url: "https://example.invalid/luca-runtime",
  can_auto_install: false,
  underlying_cli_path: null,
  node_required: false,
  auth_status: { status: "not_applicable" },
  login_hint: null,
};

const RESIDENT_PERSONAS = ["Luca", "Mara", "Sol"].map((displayName) => ({
  id: `persona:${displayName.toLowerCase()}`,
  displayName,
  systemPrompt: `Synthetic instructions for ${displayName}.`,
  runtime: "buzz-agent",
  model: `fixture-${displayName.toLowerCase()}`,
  provider: "fixture-provider",
  isActive: true,
}));

test.use({ viewport: { width: 1100, height: 760 } });

async function openAgents(page: import("@playwright/test").Page) {
  await page.goto("/");
  const trigger = page.getByTestId("open-agents-view");
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(page.getByTestId("luca-resident-setup")).toBeVisible();
}

test("F15: three residents are created through the key-safe Luca boundary", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await installMockBridge(page, {
    acpRuntimesCatalog: [READY_RUNTIME],
    personas: RESIDENT_PERSONAS,
  });
  await openAgents(page);

  const setup = page.getByTestId("luca-resident-setup");
  await expect(setup).toBeVisible();
  await expect(setup).toContainText("independent cryptographic identity");
  await expect(page.getByTestId("resident-ready-count")).toContainText(
    "0 of 0 ready",
  );

  for (const [index, persona] of RESIDENT_PERSONAS.entries()) {
    await page
      .getByRole("button", {
        name: `Add ${persona.displayName} as resident`,
      })
      .click();
    await expect(page.getByTestId("resident-ready-count")).toContainText(
      `${index + 1} of ${index + 1} ready`,
    );
    await expect(
      page.getByTestId(`resident-identity-${persona.id}`),
    ).toContainText("…");
  }

  const commands = await page.evaluate(
    () =>
      (
        window as Window & {
          __BUZZ_E2E_COMMAND_LOG__?: Array<{
            command: string;
            payload: unknown;
          }>;
        }
      ).__BUZZ_E2E_COMMAND_LOG__ ?? [],
  );
  expect(
    commands.filter(({ command }) => command === "create_luca_resident"),
  ).toHaveLength(3);
  expect(
    commands.filter(({ command }) => command === "create_managed_agent"),
  ).toHaveLength(0);
  expect(JSON.stringify(commands)).not.toContain("nsec1mock");

  const retry = await page.evaluate(async () => {
    const testWindow = window as Window & {
      __BUZZ_E2E_COMMAND_LOG__?: Array<{
        command: string;
        payload: Record<string, unknown>;
      }>;
      __BUZZ_E2E_INVOKE_MOCK_COMMAND__?: (
        command: string,
        payload?: Record<string, unknown>,
      ) => Promise<unknown>;
    };
    const firstCreate = testWindow.__BUZZ_E2E_COMMAND_LOG__?.find(
      ({ command }) => command === "create_luca_resident",
    );
    if (!firstCreate || !testWindow.__BUZZ_E2E_INVOKE_MOCK_COMMAND__) {
      throw new Error("resident test command bridge is unavailable");
    }
    return testWindow.__BUZZ_E2E_INVOKE_MOCK_COMMAND__(
      "create_luca_resident",
      firstCreate.payload,
    );
  });
  expect(retry).toMatchObject({ reused: true });

  const registry = await page.evaluate(async () => {
    const invoke = (
      window as Window & {
        __BUZZ_E2E_INVOKE_MOCK_COMMAND__?: (
          command: string,
        ) => Promise<unknown>;
      }
    ).__BUZZ_E2E_INVOKE_MOCK_COMMAND__;
    if (!invoke) throw new Error("resident test command bridge is unavailable");
    return invoke("list_luca_residents");
  });
  expect(registry).toMatchObject({
    schema: "luca.resident-registry.v1",
    residents: expect.arrayContaining([
      expect.objectContaining({
        displayName: "Luca",
        status: "running",
        runtime: expect.objectContaining({
          runtimeCommand: "buzz-agent",
          providerId: "fixture-provider",
          modelId: "fixture-luca",
        }),
      }),
    ]),
  });
  expect((registry as { residents: unknown[] }).residents).toHaveLength(3);
  expect(JSON.stringify(registry).toLowerCase()).not.toMatch(
    /private|nsec|secret|system_prompt|env_vars/,
  );
  await expect(page.getByRole("dialog", { name: "Agent created" })).toHaveCount(
    0,
  );
  await expect(page.getByText("Private key (nsec)")).toHaveCount(0);
  await expect(setup).not.toContainText(/conductor/i);
  expect(consoleErrors).toEqual([]);
});

test("F15: setup exposes persisted public identity and replaceable bindings", async ({
  page,
}) => {
  const pubkey = "d".repeat(64);
  await installMockBridge(page, {
    managedAgents: [
      {
        pubkey,
        name: "Luca",
        personaId: "persona:luca",
        status: "stopped",
      },
    ],
    personas: RESIDENT_PERSONAS,
  });
  await openAgents(page);

  await expect(page.getByTestId("resident-ready-count")).toContainText(
    "0 of 1 ready",
  );
  const luca = page.getByTestId("resident-option-persona:luca");
  await expect(luca).toContainText("Resident stopped");
  await expect(luca).toContainText("dddddddd…dddddd");
  await expect(luca).toContainText("buzz-agent");
  await expect(luca).toContainText("fixture-provider");
  await expect(luca).toContainText("fixture-luca");
  await expect(
    page.getByRole("button", { name: "Add Luca as resident" }),
  ).toHaveCount(0);
});
