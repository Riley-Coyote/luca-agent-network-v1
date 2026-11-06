import { expect, type Page } from "@playwright/test";
import { installMockBridge, TEST_IDENTITIES } from "./bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "./features";

export const MOTION_CHANNEL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
export const MOTION_TASK = "ab".repeat(32);
export const MOTION_PAIR = `correspondence-v1-${"12".repeat(32)}`;

/** The current production shell with explicit mock task data, never a dispatch. */
export async function openMotionShell(page: Page, theme = "dark") {
  const owner = "deadbeef".repeat(8);
  const luca = TEST_IDENTITIES.bob.pubkey;
  const anima = TEST_IDENTITIES.charlie.pubkey;
  const now = Math.floor(Date.now() / 1000);
  const scope = {
    communityId: "9b603e66-0283-4bb6-9808-309a2bef4927",
    ownerPubkey: owner,
  };
  const task = {
    correspondenceId: MOTION_PAIR,
    subject: "Review the onboarding flow",
    record: {
      protocol: "luca.exchange.v1",
      exchange_id: MOTION_TASK,
      owner,
      members: [luca, anima],
      conversation_id: MOTION_CHANNEL,
      root_event_id: "11".repeat(32),
      depth: 1,
      bucket: 3,
      state: "open",
      deadline: now + 3600,
      opened_by: luca,
    },
    recordEventId: MOTION_TASK,
    recordUpdatedAt: now,
    outcome: "unknown",
  };
  await page.addInitScript(
    ({ key, theme, task, scope, owner, anima, now }) => {
      localStorage.setItem(key, JSON.stringify({ "shell-frame": true }));
      localStorage.setItem(
        "buzz-theme",
        theme === "light" ? "paper" : "buzz-dark",
      );
      localStorage.setItem("buzz-follow-system", "false");
      localStorage.setItem("polyphonic-frame", "glass");
      const event = (id: string, pubkey: string, content: string) => ({
        id,
        pubkey,
        content,
        created_at: now - 60,
        kind: 40002,
        tags: [
          ["h", task.record.conversation_id],
          ["exchange", task.record.exchange_id, "1"],
        ],
        sig: "",
      });
      window.__BUZZ_E2E_AGENT_INBOX__ = {
        pages: [{ scope, tasks: [task], nextCursor: null, partial: false }],
        reads: {
          [task.record.exchange_id]: {
            scope,
            task,
            events: [
              event("11".repeat(32), owner, "Review the onboarding flow"),
              event("22".repeat(32), anima, "The first step is clear."),
            ],
            historySource: "canonical_relay",
            partial: false,
            writeCapabilities: {
              reply: true,
              continuation: true,
              newMessage: true,
            },
          },
        },
      };
      // Exercise real reporter scheduling, not simulated optical glass.
      const native = window as typeof window & {
        isTauri?: boolean;
        __POLYPHONIC_NATIVE_GLASS__?: number;
        webkit?: unknown;
      };
      native.isTauri = true;
      native.__POLYPHONIC_NATIVE_GLASS__ = 1;
      native.webkit = {
        messageHandlers: { polyphonicGlass: { postMessage() {} } },
      };
    },
    {
      key: FEATURE_OVERRIDES_STORAGE_KEY,
      theme,
      task,
      scope,
      owner,
      anima,
      now,
    },
  );
  await installMockBridge(page, {
    managedAgents: [
      {
        pubkey: luca,
        name: "Luca",
        status: "running",
        channelNames: ["general"],
      },
      {
        pubkey: anima,
        name: "Anima",
        status: "running",
        channelNames: ["general"],
      },
    ],
    exchanges: [
      {
        exchangeId: MOTION_TASK,
        owner,
        members: [luca, anima],
        conversationId: MOTION_CHANNEL,
        rootEventId: "11".repeat(32),
        openedBy: luca,
        bucket: 3,
        spent: 1,
      },
    ],
  });
  await page.goto(`/?e2e=mock#/channels/${MOTION_CHANNEL}`);
  await expect(page.locator("[data-luca-right-cards]")).toBeAttached();
  await expect(page.getByTestId("message-input").last()).toBeVisible();
}

export async function openMotionTask(page: Page) {
  await page.evaluate(
    (id) =>
      window.dispatchEvent(
        new CustomEvent("polyphonic:open-task-chat", { detail: id }),
      ),
    MOTION_TASK,
  );
  await expect(page.getByTestId("task-chat-pane")).toBeVisible();
  await expect(
    page.getByTestId("task-chat-pane").getByTestId("message-input"),
  ).toBeEditable();
}
