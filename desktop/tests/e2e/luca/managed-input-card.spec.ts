import { expect, test, type Page } from "@playwright/test";
import type { ManagedInputField } from "../../../src/shared/api/managedInputs";
import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";
import { waitForAnimations } from "../../helpers/animations";

const DM_ID = "f48efb06-0c93-5025-aac9-2e646bb6bfa8";
const RESIDENT = TEST_IDENTITIES.alice.pubkey;
type Question = {
  pendingId: string;
  request: {
    conversation_id: string;
    resident_pubkey: string;
    message: string;
    fields: ManagedInputField[];
  };
};
type Call = { command: string; payload: unknown };
type Host = {
  pending: Question[];
  calls: Call[];
  listError: boolean;
  resolveError: string | null;
  suppressResolvedEvent: boolean;
  holdLists: boolean;
  listResolvers: Array<() => void>;
  holdDecisions: boolean;
  decisionResolvers: Array<() => void>;
  failSubscriptions: boolean;
  completedLists: number;
};
declare global {
  interface Window {
    __MANAGED_INPUT_TEST__: Host;
  }
}

function question(overrides: Partial<Question> = {}): Question {
  return {
    pendingId: "native-question-1",
    request: {
      conversation_id: DM_ID,
      resident_pubkey: RESIDENT,
      message: "Which approach should I use?",
      fields: [
        {
          key: "note",
          label: "Your note",
          kind: "text",
          description: null,
          options: [],
          required: true,
        },
        {
          key: "approach",
          label: "Approach",
          kind: "single",
          description: null,
          options: [
            {
              value: "small_exact",
              label: "Smaller change",
              description: null,
            },
            { value: "large_exact", label: "Larger change", description: null },
          ],
          required: true,
        },
        {
          key: "checks",
          label: "Checks",
          kind: "multiple",
          description: "Select at least one",
          options: [
            { value: "test_exact", label: "Run tests", description: null },
            { value: "lint_exact", label: "Run lint", description: null },
          ],
          required: true,
        },
      ],
    },
    ...overrides,
  };
}

// Only native question IPC bookkeeping is mocked. The existing production
// build, channel routing, event subscription, form and API all run unchanged.
async function open(page: Page, options: Partial<Host> = {}) {
  await page.addInitScript(
    (options) => {
      const state: Host = {
        pending: [],
        calls: [],
        listError: false,
        resolveError: null,
        suppressResolvedEvent: false,
        holdLists: false,
        listResolvers: [],
        holdDecisions: false,
        decisionResolvers: [],
        failSubscriptions: false,
        completedLists: 0,
        ...options,
      };
      window.__MANAGED_INPUT_TEST__ = state;
      type Invoke = (
        command: string,
        payload?: unknown,
        options?: unknown,
      ) => Promise<unknown>;
      let realInvoke: Invoke | undefined;
      const target = window as unknown as {
        __TAURI_INTERNALS__?: Record<string, unknown>;
      };
      const internals = target.__TAURI_INTERNALS__ ?? {};
      target.__TAURI_INTERNALS__ = internals;
      Object.defineProperty(internals, "invoke", {
        configurable: true,
        set: (invoke: Invoke) => {
          realInvoke = invoke;
        },
        get:
          () =>
          async (
            command: string,
            payload?: unknown,
            invokeOptions?: unknown,
          ) => {
            state.calls.push({
              command,
              payload: structuredClone(payload ?? null),
            });
            if (command === "list_pending_managed_inputs") {
              if (state.listError)
                throw new Error("Temporary question IPC failure");
              const snapshot = structuredClone(state.pending);
              if (state.holdLists)
                await new Promise<void>((resolve) =>
                  state.listResolvers.push(resolve),
                );
              state.completedLists += 1;
              return snapshot;
            }
            if (command === "resolve_managed_input") {
              if (state.holdDecisions)
                await new Promise<void>((resolve) =>
                  state.decisionResolvers.push(resolve),
                );
              if (state.resolveError) throw new Error(state.resolveError);
              const { pendingId, action } = payload as {
                pendingId: string;
                action: string;
              };
              if (!state.pending.some((item) => item.pendingId === pendingId))
                throw new Error("This question is no longer waiting.");
              state.pending = state.pending.filter(
                (item) => item.pendingId !== pendingId,
              );
              if (!state.suppressResolvedEvent)
                window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.(
                  "managed-input-resolved",
                  { pendingId, action },
                );
              return null;
            }
            if (
              command === "plugin:event|listen" &&
              state.failSubscriptions &&
              ["managed-input-pending", "managed-input-resolved"].includes(
                (payload as { event: string }).event,
              )
            ) {
              throw new Error("Question events unavailable");
            }
            if (!realInvoke) throw new Error("Mock bridge unavailable");
            return realInvoke(command, payload, invokeOptions);
          },
      });
    },
    { pending: [question()], ...options },
  );
  await installMockBridge(page, {
    managedAgents: [
      {
        pubkey: RESIDENT,
        name: "Luca",
        status: "running",
        channelNames: ["general", "alice-tyler"],
      },
    ],
    searchProfiles: [{ pubkey: RESIDENT, displayName: "Luca", isAgent: true }],
  });
  await page.goto(`/?e2e=mock#/channels/${DM_ID}`);
  await expect(page.getByTestId("message-input")).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForFunction(
    () => window.__MANAGED_INPUT_TEST__.completedLists > 0,
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

const card = (page: Page) => page.getByTestId("managed-input-card");
async function fill(page: Page) {
  await card(page)
    .getByRole("textbox", { name: "Your note" })
    .fill("Keep the current behavior.");
  await card(page).getByRole("radio", { name: "Smaller change" }).check();
  await card(page).getByRole("checkbox", { name: "Run tests" }).check();
}
async function decisions(page: Page) {
  return page.evaluate(() =>
    window.__MANAGED_INPUT_TEST__.calls.filter(
      (call) => call.command === "resolve_managed_input",
    ),
  );
}
async function refresh(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}

test("answers exact native field values without any permission command", async ({
  page,
}, testInfo) => {
  await open(page);
  await expect(card(page)).toBeVisible();
  await fill(page);
  await card(page).getByRole("checkbox", { name: "Run lint" }).check();
  await waitForAnimations(page);
  await page.screenshot({
    path: testInfo.outputPath("managed-input-normal.png"),
  });
  await card(page).getByRole("button", { name: "Send answer" }).click();
  await expect(card(page)).toHaveCount(0);
  expect(await decisions(page)).toEqual([
    {
      command: "resolve_managed_input",
      payload: {
        pendingId: "native-question-1",
        action: "answered",
        answers: {
          note: "Keep the current behavior.",
          approach: "small_exact",
          checks: ["test_exact", "lint_exact"],
        },
      },
    },
  ]);
  expect(
    await page.evaluate(() =>
      window.__MANAGED_INPUT_TEST__.calls.some(
        (call) => call.command === "resolve_managed_permission",
      ),
    ),
  ).toBe(false);
});

test("skip bypasses required fields and never sends the draft", async ({
  page,
}) => {
  await open(page);
  await card(page)
    .getByRole("textbox", { name: "Your note" })
    .fill("Do not transmit this draft");
  await card(page).getByRole("button", { name: "Skip", exact: true }).click();
  await expect(card(page)).toHaveCount(0);
  expect((await decisions(page))[0].payload).toEqual({
    pendingId: "native-question-1",
    action: "declined",
    answers: {},
  });
});

test("required multiple selection prevents an empty answer", async ({
  page,
}) => {
  await open(page);
  await card(page)
    .getByRole("textbox", { name: "Your note" })
    .fill("Valid note");
  await card(page).getByRole("radio", { name: "Smaller change" }).check();
  await card(page).getByRole("button", { name: "Send answer" }).click();
  await expect(card(page).getByRole("alert")).toContainText("Checks");
  expect(await decisions(page)).toHaveLength(0);
});

test("required whitespace and multibyte overflow are rejected locally", async ({
  page,
}) => {
  await open(page);
  await fill(page);
  const text = card(page).getByRole("textbox", { name: "Your note" });
  await text.fill("   ");
  await card(page).getByRole("button", { name: "Send answer" }).click();
  await expect(card(page).getByRole("alert")).toContainText("Your note");
  await text.fill("界".repeat(1400));
  await card(page).getByRole("button", { name: "Send answer" }).click();
  await expect(card(page).getByRole("alert")).toContainText("too long");
  expect(await decisions(page)).toHaveLength(0);
});

test("same-tick duplicate submissions and Skip cannot race an answer", async ({
  page,
}) => {
  await open(page, { holdDecisions: true });
  await fill(page);
  await card(page)
    .locator("form")
    .evaluate((form) => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      (
        form.querySelector('button[type="button"]') as HTMLButtonElement
      ).click();
    });
  await expect(
    card(page).getByRole("button", { name: "Sending…" }),
  ).toBeDisabled();
  expect(await decisions(page)).toHaveLength(1);
  await page.evaluate(() =>
    window.__MANAGED_INPUT_TEST__.decisionResolvers
      .splice(0)
      .forEach((resolve) => {
        resolve();
      }),
  );
  await expect(card(page)).toHaveCount(0);
});

test("native stale rejection stays visible, preserves draft and allows retry", async ({
  page,
}) => {
  await open(page, { resolveError: "Stale native session epoch" });
  await fill(page);
  await card(page).getByRole("button", { name: "Send answer" }).click();
  await expect(card(page).getByRole("alert")).toHaveText(
    "Stale native session epoch",
  );
  await expect(
    card(page).getByRole("textbox", { name: "Your note" }),
  ).toHaveValue("Keep the current behavior.");
  await page.evaluate(() => {
    window.__MANAGED_INPUT_TEST__.resolveError = null;
  });
  await card(page).getByRole("button", { name: "Send answer" }).click();
  await expect(card(page)).toHaveCount(0);
  expect(await decisions(page)).toHaveLength(2);
});

test("success removes the card despite missed resolution event and failed backfill", async ({
  page,
}) => {
  await open(page, { suppressResolvedEvent: true });
  await fill(page);
  await page.evaluate(() => {
    window.__MANAGED_INPUT_TEST__.listError = true;
  });
  await card(page).getByRole("button", { name: "Send answer" }).click();
  await expect(card(page)).toHaveCount(0);
});

test("missed pending events are backfilled on focus even with unavailable subscription", async ({
  page,
}) => {
  await open(page, { pending: [], failSubscriptions: true });
  await expect(card(page)).toHaveCount(0);
  await page.evaluate((pending) => {
    window.__MANAGED_INPUT_TEST__.pending = [pending];
  }, question());
  await refresh(page);
  await expect(card(page)).toBeVisible();
});

test("initial native snapshot still renders when registration fails", async ({
  page,
}) => {
  await open(page, { failSubscriptions: true });
  await expect(card(page)).toBeVisible();
});

test("temporary snapshot failure preserves the visible question and typed draft", async ({
  page,
}) => {
  await open(page);
  await fill(page);
  await page.evaluate(() => {
    window.__MANAGED_INPUT_TEST__.listError = true;
  });
  await refresh(page);
  await expect(card(page)).toBeVisible();
  await expect(
    card(page).getByRole("textbox", { name: "Your note" }),
  ).toHaveValue("Keep the current behavior.");
  expect(await decisions(page)).toHaveLength(0);
});

test("late stale snapshot cannot resurrect an externally cancelled question", async ({
  page,
}) => {
  await open(page);
  await expect(card(page)).toBeVisible();
  await page.evaluate(() => {
    window.__MANAGED_INPUT_TEST__.holdLists = true;
  });
  await refresh(page);
  await page.waitForFunction(
    () => window.__MANAGED_INPUT_TEST__.listResolvers.length > 0,
  );
  await page.evaluate(() => {
    const host = window.__MANAGED_INPUT_TEST__;
    host.pending = [];
    host.holdLists = false;
    window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.("managed-input-resolved", {
      pendingId: "native-question-1",
      action: "cancelled",
    });
    host.listResolvers.splice(0).forEach((resolve) => {
      resolve();
    });
  });
  await expect(card(page)).toHaveCount(0);
  // An old native snapshot reappearing under the same opaque ID is still
  // terminal, even when that snapshot is the most recent IPC response.
  await page.evaluate((pending) => {
    window.__MANAGED_INPUT_TEST__.pending = [pending];
  }, question());
  await refresh(page);
  await expect(card(page)).toHaveCount(0);
  expect(await decisions(page)).toHaveLength(0);
});

test("missed cancellation is reconciled on return to a visible page", async ({
  page,
}) => {
  await open(page);
  await expect(card(page)).toBeVisible();
  await page.evaluate(() => {
    window.__MANAGED_INPUT_TEST__.pending = [];
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(card(page)).toHaveCount(0);
});

test("a replacement request starts with no draft from the prior request", async ({
  page,
}) => {
  await open(page);
  await fill(page);
  await page.evaluate(
    (pending) => {
      window.__MANAGED_INPUT_TEST__.pending = [pending];
      window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.("managed-input-pending", {});
    },
    question({ pendingId: "native-question-2" }),
  );
  await expect(
    card(page).getByRole("textbox", { name: "Your note" }),
  ).toHaveValue("");
  await expect(
    card(page).getByRole("radio", { name: "Smaller change" }),
  ).not.toBeChecked();
});

test("questions from other conversations never leak into this composer", async ({
  page,
}) => {
  const other = question();
  other.request.conversation_id = "foreign-conversation";
  await open(page, { pending: [other] });
  await expect(card(page)).toHaveCount(0);
  expect(await decisions(page)).toHaveLength(0);
});

test("keyboard selection and Enter submit use the same exact answer path", async ({
  page,
}) => {
  await open(page);
  await fill(page);
  const radio = card(page).getByRole("radio", { name: "Smaller change" });
  await radio.focus();
  await page.keyboard.press("ArrowDown");
  await expect(
    card(page).getByRole("radio", { name: "Larger change" }),
  ).toBeChecked();
  const checkbox = card(page).getByRole("checkbox", { name: "Run lint" });
  await checkbox.focus();
  await page.keyboard.press("Space");
  await expect(checkbox).toBeChecked();
  await card(page).getByRole("textbox", { name: "Your note" }).focus();
  await page.keyboard.press("Enter");
  await expect(card(page)).toHaveCount(0);
  expect((await decisions(page))[0].payload).toMatchObject({
    answers: { approach: "large_exact", checks: ["test_exact", "lint_exact"] },
  });
});

test("long native text fits a narrow composer without horizontal overflow", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 780, height: 900 });
  const long = question();
  long.request.message = "UnbrokenNativeQuestion".repeat(16);
  long.request.fields[0].label = "UnbrokenFieldLabel".repeat(12);
  long.request.fields[1].options[0].label = "UnbrokenChoiceLabel".repeat(16);
  await open(page, { pending: [long] });
  await expect(card(page)).toBeVisible();
  await card(page).evaluate((element) => {
    (element as HTMLElement).style.width = "260px";
  });
  expect(
    await card(page).evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
  await expect(
    card(page).getByRole("button", { name: "Skip", exact: true }),
  ).toBeVisible();
  await expect(
    card(page).getByRole("button", { name: "Send answer" }),
  ).toBeVisible();
  await waitForAnimations(page);
  await card(page).screenshot({
    path: testInfo.outputPath("managed-input-narrow.png"),
  });
});
