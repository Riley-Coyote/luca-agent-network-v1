import { expect, test, type Page } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";

const CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const PRESENTATION_EVENT = "luca://managed-presentation";
const RESIDENTS = [
  { name: "Claude Code", pubkey: TEST_IDENTITIES.alice.pubkey },
  { name: "Codex", pubkey: TEST_IDENTITIES.charlie.pubkey },
  { name: "Luca", pubkey: TEST_IDENTITIES.bob.pubkey },
  { name: "Mara", pubkey: "a".repeat(64) },
] as const;

async function openConversation(page: Page) {
  await installMockBridge(page, {
    managedAgents: RESIDENTS.map((resident) => ({
      channelNames: ["general"],
      name: resident.name,
      pubkey: resident.pubkey,
      status: "running" as const,
    })),
  });
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
}

async function openGroupDirectConversation(page: Page) {
  const firstMessage = "Start one independent response each.";
  await installMockBridge(page, {
    managedAgents: RESIDENTS.slice(0, 2).map((resident) => ({
      channelNames: ["general"],
      name: resident.name,
      pubkey: resident.pubkey,
      status: "running" as const,
    })),
    searchProfiles: [TEST_IDENTITIES.alice, TEST_IDENTITIES.charlie].map(
      (identity) => ({
        displayName: identity.username,
        isAgent: true,
        pubkey: identity.pubkey,
      }),
    ),
  });
  await page.goto("/?e2e=mock");
  await page.getByTestId("new-message-page").waitFor({ state: "visible" });
  for (const resident of RESIDENTS.slice(0, 2)) {
    await page.getByTestId("new-dm-search").fill(resident.name);
    await page.getByTestId(`new-dm-result-${resident.pubkey}`).click();
  }
  await page.getByTestId("message-input").fill(firstMessage);
  await page.getByTestId("send-message").click();
  await expect(page).toHaveURL(/\/channels\//);
  const { conversationId, receiptId } = await page.evaluate(async (content) => {
    const sends = (window.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? []).filter(
      (entry) => entry.command === "send_channel_message",
    );
    const conversationId = String(
      (sends.at(-1)?.payload as { channelId?: unknown } | undefined)
        ?.channelId ?? "",
    );
    const search = (await window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.(
      "search_messages",
      { q: content, limit: 10 },
    )) as
      | {
          hits?: Array<{
            channel_id?: string | null;
            content?: string;
            event_id?: string;
          }>;
        }
      | undefined;
    const receiptId =
      search?.hits?.find(
        (hit) => hit.channel_id === conversationId && hit.content === content,
      )?.event_id ?? "";
    return { conversationId, receiptId };
  }, firstMessage);
  if (!conversationId || !receiptId) {
    throw new Error("Expected a Group DM conversation and dispatch receipt.");
  }
  for (const [index, resident] of RESIDENTS.slice(0, 2).entries()) {
    await page.evaluate(
      ({ eventName, frame }) => {
        window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.(eventName, frame);
      },
      {
        eventName: PRESENTATION_EVENT,
        frame: {
          protocol: "luca.managed.presentation.v1",
          kind: "turn_started",
          resident_pubkey: resident.pubkey,
          conversation_id: conversationId,
          turn_id: `group-stop-all-${index}`,
          dispatch_receipt_id: receiptId,
          session_epoch: 7,
          sequence: 1,
        },
      },
    );
  }
}

async function seedResidentActivity(page: Page) {
  await page.waitForFunction(
    () => typeof window.__BUZZ_E2E_SEED_ACTIVE_TURNS__ === "function",
  );
  await page.evaluate(
    ({ channelId, residents }) => {
      for (const [index, resident] of residents.entries()) {
        const turnId = `activity-shelf-turn-${index}`;
        window.__BUZZ_E2E_SEED_ACTIVE_TURNS__?.({
          agentPubkey: resident.pubkey,
          channelId,
          turnId,
        });
        window.__BUZZ_E2E_SEED_ACTIVE_TURNS__?.({
          agentPubkey: resident.pubkey,
          channelId,
          turnId,
          kind: "acp_read",
          payload: {
            method: "session/update",
            params: {
              update: {
                sessionUpdate:
                  index === 0
                    ? "agent_thought_chunk"
                    : index === 1
                      ? "tool_call"
                      : "agent_message_chunk",
                ...(index === 1 ? { kind: "search" } : {}),
              },
            },
          },
        });
      }
    },
    { channelId: CHANNEL_ID, residents: RESIDENTS },
  );
}

test("activity shelf keeps three stable residents and discloses the rest", async ({
  page,
}) => {
  await openConversation(page);
  const composerBefore = await page
    .getByTestId("message-composer")
    .boundingBox();
  await seedResidentActivity(page);

  const shelf = page.getByTestId("conversation-activity-shelf");
  await expect(shelf).toHaveAttribute("data-active-count", "4");
  await expect(shelf).toHaveCSS("transition-property", "opacity");
  const composerAfter = await page
    .getByTestId("message-composer")
    .boundingBox();
  expect(composerAfter).toEqual(composerBefore);
  const shelfHeights = await shelf.evaluate(
    (element) =>
      new Promise<number[]>((resolve) => {
        const heights: number[] = [];
        const sample = () => {
          heights.push(element.getBoundingClientRect().height);
          if (heights.length === 4) resolve(heights);
          else requestAnimationFrame(sample);
        };
        sample();
      }),
  );
  expect(new Set(shelfHeights)).toEqual(new Set([60]));
  await expect(shelf).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(shelf).toHaveCSS("pointer-events", "none");
  await expect(
    page.getByTestId(
      "resident-activity-953d3363262e86b770419834c53d2446409db6d918a57f8f339d495d54ab001f",
    ),
  ).toHaveAttribute("data-activity-state", "thinking");
  await expect(page.getByText("+1 working", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stop Claude Code" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", {
      name: "Stop all active residents in this conversation",
    }),
  ).toHaveCount(0);
  await expect(page.locator(".luca-activity-item__elapsed")).toHaveCount(0);
  const sandpile = page.locator("[data-sandpile-activity]").first();
  await expect(sandpile.locator("..")).toHaveCSS("border-top-width", "0px");
  await expect(sandpile).toHaveCSS("width", "32px");
  await expect(sandpile).toHaveAttribute("data-sandpile-grid-size", "32");
  const firstFrame = await sandpile.evaluate((canvas) => {
    const surface = canvas as HTMLCanvasElement;
    const context = surface.getContext("2d");
    if (!context) return null;
    const { data, height, width } = context.getImageData(
      0,
      0,
      surface.width,
      surface.height,
    );
    const alphaAt = (x: number, y: number) => data[(y * width + x) * 4 + 3];
    let checksum = 0;
    for (let index = 0; index < data.length; index += 29) {
      checksum = (checksum + data[index]) % 1_000_003;
    }
    return {
      backingMatchesDisplay:
        width ===
        Math.round(
          Math.min(
            surface.getBoundingClientRect().width,
            surface.getBoundingClientRect().height,
          ) * window.devicePixelRatio,
        ),
      centerAlpha: alphaAt(width >> 1, height >> 1),
      checksum,
      cornerAlpha: alphaAt(0, 0),
      gridSize: Number(surface.dataset.sandpileGridSize),
    };
  });
  expect(firstFrame?.backingMatchesDisplay).toBe(true);
  expect(firstFrame?.gridSize).toBe(32);
  expect(firstFrame?.cornerAlpha).toBe(0);
  expect(firstFrame?.centerAlpha).toBe(255);
  await expect
    .poll(() =>
      sandpile.evaluate((canvas) => {
        const surface = canvas as HTMLCanvasElement;
        const context = surface.getContext("2d");
        if (!context) return 0;
        const { data } = context.getImageData(
          0,
          0,
          surface.width,
          surface.height,
        );
        let checksum = 0;
        for (let index = 0; index < data.length; index += 29) {
          checksum = (checksum + data[index]) % 1_000_003;
        }
        return checksum;
      }),
    )
    .not.toBe(firstFrame?.checksum);
  const disclosure = page.getByRole("button", {
    name: "+1 working. View all resident activity.",
  });
  await expect(disclosure).toHaveCSS("pointer-events", "auto");
  await disclosure.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "All resident activity" }),
  ).toContainText("Mara");
  await page.keyboard.press("Escape");
  await expect(disclosure).toBeFocused();
});

test("composer focus adds only the directional material edge", async ({
  page,
}) => {
  await openConversation(page);
  const composer = page.getByTestId("message-composer");
  await page.getByTestId("channel-general").focus();
  await expect
    .poll(() =>
      composer.evaluate(
        (element) => getComputedStyle(element, "::after").opacity,
      ),
    )
    .toBe("0");
  const inactive = await composer.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const edge = getComputedStyle(element, "::after");
    return {
      background: style.backgroundColor,
      borderColor: style.borderColor,
      edgeOpacity: edge.opacity,
      height: bounds.height,
      width: bounds.width,
    };
  });
  expect(inactive.borderColor).toBe("rgba(0, 0, 0, 0)");
  expect(inactive.edgeOpacity).toBe("0");

  await page.getByTestId("message-input").focus();
  await expect
    .poll(() =>
      composer.evaluate(
        (element) => getComputedStyle(element, "::after").opacity,
      ),
    )
    .toBe("1");
  const active = await composer.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const edge = getComputedStyle(element, "::after");
    return {
      background: style.backgroundColor,
      borderColor: style.borderColor,
      edgeBackground: edge.backgroundImage,
      edgeOpacity: edge.opacity,
      edgePadding: edge.paddingTop,
      height: bounds.height,
      width: bounds.width,
    };
  });
  expect(active.borderColor).toBe("rgba(0, 0, 0, 0)");
  expect(active.edgeOpacity).toBe("1");
  expect(active.edgeBackground).toContain("linear-gradient");
  expect(Number.parseFloat(active.edgePadding)).toBeLessThanOrEqual(1);
  expect(active.background).toBe(inactive.background);
  expect(active.height).toBe(inactive.height);
  expect(active.width).toBe(inactive.width);
});

test("multi-resident direct conversations expose Stop all", async ({
  page,
}) => {
  await openGroupDirectConversation(page);

  const shelf = page.getByTestId("conversation-activity-shelf");
  await expect(shelf).toHaveAttribute("data-active-count", "2");
  const stopAll = page.getByRole("button", {
    name: "Stop all active residents in this conversation",
  });
  await expect(stopAll).toBeVisible();
  await expect(stopAll).toBeEnabled();
  await stopAll.click();

  await expect
    .poll(() =>
      page.evaluate(() =>
        (window.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? [])
          .filter((entry) => entry.command === "cancel_managed_turn")
          .map((entry) =>
            String(
              (entry.payload as { residentPubkey?: unknown }).residentPubkey,
            ),
          )
          .sort(),
      ),
    )
    .toEqual(
      [TEST_IDENTITIES.alice.pubkey, TEST_IDENTITIES.charlie.pubkey].sort(),
    );
});

test("activity shelf collapses and settles motion at compact Mac size", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 500 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openConversation(page);
  await seedResidentActivity(page);

  await expect(
    page.getByRole("button", {
      name: "4 residents working. View all resident activity.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "+1 working. View all resident activity.",
    }),
  ).toBeHidden();

  const animationName = await page
    .locator(".luca-activity-pulse")
    .first()
    .evaluate((cell) => getComputedStyle(cell).animationName);
  expect(animationName).toBe("none");
  const sandpile = page.locator("[data-sandpile-activity]").first();
  const checksum = () =>
    sandpile.evaluate((canvas) => {
      const surface = canvas as HTMLCanvasElement;
      const context = surface.getContext("2d");
      if (!context) return 0;
      const { data } = context.getImageData(
        0,
        0,
        surface.width,
        surface.height,
      );
      let value = 0;
      for (let index = 0; index < data.length; index += 29) {
        value = (value + data[index]) % 1_000_003;
      }
      return value;
    });
  const firstFrame = await checksum();
  await page.waitForTimeout(160);
  expect(await checksum()).toBe(firstFrame);
  await expect(page.getByTestId("message-input")).toBeVisible();
});

test("activity controls stay usable at compact size and 200% text", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 500 });
  await openConversation(page);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await seedResidentActivity(page);

  const disclosure = page.getByRole("button", {
    name: "4 residents working. View all resident activity.",
  });
  await expect(disclosure).toBeVisible();
  await disclosure.click();
  await expect(
    page.getByRole("dialog", { name: "All resident activity" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(disclosure).toBeFocused();
  await expect(page.getByTestId("message-input")).toBeVisible();

  const documentGeometry = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(documentGeometry.scrollWidth).toBeLessThanOrEqual(
    documentGeometry.clientWidth,
  );
});
