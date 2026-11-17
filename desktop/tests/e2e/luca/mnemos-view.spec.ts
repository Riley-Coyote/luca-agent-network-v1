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
    fault?: "reader_busy" | "stale_page";
    cancelPicker?: boolean;
    holdPicker?: boolean;
    longEntry?: boolean;
    rotate?: () => void;
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
      probe.rotate = () => {
        grant = "new-grant";
      };
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
                  newest: "2026-11-16",
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
            if (state === "damaged") throw "store_changed";
            probe.reads.push({
              section: args.section,
              cursor: args.cursor,
              grant,
            });
            if (probe.fault) {
              const fault = probe.fault;
              probe.fault = undefined;
              throw fault;
            }
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
            if (
              args.section === "journal" ||
              args.section === "beliefs" ||
              args.section === "handoffs"
            ) {
              return { kind: "items", items: [], nextCursor: null };
            }
            return {
              kind: "items",
              items: [
                {
                  text: probe.longEntry
                    ? `<em>literal</em> ${"w".repeat(600)}`
                    : args.cursor
                      ? "Second synthetic memory"
                      : "First synthetic memory",
                  clipped: Boolean(probe.longEntry),
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
  await expect(
    view.getByRole("heading", { name: /Memories.*Page 2/ }),
  ).toBeFocused();
  await view.getByRole("button", { name: "Previous page" }).click();
  await expect(view.getByText("First synthetic memory")).toBeVisible();
  await view.getByRole("button", { name: "All sections" }).click();
  await expect(view.getByRole("button", { name: "Memories 2" })).toBeFocused();
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
    view.getByRole("button", { name: "Only view a memory" }),
  ).toBeVisible();
  // A view is not the resident's memory: nothing restarts it.
  expect(
    await page.evaluate(() =>
      (window as unknown as Probe).memoryProbe.calls.some((c) =>
        c.includes("managed_agent"),
      ),
    ),
  ).toBe(false);
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
      const calls = () =>
        page.evaluate(() => (window as unknown as Probe).memoryProbe.calls);
      const before = await calls();
      await view.getByRole("button", { name: "Review connection" }).click();
      await expect(view.locator("summary")).toBeFocused();
      await expect(
        view.locator("details[open]").getByText("wren"),
      ).toBeVisible();
      await expect(
        view.getByRole("button", { name: "Disconnect", exact: true }),
      ).toBeVisible();
      expect(await calls()).toEqual(before);
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

test("a temporary error retries the same page; a rejected cursor goes back to the overview", async ({
  page,
}) => {
  const view = await openView(page, "connected");
  await view.getByRole("button", { name: "Memories 2" }).click();
  await view.getByText("First synthetic memory").waitFor();
  await page.evaluate(() => {
    (window as unknown as Probe).memoryProbe.fault = "reader_busy";
  });
  await view.getByRole("button", { name: "Next page" }).click();
  await expect(view.getByRole("alert")).toBeFocused();
  await view.getByRole("button", { name: "Try again" }).click();
  await expect(view.getByText("Second synthetic memory")).toBeVisible();
  await expect(
    view.getByRole("heading", { name: /Memories.*Page 2/ }),
  ).toBeFocused();
  expect(
    await page.evaluate(() =>
      (window as unknown as Probe).memoryProbe.reads
        .slice(-2)
        .map((x) => x.cursor),
    ),
  ).toEqual(["p2", "p2"]);
  await page.evaluate(() => {
    (window as unknown as Probe).memoryProbe.fault = "stale_page";
  });
  await view.getByRole("button", { name: "Refresh", exact: true }).click();
  await view.getByRole("button", { name: "Open overview" }).click();
  await expect(view.getByRole("button", { name: "Memories 2" })).toBeVisible();
});

test("changing connections does not carry a page, another grant, or old text into the new view", async ({
  page,
}) => {
  const view = await openView(page, "connected");
  await view.getByRole("button", { name: "Memories 2" }).click();
  await view.getByRole("button", { name: "Next page" }).click();
  await view.getByText("Second synthetic memory").waitFor();
  await page.evaluate(() => {
    (window as unknown as Probe).memoryProbe.rotate?.();
  });
  await view.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(view.getByRole("button", { name: "Memories 2" })).toBeVisible();
  await expect(view.getByText("Second synthetic memory")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      (window as unknown as Probe).memoryProbe.reads.filter(
        (r) => r.grant === "new-grant",
      ),
    ),
  ).toEqual([{ section: "summary", cursor: null, grant: "new-grant" }]);
});

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
  await expect(view.getByRole("button", { name: "Memories 2" })).toBeVisible();
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
  await expect(view.getByRole("button", { name: "Memories 2" })).toBeVisible();
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

test("empty sections stay navigable and a late response does not take focus back", async ({
  page,
}) => {
  const view = await openView(page, "connected");
  await view.getByRole("button", { name: "Journal 0" }).click();
  await expect(view.getByText("Nothing in this section yet.")).toBeVisible();
  await expect(
    view.getByRole("navigation", { name: "Journal pages" }),
  ).toHaveCount(0);
  await view.getByRole("button", { name: "All sections" }).click();
  await expect(view.getByRole("button", { name: "Journal 0" })).toBeFocused();
  await view.getByRole("button", { name: "Notes 1" }).click();
  await page.waitForFunction(() =>
    Boolean((window as unknown as Probe).memoryProbe.release),
  );
  await view.locator("summary").focus();
  await page.evaluate(() => {
    (window as unknown as Probe).memoryProbe.release?.();
  });
  await expect(view.getByText("Late synthetic note")).toBeVisible();
  await expect(view.locator("summary")).toBeFocused();
});

test("long excerpts render as plain text and the reader still works at large type", async ({
  page,
}) => {
  const view = await openView(page, "connected");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "24px";
    (window as unknown as Probe).memoryProbe.longEntry = true;
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await view.getByRole("button", { name: "Memories 2" }).click();
  const words = view.getByText(/^<em>literal<\/em>/);
  await expect(words).toBeVisible();
  await expect(view.locator(".luca-mnemos-items em")).toHaveCount(0);
  await expect(view.getByText("Excerpt", { exact: true })).toBeVisible();
  expect(
    await words.evaluate((el) =>
      Number.parseFloat(getComputedStyle(el).fontSize),
    ),
  ).toBeGreaterThanOrEqual(24);
  expect(
    await view.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  await view.getByRole("button", { name: "All sections" }).click();
  await expect(view.getByRole("button", { name: "Memories 2" })).toBeFocused();
});

test("disconnect discards an in-flight read without returning its text", async ({
  page,
}) => {
  const view = await openView(page, "connected");
  await view.getByRole("button", { name: "Notes 1" }).click();
  await page.waitForFunction(() =>
    Boolean((window as unknown as Probe).memoryProbe.release),
  );
  await view.locator("summary").click();
  await view.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(
    view.getByRole("button", { name: "Only view a memory" }),
  ).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as Probe).memoryProbe.release?.(),
  );
  await expect(view.getByText("Late synthetic note")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      (window as unknown as Probe).memoryProbe.calls.slice(-2),
    ),
  ).toEqual(["disconnect_mnemos_view:", "mnemos_view_status:"]);
});
