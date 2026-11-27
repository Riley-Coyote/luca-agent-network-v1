import { expect, test, type Page } from "@playwright/test";
import { installMockBridge } from "../../helpers/bridge";
import { waitForAnimations } from "../../helpers/animations";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";

const LUCA = "11".repeat(32);
const MARA = "22".repeat(32);
const READS = [
  "get_companion_awareness",
  "get_companion_initiative",
  "list_companion_selected_sources",
  "list_companion_native_profiles",
  "list_companion_machine_sources",
  "list_companion_browser_profiles",
];

test("paused source notes stay manageable without showing content or enabling access", async ({
  page,
}, testInfo) => {
  await openSettings(page, MARA, async (page) => {
    await page.evaluate((resident) => {
      const state = window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (
            command: string,
            args?: unknown,
            options?: unknown,
          ) => Promise<unknown>;
        };
        testNoteForgotten: boolean;
      };
      const invoke = state.__TAURI_INTERNALS__.invoke;
      const item = {
        itemId: "withheld-head",
        lineageRootId: `companion-note-${"a".repeat(64)}`,
        kind: "memory_note",
        status: "active",
        authorship: "resident",
        revision: 1,
        pinnedOwnerCorrection: false,
        contentWithheld: true,
        title: null,
        body: "Source-linked note content is unavailable. You can still forget this note.",
        category: null,
        sourceEventIds: [],
        sourcePageIds: [],
        createdAt: "2026-11-03T08:00:00Z",
        updatedAt: "2026-11-03T08:00:00Z",
      };
      state.testNoteForgotten = false;
      state.__TAURI_INTERNALS__.invoke = async (command, args, options) => {
        const input = args as
          | { residentPubkey?: string; itemId?: string }
          | undefined;
        if (input?.residentPubkey === resident) {
          if (command === "list_resident_notebook_items")
            return {
              availability: "ready",
              items: state.testNoteForgotten ? [] : [item],
              nextCursor: null,
            };
          if (command === "get_resident_notebook_item")
            return {
              availability: "ready",
              item,
              revisions: [],
              annotations: [],
            };
          if (command === "forget_resident_notebook_item") {
            if (input.itemId !== item.itemId)
              throw new Error("Wrong test note");
            state.testNoteForgotten = true;
            return null;
          }
        }
        return invoke(command, args, options);
      };
    }, MARA);
  });
  await page.getByTestId("mind-back").click();
  await page
    .getByTestId(`place-row-mind:${MARA}`)
    .locator(".luca-rail-row-hit")
    .click();
  await page.getByTestId("mind-view-notes").click();
  await page.getByTestId("mind-notebook-item").click();
  await expect(
    page.getByText(
      "Source-linked note content is unavailable. You can still forget this note.",
      { exact: true },
    ),
  ).toBeVisible();
  for (const label of [
    "Correct",
    "Pin correction",
    "Archive",
    "Revision history",
  ])
    await expect(
      page.getByRole("button", { name: label, exact: true }),
    ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Forget", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("paused-note-controls.png"),
  });
  await page.getByRole("button", { name: "Forget", exact: true }).click();
  await page.getByRole("button", { name: "Forget item", exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { testNoteForgotten: boolean }).testNoteForgotten,
    ),
  ).toBe(true);
  await expect(page.getByTestId("mind-notebook-item")).toHaveCount(0);
  const calls = await companionCalls(page);
  expect(
    calls.some(({ command }) => /^(set_|select_|resume_)/.test(command)),
  ).toBe(false);
});

async function openSettings(
  page: Page,
  resident = MARA,
  beforeSelect?: (page: Page) => Promise<void>,
) {
  // The places rail (place-row-*) is the shell's, the shipped look; the e2e
  // build draws it only behind its preview switch.
  await page.addInitScript(
    (key) => localStorage.setItem(key, JSON.stringify({ "shell-frame": true })),
    FEATURE_OVERRIDES_STORAGE_KEY,
  );
  await installMockBridge(page, {
    managedAgents: [
      {
        pubkey: LUCA,
        name: "Luca",
        status: "running",
        agentCommand: "claude-code-acp",
        channelIds: [],
      },
      {
        pubkey: MARA,
        name: "Mara",
        status: "stopped",
        agentCommand: "codex-acp",
        channelIds: [],
      },
    ],
  });
  await page.goto("/?e2e=mock&notebookDemo=1#/agents");
  await expect(page.getByTestId(`place-row-mind:${resident}`)).toBeVisible();
  await beforeSelect?.(page);
  await page
    .getByTestId(`place-row-mind:${resident}`)
    .locator(".luca-rail-row-hit")
    .click();
  await page.getByTestId("mind-open-settings").click();
  await expect(page.getByTestId("mind-row-keeps")).toBeVisible();
}

async function companionCalls(page: Page) {
  return page.evaluate(() =>
    (window.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? []).filter(({ command }) =>
      command.includes("companion"),
    ),
  );
}

test("agent settings opens companion controls for a stopped agent without a chat or granting access", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openSettings(page);
  const before = await page.evaluate(
    () => (window.__BUZZ_E2E_COMMANDS__ ?? []).length,
  );
  const entry = page.getByTestId("mind-row-keeps");
  await entry.click();
  const dialog = page.getByTestId("mind-keeps-up-with");
  await expect(
    dialog.getByRole("heading", { name: "Keeps up with" }),
  ).toBeVisible();
  await expect(page.getByTestId("mind-back")).toHaveText("Settings");
  const calls = await companionCalls(page);
  expect([...new Set(calls.map(({ command }) => command))].sort()).toEqual(
    [...READS].sort(),
  );
  expect(
    calls.every(
      ({ payload }) =>
        (payload as { residentPubkey: string }).residentPubkey === MARA,
    ),
  ).toBe(true);
  const commands = await page.evaluate(
    (offset) => (window.__BUZZ_E2E_COMMANDS__ ?? []).slice(offset),
    before,
  );
  expect(
    commands.some((command) =>
      /^(start_managed_agent|create_dm|open_dm|send_|publish_|set_companion|pick_companion|select_companion)/.test(
        command,
      ),
    ),
  ).toBe(false);
  await waitForAnimations(page);
  await page.screenshot({
    path: testInfo.outputPath("companion-settings.png"),
  });
  await page.getByTestId("mind-back").click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("mind-open-settings")).toBeVisible();
  await expect(page.getByTestId("mind-page-title")).toBeFocused();
  await expect(page).toHaveURL(
    new RegExp(`profile=(?:%22)?${MARA}(?:%22)?(?:&|$)`),
  );
  expect(errors).toEqual([]);
});

test("legacy promotion never implies note consent; explicit review saves semantic notes", async ({
  page,
}, testInfo) => {
  // Synthetic IPC only: this verifies the actual review's transport, not that
  // browser fixtures grant native permission or retain any real user data.
  await openSettings(page, MARA, async (page) => {
    await page.evaluate((resident) => {
      const state = window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (
            command: string,
            args?: unknown,
            options?: unknown,
          ) => Promise<unknown>;
        };
        noteConsentCalls: Array<{ command: string; payload: unknown }>;
      };
      state.noteConsentCalls = [];
      const invoke = state.__TAURI_INTERNALS__.invoke;
      const awareness = {
        availability: "ready",
        paused: false,
        collectionRunning: true,
        revision: 3,
        truncated: false,
        grants: [
          {
            source: { source_id: "synthetic-codex", state: "active" },
            grant: {
              grant_revision: 1,
              state: "active",
              choices: {
                observe: true,
                promote: true,
                retain: false,
                provider_egress_binding: "synthetic-current-binding",
              },
            },
          },
        ],
      };
      // An older saved choice has no semanticNotes field. Even with promote
      // set on its source grant, note keeping must remain unchecked.
      const history = {
        choice: { revision: 2, allowed: true },
        currentBindingConfirmed: true,
        consumersReady: true,
        disclosureRevision: 1,
        disclosure: "Synthetic reviewed activity context.",
      };
      state.__TAURI_INTERNALS__.invoke = async (command, args, options) => {
        const input = args as { residentPubkey?: string } | undefined;
        if (input?.residentPubkey === resident) {
          if (command === "get_companion_awareness") return awareness;
          if (command === "list_companion_native_profiles")
            return [
              {
                sourceId: "synthetic-codex",
                kind: "codex_sessions",
                class: "visible_excerpts",
              },
            ];
          if (command === "get_companion_native_history_choice") return history;
          if (
            command === "set_companion_source_choices" ||
            command === "set_companion_native_history_choice"
          ) {
            state.noteConsentCalls.push({ command, payload: args });
            return command === "set_companion_native_history_choice"
              ? history
              : awareness;
          }
        }
        return invoke(command, args, options);
      };
    }, MARA);
  });
  await page.getByTestId("mind-row-keeps").click();
  const keeps = page.getByTestId("mind-keeps-up-with");
  const review = page.getByTestId("mind-review-access");
  for (const chooseNotes of [false, true]) {
    await keeps
      .getByTestId("mind-follow-codex_sessions")
      .getByRole("button", { name: "Review access" })
      .click();
    const notes = review.getByRole("switch", {
      name: "Keep meaningful notes",
      exact: true,
    });
    await expect(notes).not.toBeChecked();
    await expect(notes).toBeEnabled();
    if (chooseNotes) {
      await notes.click();
      await waitForAnimations(page);
      await page.screenshot({
        path: testInfo.outputPath("explicit-note-review.png"),
      });
    }
    await review.getByRole("button", { name: "Confirm these choices" }).click();
    await expect(review).toHaveCount(0);
    const saves = await page.evaluate(() =>
      (
        window as unknown as {
          noteConsentCalls: Array<{ command: string; payload: unknown }>;
        }
      ).noteConsentCalls.filter(
        ({ command }) => command === "set_companion_native_history_choice",
      ),
    );
    expect(saves).toHaveLength(chooseNotes ? 2 : 1);
    expect(saves.at(-1)?.payload).toMatchObject({
      residentPubkey: MARA,
      sourceId: "synthetic-codex",
      input: {
        allowed: true,
        semanticNotes: chooseNotes,
        expectedRevision: 2,
        disclosureRevision: 1,
      },
    });
  }
});

test("keyboard entry follows the selected resident and restores focus at compact width", async ({
  page,
}) => {
  await openSettings(page);
  await page.getByTestId("mind-row-keeps").press("Enter");
  await expect(page.getByTestId("mind-keeps-up-with")).toBeVisible();
  await page.getByTestId("mind-back").press("Enter");
  await expect(page.getByTestId("mind-page-title")).toBeFocused();

  await page
    .getByTestId(`place-row-mind:${LUCA}`)
    .locator(".luca-rail-row-hit")
    .click();
  await page.getByTestId("mind-open-settings").click();
  await page.setViewportSize({ width: 480, height: 800 });
  const entry = page.getByTestId("mind-row-keeps");
  await entry.press("Enter");
  const dialog = page.getByTestId("mind-keeps-up-with");
  await expect(
    dialog.getByRole("heading", { name: "Keeps up with" }),
  ).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(480);
  const calls = await companionCalls(page);
  const currentReads = calls.slice(-READS.length);
  expect(
    currentReads.every(
      ({ payload }) =>
        (payload as { residentPubkey: string }).residentPubkey === LUCA,
    ),
  ).toBe(true);
  await page.getByTestId("mind-back").click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("mind-page-title")).toBeFocused();
});

test("work buttons request native discovery; manual folder selection stays explicit", async ({
  page,
}) => {
  await openSettings(page);
  await page.getByTestId("mind-row-keeps").click();
  const dialog = page.getByTestId("mind-keeps-up-with");
  await dialog
    .getByRole("switch", { name: "Follow Codex work", exact: true })
    .click();
  await expect(
    dialog.getByRole("switch", {
      name: "Follow Claude Code work",
      exact: true,
    }),
  ).toBeEnabled();
  await dialog
    .getByRole("switch", { name: "Follow Claude Code work", exact: true })
    .click();
  await expect(
    dialog.getByRole("switch", { name: "Follow Codex work", exact: true }),
  ).toBeEnabled();
  const calls = await companionCalls(page);
  expect(
    calls
      .filter(({ command }) => command === "follow_companion_work")
      .map(({ payload }) => payload),
  ).toEqual([
    { residentPubkey: MARA, kind: "codex_sessions" },
    { residentPubkey: MARA, kind: "claude_projects" },
  ]);
  expect(
    calls.some(({ command }) => /^(pick_|set_|select_|resume_)/.test(command)),
  ).toBe(false);
  await expect(
    dialog.getByRole("button", { name: "Choose Codex folder" }),
  ).toBeHidden();
  await dialog
    .getByRole("button", {
      name: "Use a different profile folder",
      exact: true,
    })
    .click();
  await dialog.getByRole("button", { name: "Choose Codex folder" }).click();
  const manual = (await companionCalls(page)).find(
    ({ command }) => command === "pick_companion_native_profile",
  );
  expect(manual?.payload).toMatchObject({
    residentPubkey: MARA,
    kind: "codex_sessions",
    choices: {
      observe: false,
      promote: false,
      providerEgress: false,
      retainRaw: false,
    },
  });
});

test("unavailable work discovery can be dismissed and retried without losing the agent page", async ({
  page,
}) => {
  await openSettings(page);
  await page.getByTestId("mind-row-keeps").click();
  const dialog = page.getByTestId("mind-keeps-up-with");
  const follow = dialog.getByRole("switch", { name: "Follow Codex work" });
  await expect(follow).toBeVisible();
  await page.evaluate(() => {
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (
            command: string,
            args?: unknown,
            options?: unknown,
          ) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__;
    const invoke = internals.invoke;
    let fail = true;
    internals.invoke = async (command, ...args) => {
      if (command === "follow_companion_work" && fail) {
        fail = false;
        throw new Error("Companion unavailable in test");
      }
      return invoke(command, ...args);
    };
  });
  await follow.click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Companion unavailable in test",
  );
  await page.getByTestId("mind-back").click();
  await expect(page.getByTestId("mind-open-settings")).toBeVisible();
  await page.getByTestId("mind-open-settings").click();
  await page.getByTestId("mind-row-keeps").click();
  await expect(follow).toBeVisible();
  await follow.click();
  await expect(follow).toBeEnabled();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
});
