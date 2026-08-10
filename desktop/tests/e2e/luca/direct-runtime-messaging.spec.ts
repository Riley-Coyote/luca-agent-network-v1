import { expect, test } from "@playwright/test";

import { installMockBridge } from "../../helpers/bridge";

function readyRuntime(id: "claude" | "codex", label: string) {
  return {
    id,
    label,
    avatar_url: "",
    availability: "available",
    command: `${id}-acp`,
    binary_path: `/fixture/${id}-acp`,
    default_args: ["--acp"],
    mcp_command: `${id} mcp serve`,
    model_env_var: null,
    provider_env_var: null,
    thinking_env_var: null,
    install_hint: `Install ${label}`,
    install_instructions_url: "https://example.invalid/runtime",
    can_auto_install: false,
    underlying_cli_path: null,
    node_required: false,
    auth_status: { status: "logged_in" },
    login_hint: null,
  };
}

async function commandLog(page: import("@playwright/test").Page) {
  return page.evaluate(
    () =>
      (
        window as Window & {
          __BUZZ_E2E_COMMAND_LOG__?: Array<{
            command: string;
            payload: Record<string, unknown>;
          }>;
        }
      ).__BUZZ_E2E_COMMAND_LOG__ ?? [],
  );
}

async function openNewMessage(page: import("@playwright/test").Page) {
  if (await page.getByTestId("new-message-page").isVisible()) return;
  await page.getByTestId("open-new-conversation").click();
  await expect(page.getByTestId("new-message-page")).toBeVisible();
}

for (const runtime of [
  {
    id: "claude" as const,
    label: "Claude Code",
    personaId: "builtin:direct-runtime:claude",
  },
  {
    id: "codex" as const,
    label: "Codex",
    personaId: "builtin:direct-runtime:codex",
  },
]) {
  test(`messages ${runtime.label} directly and materializes one stable resident`, async ({
    page,
  }) => {
    await installMockBridge(page, {
      acpRuntimesCatalog: [readyRuntime(runtime.id, runtime.label)],
    });
    await page.goto("/");
    await openNewMessage(page);

    const contact = page.getByTestId(`direct-runtime-contact-${runtime.id}`);
    await expect(contact).toContainText(runtime.label);
    await expect(contact).toContainText("Ready");
    await contact.click({ force: true });

    const selected = page.locator("button[data-testid^='new-dm-selected-']");
    await expect(selected).toHaveCount(1);
    await expect(selected).toHaveAttribute(
      "aria-label",
      `Remove ${runtime.label}`,
    );

    const commands = await commandLog(page);
    expect(
      commands.filter(({ command }) => command === "set_persona_active"),
    ).toContainEqual({
      command: "set_persona_active",
      payload: { id: runtime.personaId, active: true },
    });
    const creations = commands.filter(
      ({ command }) => command === "create_luca_resident",
    );
    expect(creations).toHaveLength(1);
    expect(creations[0]?.payload).toMatchObject({
      input: {
        name: runtime.label,
        personaId: runtime.personaId,
        agentCommand: `${runtime.id}-acp`,
        spawnAfterCreate: true,
      },
    });

    await page
      .getByTestId("message-input")
      .fill(`Hello ${runtime.label}, check this project.`);
    await page.getByTestId("send-message").click();
    await expect(page.getByTestId("chat-title")).toHaveText(runtime.label);

    await openNewMessage(page);
    await expect(
      page.getByTestId(`direct-runtime-contact-${runtime.id}`),
    ).toHaveCount(0);
    await page.getByTestId("new-dm-search").fill(runtime.label);
    await expect(page.getByTestId("new-dm-directory-results")).toContainText(
      runtime.label,
    );
    expect(
      (await commandLog(page)).filter(
        ({ command }) => command === "create_luca_resident",
      ),
    ).toHaveLength(1);
  });
}

test("routes an unavailable direct runtime to agent setup without creating it", async ({
  page,
}) => {
  await installMockBridge(page, {
    acpRuntimesCatalog: [
      {
        ...readyRuntime("codex", "Codex"),
        availability: "not_installed",
        command: null,
        binary_path: null,
        auth_status: { status: "unknown" },
      },
    ],
  });
  await page.goto("/");
  await openNewMessage(page);

  const contact = page.getByTestId("direct-runtime-contact-codex");
  await expect(contact).toContainText("Setup required");
  await contact.click({ force: true });
  await expect(page).toHaveURL(/\/settings\?section=agents/);
  expect(
    (await commandLog(page)).filter(
      ({ command }) => command === "create_luca_resident",
    ),
  ).toHaveLength(0);
});
