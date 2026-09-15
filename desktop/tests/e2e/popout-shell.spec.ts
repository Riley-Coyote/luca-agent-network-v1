import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../helpers/features";

/**
 * The pop-out chat window (Track A M1).
 *
 * Playwright cannot open a second native window, but it CAN boot the pop-out
 * shell as its own page: the bundle picks its root from `?window=popout`, so
 * everything above the window server — the shell, the providers, the
 * conversation, the composer — is exactly what the native window runs.
 *
 * What is NOT covered here, and only a live installed app can answer: window
 * creation, the reveal handshake, geometry restore, the pin actually floating
 * over other apps, the traffic lights being hidden natively, and what happens
 * when the main window closes.
 */

const GENERAL_CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const CHARLIE_DM_ID = "d1ec7000-d000-4000-8000-000000000001";
const POPOUT_URL = `/?e2e=mock&window=popout&channel=${GENERAL_CHANNEL_ID}#/channels/${GENERAL_CHANNEL_ID}`;
const POPOUT_WINDOWS_FEATURE_ID = "popout-chat-windows";
const OPEN_IN_MAIN_EVENT = "luca://popout-open-in-main";

/**
 * Claim the native runtime for one page.
 *
 * `isTauri()` is false in a browser context and every window control gates on
 * it. The mocked IPC serves the window commands they reach for.
 */
async function claimNativeRuntime(page: Page) {
  await page.addInitScript(() => {
    (window as typeof window & { isTauri?: boolean }).isTauri = true;
  });
}

test.describe("the pop-out shell", () => {
  // The window's own opening size.
  test.use({ viewport: { width: 380, height: 560 } });

  test("is one conversation and nothing else", async ({ page }) => {
    await installMockBridge(page);
    await page.goto(POPOUT_URL);

    await expect(page.getByTestId("popout-shell")).toBeVisible();
    // No second place to go: the rail and the sidebar are the main window's.
    await expect(page.getByTestId("app-sidebar")).toHaveCount(0);
    await expect(page.getByTestId("community-rail")).toHaveCount(0);

    const strip = page.getByTestId("popout-drag-strip");
    await expect(strip).toBeVisible();

    // ONE bar, and it carries the title. The conversation header the main
    // window draws is not rendered here at all: stacked under the strip it
    // restated the name and spent ~92px of a 560px window on chrome.
    await expect(page.getByTestId("chat-header")).toHaveCount(0);
    await expect(page.getByTestId("chat-title")).toHaveText("general");
    await expect(page.getByTestId("popout-title")).toHaveCount(0);
    await expect(page.getByTestId("open-channel-popout")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Open conversation details" }),
    ).toHaveCount(0);
    await expect(page.locator("[data-luca-inspector]")).toHaveCount(0);

    // The bar stands where a title bar would, and owns its full width — the
    // native traffic lights are hidden, so nothing is reserved on the left.
    const stripBox = await strip.boundingBox();
    expect(stripBox?.y).toBe(0);
    expect(stripBox?.width).toBe(380);
    expect(stripBox?.height).toBe(36);

    // With no overlaid header the timeline owes the bar air, not clearance.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const shell = document.querySelector('[data-testid="popout-shell"]');
          if (!shell) return null;
          return getComputedStyle(shell)
            .getPropertyValue("--buzz-channel-content-top-padding")
            .trim();
        }),
      )
      .toBe("12px");

    // The composer veil is present at pop-out dimensions. The header veil is
    // not: it lived inside the conversation header, which this window has
    // traded for the bar above.
    const veilBottom = page.locator(".luca-conversation-veil-bottom");
    await expect(page.locator(".luca-conversation-veil-top")).toHaveCount(0);
    await expect(veilBottom).toHaveCount(1);
    expect((await veilBottom.boundingBox())?.width).toBe(380);

    // 14px gutters, not the shared reading plane's 20px: at 380px that rule
    // spent more than a tenth of the window on air.
    const measure = page.locator(".luca-measure").first();
    expect((await measure.boundingBox())?.width).toBe(380 - 28);
  });

  test("sends into the channel from its own composer", async ({ page }) => {
    await installMockBridge(page);
    await page.goto(POPOUT_URL);
    await expect(page.getByTestId("popout-shell")).toBeVisible();

    // Messages are dropped without a live subscription; the pop-out opens its
    // own, so wait for it rather than assuming the main window's.
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

    const input = page.getByTestId("message-input");
    await input.click();
    await input.pressSequentially("sent from the pop-out");
    await page.keyboard.press("Enter");

    await expect(
      page
        .getByTestId("message-row")
        .filter({ hasText: "sent from the pop-out" }),
    ).toHaveCount(1);
    await expect(input).toHaveText("");
  });

  test("keeps the hover actions off the words until they are wanted", async ({
    page,
  }) => {
    await installMockBridge(page);
    await page.goto(POPOUT_URL);
    await expect(page.getByTestId("popout-shell")).toBeVisible();

    const row = page
      .getByTestId("message-row")
      .filter({ has: page.locator("[data-message-action-bar]") })
      .last();
    await expect(row).toBeVisible();
    const pill = row.locator("[data-message-action-bar] > *");
    await expect(pill).toHaveCount(1);

    // The reveal is a `sm:` utility, so below 640px the main window simply
    // parks this pill open — a concession to touch widths that have no
    // pointer. A pop-out is 380px with a mouse, so `popout.css` runs the
    // reveal at every width and the pill stays off the text at rest.
    await expect(pill).toHaveCSS("opacity", "0");
    await expect(pill).toHaveCSS("pointer-events", "none");

    await row.hover();
    await expect(pill).toHaveCSS("opacity", "1");
    await expect(pill).toHaveCSS("pointer-events", "auto");
  });

  test("is glass: the window opens onto the desktop, not onto a plate", async ({
    page,
  }, testInfo) => {
    await installMockBridge(page);
    await page.goto(POPOUT_URL);
    const shell = page.getByTestId("popout-shell");
    await expect(shell).toBeVisible();

    // The attribute is stamped only after the vibrancy install resolves —
    // here there is no native window, so there is nothing to wait for and
    // nothing behind the page to protect.
    await expect(page.locator("html")).toHaveAttribute(
      "data-luca-popout-glass",
      "",
    );

    // Root and body step aside entirely, so the window's own rounded corners
    // and the native shadow have nothing painted into them…
    await expect(page.locator("html")).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    await expect(page.locator("body")).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );

    // …and the shell carries the one translucent plate.
    await expect(shell).toHaveCSS("background-color", "rgba(27, 28, 29, 0.7)");

    // Nothing inside may paint an opaque surface across the window: a single
    // full-bleed opaque child and the glass is a rumour.
    const opaqueCovers = await page.evaluate(() => {
      const area = window.innerWidth * window.innerHeight;
      const offenders: string[] = [];
      for (const node of Array.from(document.body.querySelectorAll("*"))) {
        const rect = node.getBoundingClientRect();
        if (rect.width * rect.height < area * 0.85) continue;
        const style = window.getComputedStyle(node);
        const opaqueColor =
          style.backgroundColor !== "rgba(0, 0, 0, 0)" &&
          !/rgba\([^)]*,\s*0?\.\d+\)$/.test(style.backgroundColor);
        const hasImage = style.backgroundImage !== "none";
        if (opaqueColor || hasImage) {
          offenders.push(
            `${node.tagName.toLowerCase()}.${node.className || "-"}: ${style.backgroundColor} / ${style.backgroundImage}`,
          );
        }
      }
      return offenders;
    });
    expect(opaqueCovers).toEqual([]);

    // Evidence: the plate over a bright, busy stand-in for the desktop, with
    // the conversation actually in it — the composer and its veil are the
    // surfaces most likely to land as a solid band on glass.
    await expect(page.getByTestId("chat-title")).toHaveText("general");
    await expect(page.getByTestId("message-input")).toBeVisible();
    await page.evaluate(() => {
      const node = document.createElement("div");
      node.style.cssText = [
        "position:fixed",
        "inset:0",
        "z-index:-1",
        "background:" +
          "repeating-linear-gradient(45deg, rgba(0,0,0,0.07) 0 12px, rgba(255,255,255,0.07) 12px 24px)," +
          "radial-gradient(60% 70% at 25% 20%, #fff8e1, transparent 70%)," +
          "radial-gradient(70% 60% at 80% 75%, #cfe9ff, transparent 70%)," +
          "linear-gradient(140deg, #f7f4ee 0%, #e8d9c2 45%, #dbe8f2 100%)",
      ].join(";");
      document.body.appendChild(node);
    });
    const evidenceDirectory = process.env.LUCA_VISUAL_EVIDENCE_DIR?.trim();
    if (evidenceDirectory) {
      await page.screenshot({
        animations: "allow",
        path: `${evidenceDirectory}/popout-glass-over-bright-desktop.png`,
      });
    } else {
      await testInfo.attach("pop-out glass over a bright desktop", {
        body: await page.screenshot({ animations: "allow" }),
        contentType: "image/png",
      });
    }
  });

  test("does not open the canvas on a resident's canvas-present", async ({
    page,
  }) => {
    await installMockBridge(page);
    await page.goto(POPOUT_URL);
    await expect(page.getByTestId("popout-shell")).toBeVisible();
    await expect(page.getByTestId("chat-title")).toHaveText("general");

    // Sent on the conversation this window IS: in the main window this is the
    // payload that auto-presents.
    await page.evaluate((conversationId) => {
      window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.("luca://canvas-present", {
        artifactId: "threshold-study",
        conversationId,
        residentPubkey:
          "953d3363262e86b770419834c53d2446409db6d918a57f8f339d495d54ab001f",
        turnId: "popout-ignores-this-turn",
      });
    }, GENERAL_CHANNEL_ID);

    await expect(page.getByTestId("artifact-canvas")).toHaveCount(0);
    // And the window never asks to be resized for one. A pop-out that called
    // `set_artifact_canvas_window_open` would shove itself across the desktop
    // and restore to the main window's geometry.
    const commands = await page.evaluate(
      () => window.__BUZZ_E2E_COMMANDS__ ?? [],
    );
    expect(commands).not.toContain("set_artifact_canvas_window_open");
  });

  test("keeps all four window controls visible and reachable at rest", async ({
    page,
  }) => {
    await installMockBridge(page);
    await page.goto(POPOUT_URL);

    const controls = page.getByTestId("popout-controls");
    await expect(controls).toBeVisible();
    // They used to be opacity 0 until the pointer approached the header,
    // which is how the owner came to believe the window had no controls.
    await expect(controls).toHaveCSS("opacity", "1");
    await expect(controls).not.toHaveCSS("pointer-events", "none");

    for (const testId of [
      "popout-pin",
      "popout-dock",
      "popout-minimize",
      "popout-close",
    ]) {
      const control = page.getByTestId(testId);
      await expect(control).toBeVisible();
      await control.focus();
      await expect(control).toBeFocused();
    }

    await expect(page.getByTestId("popout-dock")).toHaveAccessibleName(
      "Open in Polyphonic",
    );
    await expect(page.getByTestId("popout-minimize")).toHaveAccessibleName(
      "Minimize",
    );
    await expect(page.getByTestId("popout-close")).toHaveAccessibleName(
      "Close",
    );

    const pin = page.getByTestId("popout-pin");
    await expect(pin).toHaveAttribute("aria-pressed", "false");
    await pin.click();
    await expect(pin).toHaveAttribute("aria-pressed", "true");
  });

  test("reaches every conversation from a direct message's own bar", async ({
    page,
  }) => {
    await installMockBridge(page);
    await page.goto(
      `/?e2e=mock&window=popout&channel=${CHARLIE_DM_ID}#/channels/${CHARLIE_DM_ID}`,
    );

    // A DM had no switcher at all before: the project-room picker only ever
    // rendered for a room that belonged to a project.
    const trigger = page.getByTestId("popout-conversation-picker-trigger");
    await expect(trigger).toBeVisible();
    await expect(page.getByTestId("chat-title")).toHaveText("charlie");

    await trigger.click();
    const picker = page.getByTestId("popout-conversation-picker");
    await expect(picker).toBeVisible();
    // Grouped: each project's rooms under its label, then Rooms, then Direct.
    await expect(picker.getByRole("group", { name: "Direct" })).toBeVisible();
    await expect(picker.getByRole("group", { name: "Rooms" })).toBeVisible();
    await expect(
      picker.getByTestId(`popout-conversation-picker-option-${CHARLIE_DM_ID}`),
    ).toHaveAttribute("aria-selected", "true");

    await picker
      .getByTestId(`popout-conversation-picker-option-${GENERAL_CHANNEL_ID}`)
      .click();

    await expect(page.getByTestId("chat-title")).toHaveText("general");
    await expect(page).toHaveURL(
      new RegExp(`#/channels/${GENERAL_CHANNEL_ID}$`),
    );
    // The window's own identity follows the conversation it is showing.
    await expect
      .poll(() => new URL(page.url()).searchParams.get("channel"))
      .toBe(GENERAL_CHANNEL_ID);
    await expect.poll(() => page.title()).toBe("general");
  });

  test("switches project rooms inside the same compact window", async ({
    page,
  }) => {
    await installMockBridge(page);
    await page.goto(
      `/?e2e=mock&projectDemo=1&window=popout&channel=${GENERAL_CHANNEL_ID}#/channels/${GENERAL_CHANNEL_ID}`,
    );

    // The project-room picker is the main window header's control and left
    // with the header; the bar's own picker carries project rooms under their
    // project label instead.
    await expect(page.getByTestId("project-room-picker-trigger")).toHaveCount(
      0,
    );
    const trigger = page.getByTestId("popout-conversation-picker-trigger");
    await expect(trigger).toHaveAccessibleName(/general/);
    await trigger.click();

    const picker = page.getByTestId("popout-conversation-picker");
    const luca = picker.getByRole("group", { name: "Luca" });
    await expect(luca).toBeVisible();
    const engineering = luca.getByRole("option", { name: /engineering/i });
    const optionTestId = await engineering.getAttribute("data-testid");
    const engineeringId = optionTestId?.replace(
      "popout-conversation-picker-option-",
      "",
    );
    if (!engineeringId) throw new Error("Expected the engineering room id.");
    await engineering.click();

    await expect(page.getByTestId("chat-title")).toHaveText("engineering");
    await expect(page).toHaveURL(new RegExp(`#/channels/${engineeringId}$`));
    await expect
      .poll(() => new URL(page.url()).searchParams.get("channel"))
      .toBe(engineeringId);
    await expect.poll(() => page.title()).toBe("engineering");
    await expect(page.getByTestId("project-room-navigator")).toHaveCount(0);
  });

  test("asks the main window to take over, then closes itself", async ({
    page,
  }) => {
    await claimNativeRuntime(page);
    await installMockBridge(page);
    await page.goto(POPOUT_URL);
    await expect(page.getByTestId("popout-shell")).toBeVisible();

    // Stand in for the main window's `usePopoutRequests`. It registers with
    // `listen()`, i.e. `EventTarget::Any` — which is precisely why the old
    // `emitTo("main", …)` never arrived: tauri's `filter_target` does not
    // match `Any` against an addressed emit, so Rust dropped it and returned
    // Ok. A broadcast takes the unfiltered path, and this is where that shows.
    await page.evaluate((eventName) => {
      const internals = (
        window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (command: string, args: unknown) => Promise<unknown>;
            transformCallback: (callback: (data: unknown) => void) => number;
          };
        }
      ).__TAURI_INTERNALS__;
      const received: unknown[] = [];
      (
        window as unknown as { __POPOUT_DOCK_REQUESTS__: unknown[] }
      ).__POPOUT_DOCK_REQUESTS__ = received;
      const handler = internals.transformCallback((data) => {
        received.push((data as { payload?: unknown }).payload);
      });
      return internals.invoke("plugin:event|listen", {
        event: eventName,
        target: { kind: "Any" },
        handler,
      });
    }, OPEN_IN_MAIN_EVENT);

    await page.getByTestId("popout-dock").click();

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __POPOUT_DOCK_REQUESTS__?: unknown[] })
              .__POPOUT_DOCK_REQUESTS__ ?? [],
        ),
      )
      .toEqual([{ channelId: GENERAL_CHANNEL_ID }]);

    // Focus belongs to the window taking it; this one is done.
    await expect
      .poll(() => page.evaluate(() => window.__BUZZ_E2E_COMMANDS__ ?? []))
      .toContain("plugin:window|close");

    // The bar only says so when the request could not be delivered.
    await expect(page.getByTestId("popout-dock-error")).toHaveCount(0);
  });
});

test("the conversation header asks the native side for a pop-out", async ({
  page,
}) => {
  await installMockBridge(page);
  // `popout-chat-windows` is deliberately absent from preview-features.json,
  // so the shared seed does not switch it on. Opt in the way a user would.
  await page.addInitScript(
    ({ key, id }) => {
      let overrides: Record<string, boolean> = {};
      try {
        const raw = window.localStorage.getItem(key);
        if (raw) overrides = JSON.parse(raw) as Record<string, boolean>;
      } catch {
        overrides = {};
      }
      overrides[id] = true;
      window.localStorage.setItem(key, JSON.stringify(overrides));
    },
    { key: FEATURE_OVERRIDES_STORAGE_KEY, id: POPOUT_WINDOWS_FEATURE_ID },
  );

  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-general").click();

  const affordance = page.getByTestId("open-channel-popout");
  await expect(affordance).toBeVisible();
  await affordance.click();

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.(
            "get_e2e_popout_window_requests",
          ) ?? [],
      ),
    )
    .toEqual([{ channelId: GENERAL_CHANNEL_ID, title: "general" }]);
});

test("the affordance stays hidden while the preview feature is off", async ({
  page,
}) => {
  // The feature now ships defaultEnabled in the manifest (and the bridge
  // seeds every preview flag on) — the off-state is an explicit override,
  // exactly what the Settings toggle writes.
  await installMockBridge(page, { seedPreviewFeatures: false });
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "buzz-feature-overrides-v1",
      JSON.stringify({ "popout-chat-windows": false }),
    );
  });
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-general").click();

  await expect(page.getByTestId("chat-header")).toBeVisible();
  await expect(page.getByTestId("open-channel-popout")).toHaveCount(0);
});
