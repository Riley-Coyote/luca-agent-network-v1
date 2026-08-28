import { expect, test } from "@playwright/test";

import { installMockBridge } from "../../helpers/bridge";

function readyCodexRuntime() {
  return {
    id: "codex",
    label: "Codex",
    avatar_url: "",
    availability: "available",
    command: "codex-acp",
    binary_path: "/fixture/codex-acp",
    default_args: ["--acp"],
    mcp_command: "codex mcp serve",
    model_env_var: null,
    provider_env_var: null,
    thinking_env_var: null,
    install_hint: "Install Codex",
    install_instructions_url: "https://example.invalid/runtime",
    can_auto_install: false,
    underlying_cli_path: null,
    node_required: false,
    auth_status: { status: "logged_in" },
    login_hint: null,
  };
}

test("Skills search opens source detail and hands off to New Message", async ({
  page,
}) => {
  await installMockBridge(page, {
    acpRuntimesCatalog: [readyCodexRuntime()],
    capabilitySkills: [
      {
        skillId: "codex:launch-planning",
        name: "Launch planning",
        description: "Turn a release goal into a bounded launch plan.",
        sourceLabels: ["Codex user skills"],
        runtimeIds: ["codex"],
        content: "# Launch planning\n\nKeep the plan bounded and verifiable.",
      },
      {
        skillId: "claude:copy-edit",
        name: "Copy edit",
        description: "Polish concise product copy.",
        sourceLabels: ["Claude Code user skills"],
        runtimeIds: ["claude"],
        content: "# Copy edit\n\nPreserve the author's voice.",
      },
    ],
  });
  await page.goto("/?e2e=mock#/artifacts");
  await page.getByRole("button", { name: "Skills" }).click();

  await page.getByPlaceholder("Search installed skills").fill("launch");
  await expect(
    page.getByText("Launch planning", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Copy edit", { exact: true })).toHaveCount(0);
  await page
    .locator(".skill-library-row__main")
    .filter({ hasText: "Launch planning" })
    .click();

  const detail = page.getByRole("dialog", { name: "Launch planning" });
  await expect(detail).toContainText("Codex user skills");
  await expect(detail.locator("pre")).toHaveText(
    "# Launch planning\n\nKeep the plan bounded and verifiable.",
  );
  await detail.getByRole("button", { name: "Use with Codex" }).click();

  await expect(page.getByTestId("new-message-page")).toBeVisible();
  await expect(page.getByTestId("new-dm-search")).toHaveValue("Codex");
  await expect(page.getByTestId("message-composer")).toContainText(
    "Use the “Launch planning” skill for this request:",
  );
});

test("Skills failure stays local and offers a truthful retry", async ({
  page,
}) => {
  await installMockBridge(page, {
    capabilitySkillsError: "Synthetic skill catalog failure",
  });
  await page.goto("/?e2e=mock#/artifacts");
  await page.getByRole("button", { name: "Skills" }).click();

  await expect(
    page.getByRole("heading", { name: "Skills are unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByText("Your agents still work normally."),
  ).toBeVisible();
  const retry = page.getByRole("button", { name: "Check again" });
  await expect(retry).toBeVisible();
  const catalogReads = () =>
    page.evaluate(
      () =>
        (window.__BUZZ_E2E_COMMANDS__ ?? []).filter(
          (command) => command === "list_capability_skills",
        ).length,
    );
  const readsBeforeRetry = await catalogReads();
  await retry.click();
  await expect.poll(catalogReads).toBeGreaterThan(readsBeforeRetry);
  await expect(
    page.getByRole("heading", { name: "Skills are unavailable" }),
  ).toBeVisible();
});
