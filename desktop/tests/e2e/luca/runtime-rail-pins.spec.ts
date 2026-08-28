import { expect, test } from "@playwright/test";

import { installMockBridge } from "../../helpers/bridge";

function readyRuntime(id: "claude" | "codex" | "kimi" | "grok", label: string) {
  return {
    id,
    label,
    avatar_url: "",
    availability: "available",
    command: `${id}-acp`,
    binary_path: `/fixture/${id}-acp`,
    default_args: ["--acp"],
    mcp_command: null,
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

test("curates one pinned row per supported runtime family", async ({
  page,
}) => {
  await installMockBridge(page, {
    acpRuntimesCatalog: [
      readyRuntime("claude", "Claude Code"),
      readyRuntime("codex", "Codex"),
      readyRuntime("kimi", "Kimi Code"),
      readyRuntime("grok", "Grok"),
    ],
  });
  await page.goto("/?e2e=mock");

  await expect(page.getByTestId("runtime-rail-claude_code")).toBeVisible();
  await expect(page.getByTestId("runtime-rail-codex")).toBeVisible();
  await expect(page.getByTestId("runtime-rail-kimi")).toBeVisible();
  await expect(page.getByTestId("runtime-rail-grok")).toBeVisible();
  await expect(page.getByTestId("runtime-rail-hermes")).toHaveCount(0);
  await expect(page.getByTestId("runtime-rail-openclaw")).toHaveCount(0);

  await page.getByTestId("open-settings").click();
  await page.getByTestId("profile-popover-settings").click();
  await page.getByTestId("settings-nav-appearance").click();
  const kimiPin = page.getByTestId("runtime-rail-pin-kimi");
  await expect(kimiPin).toBeChecked();
  await kimiPin.click();
  await expect(kimiPin).not.toBeChecked();
  await page.getByTestId("settings-back-to-app").click();

  await expect(page.getByTestId("runtime-rail-kimi")).toHaveCount(0);
  await expect(page.getByTestId("runtime-rail-grok")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("runtime-rail-kimi")).toHaveCount(0);
  await expect(page.getByTestId("runtime-rail-grok")).toBeVisible();
});
