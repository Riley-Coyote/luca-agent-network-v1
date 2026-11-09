import { expect, test, type Page } from "@playwright/test";
import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";
import type { AgentInboxFixture } from "../../../src/testing/agentInboxFixture";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";

const OWNER = "deadbeef".repeat(8);
const LUCA = TEST_IDENTITIES.bob.pubkey;
const ANIMA = TEST_IDENTITIES.charlie.pubkey;
const TASK = "ab".repeat(32);
const OTHER_TASK = "cd".repeat(32);
const PAIR = `correspondence-v1-${"12".repeat(32)}`;
const ROOT = "11".repeat(32);
const TURN = "22".repeat(32);
const CHANNEL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const scope = {
  communityId: "9b603e66-0283-4bb6-9808-309a2bef4927",
  ownerPubkey: OWNER,
};

const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error("Correspondence page error:", error.stack);
  });
});
test.afterEach(({ page }) => {
  expect(pageErrors.get(page)).toEqual([]);
});

function fixture(): AgentInboxFixture {
  const now = Math.floor(Date.now() / 1000);
  const task = (id: string, state = "open") => ({
    correspondenceId: PAIR,
    record: {
      protocol: "luca.exchange.v1",
      exchange_id: id,
      owner: OWNER,
      members: [LUCA, ANIMA],
      conversation_id: CHANNEL,
      root_event_id: ROOT,
      depth: 1,
      bucket: 3,
      state,
      deadline: now + 3600,
      opened_by: LUCA,
    },
    recordEventId: id,
    recordUpdatedAt: now,
    outcome: "unknown",
  });
  const first = task(TASK);
  const second = task(OTHER_TASK, "closed");
  const event = (id: string, pubkey: string, content: string) => ({
    id,
    pubkey,
    content,
    created_at: now - 60,
    kind: 40002,
    tags: [
      ["h", CHANNEL],
      ["exchange", TASK, "1"],
    ],
    sig: "",
  });
  return {
    pages: [
      {
        scope,
        tasks: [first, second],
        nextCursor: null,
        historySource: "canonical_relay",
        partial: false,
      },
    ],
    reads: {
      [TASK]: {
        scope,
        task: first,
        events: [
          event(ROOT, OWNER, "Review the onboarding flow"),
          event(
            TURN,
            ANIMA,
            "## Review\n\nThe **first step** is clear.\n\n```ts\nconst ready = true;\n```\n\n[Reference](https://example.com)",
          ),
        ],
        historySource: "canonical_relay",
        partial: false,
      },
      [OTHER_TASK]: {
        scope,
        task: second,
        events: [],
        historySource: "canonical_relay",
        partial: false,
      },
    },
  };
}

async function open(
  page: Page,
  theme = "light",
  sendFailures = 0,
  omitSelectedFromPage = false,
  configure?: (data: AgentInboxFixture) => void,
  embedded = false,
  openTask = true,
) {
  const data = fixture();
  if (omitSelectedFromPage) data.pages[0].tasks = data.pages[0].tasks.slice(1);
  data.sendFailuresRemaining = sendFailures;
  configure?.(data);
  await page.addInitScript(
    ({ data, theme }) => {
      window.__BUZZ_E2E_AGENT_INBOX__ = data;
      window.localStorage.setItem("buzz-theme", theme);
      window.localStorage.setItem("buzz-follow-system", "false");
    },
    { data, theme },
  );
  await installMockBridge(page, {
    exchanges: [
      {
        exchangeId: TASK,
        owner: OWNER,
        members: [LUCA, ANIMA],
        conversationId: CHANNEL,
        rootEventId: ROOT,
        openedBy: LUCA,
        bucket: 3,
        spent: 1,
      },
    ],
    managedAgents: [
      {
        pubkey: LUCA,
        name: "Luca",
        personaId: "builtin:fizz",
        status: "running",
        channelNames: ["general"],
      },
      {
        pubkey: ANIMA,
        name: "Anima",
        personaId: "builtin:honey",
        status: "running",
        channelNames: ["general"],
      },
      {
        pubkey: TEST_IDENTITIES.alice.pubkey,
        name: "Wren",
        status: "stopped",
        channelNames: [],
      },
    ],
  });
  if (embedded) {
    await page.addInitScript((key) => {
      const flags = JSON.parse(localStorage.getItem(key) ?? "{}");
      localStorage.setItem(
        key,
        JSON.stringify({ ...flags, "shell-frame": true }),
      );
    }, FEATURE_OVERRIDES_STORAGE_KEY);
    // The installed fixture enables the bridge; mimic the native app's clean
    // outer URL so Back/Forward has no unrelated bootstrap search appended.
    await page.goto(`/#/channels/${CHANNEL}`);
    await expect(page.locator("[data-luca-right-cards]")).toBeAttached();
    if (openTask) {
      await page.evaluate(
        (id) =>
          window.dispatchEvent(
            new CustomEvent("polyphonic:open-task-chat", { detail: id }),
          ),
        TASK,
      );
    }
  } else {
    await page.goto(
      `/?e2e=mock&window=popout&correspondence=${PAIR}&task=${TASK}`,
    );
  }
  if (embedded && !openTask) return;
  await expect(page.getByTestId("correspondence-window")).toBeVisible();
  await expect(
    page.getByRole("article", { name: "Review the onboarding flow" }),
  ).toBeVisible();
}

test("embedded task chat omits a duplicate transport anchor, not its brief", async ({
  page,
}) => {
  await open(
    page,
    "dark",
    0,
    false,
    (data) => {
      enableOwnerWrites(data);
      const read = data.reads[TASK];
      read.task.record.root_event_id = "88".repeat(32);
      read.events[0].pubkey = LUCA;
      read.events.push({
        ...read.events[0],
        id: "88".repeat(32),
        content: "Task: Review the onboarding flow",
        tags: [["luca-managed-dispatch", "99".repeat(32)]],
      });
    },
    true,
  );
  const chat = page.getByTestId("correspondence-window");
  await expect(
    chat
      .locator(".conversation-prose")
      .getByText("Review the onboarding flow", { exact: true }),
  ).toHaveCount(1);
  await expect(
    chat.getByText("Task: Review the onboarding flow", { exact: true }),
  ).toHaveCount(0);
  await expect(chat.getByTestId("message-input")).toBeEditable();
});

for (const theme of ["dark", "light"]) {
  test(`accepted task replies stay distinct from transport status: ${theme}`, async ({
    page,
  }, testInfo) => {
    await open(page, theme, 0, false, (data) => {
      enableOwnerWrites(data);
      (data.reads[TASK].task as { outcome: string }).outcome = "reply_received";
      data.pages[0].tasks[0] = data.reads[TASK].task;
    });
    const chat = page.getByTestId("correspondence-window");
    await expect(
      chat
        .getByRole("navigation", { name: "Tasks" })
        .getByRole("button")
        .first(),
    ).toContainText("Replied");
    await expect(
      chat.getByText(/Review the onboarding flow · Replied/),
    ).toBeVisible();
    await expect(chat.getByText(/Done|Succeeded/)).toHaveCount(0);
    await chat
      .getByRole("button", { name: "Reply to Anima", exact: true })
      .click();
    await expect(chat.getByTestId("message-input")).toBeEditable();
    const { waitForAnimations } = await import("../../helpers/animations");
    await waitForAnimations(page);
    await chat.screenshot({
      path: testInfo.outputPath(`reply-status-${theme}.png`),
    });
  });

  test(`live delegation stays quiet until the task card is clicked: ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, theme, 0, false, enableOwnerWrites, true, false);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
              channelName: "general",
            }) ?? false,
        ),
      )
      .toBe(true);
    await page.evaluate(
      ({ task, owner, luca, peer, channel }) => {
        const now = Math.floor(Date.now() / 1000);
        window.__BUZZ_E2E_EMIT_MOCK_EXCHANGE__?.({
          exchangeId: task,
          owner,
          members: [luca, peer],
          conversationId: channel,
          rootEventId: "44".repeat(32),
          openedBy: luca,
          bucket: 3,
          spent: 1,
        });
        const emit = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
        emit?.({
          channelName: "general",
          id: "44".repeat(32),
          pubkey: luca,
          content: "Task: Review the onboarding flow",
          createdAt: now,
        });
        emit?.({
          channelName: "general",
          pubkey: owner,
          kind: 40099,
          content: JSON.stringify({
            type: "member_joined",
            actor: owner,
            target: peer,
          }),
          createdAt: now,
        });
        emit?.({
          channelName: "general",
          pubkey: owner,
          kind: 40099,
          content: JSON.stringify({
            type: "visit_arrived",
            resident: peer,
            exchange_id: task,
          }),
          createdAt: now,
        });
        emit?.({
          channelName: "general",
          pubkey: luca,
          content: "Please review the onboarding flow",
          extraTags: [["exchange", task, "1"]],
          createdAt: now + 1,
        });
      },
      {
        task: OTHER_TASK,
        owner: OWNER,
        luca: LUCA,
        peer: ANIMA,
        channel: CHANNEL,
      },
    );
    const card = page.getByTestId(`exchange-receipt-${OTHER_TASK}`);
    await expect(card).toHaveCount(1);
    await expect(card).toBeVisible();
    await expect(page.getByTestId("task-chat-pane")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Close panel", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: "Open conversation details",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Anima stepped in", { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText("was added by", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.locator(`[data-message-id="${"44".repeat(32)}"]`),
    ).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath(`quiet-delegation-${theme}.png`),
    });
    await card.click();
    await expect(page.getByTestId("task-chat-pane")).toBeVisible();
    await expect(
      page.getByTestId("task-chat-pane").getByTestId("message-input"),
    ).toBeVisible();
    expect(await sends(page)).toEqual([]);
  });
}

test("embedded task chat keeps the main route and composer, defaults recipient, and opens no native window", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "dark", 0, false, enableOwnerWrites, true);
  const pane = page.getByTestId("task-chat-pane");
  await expect(pane.getByTestId("message-input")).toBeVisible();
  await expect(
    pane.getByTestId("message-input").locator("[data-placeholder]"),
  ).toHaveAttribute("data-placeholder", "Reply to Anima…");
  await expect(pane.getByLabel("Reply recipient")).toHaveCount(0);
  await expect(pane.getByRole("navigation", { name: "Tasks" })).toBeHidden();
  const route = page.url();
  await pane.getByTestId("message-input").fill("A draft for this task");
  await pane.getByRole("button", { name: "Close task conversation" }).click();
  await expect(pane).toHaveCount(0);
  expect(page.url()).toBe(route);
  expect(await sends(page)).toEqual([]);
  await page.evaluate(
    (id) =>
      window.dispatchEvent(
        new CustomEvent("polyphonic:open-task-chat", { detail: id }),
      ),
    TASK,
  );
  await expect(pane.getByTestId("message-input")).toHaveText(
    "A draft for this task",
  );
  await pane.getByTestId("send-message").click();
  await expect.poll(async () => (await sends(page)).length).toBe(1);
  expect((await sends(page))[0]).toMatchObject({
    exchangeId: TASK,
    recipientPubkey: ANIMA,
    continuationIntent: false,
  });
  expect(
    await page.evaluate(() =>
      (window.__BUZZ_E2E_COMMAND_LOG__ ?? []).filter(
        (entry) => entry.command === "open_chat_view",
      ),
    ),
  ).toEqual([]);
});

test("embedded task sends explicit continuation only on Send and preserves task-specific drafts", async ({
  page,
}) => {
  await open(page, "light", 0, false, enableOwnerWrites, true);
  const pane = page.getByTestId("task-chat-pane");
  await pane.getByTestId("message-input").fill("First task draft");
  await pane.getByLabel("Task", { exact: true }).selectOption(OTHER_TASK);
  await expect(pane.getByTestId("message-input")).toHaveText("");
  await expect(
    pane.getByText("Sending a message resumes this task with Anima."),
  ).toBeVisible();
  expect(await sends(page)).toEqual([]);
  await pane.getByTestId("message-input").fill("Please continue this task.");
  await pane.getByTestId("send-message").click();
  await expect.poll(async () => (await sends(page)).length).toBe(1);
  expect((await sends(page))[0]).toMatchObject({
    exchangeId: OTHER_TASK,
    recipientPubkey: ANIMA,
    continuationIntent: true,
  });
  await pane.getByLabel("Task", { exact: true }).selectOption(TASK);
  await expect(pane.getByTestId("message-input")).toHaveText(
    "First task draft",
  );
});

for (const theme of ["dark", "light"]) {
  test(`embedded task desktop layout ${theme}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, theme, 0, false, enableOwnerWrites, true);
    const pane = page.getByTestId("task-chat-pane");
    for (const width of [1440, 1280, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(pane.getByTestId("message-input")).toBeVisible();
      await expect
        .poll(async () =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
      await page.screenshot({
        path: `test-results/task-chat/embedded-${theme}-${width}.png`,
      });
    }
  });
}

async function sends(page: Page) {
  return page.evaluate(() =>
    (window.__BUZZ_E2E_COMMAND_LOG__ ?? [])
      .filter((entry) => entry.command === "send_agent_inbox_reply")
      .map(
        (entry) => (entry.payload as { input: Record<string, unknown> }).input,
      ),
  );
}

// These are explicit simulated host contracts, not native dispatch proofs.
function enableOwnerWrites(data: AgentInboxFixture) {
  for (const read of Object.values(data.reads))
    read.writeCapabilities = {
      reply: true,
      continuation: true,
      newMessage: true,
    };
}

async function selectStoppedTask(page: Page) {
  await page
    .getByRole("navigation", { name: "Tasks" })
    .getByRole("button")
    .nth(1)
    .click();
  await page.getByLabel("Reply recipient").selectOption(ANIMA);
}

test("mock contract: canonical subjects distinguish tasks before selection", async ({
  page,
}) => {
  await open(page, "light", 0, false, (data) => {
    Object.assign(data.pages[0].tasks[1] as object, {
      subject: "Review the deployment plan",
    });
  });
  await expect(
    page
      .getByRole("navigation", { name: "Tasks" })
      .getByRole("button", { name: /Review the deployment plan/ }),
  ).toBeVisible();
});

test("mock contract: continuing stopped work requires consent and keeps logical task across a new attempt", async ({
  page,
}) => {
  await open(page, "light", 0, false, enableOwnerWrites);
  await selectStoppedTask(page);
  expect(await sends(page)).toEqual([]);
  await expect(page.getByTestId("message-composer")).toHaveCount(0);
  await page
    .getByLabel("Continue this task with a new bounded attempt")
    .check();
  const input = page.getByTestId("message-input");
  await input.fill("Continue the same task.");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(input).toHaveText("Continue the same task.");
  await page.getByTestId("send-message").click();
  await expect(input).toHaveText("");
  const calls = await sends(page);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    exchangeId: OTHER_TASK,
    continuationIntent: true,
    recipientPubkey: ANIMA,
  });
  await expect(
    page
      .getByRole("navigation", { name: "Tasks" })
      .locator('[aria-current="true"]'),
  ).toContainText("Open");
  const read = await page.evaluate(
    (id) => window.__BUZZ_E2E_AGENT_INBOX__?.reads[id],
    OTHER_TASK,
  );
  expect(read?.logicalTaskId).toBe(OTHER_TASK);
  expect(read?.currentAttemptId).toBe("ef".repeat(32));
  await input.fill("Follow-up in the same logical draft.");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(input).toHaveText("Follow-up in the same logical draft.");
  await page.getByTestId("send-message").click();
  await expect(input).toHaveText("");
  expect((await sends(page))[1]).toMatchObject({
    exchangeId: "ef".repeat(32),
    continuationIntent: false,
  });
});

test("mock contract: New message creates a new logical task in the selected pair without replacing its source", async ({
  page,
}) => {
  await open(page, "light", 0, false, enableOwnerWrites);
  await page.getByLabel("Reply recipient").selectOption(ANIMA);
  await page.getByTestId("message-input").fill("Original task draft.");
  await page.getByRole("button", { name: "New message", exact: true }).click();
  await expect(
    page.getByText("Source: Review the onboarding flow", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("message-input")).toHaveText("");
  await page.getByTestId("message-input").fill("A separate topic.");
  await page.getByTestId("send-message").click();
  await expect(
    page.getByRole("article", { name: "A separate topic." }),
  ).toBeVisible();
  const calls = await page.evaluate(() =>
    (window.__BUZZ_E2E_COMMAND_LOG__ ?? [])
      .filter((entry) => entry.command === "send_agent_inbox_message")
      .map((entry) => entry.payload),
  );
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    input: {
      sourceExchangeId: TASK,
      recipientPubkey: ANIMA,
      content: "A separate topic.",
    },
  });
  const newRead = await page.evaluate(
    () => window.__BUZZ_E2E_AGENT_INBOX__?.reads["fa".repeat(32)],
  );
  expect(newRead?.logicalTaskId).toBe("fa".repeat(32));
  expect((newRead?.task as { correspondenceId: string }).correspondenceId).toBe(
    PAIR,
  );
  await page
    .getByRole("navigation", { name: "Tasks" })
    .getByRole("button")
    .filter({ hasText: "Conversation with Anima" })
    .first()
    .click();
  await page.getByLabel("Reply recipient").selectOption(ANIMA);
  await expect(page.getByTestId("message-input")).toHaveText(
    "Original task draft.",
  );
});

test("mock contract: uncertain continuation retries retain original operation and attempt after phase changes", async ({
  page,
}) => {
  await open(page, "light", 0, false, (data) => {
    enableOwnerWrites(data);
    data.sendAcceptedFailuresRemaining = 1;
  });
  await selectStoppedTask(page);
  await page
    .getByLabel("Continue this task with a new bounded attempt")
    .check();
  const input = page.getByTestId("message-input");
  await input.fill("Keep the accepted continuation identity.");
  await page.getByTestId("send-message").click();
  await expect(
    page.getByRole("alert").filter({ hasText: "wake confirmation" }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByLabel("Continue this task with a new bounded attempt"),
  ).toHaveCount(0);
  await expect(input).toHaveText("Keep the accepted continuation identity.");
  await page.getByTestId("send-message").click();
  await expect(input).toHaveText("");
  const calls = await sends(page);
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual(calls[0]);
  expect(calls[1]).toMatchObject({
    exchangeId: OTHER_TASK,
    continuationIntent: true,
  });
});

test("mock contract: explicit host capability denial cannot expose write controls", async ({
  page,
}) => {
  await open(page, "light", 0, false, (data) => {
    for (const read of Object.values(data.reads))
      read.writeCapabilities = {
        reply: false,
        continuation: false,
        newMessage: false,
      };
  });
  await page.getByLabel("Reply recipient").selectOption(ANIMA);
  await expect(page.getByTestId("message-composer")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "New message", exact: true }),
  ).toBeDisabled();
  await selectStoppedTask(page);
  await expect(
    page.getByLabel("Continue this task with a new bounded attempt"),
  ).toHaveCount(0);
  await expect(page.getByTestId("message-composer")).toHaveCount(0);
  expect(await sends(page)).toEqual([]);
});

test("canonical kind9 relay final refreshes the selected transcript without the Refresh button", async ({
  page,
}) => {
  await open(page);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
          channelName: "general",
          kind: 9,
        }),
      ),
    )
    .toBe(true);
  await page.evaluate(
    ({ taskId, pubkey, channelId }) => {
      const id = "de".repeat(32);
      window.__BUZZ_E2E_AGENT_INBOX__?.reads[taskId].events.push({
        id,
        pubkey,
        content: "Live canonical continuation reply.",
        created_at: Math.floor(Date.now() / 1000),
        kind: 9,
        tags: [
          ["h", channelId],
          ["exchange", taskId, "1"],
        ],
        sig: "",
      });
      const event = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        id,
        kind: 9,
        channelId,
        pubkey,
        content: "Untrusted relay hint body must not render.",
        extraTags: [["exchange", taskId, "1"]],
      });
      if (!event) throw new Error("Mock relay emission unavailable");
    },
    { taskId: TASK, pubkey: ANIMA, channelId: CHANNEL },
  );
  await expect(
    page.getByText("Live canonical continuation reply.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Untrusted relay hint body must not render.", {
      exact: true,
    }),
  ).toHaveCount(0);
  expect(await sends(page)).toEqual([]);
});

test("candidate timing sample: cached selection and typing with1000 paginated tasks", async ({
  page,
}, testInfo) => {
  await open(page, "light", 0, false, (data) => {
    const [first, second] = data.pages[0].tasks;
    const rest = Array.from({ length: 998 }, (_, index) => {
      const copy = structuredClone(first) as {
        record: { exchange_id: string };
        recordUpdatedAt: number;
      };
      copy.record.exchange_id = (index + 1000).toString(16).padStart(64, "0");
      copy.recordUpdatedAt -= index + 1;
      return copy;
    });
    const all = [first, second, ...rest];
    const base = data.pages[0];
    data.pages = Array.from({ length: 20 }, (_, index) => ({
      ...base,
      tasks: all.slice(index * 50, (index + 1) * 50),
      nextCursor:
        index < 19 ? { scope, until: 1, beforeId: `page-${index}` } : null,
    }));
  });
  const rows = page
    .getByRole("navigation", { name: "Tasks" })
    .getByRole("button");
  await expect(rows).toHaveCount(50);
  await rows.nth(1).click();
  await expect(
    page.getByText("No messages available for this task."),
  ).toBeVisible();
  await rows.first().click();
  await page.getByLabel("Reply recipient").selectOption(ANIMA);
  await expect(page.getByTestId("message-input")).toBeVisible();
  await page.evaluate(() => {
    const samples: Array<{ name: string; handlerMs: number }> = [];
    const longTasks: number[] = [];
    const events = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const timing = entry as PerformanceEventTiming;
        samples.push({
          name: timing.name,
          handlerMs: timing.processingEnd - timing.processingStart,
        });
      }
    });
    events.observe({
      type: "event",
      durationThreshold: 16,
    } as PerformanceObserverInit);
    const tasks = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push(entry.duration);
    });
    tasks.observe({ type: "longtask" });
    Object.assign(window, {
      __inboxTimingSample: {
        samples,
        longTasks,
        stop: () => {
          events.disconnect();
          tasks.disconnect();
        },
      },
    });
  });
  for (let index = 0; index < 5; index++) {
    await rows.nth(1).click();
    await rows.first().click();
  }
  await page.getByLabel("Reply recipient").selectOption(ANIMA);
  await page
    .getByTestId("message-input")
    .pressSequentially("Cached task typing remains local and scoped.");
  await expect(page.getByTestId("message-input")).toHaveText(
    "Cached task typing remains local and scoped.",
  );
  const timing = await page.evaluate(() => {
    const sample = (
      window as unknown as {
        __inboxTimingSample: {
          samples: Array<{ name: string; handlerMs: number }>;
          longTasks: number[];
          stop: () => void;
        };
      }
    ).__inboxTimingSample;
    sample.stop();
    return {
      handlerSamples: sample.samples,
      longTasksOver50Ms: sample.longTasks.filter((duration) => duration > 50),
    };
  });
  await testInfo.attach("candidate-cached-selection-typing-timings", {
    body: JSON.stringify(
      {
        taskFixtureCount: 1000,
        pageSize: 50,
        selectedTasksWarmed: 2,
        scope:
          "EventTiming JS processing only; not network latency; candidate-only, no baseline",
        ...timing,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
});

test("opening reads only the selected task and uses production rich text without spheres", async ({
  page,
}) => {
  await open(page);
  await expect(
    page.getByRole("heading", { name: "Review", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Reference" })).toBeVisible();
  await expect(page.locator("article pre")).toContainText(
    "const ready = true;",
  );
  await expect(
    page.locator("[data-resident-mark-kind=character], mote-3d"),
  ).toHaveCount(0);
  await expect(page.getByText("You", { exact: true })).toBeVisible();
  await expect(page.getByTestId("exchange-owner-avatar-fallback")).toHaveText(
    "Y",
  );
  await expect(
    page.getByTestId("exchange-owner-avatar-fallback"),
  ).toBeVisible();
  await expect(
    page
      .getByText("You", { exact: true })
      .locator("../..")
      .locator("[data-agent-dendrite]"),
  ).toHaveCount(0);
  expect(await sends(page)).toEqual([]);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window.__BUZZ_E2E_COMMAND_LOG__ ?? []).filter(
            (entry) => entry.command === "query_agent_inbox",
          ).length,
      ),
    )
    .toBeGreaterThan(0);
  const filters = await page.evaluate(() =>
    (window.__BUZZ_E2E_COMMAND_LOG__ ?? [])
      .filter((entry) => entry.command === "query_agent_inbox")
      .map(
        (entry) =>
          (
            entry.payload as {
              query: { residentPubkey?: string; correspondentPubkey?: string };
            }
          ).query,
      ),
  );
  for (const filter of filters)
    expect([filter.residentPubkey, filter.correspondentPubkey].sort()).toEqual(
      [LUCA, ANIMA].sort(),
    );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window.__BUZZ_E2E_COMMAND_LOG__ ?? []).filter(
            (entry) => entry.command === "mark_agent_inbox_task_read",
          ).length,
      ),
    )
    .toBeGreaterThan(0);
});

test("an older initial task remains selectable without scanning unrelated owner history", async ({
  page,
}) => {
  await open(page, "light", 0, true);
  await expect(
    page
      .getByRole("navigation", { name: "Tasks" })
      .getByRole("button", { name: /Review the onboarding flow/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("article", { name: "Review the onboarding flow" }),
  ).toBeVisible();
});

test("stopping is an explicit exact-exchange decision, never a side effect of viewing", async ({
  page,
}) => {
  await open(page);
  await expect(
    page.getByRole("button", { name: "Stop exchange", exact: true }),
  ).toBeVisible();
  const decisions = () =>
    page.evaluate(() =>
      (window.__BUZZ_E2E_COMMAND_LOG__ ?? [])
        .filter((entry) => entry.command === "resolve_exchange")
        .map((entry) => entry.payload),
    );
  expect(await decisions()).toEqual([]);
  await page
    .getByRole("button", { name: "Stop exchange", exact: true })
    .click();
  await expect.poll(decisions).toEqual([{ exchangeId: TASK, action: "stop" }]);
  await expect(
    page.getByRole("button", { name: "Stop exchange", exact: true }),
  ).toHaveCount(0);
});

test("fifty task rows cannot push the selected transcript out of reach", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.evaluate(() => {
    const fixture = window.__BUZZ_E2E_AGENT_INBOX__;
    if (!fixture) throw new Error("Missing fixture");
    const first = fixture.pages[0].tasks[0] as {
      record: Record<string, unknown>;
    };
    fixture.pages[0].tasks = Array.from({ length: 50 }, (_, index) => ({
      ...first,
      record: {
        ...first.record,
        exchange_id: (index + 1).toString(16).padStart(64, "0"),
      },
    }));
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  const selector = page.getByRole("navigation", { name: "Tasks" });
  await expect(selector.getByRole("button")).toHaveCount(51);
  expect((await selector.boundingBox())?.height).toBeLessThanOrEqual(161);
  expect(
    (
      await page
        .getByRole("article", { name: "Review the onboarding flow" })
        .boundingBox()
    )?.y,
  ).toBeLessThan(400);
});

test("reply requires an explicit agent and preserves request identity on an exact retry", async ({
  page,
}) => {
  await open(page, "light", 1);
  await expect(page.getByTestId("message-composer")).toHaveCount(0);
  await page.getByLabel("Reply recipient").selectOption(ANIMA);
  const input = page.getByTestId("message-input");
  await input.fill("Please check the second step too.");
  await page.getByTestId("send-message").click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Temporarily disconnected" })
      .first(),
  ).toContainText("Temporarily disconnected");
  await expect(input).toContainText("Please check the second step too.");
  await page.getByTestId("send-message").click();
  await expect(input).toHaveText("");
  const calls = await sends(page);
  expect(calls).toHaveLength(2);
  expect(calls[0].idempotencyKey).toBe(calls[1].idempotencyKey);
  expect(calls[1].exchangeId).toBe(TASK);
  expect(calls[1].recipientPubkey).toBe(ANIMA);
  expect(calls[1].continuationIntent).toBe(false);
});

test("mentioning another resident cannot create, invite, wake or redirect a fixed-recipient reply", async ({
  page,
}) => {
  await open(page);
  await page.getByLabel("Reply recipient").selectOption(ANIMA);
  const input = page.getByTestId("message-input");
  await input.fill("@Wren");
  await page
    .getByTestId("mention-autocomplete")
    .locator("button", { hasText: "Wren" })
    .click();
  await input.press("End");
  await page.keyboard.type(" is referenced only; this reply is for Anima.");
  const before = await page.evaluate(
    () => window.__BUZZ_E2E_COMMAND_LOG__?.length ?? 0,
  );
  await page.getByTestId("send-message").click();
  await expect(input).toHaveText("");
  const calls = await sends(page);
  expect(calls).toHaveLength(1);
  expect(calls[0].recipientPubkey).toBe(ANIMA);
  expect(calls[0].content).toContain("Wren");
  const mutations = await page.evaluate(
    (before) =>
      (window.__BUZZ_E2E_COMMAND_LOG__ ?? [])
        .slice(before)
        .filter((entry) =>
          /(?:create|provision|start).*agent|add_channel_members|create_dm|send_channel_message/.test(
            entry.command,
          ),
        )
        .map((entry) => entry.command),
    before,
  );
  expect(mutations).toEqual([]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("switching task preserves its separate draft and never resumes closed work on view", async ({
  page,
}) => {
  await open(page);
  await page.getByLabel("Reply recipient").selectOption(ANIMA);
  await page.getByTestId("message-input").fill("Task A draft");
  await page
    .getByRole("navigation", { name: "Tasks" })
    .getByRole("button")
    .nth(1)
    .click();
  await expect(
    page.getByText("No messages available for this task."),
  ).toBeVisible();
  await page.getByLabel("Reply recipient").selectOption(ANIMA);
  await expect(page.getByTestId("message-composer")).toHaveCount(0);
  await expect(
    page.getByText(
      "This task is closed. Continuing it is not available here yet.",
    ),
  ).toBeVisible();
  expect(await sends(page)).toEqual([]);
  await page
    .getByRole("navigation", { name: "Tasks" })
    .getByRole("button")
    .first()
    .click();
  await page.getByLabel("Reply recipient").selectOption(ANIMA);
  await expect(page.getByTestId("message-input")).toHaveText("Task A draft");
});

test("an uncertain reply keeps its request identity after reopening the window", async ({
  page,
}) => {
  await open(page, "light", 1);
  await page.getByLabel("Reply recipient").selectOption(ANIMA);
  await page.getByTestId("message-input").fill("Keep this exact request.");
  await page.getByTestId("send-message").click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Temporarily disconnected" })
      .first(),
  ).toBeVisible();
  const originalKey = (await sends(page))[0].idempotencyKey;
  await page.reload();
  await expect(
    page.getByRole("article", { name: "Review the onboarding flow" }),
  ).toBeVisible();
  await page.getByLabel("Reply recipient").selectOption(ANIMA);
  await expect(page.getByTestId("message-input")).toHaveText(
    "Keep this exact request.",
  );
  await page.getByTestId("send-message").click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Temporarily disconnected" })
      .first(),
  ).toBeVisible();
  expect((await sends(page))[0].idempotencyKey).toBe(originalKey);
});

test("owner-scoped uploaded chat pictures take precedence over generated identity", async ({
  page,
}) => {
  const picture =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=";
  await page.addInitScript(
    ({ key, picture }) => localStorage.setItem(key, picture),
    { key: `polyphonic.chat-picture.v1:${OWNER}:${ANIMA}`, picture },
  );
  await open(page);
  await expect(page.getByAltText("Anima avatar")).toBeVisible();
  await expect(page.getByAltText("Anima avatar")).toHaveAttribute(
    "src",
    picture,
  );
});

test("largest reading text and reduced motion fit the minimum-width window", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 560 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() =>
    localStorage.setItem(
      "luca.message-text-size.v1",
      JSON.stringify({ version: 1, size: "large" }),
    ),
  );
  await open(page, "dark");
  await page.getByLabel("Reply recipient").selectOption(ANIMA);
  await expect(page.locator("html")).toHaveAttribute(
    "data-message-text",
    "large",
  );
  await expect(page.getByTestId("message-composer")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/agent-inbox-window/dark-390-large-reduced.png",
  });
});

for (const dpr of [1, 2])
  test.describe(`DPR ${dpr}`, () => {
    test.use({ deviceScaleFactor: dpr });
    for (const theme of ["light", "dark"])
      for (const width of [1440, 1280, 1024, 390, 380]) {
        test(`correspondence render ${theme} ${width}`, async ({ page }) => {
          await page.setViewportSize({ width, height: 844 });
          await open(page, theme);
          await page.getByLabel("Reply recipient").selectOption(ANIMA);
          await expect(page.getByTestId("message-composer")).toBeVisible();
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
          ).toBe(true);
          await page.screenshot({
            path: `test-results/agent-inbox-window/${theme}-${width}-dpr${dpr}.png`,
          });
        });
      }
  });

async function mainPair(
  page: Page,
  options: { seed?: string; task?: string; recipient?: string } = {
    seed: TASK,
    recipient: ANIMA,
  },
) {
  // TanStack's search codec quotes numeric-looking public keys so JSON parsing
  // cannot turn a 64-digit fixture identity into a lossy number.
  const search = new URLSearchParams(
    Object.entries(options).map(([key, value]) => [key, JSON.stringify(value)]),
  ).toString();
  await page.goto(`/#/correspondence/${PAIR}?${search}`);
  await expect(
    page.locator(
      '[data-testid="correspondence-window"][data-presentation="main"]',
    ),
  ).toBeVisible();
}

test("rail correspondence opens as the main chat with normal Back and Forward", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "dark", 0, false, enableOwnerWrites, true, false);
  const original = page.url();
  const row = page.getByRole("button", { name: /^With Luca/ });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/correspondence/${PAIR}`));
  await expect(page.getByTestId("task-chat-pane")).toHaveCount(0);
  const chat = page.getByTestId("correspondence-window");
  await expect(chat).toHaveAttribute("data-presentation", "main");
  await expect(row).toHaveAttribute("aria-current", "page");
  await expect(chat.getByTestId("message-input")).toBeEditable();
  await expect(
    chat.getByRole("button", { name: "Reply to this task", exact: true }),
  ).toBeVisible();
  await expect(chat.getByText(/Sending a message resumes/)).toHaveCount(0);
  await chat.getByTestId("message-input").fill("General conversation draft");
  await page.goBack();
  await expect(page).toHaveURL(original);
  await page.goForward();
  await expect(chat.getByTestId("message-input")).toHaveText(
    "General conversation draft",
  );
  expect(await sends(page)).toEqual([]);
  expect(
    await page.evaluate(() =>
      (window.__BUZZ_E2E_COMMAND_LOG__ ?? []).filter((entry) =>
        /^(create_(channel|project|group)|send_agent_|resolve_exchange|start_local_agent)/.test(
          entry.command,
        ),
      ),
    ),
  ).toEqual([]);
});

test("promoting beside to main preserves the exact task, recipient, reply target and draft", async ({
  page,
}) => {
  await open(page, "dark", 0, false, enableOwnerWrites, true);
  const pane = page.getByTestId("task-chat-pane");
  await pane
    .getByRole("button", { name: "Reply to Anima", exact: true })
    .click();
  await pane.getByTestId("message-input").fill("A focused reply draft");
  await pane.getByRole("button", { name: "Conversation options" }).click();
  await page.getByRole("menuitem", { name: "Open in main chat" }).click();
  await expect(pane).toHaveCount(0);
  const chat = page.getByTestId("correspondence-window");
  await expect(chat).toHaveAttribute("data-presentation", "main");
  await expect(chat.getByTestId("message-input")).toHaveText(
    "A focused reply draft",
  );
  await expect(
    chat.getByRole("button", { name: /Cancel reply/ }),
  ).toBeVisible();
  await chat.getByTestId("send-message").click();
  await expect.poll(async () => (await sends(page)).length).toBe(1);
  expect((await sends(page))[0]).toMatchObject({
    exchangeId: TASK,
    recipientPubkey: ANIMA,
    replyEventId: TURN,
    continuationIntent: false,
  });
});

test("a general pair message never continues the closed task used to load history", async ({
  page,
}) => {
  await open(page, "light", 0, false, enableOwnerWrites, true, false);
  await mainPair(page, { seed: OTHER_TASK, recipient: ANIMA });
  const chat = page.getByTestId("correspondence-window");
  await expect(chat.getByTestId("message-input")).toBeEditable();
  await expect(chat.getByText(/Sending a message resumes/)).toHaveCount(0);
  await chat
    .getByTestId("message-input")
    .fill("A different question for Anima");
  await chat.getByTestId("send-message").click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window.__BUZZ_E2E_COMMAND_LOG__ ?? []).filter(
            (entry) => entry.command === "send_agent_inbox_message",
          ).length,
      ),
    )
    .toBe(1);
  const message = await page.evaluate(
    () =>
      (window.__BUZZ_E2E_COMMAND_LOG__ ?? []).find(
        (entry) => entry.command === "send_agent_inbox_message",
      )?.payload,
  );
  expect(message).toMatchObject({
    input: {
      sourceExchangeId: OTHER_TASK,
      recipientPubkey: ANIMA,
      content: "A different question for Anima",
    },
  });
  expect(await sends(page)).toEqual([]);
});

test("canceling a focused reply restores the general draft and recipient", async ({
  page,
}) => {
  await open(page, "dark", 0, false, enableOwnerWrites, true, false);
  await mainPair(page);
  const chat = page.getByTestId("correspondence-window");
  await chat.getByTestId("message-input").fill("My general question");
  await chat
    .getByRole("button", { name: "Reply to Anima", exact: true })
    .click();
  await chat.getByTestId("message-input").fill("A separate task reply");
  await chat.getByRole("button", { name: /Cancel reply/ }).click();
  await expect(chat.getByTestId("message-input")).toHaveText(
    "My general question",
  );
  await expect(
    chat.getByRole("button", { name: "Reply to this task", exact: true }),
  ).toBeVisible();
  expect(await sends(page)).toEqual([]);
});

test("main chat denies foreign recipients and history, without falling back or dispatching", async ({
  page,
}) => {
  await open(page, "light", 0, false, enableOwnerWrites, true, false);
  await mainPair(page, { seed: TASK, recipient: "ff".repeat(32) });
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "not part of this conversation" }),
  ).toBeVisible();
  await expect(
    page.getByTestId("correspondence-window").getByTestId("message-input"),
  ).toHaveCount(0);
  await mainPair(page, { seed: "ee".repeat(32), recipient: ANIMA });
  await expect(
    page.getByRole("alert").filter({ hasText: "unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByTestId("correspondence-window").getByTestId("message-input"),
  ).toHaveCount(0);
  expect(await sends(page)).toEqual([]);
});

test("an explicit beside request for the current main pair never duplicates its chat", async ({
  page,
}) => {
  await open(page, "dark", 0, false, enableOwnerWrites, true, false);
  await mainPair(page);
  await page.evaluate(
    (id) =>
      window.dispatchEvent(
        new CustomEvent("polyphonic:open-task-chat", { detail: id }),
      ),
    OTHER_TASK,
  );
  await expect(page).toHaveURL(new RegExp(`task=${OTHER_TASK}`));
  await expect(page.getByTestId("task-chat-pane")).toHaveCount(0);
  await expect(page.getByTestId("correspondence-window")).toHaveCount(1);
  await expect(
    page.getByText("Sending a message resumes this task with Anima."),
  ).toBeVisible();
  expect(await sends(page)).toEqual([]);
});

test("Open beside is explicit in the rail menu and normal navigation closes it without execution", async ({
  page,
}) => {
  await open(page, "dark", 0, false, enableOwnerWrites, true, false);
  const route = page.url();
  const row = page.getByRole("button", { name: /^With Luca/ });
  await row.click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Open beside", exact: true })
    .click();
  await expect(page.getByTestId("task-chat-pane")).toBeVisible();
  expect(page.url()).toBe(route);
  await row.click();
  await expect(page.getByTestId("task-chat-pane")).toHaveCount(0);
  await expect(page.getByTestId("correspondence-window")).toHaveAttribute(
    "data-presentation",
    "main",
  );
  expect(await sends(page)).toEqual([]);
});

test("main and beside share a general draft and retain the reading position", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(
    page,
    "dark",
    0,
    false,
    (data) => {
      enableOwnerWrites(data);
      const source = data.reads[TASK].events[1];
      for (let i = 0; i < 60; i++)
        data.reads[TASK].events.push({
          ...source,
          id: i.toString(16).padStart(64, "0"),
          created_at: source.created_at + i + 1,
          content: `Review note ${i}. The same canonical conversation can be read in either presentation.`,
        });
    },
    true,
  );
  const pane = page.getByTestId("task-chat-pane");
  const scroller = pane.locator(
    "[data-testid=correspondence-window] > .overflow-y-auto",
  );
  await scroller.evaluate((node) => {
    node.scrollTop = 240;
    node.dispatchEvent(new Event("scroll"));
  });
  await pane.getByRole("button", { name: "Conversation options" }).click();
  await page
    .getByRole("menuitem", { name: "New message", exact: true })
    .click();
  await pane
    .getByTestId("message-input")
    .fill("A general draft while reading history");
  const readingPosition = await scroller.evaluate((node) => node.scrollTop);
  await pane.getByRole("button", { name: "Conversation options" }).click();
  await page.getByRole("menuitem", { name: "Open in main chat" }).click();
  const chat = page.getByTestId("correspondence-window");
  await expect(pane).toHaveCount(0);
  await expect(chat.getByTestId("message-input")).toHaveText(
    "A general draft while reading history",
  );
  await expect(
    chat.getByRole("button", { name: "Reply to this task", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      chat
        .locator(":scope > .overflow-y-auto")
        .evaluate((node) => node.scrollTop),
    )
    .toBe(readingPosition);
  expect(await sends(page)).toEqual([]);
});

for (const theme of ["dark", "light"]) {
  test(`main correspondence uses production chat at desktop sizes: ${theme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, theme, 0, false, enableOwnerWrites, true, false);
    await mainPair(page);
    for (const width of [1440, 1280, 1024, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(
        page.getByTestId("correspondence-window").getByTestId("message-input"),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/task-chat/main-${theme}-${width}.png`,
      });
    }
  });
}
