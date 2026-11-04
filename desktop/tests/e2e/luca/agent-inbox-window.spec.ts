import { expect, test, type Page } from "@playwright/test";
import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";
import type { AgentInboxFixture } from "../../../src/testing/agentInboxFixture";

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
        status: "running",
        channelNames: ["general"],
      },
      {
        pubkey: ANIMA,
        name: "Anima",
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
  await page.goto(
    `/?e2e=mock&window=popout&correspondence=${PAIR}&task=${TASK}`,
  );
  await expect(page.getByTestId("correspondence-window")).toBeVisible();
  await expect(
    page.getByRole("article", { name: "Review the onboarding flow" }),
  ).toBeVisible();
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
