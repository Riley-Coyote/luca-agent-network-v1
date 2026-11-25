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
  memoryProbe: {
    calls: string[];
    release?: () => void;
    cancelPicker?: boolean;
    holdPicker?: boolean;
    cancelLink?: boolean;
    busyResident?: boolean;
    reads: { section: unknown; cursor: unknown; grant: unknown }[];
  };
};
async function openView(
  page: Page,
  mode:
    | "connected"
    | "missing"
    | "disconnected"
    | "damaged"
    | "linkable"
    | "no-mnemos",
) {
  await page.addInitScript(
    ({ subject, key, state }) => {
      const win = window as unknown as Probe;
      const bridge = win.__TAURI_INTERNALS__ ?? {};
      win.__TAURI_INTERNALS__ = bridge;
      const probe: Probe["memoryProbe"] = { calls: [], reads: [] };
      win.memoryProbe = probe;
      let delegate: Call | undefined;
      let grant =
        state === "connected" || state === "damaged" ? "exact-grant" : null;
      let linked = false;
      let mind = "wren";
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
            // Restarting the resident into its memory: never interrupt work.
            if (
              cmd === "try_stop_managed_agent_for_auto_restart" ||
              cmd === "stop_managed_agent" ||
              cmd === "start_managed_agent"
            ) {
              if (args?.pubkey !== subject) throw Error("unexpected restart");
              probe.calls.push(`${cmd}:`);
              if (
                cmd === "try_stop_managed_agent_for_auto_restart" &&
                probe.busyResident
              )
                return null;
              const agents = (await delegate?.("list_managed_agents")) as {
                pubkey: string;
              }[];
              return agents.find((agent) => agent.pubkey === subject);
            }
            if (!cmd.includes("mnemos")) return delegate?.(cmd, args, opts);
            if (args?.residentPubkey !== subject)
              throw Error("unexpected scope");
            probe.calls.push(`${cmd}:${args.section ?? ""}`);
            const scope = linked
              ? { agent_id: mind, person_id: "user", project_scope: "global" }
              : {
                  agent_id: "wren",
                  person_id: "pat-example",
                  project_scope: "lighthouse",
                };
            if (cmd === "mnemos_view_status")
              return {
                grant,
                scope: grant ? scope : null,
                readerReady: state !== "missing",
                linked,
                mnemosReady: state === "linkable",
              };
            if (cmd === "mnemos_minds") {
              if (state !== "linkable") throw Error("no Mnemos to list");
              return [
                {
                  id: "wren",
                  name: "Wren",
                  memories: 2431,
                  newest: "2026-11-16T12:00:00+00:00",
                },
                {
                  id: "field-notes",
                  name: "Field Notes",
                  memories: 1,
                  newest: null,
                },
              ];
            }
            if (cmd === "link_mnemos_mind") {
              if (grant) throw Error("already connected");
              if (probe.cancelLink) return false;
              mind = String(args.mind);
              linked = true;
              grant = "linked-grant";
              return true;
            }
            if (cmd === "connect_mnemos_view") {
              if (state === "missing" || grant)
                throw Error("unexpected connection");
              if (probe.holdPicker)
                await new Promise<void>((resolve) => {
                  probe.release = resolve;
                });
              if (probe.cancelPicker) return false;
              if (JSON.stringify(args.scope) !== JSON.stringify(scope))
                throw Error("scope mismatch");
              grant = "approved-grant";
              return true;
            }
            if (!grant || args.grant !== grant) throw Error("unapproved read");
            if (cmd === "disconnect_mnemos_view") {
              grant = null;
              linked = false;
              return;
            }
            // The page reads nothing of the memory itself (WP-48, 0e).
            probe.reads.push({
              section: args.section,
              cursor: args.cursor,
              grant,
            });
            throw Error("this page reads no memory");
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

/** Anything this page read of the memory itself: it reads none (WP-48, 0e). */
const memoryReads = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as Probe).memoryProbe.calls.filter((c) =>
      c.startsWith("read_mnemos_view:"),
    ),
  );

test("a read-only connection is the relationship and a way into the notebook; it disconnects without changing memory", async ({
  page,
}) => {
  const view = await openView(page, "connected");
  const memory = view.getByRole("region", { name: "Memory", exact: true });
  await expect(memory.getByText("Wren", { exact: true })).toBeVisible();
  await expect(memory.getByText("Read only", { exact: true })).toBeVisible();
  await expect(view.getByTestId("mind-open-notebook")).toContainText(
    "Open Luca’s notebook",
  );
  // The lists are the notebook's now: none here, and nothing of it read.
  await expect(view.getByRole("button", { name: /^Memories/ })).toHaveCount(0);
  expect(await memoryReads(page)).toEqual([]);
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
  await page.reload();
  await expect(view.getByTestId("mind-open-notebook")).toBeVisible();
  await view.locator("summary").focus();
  await page.keyboard.press("Enter");
  await view.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(
    view.getByRole("button", { name: "Only view a memory" }),
  ).toBeVisible();
  await expect(view.getByTestId("mind-open-notebook")).toHaveCount(0);
  // A view is not the resident's memory: nothing restarts it.
  expect(
    await page.evaluate(() =>
      (window as unknown as Probe).memoryProbe.calls.some((c) =>
        c.includes("managed_agent"),
      ),
    ),
  ).toBe(false);
});

test("Open Luca’s notebook opens the Mnemos place at that mind", async ({
  page,
}) => {
  const view = await openView(page, "connected");
  await view.getByTestId("mind-open-notebook").click();
  await expect(page).toHaveURL(/#\/mnemos\?.*mind=wren/);
});
for (const state of ["missing", "disconnected", "damaged"] as const) {
  test(`memory view handles ${state} without broadening access`, async ({
    page,
  }) => {
    const view = await openView(page, state);
    if (state === "damaged") {
      // Nothing of the memory is read here, so a moved store is the
      // notebook's to say; here the connection stays reviewable.
      await expect(view.getByTestId("mind-open-notebook")).toBeVisible();
      await view.locator("summary").click();
      await expect(
        view.locator("details[open]").getByText("wren"),
      ).toBeVisible();
      await expect(
        view.getByRole("button", { name: "Disconnect", exact: true }),
      ).toBeVisible();
      expect(await memoryReads(page)).toEqual([]);
    } else {
      await expect(view.getByText("Mnemos isn’t on this Mac")).toBeVisible();
      await expect(
        view.getByRole("button", { name: "Only view a memory" }),
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

test("setup identifies a bad ID and preserves valid entries when the picker is cancelled", async ({
  page,
}) => {
  const view = await openView(page, "disconnected");
  await view.getByRole("button", { name: "Only view a memory" }).click();
  const agent = view.getByRole("textbox", { name: "Agent ID" });
  await expect(agent).toBeFocused();
  await agent.fill("Wren");
  await expect(agent).toHaveAttribute("aria-invalid", "true");
  await expect(agent).toHaveAccessibleDescription(/lowercase/);
  const choose = view.getByRole("button", { name: "Choose store…" });
  await expect(choose).toBeDisabled();
  await agent.fill("wren");
  await view.getByRole("textbox", { name: "Person ID" }).fill("pat-example");
  await view.getByRole("textbox", { name: "Project scope" }).fill("lighthouse");
  await page.evaluate(() => {
    (window as unknown as Probe).memoryProbe.cancelPicker = true;
    (window as unknown as Probe).memoryProbe.holdPicker = true;
  });
  await choose.click();
  await page.waitForFunction(() =>
    Boolean((window as unknown as Probe).memoryProbe.release),
  );
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(
    view.getByText("Memory is only shown while this view is open."),
  ).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    (window as unknown as Probe).memoryProbe.release?.();
  });
  await expect(choose).toBeFocused();
  await expect(agent).toHaveValue("wren");
  expect(
    await page.evaluate(
      () => (window as unknown as Probe).memoryProbe.reads.length,
    ),
  ).toBe(0);
  await page.evaluate(() => {
    (window as unknown as Probe).memoryProbe.cancelPicker = false;
    (window as unknown as Probe).memoryProbe.holdPicker = false;
  });
  await choose.click();
  await expect(view.getByTestId("mind-open-notebook")).toBeVisible();
  await view.locator("summary").click();
  await view.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(
    view.getByRole("button", { name: "Only view a memory" }),
  ).toBeFocused();
});

const restarts = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as Probe).memoryProbe.calls.filter((c) =>
      c.includes("managed_agent"),
    ),
  );

test("the owner gives a resident one of their minds, and it restarts into it", async ({
  page,
}) => {
  const view = await openView(page, "linkable");
  const minds = view.getByRole("region", { name: "Give Luca a memory" });
  await expect(minds.getByText("Wren", { exact: true })).toBeVisible();
  await expect(
    minds.getByText(/^2,431 memories · newest \w+ \d+$/),
  ).toBeVisible();
  await expect(minds.getByText("1 memory", { exact: true })).toBeVisible();
  await expect(view.getByText(/same one your other apps reach/)).toBeVisible();
  await view.getByRole("button", { name: "Use Wren as Luca’s memory" }).click();
  const memory = view.getByRole("region", { name: "Memory", exact: true });
  await expect(memory.getByText("Linked", { exact: true })).toBeVisible();
  await expect(
    memory.getByText(
      "Luca remembers with this memory, here and in your other apps.",
    ),
  ).toBeVisible();
  await expect(view.getByTestId("mind-open-notebook")).toContainText(
    "Open Luca’s notebook",
  );
  expect(await restarts(page)).toEqual([
    "try_stop_managed_agent_for_auto_restart:",
    "start_managed_agent:",
  ]);
  await view.locator("summary").click();
  await expect(view.locator("summary")).toHaveText("Linked memory");
  await view.getByRole("button", { name: "Unlink", exact: true }).click();
  await expect(
    view.getByRole("button", { name: "Use Wren as Luca’s memory" }),
  ).toBeFocused();
  expect(await restarts(page)).toHaveLength(4);
});

test("a cancelled link changes nothing and a busy resident is never interrupted", async ({
  page,
}) => {
  const view = await openView(page, "linkable");
  await page.evaluate(() => {
    (window as unknown as Probe).memoryProbe.cancelLink = true;
  });
  const fieldNotes = view.getByRole("button", {
    name: "Use Field Notes as Luca’s memory",
  });
  await fieldNotes.click();
  await expect(fieldNotes).toBeFocused();
  expect(await restarts(page)).toEqual([]);
  await page.evaluate(() => {
    const probe = (window as unknown as Probe).memoryProbe;
    probe.cancelLink = false;
    probe.busyResident = true;
  });
  await fieldNotes.click();
  await expect(view.getByText("Field Notes", { exact: true })).toBeVisible();
  await expect(
    view.getByText(/Luca is in the middle of something/),
  ).toBeVisible();
  expect(await restarts(page)).toEqual([
    "try_stop_managed_agent_for_auto_restart:",
  ]);
  await page.evaluate(() => {
    (window as unknown as Probe).memoryProbe.busyResident = false;
  });
  await view.getByRole("button", { name: "Restart now" }).click();
  await expect(view.getByText(/in the middle of something/)).toHaveCount(0);
  expect((await restarts(page)).slice(-2)).toEqual([
    "stop_managed_agent:",
    "start_managed_agent:",
  ]);
});

test("without Mnemos on the Mac the tab says so plainly", async ({ page }) => {
  const view = await openView(page, "no-mnemos");
  await expect(view.getByText("Mnemos isn’t on this Mac")).toBeVisible();
  await expect(
    view.getByText(
      "Install Mnemos to give Luca a memory it keeps across your apps.",
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as unknown as Probe).memoryProbe.calls.some((c) =>
        c.startsWith("mnemos_minds"),
      ),
    ),
  ).toBe(false);
});
