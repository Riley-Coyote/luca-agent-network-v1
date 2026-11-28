import { expect, type Page, test } from "@playwright/test";
import { installMockBridge } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";
import { waitForAnimations } from "../../helpers/animations";

test.use({ viewport: { width: 1372, height: 835 } });
test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    localStorage.setItem(key, JSON.stringify({ "shell-frame": true }));
    localStorage.setItem("buzz-theme", "obsidian");
    localStorage.setItem("buzz-follow-system", "false");
  }, FEATURE_OVERRIDES_STORAGE_KEY);
  await installMockBridge(page, {
    managedAgents: [
      {
        name: "Luca",
        personaId: "builtin:fizz",
        pubkey: "a".repeat(64),
        status: "running",
      },
    ],
  });
  await page.goto("/#/channels/9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50");
  await expect(page.getByTestId("message-composer")).toBeVisible();
  await waitForAnimations(page);
  await page.getByTestId("quickchat-launcher").click();
  await expect(page.getByTestId("quickchat-input")).toBeFocused();
});

test("IME Enter and Escape cannot send or dismiss; ordinary keys still work", async ({
  page,
}) => {
  const field = page.getByTestId("quickchat-input");
  await field.fill("日本語");
  await field.dispatchEvent("compositionstart");
  // These keys belong to the input method, not textarea default insertion.
  await field.dispatchEvent("keydown", { key: "Enter", bubbles: true });
  await field.dispatchEvent("keydown", { key: "Escape", bubbles: true });
  await expect(field).toHaveValue("日本語");
  await field.dispatchEvent("compositionend");
  for (const key of ["Enter", "Escape"]) {
    await field.dispatchEvent("keydown", { key, keyCode: 229, bubbles: true });
    await field.dispatchEvent("keydown", {
      key,
      isComposing: true,
      bubbles: true,
    });
  }
  await expect(field).toHaveValue("日本語");
  await field.press("Shift+Enter");
  await expect(field).toHaveValue("日本語\n");
  await field.press("Enter");
  await expect(field).toHaveValue("");
  await expect(page.getByTestId("quickchat-panel")).toContainText("日本語");
});

test("menus dismiss before the panel and each close path restores the launcher", async ({
  page,
}) => {
  const launcher = page.getByTestId("quickchat-launcher");
  const options = page.getByRole("button", {
    name: "Quick Chat options",
    exact: true,
  });
  await options.click();
  await page.keyboard.press("Escape");
  await expect(options).toBeFocused();
  await expect(page.locator(".qc-menu")).toHaveCount(0);
  await options.click();
  await page.getByTestId("quickchat-input").click();
  await expect(page.locator(".qc-menu")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(launcher).toBeFocused();
  for (const name of ["Minimize Quick Chat", "Close Quick Chat"]) {
    await launcher.click();
    await page.getByRole("button", { name, exact: true }).click();
    await expect(launcher).toBeFocused();
  }
});

test("Lens has unmasked nested backdrops and a solid fallback", async ({
  page,
}) => {
  // Browser structural simulation only; native captures prove actual frost.
  await page.evaluate(() =>
    document.documentElement.setAttribute("data-luca-frame-glass", ""),
  );
  await expect(page.locator(".qc-glass-lens")).toHaveCount(3);
  await expect(page.locator(".qc-glass")).toHaveCSS("backdrop-filter", "none");
  await expect(page.locator(".qc-glass")).toHaveCSS("mask-image", "none");
  await expect
    .poll(() =>
      page
        .locator(".qc-glass")
        .evaluate((el) =>
          getComputedStyle(el).getPropertyValue("--qc-glass-r"),
        ),
    )
    .toBe("16px");
  await expect(page.locator(".qc-header")).toHaveCSS("height", "18px");
  await expect(page.locator(".qc-resize").first()).toHaveAttribute(
    "tabindex",
    "-1",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByTestId("quickchat-input").fill("one\ntwo");
  await expect(page.locator(".qc-composer")).toHaveAttribute(
    "data-composer-open",
    "",
  );
  await expect
    .poll(() =>
      page
        .locator(".qc-composer")
        .evaluate(
          (el) =>
            el.getAnimations().filter((a) => a.playState === "running").length,
        ),
    )
    .toBe(0);
  await page.evaluate(() =>
    document.documentElement.removeAttribute("data-luca-frame-glass"),
  );
  await expect(page.locator(".qc-glass")).toHaveCount(0);
  await expect(page.getByTestId("quickchat-panel")).toHaveCSS(
    "background-color",
    "rgb(14, 14, 15)",
  );
});

test("a reader stays put while content grows, then newest resumes following", async ({
  page,
}) => {
  const field = page.getByTestId("quickchat-input");
  await field.fill("A long message for scroll verification. ".repeat(70));
  await field.press("Enter");
  await expect(field).toHaveValue("");
  const transcript = page.locator(".qc-transcript");
  await waitForAnimations(page);
  await transcript.focus();
  await transcript.press("ControlOrMeta+Home");
  await transcript.evaluate((el) => {
    el.scrollTop = 60;
    el.dispatchEvent(new Event("scroll"));
  });
  const arrow = page.getByRole("button", {
    name: "Newest message",
    exact: true,
  });
  await expect(arrow).toBeVisible();
  await expect
    .poll(() =>
      transcript.evaluate((el) => el.style.getPropertyValue("--qc-edge-top")),
    )
    .toBe("1");
  await expect
    .poll(() =>
      transcript.evaluate((el) =>
        el.style.getPropertyValue("--qc-edge-bottom"),
      ),
    )
    .toBe("1");
  // Simulate streamed layout growth, not a new user action that asks to send.
  await page.locator(".qc-messages").evaluate((el) => {
    const p = document.createElement("p");
    p.style.height = "200px";
    el.append(p);
  });
  await expect.poll(() => transcript.evaluate((el) => el.scrollTop)).toBe(60);
  await arrow.click();
  await expect(arrow).toHaveCount(0);
  await page.locator(".qc-messages").evaluate((el) => {
    const p = document.createElement("p");
    p.style.height = "200px";
    el.append(p);
  });
  await expect
    .poll(() =>
      transcript.evaluate((el) =>
        Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop),
      ),
    )
    .toBeLessThanOrEqual(2);
});

// Following a reply that grows fast (beta.14 hands-on pass). Growth here is
// layout growth, as a streamed reply makes it; the reader moves only by real
// wheel and keyboard input.
async function longConversation(page: Page) {
  const field = page.getByTestId("quickchat-input");
  await field.fill("A long message for scroll verification. ".repeat(70));
  await field.press("Enter");
  await expect(field).toHaveValue("");
  await waitForAnimations(page);
}
const newestArrow = (page: Page) =>
  page.getByRole("button", { name: "Newest message", exact: true });
const leftToEnd = (page: Page) =>
  page
    .locator(".qc-transcript")
    .evaluate((el) =>
      Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop),
    );
const viewTop = (page: Page) =>
  page.locator(".qc-transcript").evaluate((el) => el.scrollTop);
/** Let scroll, resize and paint run their course, then read once. */
const settle = (page: Page) =>
  page.evaluate(async () => {
    for (let i = 0; i < 12; i++)
      await new Promise<void>((done) => requestAnimationFrame(() => done()));
  });
async function wheelOverTranscript(page: Page, deltaY: number) {
  const box = await page.locator(".qc-transcript").boundingBox();
  if (!box) throw new Error("no transcript");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, deltaY);
}
/** Wait for a user scroll to come to rest (smooth scrolling animates). */
async function restingTop(page: Page) {
  let previous = Number.NaN;
  for (let i = 0; i < 60; i++) {
    await settle(page);
    const top = await viewTop(page);
    if (Math.abs(top - previous) < 0.5) return top;
    previous = top;
  }
  throw new Error("the view never came to rest");
}
async function grow(page: Page, height: number) {
  await page.locator(".qc-messages").evaluate((el, px) => {
    const p = document.createElement("p");
    p.style.height = `${px}px`;
    el.append(p);
  }, height);
}
/** A reply that gains a line every `gap` ms, the arrow sampled every frame. */
function startStream(page: Page, lines: number, gap: number) {
  return page.evaluate(
    ({ lines, gap }) => {
      const transcript = document.querySelector(
        ".qc-transcript",
      ) as HTMLElement;
      const reply = document.createElement("p");
      reply.style.height = "0px";
      document.querySelector(".qc-messages")?.append(reply);
      const record = { line: 0, tops: [] as number[], arrowFrames: 0 };
      (window as unknown as { __stream: typeof record }).__stream = record;
      let streaming = true;
      const sample = () => {
        if (document.querySelector('button[aria-label="Newest message"]'))
          record.arrowFrames++;
        if (streaming) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      return (async () => {
        for (let line = 1; line <= lines; line++) {
          reply.style.height = `${line * 22}px`;
          await new Promise<void>((done) => setTimeout(done, gap));
          record.line = line;
          record.tops.push(transcript.scrollTop);
        }
        streaming = false;
      })();
    },
    { lines, gap },
  );
}
const streamRecord = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          __stream: { line: number; tops: number[]; arrowFrames: number };
        }
      ).__stream,
  );

test.describe("the mini chat keeps up with a fast reply", () => {
  test.beforeEach(async ({ page }) => {
    await longConversation(page);
    expect(await leftToEnd(page)).toBeLessThanOrEqual(2);
  });

  test("newest pressed while the reply grows in the same moment", async ({
    page,
  }) => {
    await wheelOverTranscript(page, -400);
    await restingTop(page);
    await expect(newestArrow(page)).toBeVisible();
    await page.evaluate(() => {
      document
        .querySelector<HTMLButtonElement>('button[aria-label="Newest message"]')
        ?.click();
      const p = document.createElement("p");
      p.style.height = "200px";
      document.querySelector(".qc-messages")?.append(p);
    });
    await settle(page);
    expect(await leftToEnd(page)).toBeLessThanOrEqual(2);
    await expect(newestArrow(page)).toHaveCount(0);
  });

  test("growth in two frames running keeps the end", async ({ page }) => {
    await page.evaluate(async () => {
      const grow = (height: number) => {
        const p = document.createElement("p");
        p.style.height = `${height}px`;
        document.querySelector(".qc-messages")?.append(p);
      };
      grow(40);
      // After this frame's drawing (its follow has scrolled), before the next.
      await new Promise<void>((done) =>
        requestAnimationFrame(() => setTimeout(done, 0)),
      );
      grow(40);
    });
    await settle(page);
    expect(await leftToEnd(page)).toBeLessThanOrEqual(2);
    await expect(newestArrow(page)).toHaveCount(0);
  });

  test("a line every 16 ms: the arrow never shows and the end is kept", async ({
    page,
  }) => {
    await startStream(page, 40, 16);
    await settle(page);
    expect((await streamRecord(page)).arrowFrames).toBe(0);
    expect(await leftToEnd(page)).toBeLessThanOrEqual(2);
    await expect(newestArrow(page)).toHaveCount(0);
  });

  test("the reader gets away from a fast reply by wheel and by keyboard", async ({
    page,
  }) => {
    const stream = startStream(page, 400, 16);
    await expect
      .poll(async () => (await streamRecord(page)).line)
      .toBeGreaterThan(5);
    await wheelOverTranscript(page, -300);
    const top = await restingTop(page);
    const from = (await streamRecord(page)).line;
    await expect(newestArrow(page)).toBeVisible();
    await expect
      .poll(async () => (await streamRecord(page)).line, { timeout: 10_000 })
      .toBeGreaterThanOrEqual(from + 20);
    const tops = (await streamRecord(page)).tops.slice(from, from + 20);
    for (const seen of tops)
      expect(Math.abs(seen - top)).toBeLessThanOrEqual(1);

    // Back to the end by the arrow (a wheel aimed at the end lands short of a
    // reply this fast, and short of the end is not the end), then away by keyboard.
    await newestArrow(page).click();
    await expect.poll(() => leftToEnd(page)).toBeLessThanOrEqual(2);
    await expect(newestArrow(page)).toHaveCount(0);
    await page.locator(".qc-transcript").focus();
    await page.keyboard.press("PageUp");
    const keyTop = await restingTop(page);
    const keyFrom = (await streamRecord(page)).line;
    await expect(newestArrow(page)).toBeVisible();
    await expect
      .poll(async () => (await streamRecord(page)).line, { timeout: 10_000 })
      .toBeGreaterThanOrEqual(keyFrom + 20);
    const keyTops = (await streamRecord(page)).tops.slice(
      keyFrom,
      keyFrom + 20,
    );
    for (const seen of keyTops)
      expect(Math.abs(seen - keyTop)).toBeLessThanOrEqual(1);
    await page.keyboard.press("ArrowUp");
    const arrowTop = await restingTop(page);
    expect(arrowTop).toBeLessThan(keyTop);
    await stream;
    expect(Math.abs((await viewTop(page)) - arrowTop)).toBeLessThanOrEqual(1);
  });

  test("part of the way down does not resume following; the end does", async ({
    page,
  }) => {
    await wheelOverTranscript(page, -400);
    await restingTop(page);
    await wheelOverTranscript(page, 200);
    const partway = await restingTop(page);
    expect(await leftToEnd(page)).toBeGreaterThan(2);
    await expect(newestArrow(page)).toBeVisible();
    await grow(page, 200);
    await settle(page);
    expect(Math.abs((await viewTop(page)) - partway)).toBeLessThanOrEqual(1);
    await expect(newestArrow(page)).toBeVisible();
    await wheelOverTranscript(page, 100_000);
    await expect.poll(() => leftToEnd(page)).toBeLessThanOrEqual(2);
    await expect(newestArrow(page)).toHaveCount(0);
    await grow(page, 200);
    await settle(page);
    expect(await leftToEnd(page)).toBeLessThanOrEqual(2);
    await expect(newestArrow(page)).toHaveCount(0);
  });

  test("reopening at a saved middle position stays there with the arrow", async ({
    page,
  }) => {
    await wheelOverTranscript(page, -400);
    const saved = await restingTop(page);
    await page
      .getByRole("button", { name: "Minimize Quick Chat", exact: true })
      .click();
    await expect(page.getByTestId("quickchat-panel")).toHaveCount(0);
    // Watch every frame from the click on: once drawn, the arrow never leaves.
    await page.evaluate(() => {
      const seen = { frames: 0, shown: 0, gone: 0 };
      (window as unknown as { __arrow: typeof seen }).__arrow = seen;
      const watch = () => {
        const panel = document.querySelector('[data-testid="quickchat-panel"]');
        if (panel) {
          seen.frames++;
          if (document.querySelector('button[aria-label="Newest message"]'))
            seen.shown++;
          else seen.gone++;
        }
        if (seen.frames < 30) requestAnimationFrame(watch);
      };
      requestAnimationFrame(watch);
    });
    await page.getByTestId("quickchat-launcher").click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __arrow: { frames: number } }).__arrow
              .frames,
        ),
      )
      .toBeGreaterThanOrEqual(30);
    const seen = await page.evaluate(
      () =>
        (window as unknown as { __arrow: { shown: number; gone: number } })
          .__arrow,
    );
    expect(seen).toEqual({ frames: 30, shown: 30, gone: 0 });
    expect(Math.abs((await viewTop(page)) - saved)).toBeLessThanOrEqual(1);
    await expect(newestArrow(page)).toBeVisible();
  });

  test("content removed under a following reader keeps following", async ({
    page,
  }) => {
    await grow(page, 300);
    await settle(page);
    expect(await leftToEnd(page)).toBeLessThanOrEqual(2);
    await page
      .locator(".qc-messages > p")
      .last()
      .evaluate((el) => el.remove());
    await settle(page);
    expect(await leftToEnd(page)).toBeLessThanOrEqual(2);
    await expect(newestArrow(page)).toHaveCount(0);
    await grow(page, 120);
    await settle(page);
    expect(await leftToEnd(page)).toBeLessThanOrEqual(2);
    await expect(newestArrow(page)).toHaveCount(0);
  });
});

// The composer's height is the list's bottom padding: a draft opening or
// closing moves the end without any message changing size.
const DRAFT = [
  "A second thought that runs long enough to need more than one line here.",
  "And a second line.",
  "And a third.",
  "And a fourth.",
].join("\n");
const dockPadding = (page: Page) =>
  page
    .locator(".qc-messages")
    .evaluate((el) => Number.parseFloat(getComputedStyle(el).paddingBottom));

/** A reply a line every 16 ms; at line 3 the draft is cleared, or sent. */
function streamWhileDraftCloses(page: Page, how: "clear" | "send") {
  return page.evaluate(async (how) => {
    const transcript = document.querySelector(".qc-transcript") as HTMLElement;
    const field = document.querySelector(
      '[data-testid="quickchat-input"]',
    ) as HTMLTextAreaElement;
    const reply = document.createElement("p");
    reply.style.height = "0px";
    document.querySelector(".qc-messages")?.append(reply);
    let arrowFrames = 0;
    let streaming = true;
    const sample = () => {
      if (document.querySelector('button[aria-label="Newest message"]'))
        arrowFrames++;
      if (streaming) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    for (let line = 1; line <= 40; line++) {
      reply.style.height = `${line * 22}px`;
      if (line === 3) {
        if (how === "clear") {
          Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            "value",
          )?.set?.call(field, "");
          field.dispatchEvent(new Event("input", { bubbles: true }));
        } else {
          field.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
          );
        }
      }
      await new Promise<void>((done) => setTimeout(done, 16));
    }
    streaming = false;
    return {
      arrowFrames,
      left: Math.abs(
        transcript.scrollHeight -
          transcript.clientHeight -
          transcript.scrollTop,
      ),
      draft: field.value,
    };
  }, how);
}

test.describe("the composer's height and following", () => {
  test("a draft cleared while a fast reply arrives: the end is kept", async ({
    page,
  }) => {
    await longConversation(page);
    await page.getByTestId("quickchat-input").fill(DRAFT);
    await waitForAnimations(page);
    await settle(page);
    const result = await streamWhileDraftCloses(page, "clear");
    expect(result.draft).toBe("");
    await settle(page);
    expect(result.arrowFrames).toBe(0);
    expect(await leftToEnd(page)).toBeLessThanOrEqual(2);
    await expect(newestArrow(page)).toHaveCount(0);
  });

  test("a draft sent as the reply starts arriving: the end is kept", async ({
    page,
  }) => {
    // A second send waits while a turn runs, so this is the first send: the
    // composer closes as the reply's first lines land.
    const field = page.getByTestId("quickchat-input");
    await field.fill(
      `${"A long message for scroll verification. ".repeat(40)}\n${DRAFT}`,
    );
    await waitForAnimations(page);
    await settle(page);
    const result = await streamWhileDraftCloses(page, "send");
    expect(result.draft).toBe("");
    await settle(page);
    expect(result.arrowFrames).toBe(0);
    expect(await leftToEnd(page)).toBeLessThanOrEqual(2);
    await expect(newestArrow(page)).toHaveCount(0);
  });

  test("a draft that opens the composer keeps the newest message above it", async ({
    page,
  }) => {
    await longConversation(page);
    const before = await dockPadding(page);
    await page.getByTestId("quickchat-input").fill(DRAFT);
    await waitForAnimations(page);
    await settle(page);
    expect(await dockPadding(page)).toBeGreaterThan(before + 20);
    expect(await leftToEnd(page)).toBeLessThanOrEqual(2);
    const [messageBottom, composerTop] = await Promise.all([
      page
        .locator(".qc-message")
        .last()
        .evaluate((el) => el.getBoundingClientRect().bottom),
      page
        .locator(".qc-composer")
        .evaluate((el) => el.getBoundingClientRect().top),
    ]);
    expect(messageBottom).toBeLessThanOrEqual(composerTop);
    await expect(newestArrow(page)).toHaveCount(0);
  });

  test("the composer closing does not pull a reader who is further up", async ({
    page,
  }) => {
    await longConversation(page);
    await page.getByTestId("quickchat-input").fill(DRAFT);
    await waitForAnimations(page);
    await settle(page);
    await wheelOverTranscript(page, -400);
    const top = await restingTop(page);
    await expect(newestArrow(page)).toBeVisible();
    const open = await dockPadding(page);
    await page.getByTestId("quickchat-input").fill("");
    await waitForAnimations(page);
    await settle(page);
    const closed = await dockPadding(page);
    expect(open - closed).toBeGreaterThan(20);
    // The browser itself moves the view only if the end comes past it.
    expect(Math.abs((await viewTop(page)) - top)).toBeLessThanOrEqual(
      open - closed,
    );
    await expect(newestArrow(page)).toBeVisible();
    const held = await viewTop(page);
    await grow(page, 200);
    await settle(page);
    expect(Math.abs((await viewTop(page)) - held)).toBeLessThanOrEqual(1);
    await expect(newestArrow(page)).toBeVisible();
  });
});
