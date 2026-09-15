import { expect, test, type Locator, type Page } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";
import { openSettings } from "../../helpers/settings";

const CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const CLAUDE = TEST_IDENTITIES.alice.pubkey;
const PRESENTATION_EVENT = "luca://managed-presentation";
/** The mock bridge's local identity — see DEFAULT_MOCK_PUBKEY in helpers. */
const OWNER = "deadbeef".repeat(8);
const STREAMING_TEXT_KEY = `luca.streaming-text.v1:${OWNER}`;
const WORD = "[data-md-stream-word]";
const SHOTS = "../.wp-stream-shots";

const PROSE_ONE =
  "Your draft makes one real claim: that the questions felt calibrated " +
  "rather than scripted. Everything else in the piece is context, and the " +
  "context is doing more work than it should have to do on its own.";
const PROSE_TWO =
  "The sentence about awareness is carrying the paragraph — it names the " +
  "thing the reader already suspected but had not said yet, and it does so " +
  "without asking for any credit for having noticed it first.";
const CODE = "```ts\nconst calibrated = questions.filter(honest);\n```";
const REPLY = `${PROSE_ONE}\n\n${PROSE_TWO}\n\n${CODE}`;

/** Plain-text form of the reply, for comparing against the settled row. */
const REPLY_WORDS = `${PROSE_ONE} ${PROSE_TWO}`.split(/\s+/);

/** One instant of the row, read inside the page. */
type WordFrame = {
  blurs: number[];
  scales: number[];
  settled: number;
  words: number;
};

async function seedEffect(page: Page, effect: string) {
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(
        key,
        JSON.stringify({ version: 1, effect: value }),
      );
    },
    { key: STREAMING_TEXT_KEY, value: effect },
  );
}

/** Nothing this work does may put an error on the console. */
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  return errors;
}

async function openChannel(page: Page, reducedMotion = false) {
  // Emulated before the first paint, not through `test.use` — the project's
  // device profile wins over the fixture here, and the app reads both of these
  // on its very first render.
  await page.emulateMedia({
    colorScheme: "dark",
    reducedMotion: reducedMotion ? "reduce" : "no-preference",
  });
  await installMockBridge(page, {
    managedAgents: [
      {
        channelNames: ["general"],
        name: "Claude Code",
        pubkey: CLAUDE,
        status: "running",
      },
    ],
    searchProfiles: [
      { displayName: "Claude Code", isAgent: true, pubkey: CLAUDE },
    ],
  });
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-general").click();
  // Generous on purpose: this spec is run in parallel with others, and four
  // concurrent browsers can take well past the default before the app boots.
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
              channelName: "general",
            }) ?? false,
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
}

async function send(page: Page, content: string): Promise<string> {
  // The composer mounts read-only until the channel's live subscription and
  // the editor have both settled.
  await expect(page.getByTestId("message-input")).toHaveAttribute(
    "contenteditable",
    "true",
    { timeout: 30_000 },
  );
  await page.getByTestId("message-input").fill(content);
  await page.getByTestId("send-message").click();
  const row = page
    .getByTestId("message-row")
    .filter({ hasText: content })
    .last();
  await expect(row).toBeVisible();
  const messageId = await row.getAttribute("data-message-id");
  if (!messageId) throw new Error("Expected an owner event ID.");
  return messageId;
}

async function emitFrame(
  page: Page,
  input: {
    kind: string;
    publicChunk?: string;
    receiptId: string;
    sequence: number;
    turnId: string;
  },
) {
  await page.evaluate(
    ({ eventName, frame }) => {
      window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.(eventName, frame);
    },
    {
      eventName: PRESENTATION_EVENT,
      frame: {
        protocol: "luca.managed.presentation.v1",
        kind: input.kind,
        resident_pubkey: CLAUDE,
        conversation_id: CHANNEL_ID,
        turn_id: input.turnId,
        dispatch_receipt_id: input.receiptId,
        session_epoch: 7,
        sequence: input.sequence,
        ...(input.publicChunk ? { public_chunk: input.publicChunk } : {}),
      },
    },
  );
}

/**
 * The signed final is what actually ends the stream: `completed` only closes
 * the frame sequence, and the row keeps streaming until the durable event
 * lands.
 */
async function emitSignedFinal(page: Page, receiptId: string, id: string) {
  await page.evaluate(
    ({ eventId, parentEventId, pubkey, text }) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        content: text,
        id: eventId,
        parentEventId,
        pubkey,
        extraTags: [
          ["broadcast", "1"],
          ["luca-managed-dispatch", parentEventId],
        ],
      });
    },
    { eventId: id, parentEventId: receiptId, pubkey: CLAUDE, text: REPLY },
  );
}

function managedRow(page: Page): Locator {
  return page.locator("[data-managed-response-ui-key]").last();
}

/** Start a streamed reply and return its row. Does not wait for it to finish. */
async function streamReply(
  page: Page,
  turnId: string,
): Promise<{ row: Locator; receiptId: string }> {
  const receiptId = await send(page, `Read this back to me (${turnId}).`);
  await emitFrame(page, {
    kind: "turn_started",
    receiptId,
    sequence: 1,
    turnId,
  });
  await emitFrame(page, {
    kind: "public_chunk",
    publicChunk: REPLY,
    receiptId,
    sequence: 2,
    turnId,
  });
  await emitFrame(page, { kind: "completed", receiptId, sequence: 3, turnId });
  return { receiptId, row: managedRow(page) };
}

/**
 * Sample the live row from inside the page, one reading per animation frame,
 * and resolve with the first frame that satisfies the predicate.
 *
 * Deliberately not a Playwright poll: one cross-process round trip on a loaded
 * machine already costs more than a whole 320ms word, so a test-side loop
 * cannot see a leading edge at all — it sees two readings and a settled row.
 *
 * The row is re-queried every frame rather than captured once: a managed row
 * remounts when its optimistic id gives way to the signed one, and a held
 * element handle would go quietly stale mid-stream.
 */
function watchFrames(
  page: Page,
  want: "blur" | "scale",
  timeoutMs = 10_000,
): Promise<WordFrame | null> {
  return page.evaluate(
    (input) =>
      new Promise<WordFrame | null>((resolve) => {
        const deadline = performance.now() + input.timeoutMs;
        const spread = (values: number[]) =>
          new Set(values.map((value) => value.toFixed(3))).size;
        const read = (): WordFrame => {
          const rows = document.querySelectorAll(
            "[data-managed-response-ui-key]",
          );
          const row = rows[rows.length - 1];
          const spans = row
            ? Array.from(row.querySelectorAll("[data-md-stream-word]"))
            : [];
          const frame: WordFrame = {
            blurs: [],
            scales: [],
            settled: 0,
            words: spans.length,
          };
          for (const span of spans) {
            const computed = getComputedStyle(span);
            const blur = Number.parseFloat(
              /blur\(([\d.]+)px\)/.exec(computed.filter)?.[1] ?? "",
            );
            if (Number.isFinite(blur) && blur > 0) frame.blurs.push(blur);
            const scale = Number.parseFloat(
              /^matrix\(([\d.]+),/.exec(computed.transform)?.[1] ?? "",
            );
            if (Number.isFinite(scale) && scale > 1) frame.scales.push(scale);
            if (computed.filter === "none" && computed.transform === "none") {
              frame.settled += 1;
            }
          }
          return frame;
        };
        const tick = () => {
          const frame = read();
          const enough =
            input.want === "blur"
              ? spread(frame.blurs) >= 3 && frame.settled > 0
              : spread(frame.scales) >= 3;
          if (enough) return resolve(frame);
          if (performance.now() > deadline) return resolve(null);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    { timeoutMs, want },
  );
}

/**
 * The worst reading `count` produces over `ms`, sampled every frame in the
 * page. For the assertions that must hold at every instant of a stream rather
 * than at one instant of it. Re-queries the row every frame, as above.
 */
function watchWorst(
  page: Page,
  count: "code-words" | "words" | "disturbance",
  ms = 2_500,
): Promise<number> {
  return page.evaluate(
    (input) =>
      new Promise<number>((resolve) => {
        const deadline = performance.now() + input.ms;
        const read = () => {
          const rows = document.querySelectorAll(
            "[data-managed-response-ui-key]",
          );
          const row = rows[rows.length - 1];
          if (!row) return 0;
          if (input.count === "code-words") {
            return row.querySelectorAll(
              "pre [data-md-stream-word], code [data-md-stream-word]",
            ).length;
          }
          if (input.count === "words") {
            return row.querySelectorAll("[data-md-stream-word]").length;
          }
          let styled = 0;
          for (const node of row.querySelectorAll<HTMLElement>(
            ".message-markdown *",
          )) {
            const inline = node.style;
            if (
              (inline.filter && inline.filter !== "none") ||
              (inline.transform && inline.transform !== "none")
            ) {
              styled += 1;
            }
          }
          return (
            row.querySelectorAll("[data-md-stream-word]").length +
            row.querySelectorAll("[data-md-stream-effect]").length +
            styled
          );
        };
        let worst = 0;
        const tick = () => {
          worst = Math.max(worst, read());
          if (worst > 0 || performance.now() > deadline) return resolve(worst);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    { count, ms },
  );
}

function distinct(values: readonly number[]): number[] {
  return [...new Set(values.map((value) => value.toFixed(3)))].map(Number);
}

test.describe("streamed words", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("bloom lands several words at once, each at its own scale", async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await seedEffect(page, "bloom");
    await openChannel(page);
    const { row } = await streamReply(page, "bloom-turn");

    const midStream = await watchFrames(page, "scale");
    expect(midStream, "expected a frame with words still in flight").not.toBe(
      null,
    );
    const scales = distinct(midStream?.scales ?? []);
    expect(scales.length).toBeGreaterThanOrEqual(3);
    // The peak is capped: a transform reserves no layout, and the row's
    // word-spacing is sized for exactly this much overflow.
    for (const scale of scales) expect(scale).toBeLessThanOrEqual(1.1001);
    // The row opens up while words are in flight so they cannot collide.
    await expect(
      row.locator('[data-md-stream-effect="bloom"]').first(),
    ).toHaveCount(1);

    await page.screenshot({
      path: `${SHOTS}/bloom-midstream.png`,
      fullPage: false,
    });
    expect(errors).toEqual([]);
  });

  test("diffusion holds a soft gradient of blur across the leading edge", async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await seedEffect(page, "diffusion");
    await openChannel(page);
    await streamReply(page, "diffusion-turn");

    // One frame that is both a gradient at the edge and settled behind it —
    // settled counts only words whose filter AND transform are `none`.
    const midStream = await watchFrames(page, "blur");
    expect(midStream, "expected a frame with words still in flight").not.toBe(
      null,
    );
    const blurs = distinct(midStream?.blurs ?? []);
    expect(blurs.length).toBeGreaterThanOrEqual(3);
    for (const blur of blurs) {
      expect(blur).toBeGreaterThan(0);
      expect(blur).toBeLessThanOrEqual(5.001);
    }
    expect(midStream?.settled ?? 0).toBeGreaterThan(0);

    await page.screenshot({
      path: `${SHOTS}/diffusion-midstream.png`,
      fullPage: false,
    });
    expect(errors).toEqual([]);
  });

  test("a code block in the reply never gets word spans", async ({ page }) => {
    await seedEffect(page, "bloom");
    await openChannel(page);
    const { row } = await streamReply(page, "code-turn");

    await expect(row).toContainText("const calibrated");
    // Every frame of the stream, not one instant after it settles.
    expect(await watchWorst(page, "code-words")).toBe(0);
  });

  test("the spans unwrap when the stream ends, leaving the plain reply", async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await seedEffect(page, "bloom");
    await openChannel(page);
    const { receiptId, row } = await streamReply(page, "unwrap-turn");

    await expect(row).toContainText("without asking for any credit");
    await emitSignedFinal(page, receiptId, "managed-stream-signed-final");
    await expect(row).toHaveAttribute(
      "data-signed-message-id",
      "managed-stream-signed-final",
    );
    await expect(row.locator(WORD)).toHaveCount(0, { timeout: 15_000 });
    await expect(row.locator("[data-md-stream-effect]")).toHaveCount(0, {
      timeout: 15_000,
    });

    const body = await row.evaluate(
      (element) =>
        element.querySelector(".message-markdown")?.textContent ??
        element.textContent ??
        "",
    );
    for (const word of REPLY_WORDS) expect(body).toContain(word);
    expect(body).toContain("const calibrated = questions.filter(honest);");
    expect(errors).toEqual([]);
  });

  test("the bloom row eases its spacing shut behind the last word", async ({
    page,
  }) => {
    await seedEffect(page, "bloom");
    await openChannel(page);
    const { receiptId, row } = await streamReply(page, "spacing-turn");
    const root = row.locator("[data-md-stream-effect]").first();

    // The signed final is deliberately still held here, so the row cannot
    // settle out from under the sample however slow the machine is. What can
    // still be late is the width itself: the markdown stylesheet arrives in
    // its own chunk, so a single read can land while the attribute is on the
    // element but its rule has not applied to it yet, and report the inherited
    // `normal` — which parses to NaN, not to a width. Poll for a real one.
    await expect(root).toHaveAttribute("data-md-stream-effect", "bloom");
    let open = 0;
    await expect
      .poll(
        async () => {
          open = await root.evaluate(
            (element) =>
              Number.parseFloat(getComputedStyle(element).wordSpacing) || 0,
          );
          return open;
        },
        {
          message: "the bloom row must open its spacing while words fly",
          timeout: 15_000,
        },
      )
      .toBeGreaterThan(0);

    await expect(row).toContainText("without asking for any credit");

    // Record the ease from inside the page, one reading per frame. The whole
    // animation is 300ms and a single cross-process read can cost more than
    // that on a loaded machine, so a test-side loop sees the open width, then
    // nothing, and concludes the row snapped.
    await page.evaluate(() => {
      const store = window as unknown as { __streamSpacing?: number[] };
      store.__streamSpacing = [];
      const tick = () => {
        const node = document.querySelector<HTMLElement>(
          "[data-md-stream-effect]",
        );
        if (!node) return;
        store.__streamSpacing?.push(
          Number.parseFloat(getComputedStyle(node).wordSpacing) || 0,
        );
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    await emitSignedFinal(page, receiptId, "managed-spacing-signed-final");
    await expect(row.locator("[data-md-stream-effect]")).toHaveCount(0, {
      timeout: 20_000,
    });

    // The row has to ease, not snap: without the transition this records the
    // open width and then zero, with nothing in between.
    const seen = await page.evaluate(
      () =>
        (window as unknown as { __streamSpacing?: number[] }).__streamSpacing ??
        [],
    );
    expect(seen.length, "the recorder must have run").toBeGreaterThan(1);
    expect(
      seen.some((value) => value > 0 && value < open - 0.01),
      `expected a width between 0 and ${open}; saw ${JSON.stringify(seen.slice(-40))}`,
    ).toBe(true);
  });

  test("Off renders a streamed reply plain", async ({ page }) => {
    await seedEffect(page, "off");
    await openChannel(page);
    const { row } = await streamReply(page, "off-turn");

    expect(await watchWorst(page, "words")).toBe(0);
    await expect(row).toContainText("Everything else in the piece is context");
    await expect(row.locator("[data-md-stream-effect]")).toHaveCount(0);
  });

  test("the setting switches the effect and persists", async ({ page }) => {
    await openChannel(page);
    await openSettings(page, "appearance");

    const bloom = page.getByTestId("streaming-text-bloom");
    await expect(bloom).toBeVisible();
    await expect(bloom).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("streaming-text-diffusion")).toBeVisible();
    await expect(page.getByTestId("streaming-text-off")).toBeVisible();

    await page.getByTestId("streaming-text-diffusion").click();
    await expect(page.getByTestId("streaming-text-diffusion")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(bloom).toHaveAttribute("aria-pressed", "false");
    expect(
      await page.evaluate(
        (key) => window.localStorage.getItem(key),
        STREAMING_TEXT_KEY,
      ),
    ).toBe(JSON.stringify({ version: 1, effect: "diffusion" }));

    await page.goto("/?e2e=mock");
    await page.getByTestId("channel-general").click();
    await openSettings(page, "appearance");
    await expect(page.getByTestId("streaming-text-diffusion")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

test.describe("streamed words under reduced motion", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("words arrive settled — no spans, no filter, no transform", async ({
    page,
  }) => {
    await seedEffect(page, "bloom");
    await openChannel(page, true);
    expect(
      await page.evaluate(
        () => matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
      "the harness must actually be emulating reduced motion",
    ).toBe(true);
    const { row } = await streamReply(page, "reduced-turn");

    // No span, no spacing attribute, and no inline filter or transform on any
    // node of the prose, at any frame of the stream.
    expect(await watchWorst(page, "disturbance")).toBe(0);
    await expect(row).toContainText("without asking for any credit");
  });
});
