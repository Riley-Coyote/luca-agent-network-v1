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

async function createdResidentPubkey(
  page: import("@playwright/test").Page,
  displayName: string,
) {
  return page.evaluate(async (expectedName) => {
    const response = (await window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.(
      "list_luca_residents",
      {},
    )) as
      | {
          residents?: Array<{
            displayName: string;
            residentPubkey: string;
          }>;
        }
      | undefined;
    return (
      response?.residents?.find(
        (resident) => resident.displayName === expectedName,
      )?.residentPubkey ?? null
    );
  }, displayName);
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
    await expect(
      page.getByTestId(`direct-runtime-contact-icon-${runtime.id}`),
    ).toHaveAttribute(
      "src",
      new RegExp(
        `^(?:data:image/png;base64,|/runtime-icons/${runtime.id}\\.png$)`,
      ),
    );
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

    const ownerMessage = `Hello ${runtime.label}, check this project.`;
    await page.getByTestId("message-input").fill(ownerMessage);
    await page.getByTestId("send-message").click();
    await expect(page.getByTestId("chat-title")).toHaveText(runtime.label);

    const residentPubkey = await createdResidentPubkey(page, runtime.label);
    expect(residentPubkey).toMatch(/^[0-9a-f]{64}$/);
    if (!residentPubkey) throw new Error("Expected a created resident pubkey.");

    const ownerRow = page
      .getByTestId("message-row")
      .filter({ hasText: ownerMessage })
      .last();
    await expect(ownerRow).toBeVisible();
    const dispatchReceiptId = await ownerRow.getAttribute("data-message-id");
    if (!dispatchReceiptId) {
      throw new Error("Expected an owner dispatch receipt event ID.");
    }

    const directSend = await page.evaluate(() => {
      const entries = (window.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? []).filter(
        (entry) => entry.command === "send_channel_message",
      );
      return entries.at(-1)?.payload;
    });
    expect(directSend).toMatchObject({
      content: ownerMessage,
      // New-conversation sends carry the managed registry directly, so even a
      // resident materialized during first use reaches the native boundary as
      // an explicit one-resident conversation audience.
      managedAudience: {
        mode: "conversation",
        resident_pubkeys: [residentPubkey],
      },
      mentionPubkeys: [residentPubkey],
      responseSurface: "timeline",
    });
    const targetChannelId = (directSend as { channelId?: string } | undefined)
      ?.channelId;
    expect(targetChannelId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    if (!targetChannelId) {
      throw new Error(
        "Expected the direct send to retain its channel binding.",
      );
    }
    // The ordinary owner send completes through the canonical command without
    // inserting a confirmation or alternate guarded-mode payload.
    expect(directSend).not.toHaveProperty("approval");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const signedOwnerEvent = await page.evaluate(
      () => window.__BUZZ_E2E_SIGNED_EVENTS__?.at(-1) ?? null,
    );
    expect(signedOwnerEvent).toMatchObject({ content: ownerMessage, kind: 9 });
    expect(signedOwnerEvent?.tags).toContainEqual(["p", residentPubkey]);

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
              channelName: "DM",
            }) ?? false,
        ),
      )
      .toBe(true);

    // `DM` is also the name of an older bridge fixture. Give the dynamic
    // conversation a unique mock lookup name so the injected live event is
    // delivered to the exact channel bound above.
    const mockChannelName = `com-101-${runtime.id}-direct`;
    await page.evaluate(
      ({ channelId, name }) =>
        window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.("update_channel", {
          input: { channelId, name },
        }),
      { channelId: targetChannelId, name: mockChannelName },
    );

    const verbatimFinal = `${runtime.label}: exact resident output — unchanged.`;
    const signedFinal = await page.evaluate(
      ({ channelName, content, dispatchId, pubkey }) =>
        window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
          channelName,
          content,
          extraTags: [
            ["luca-managed-dispatch", dispatchId],
            ["broadcast", "1"],
          ],
          parentEventId: dispatchId,
          pubkey,
        }),
      {
        channelName: mockChannelName,
        content: verbatimFinal,
        dispatchId: dispatchReceiptId,
        pubkey: residentPubkey,
      },
    );
    expect(signedFinal).toMatchObject({
      content: verbatimFinal,
      kind: 9,
      pubkey: residentPubkey,
    });
    expect(signedFinal?.tags).toContainEqual([
      "luca-managed-dispatch",
      dispatchReceiptId,
    ]);

    const finalRow = page
      .getByTestId("message-row")
      .filter({ hasText: verbatimFinal });
    await expect(finalRow).toHaveCount(1);
    await expect(finalRow.getByTestId("message-author")).toHaveText(
      runtime.label,
    );

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

test("presents residents before runtimes and uses resident identity marks", async ({
  page,
}) => {
  const residentPubkey = "9".repeat(64);
  await installMockBridge(page, {
    acpRuntimesCatalog: [readyRuntime("codex", "Codex")],
    managedAgents: [
      {
        channelNames: ["general"],
        name: "Researcher",
        pubkey: residentPubkey,
        status: "running",
      },
    ],
    searchProfiles: [
      {
        displayName: "Researcher",
        isAgent: true,
        pubkey: residentPubkey,
      },
    ],
  });
  await page.goto("/");
  await openNewMessage(page);

  const resident = page
    .getByTestId("new-dm-directory-results")
    .getByRole("option", { name: /Researcher/ });
  const runtime = page.getByTestId("direct-runtime-contact-codex");
  await expect(resident).toBeVisible();
  await expect(runtime).toBeVisible();
  await expect(resident.locator(".agent-identity-specimen")).toHaveCount(1);

  const [residentBox, runtimeBox] = await Promise.all([
    resident.boundingBox(),
    runtime.boundingBox(),
  ]);
  expect(residentBox?.y).toBeLessThan(runtimeBox?.y ?? 0);
});
