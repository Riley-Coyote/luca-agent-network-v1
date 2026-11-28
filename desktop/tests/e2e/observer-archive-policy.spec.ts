import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

test.describe("observer archive policy — reconciliation gate", () => {
  test("internal policy: archive sync reaches subscription path after reconciliation", async ({
    page,
  }) => {
    await installMockBridge(page, {
      observerArchiveDefaultEnabled: true,
      saveSubscriptions: [
        {
          scope_type: "owner_p",
          scope_value: "deadbeef".repeat(8),
          kinds: "[24200]",
        },
      ],
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Wait for the channel list to appear (proves AppShell mounted fully).
    await expect(page.getByTestId("channel-general")).toBeVisible({
      timeout: 10_000,
    });

    // The reconciliation gate (useObserverArchiveReconciliation) must have
    // resolved successfully, allowing useArchiveSync to start the
    // ArchiveSyncManager, which calls list_save_subscriptions. The IPC
    // counter proves the subscription path was reached.
    await page.waitForFunction(
      () => {
        const counters = (window as Record<string, unknown>)
          .__BUZZ_E2E_IPC_COUNTERS__ as Record<string, number> | undefined;
        return (counters?.list_save_subscriptions ?? 0) > 0;
      },
      null,
      { timeout: 10_000 },
    );

    const count = await page.evaluate(() => {
      const counters = (window as Record<string, unknown>)
        .__BUZZ_E2E_IPC_COUNTERS__ as Record<string, number> | undefined;
      return counters?.list_save_subscriptions ?? 0;
    });
    expect(count).toBeGreaterThan(0);

    // Bonus (Thufir pass 2, F4): the reconciliation gate must also result
    // in a real `#p` + kind-24200 live REQ filter, not just an IPC call.
    const hasOwnerKindSubscription = await page.evaluate(
      (ownerPubkey) =>
        (
          window as Window & {
            __BUZZ_E2E_HAS_MOCK_OWNER_KIND_SUBSCRIPTION__?: (input: {
              ownerPubkey: string;
              kind: number;
            }) => boolean;
          }
        ).__BUZZ_E2E_HAS_MOCK_OWNER_KIND_SUBSCRIPTION__?.({
          ownerPubkey,
          kind: 24200,
        }) ?? false,
      "deadbeef".repeat(8),
    );
    expect(hasOwnerKindSubscription).toBe(true);
  });

  test("policy pending: no subscription list call or live filter until resolved", async ({
    page,
  }) => {
    await installMockBridge(page, {
      observerArchiveDefaultEnabled: true,
      observerArchiveDefaultEnabledDelayMs: 500,
      saveSubscriptions: [
        {
          scope_type: "owner_p",
          scope_value: "deadbeef".repeat(8),
          kinds: "[24200]",
        },
      ],
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("channel-general")).toBeVisible({
      timeout: 10_000,
    });

    // While the policy check is pending, useArchiveSync must not have
    // started — no list_save_subscriptions call, no owner/24200 live
    // filter. This is the discriminating half pass 2 found missing: the
    // prior test only proved "eventually starts", not "doesn't start
    // early."
    const countWhilePending = await page.evaluate(
      () =>
        (
          (window as Record<string, unknown>).__BUZZ_E2E_IPC_COUNTERS__ as
            | Record<string, number>
            | undefined
        )?.list_save_subscriptions ?? 0,
    );
    expect(countWhilePending).toBe(0);
    const hasSubscriptionWhilePending = await page.evaluate(
      (ownerPubkey) =>
        (
          window as Window & {
            __BUZZ_E2E_HAS_MOCK_OWNER_KIND_SUBSCRIPTION__?: (input: {
              ownerPubkey: string;
              kind: number;
            }) => boolean;
          }
        ).__BUZZ_E2E_HAS_MOCK_OWNER_KIND_SUBSCRIPTION__?.({
          ownerPubkey,
          kind: 24200,
        }) ?? false,
      "deadbeef".repeat(8),
    );
    expect(hasSubscriptionWhilePending).toBe(false);

    // After the policy resolves, both the IPC call and the live filter
    // appear.
    await page.waitForFunction(
      () =>
        ((
          (window as Record<string, unknown>).__BUZZ_E2E_IPC_COUNTERS__ as
            | Record<string, number>
            | undefined
        )?.list_save_subscriptions ?? 0) > 0,
      null,
      { timeout: 10_000 },
    );
    await expect
      .poll(
        () =>
          page.evaluate(
            (ownerPubkey) =>
              (
                window as Window & {
                  __BUZZ_E2E_HAS_MOCK_OWNER_KIND_SUBSCRIPTION__?: (input: {
                    ownerPubkey: string;
                    kind: number;
                  }) => boolean;
                }
              ).__BUZZ_E2E_HAS_MOCK_OWNER_KIND_SUBSCRIPTION__?.({
                ownerPubkey,
                kind: 24200,
              }) ?? false,
            "deadbeef".repeat(8),
          ),
        { timeout: 5_000 },
      )
      .toBe(true);
  });

  test("policy check fails: subscription path never opens", async ({
    page,
  }) => {
    await installMockBridge(page, {
      observerArchiveDefaultEnabled: true,
      observerArchiveDefaultEnabledError: "policy check failed",
      saveSubscriptions: [
        {
          scope_type: "owner_p",
          scope_value: "deadbeef".repeat(8),
          kinds: "[24200]",
        },
      ],
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("channel-general")).toBeVisible({
      timeout: 10_000,
    });

    // Give the rejected reconciliation time to settle, then assert the
    // gate stayed shut: no list_save_subscriptions call, no live filter.
    await page.waitForTimeout(500);
    const count = await page.evaluate(
      () =>
        (
          (window as Record<string, unknown>).__BUZZ_E2E_IPC_COUNTERS__ as
            | Record<string, number>
            | undefined
        )?.list_save_subscriptions ?? 0,
    );
    expect(count).toBe(0);
    const hasSubscription = await page.evaluate(
      (ownerPubkey) =>
        (
          window as Window & {
            __BUZZ_E2E_HAS_MOCK_OWNER_KIND_SUBSCRIPTION__?: (input: {
              ownerPubkey: string;
              kind: number;
            }) => boolean;
          }
        ).__BUZZ_E2E_HAS_MOCK_OWNER_KIND_SUBSCRIPTION__?.({
          ownerPubkey,
          kind: 24200,
        }) ?? false,
      "deadbeef".repeat(8),
    );
    expect(hasSubscription).toBe(false);
  });

  test("fresh internal install: reconciliation repairs an empty subscription list", async ({
    page,
  }) => {
    // The actual production repair path Will's bug report was about: a
    // fresh internal install with no owner_p/24200 row yet must end up
    // with one after startup reconciliation runs — not just "no-op
    // because the row was already there" (the prior fixture always
    // pre-seeded the row).
    await installMockBridge(page, {
      observerArchiveDefaultEnabled: true,
      saveSubscriptions: [],
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("channel-general")).toBeVisible({
      timeout: 10_000,
    });

    await expect
      .poll(
        () =>
          page.evaluate(
            (ownerPubkey) =>
              (
                window as Window & {
                  __BUZZ_E2E_HAS_MOCK_OWNER_KIND_SUBSCRIPTION__?: (input: {
                    ownerPubkey: string;
                    kind: number;
                  }) => boolean;
                }
              ).__BUZZ_E2E_HAS_MOCK_OWNER_KIND_SUBSCRIPTION__?.({
                ownerPubkey,
                kind: 24200,
              }) ?? false,
            "deadbeef".repeat(8),
          ),
        { timeout: 10_000 },
      )
      .toBe(true);

    const commands = await page.evaluate(
      () =>
        (window as Window & { __BUZZ_E2E_COMMANDS__?: string[] })
          .__BUZZ_E2E_COMMANDS__ ?? [],
    );
    expect(commands).toContain("merge_save_subscription_kinds");
  });
});
