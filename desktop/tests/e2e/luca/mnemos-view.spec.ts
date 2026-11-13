import { expect, type Page, test } from "@playwright/test";
import { installMockBridge } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";

const resident = "a".repeat(64);
type Call = (
  cmd: string,
  args?: Record<string, unknown>,
  opts?: unknown,
) => Promise<unknown>;
type Probe = {
  __TAURI_INTERNALS__?: { invoke?: Call };
  memoryProbe: { calls: string[]; release?: () => void };
};
async function openView(
  page: Page,
  mode: "connected" | "missing" | "disconnected" | "damaged",
) {
  await page.addInitScript(
    ({ subject, key, state }) => {
      const win = window as unknown as Probe;
      const bridge = win.__TAURI_INTERNALS__ ?? {};
      win.__TAURI_INTERNALS__ = bridge;
      const probe: Probe["memoryProbe"] = { calls: [] };
      win.memoryProbe = probe;
      let delegate: Call | undefined;
      let grant =
        state !== "disconnected" && state !== "missing" ? "exact-grant" : null;
      window.localStorage.setItem(key, JSON.stringify({ "shell-frame": true }));
      // Install before the real test bridge; all other app commands pass through.
      Object.defineProperty(bridge, "invoke", {
        configurable: true,
        set(next: Call) {
          delegate = next;
        },
        get:
          () =>
          async (
            cmd: string,
            args?: Record<string, unknown>,
            opts?: unknown,
          ) => {
            if (!cmd.includes("mnemos_view"))
              return delegate?.(cmd, args, opts);
            if (args?.residentPubkey !== subject)
              throw Error("unexpected scope");
            probe.calls.push(`${cmd}:${args.section ?? ""}`);
            const scope = {
              agent_id: "wren",
              person_id: "pat-example",
              project_scope: "lighthouse",
            };
            if (cmd === "mnemos_view_status")
              return {
                grant,
                scope: grant ? scope : null,
                readerReady: state !== "missing",
              };
            if (!grant || args.grant !== grant) throw Error("unapproved read");
            if (cmd === "disconnect_mnemos_view") {
              grant = null;
              return;
            }
            if (state === "damaged") throw "store_changed";
            if (args.section === "summary")
              return {
                kind: "summary",
                counts: {
                  memories: { active: 2, dormant: 0, archived: 1 },
                  notes: { all: 1, unread: 1 },
                  standing: 1,
                  journal: 0,
                  handoffs: 0,
                  beliefs: 0,
                },
              };
            if (args.section === "notes") {
              await new Promise<void>((resolve) => {
                probe.release = resolve;
              });
              return {
                kind: "items",
                items: [{ text: "Late synthetic note", clipped: false }],
                nextCursor: null,
              };
            }
            return {
              kind: "items",
              items: [
                {
                  text: args.cursor
                    ? "Second synthetic memory"
                    : "First synthetic memory",
                  clipped: false,
                },
              ],
              nextCursor: args.cursor ? null : "p2",
            };
          },
      });
    },
    { subject: resident, key: FEATURE_OVERRIDES_STORAGE_KEY, state: mode },
  );
  await installMockBridge(page, {
    managedAgents: [
      {
        pubkey: resident,
        name: "Luca",
        status: "running",
        personaId: "builtin:fizz",
      },
    ],
  });
  await page.goto(`/#/agents?profile=${resident}&page=mnemos`);
  await expect(page.getByTestId("mind-mnemos")).toBeVisible();
  return page.getByTestId("mind-mnemos");
}

test("the resident can read pages, discard late hidden results, and disconnect without changing memory", async ({
  page,
}) => {
  const view = await openView(page, "connected");
  await view.getByRole("button", { name: "Memories 2" }).click();
  await expect(view.getByText("First synthetic memory")).toBeVisible();
  await view.getByRole("button", { name: "Next page" }).click();
  await expect(view.getByText("Second synthetic memory")).toBeVisible();
  await view.getByRole("button", { name: "Previous page" }).click();
  await expect(view.getByText("First synthetic memory")).toBeVisible();
  await view.getByRole("button", { name: "All sections" }).click();
  await view.getByRole("button", { name: "Notes 1" }).click();
  await page.waitForFunction(() =>
    Boolean((window as unknown as Probe).memoryProbe.release),
  );
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(
    view.getByText("Memory is only shown while this view is open."),
  ).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as Probe).memoryProbe.release?.();
  });
  await expect(view.getByText("Late synthetic note")).toHaveCount(0);
  await page.reload();
  await expect(view.getByRole("button", { name: "Memories 2" })).toBeVisible();
  await view.locator("summary").focus();
  await page.keyboard.press("Enter");
  await view.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(
    view.getByRole("button", { name: "Connect a store" }),
  ).toBeVisible();
});
for (const state of ["missing", "disconnected", "damaged"] as const) {
  test(`memory view handles ${state} without broadening access`, async ({
    page,
  }) => {
    const view = await openView(page, state);
    if (state === "damaged") {
      await expect(view.getByRole("alert")).toContainText(
        "store moved or was replaced",
      );
    } else {
      await expect(view.getByText("No store connected")).toBeVisible();
      await expect(
        view.getByRole("button", { name: "Connect a store" }),
      ).toHaveCount(state === "missing" ? 0 : 1);
      expect(
        await page.evaluate(() =>
          (window as unknown as Probe).memoryProbe.calls.some((c) =>
            c.startsWith("read_mnemos_view:"),
          ),
        ),
      ).toBe(false);
    }
  });
}
