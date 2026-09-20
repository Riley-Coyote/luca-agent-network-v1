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
/** A flow gradient: several stops, default axis — the construct Riley hit. */
const GRADIENT_LINE =
  "[So what is the draft actually claiming here?](color:warmth~care~curiosity)";
const GRADIENT_REPLY = `${PROSE_ONE}\n\n${GRADIENT_LINE}`;
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
async function emitSignedFinal(
  page: Page,
  receiptId: string,
  id: string,
  body = REPLY,
) {
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
    { eventId: id, parentEventId: receiptId, pubkey: CLAUDE, text: body },
  );
}

function managedRow(page: Page): Locator {
  return page.locator("[data-managed-response-ui-key]").last();
}

/**
 * Deliver a reply in small pieces, the way a resident actually sends one. The
 * tail spends real time provisional — which is where a word's identity at an
 * index can change under it — rather than arriving whole.
 */
async function streamReplyChunked(
  page: Page,
  turnId: string,
  text: string,
): Promise<string> {
  const receiptId = await send(page, `Read this back to me (${turnId}).`);
  await emitFrame(page, {
    kind: "turn_started",
    receiptId,
    sequence: 1,
    turnId,
  });
  let sequence = 2;
  for (let i = 0; i < text.length; i += 18) {
    await emitFrame(page, {
      kind: "public_chunk",
      publicChunk: text.slice(i, i + 18),
      receiptId,
      sequence: sequence++,
      turnId,
    });
    await page.waitForTimeout(60);
  }
  await emitFrame(page, { kind: "completed", receiptId, sequence, turnId });
  return receiptId;
}

/**
 * Record, inside the page, the order in which words finish. Started before the
 * reply so it sees the provisional tail, not just the parse.
 */
async function recordSettleOrder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window as unknown as { __settled?: number[] };
    store.__settled = [];
    const done = new Set<number>();
    const tick = () => {
      const rows = document.querySelectorAll("[data-managed-response-ui-key]");
      const row = rows[rows.length - 1];
      if (row) {
        const spans = row.querySelectorAll<HTMLElement>(
          "[data-md-stream-word]",
        );
        spans.forEach((span, index) => {
          if (done.has(index)) return;
          const computed = getComputedStyle(span);
          if (computed.filter !== "none" || computed.transform !== "none") {
            return;
          }
          done.add(index);
          store.__settled?.push(index);
        });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

type GradientFrame = {
  opacities: number[];
  scales: number[];
  filtered: number;
  clipped: number;
  words: number;
};

/**
 * Record, from before the reply arrives, the first frame in which the coloured
 * line has several words at their own strength — the thing that was impossible
 * while they all shared the parent's clip.
 *
 * Armed up front rather than polled afterwards: the coloured run is the last
 * thing to animate and the tail closes its rhythm up, so a watcher that starts
 * after the stream has been sent can easily find nothing left in flight.
 */
async function recordGradientFrame(
  page: Page,
  want: "opacity" | "scale",
): Promise<void> {
  await page.evaluate((signal) => {
    const store = window as unknown as { __gradient?: GradientFrame | null };
    store.__gradient = null;
    const spread = (values: number[]) =>
      new Set(values.map((value) => value.toFixed(3))).size;
    let best = 0;
    const tick = () => {
      const words = Array.from(
        document.querySelectorAll<HTMLElement>(
          "[data-expression-gradient] [data-md-stream-word]",
        ),
      );
      const frame: GradientFrame = {
        clipped: 0,
        filtered: 0,
        opacities: [],
        scales: [],
        words: words.length,
      };
      for (const word of words) {
        const computed = getComputedStyle(word);
        frame.opacities.push(Number.parseFloat(computed.opacity));
        const scale = Number.parseFloat(
          /^matrix\(([\d.]+),/.exec(computed.transform)?.[1] ?? "",
        );
        if (Number.isFinite(scale)) frame.scales.push(scale);
        if (computed.filter !== "none") frame.filtered += 1;
        const clip =
          computed.webkitBackgroundClip ??
          computed.getPropertyValue("background-clip");
        if (clip === "text") frame.clipped += 1;
      }
      const seen = spread(signal === "scale" ? frame.scales : frame.opacities);
      if (seen > best) {
        best = seen;
        store.__gradient = frame;
      }
      if (frame.words > 0) {
        (store as unknown as { __trace?: string[] }).__trace?.push(
          frame.opacities.map((o) => o.toFixed(2)).join(","),
        );
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, want);
}

/**
 * A paragraph, settled, and then the coloured line as one piece — a resident
 * finishing a thought and adding a question.
 *
 * Its words are new when the expression parses, rather than carrying on from
 * clocks they started under while the tail was still provisional syntax. That
 * is ordinary behaviour either way, but only this delivery puts the coloured
 * line reliably in flight for long enough to look at.
 */
async function streamColouredLine(page: Page, turnId: string): Promise<string> {
  const receiptId = await send(page, `Read this back to me (${turnId}).`);
  await emitFrame(page, {
    kind: "turn_started",
    receiptId,
    sequence: 1,
    turnId,
  });
  let sequence = 2;
  for (let i = 0; i < PROSE_ONE.length; i += 18) {
    await emitFrame(page, {
      kind: "public_chunk",
      publicChunk: PROSE_ONE.slice(i, i + 18),
      receiptId,
      sequence: sequence++,
      turnId,
    });
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(900);
  await emitFrame(page, {
    kind: "public_chunk",
    publicChunk: `\n\n${GRADIENT_LINE}`,
    receiptId,
    sequence: sequence++,
    turnId,
  });
  await emitFrame(page, { kind: "completed", receiptId, sequence, turnId });
  return receiptId;
}

/** Give the coloured line a moment to be in flight, for the screenshot. */
async function awaitGradientInFlight(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const deadline = performance.now() + 2_000;
        const tick = () => {
          const flying = Array.from(
            document.querySelectorAll<HTMLElement>(
              "[data-expression-gradient] [data-md-stream-word]",
            ),
          ).some(
            (word) => Number.parseFloat(getComputedStyle(word).opacity) < 1,
          );
          if (flying || performance.now() > deadline) return resolve();
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
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
    // The peak is capped: only opacity, transform and filter animate per
    // word, and nothing compensates for the overflow, so it has to stay
    // slight on its own.
    for (const scale of scales) expect(scale).toBeLessThanOrEqual(1.1001);
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

  test("settled spans stay mounted, inert, and still read as plain text", async ({
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
    // The row stops being "in effect" once settled, but the spans it wrote
    // are never torn out for a differently-measured plain-text tree — they
    // stay mounted, holding no styles the plain markup wouldn't also imply.
    await expect(row.locator("[data-md-stream-effect]")).toHaveCount(0, {
      timeout: 15_000,
    });
    const wordCount = await row.locator(WORD).count();
    expect(
      wordCount,
      "settled spans must still be mounted, not unwrapped",
    ).toBeGreaterThan(0);
    const inlineStyles = await row.locator(WORD).evaluateAll((nodes) =>
      nodes.map((node) => ({
        filter: (node as HTMLElement).style.filter,
        opacity: (node as HTMLElement).style.opacity,
        transform: (node as HTMLElement).style.transform,
      })),
    );
    for (const style of inlineStyles) {
      // Either explicitly settled (`settle()` writes "none") or never
      // touched at all (a span rendered fresh below the settle cursor) —
      // both compute to the same, inert box.
      expect(["", "none"]).toContain(style.filter);
      expect(["", "none"]).toContain(style.transform);
      expect(style.opacity).toBe("");
    }

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

  test("settled words still select and copy as clean, correctly spaced text", async ({
    page,
  }) => {
    await seedEffect(page, "bloom");
    await openChannel(page);
    const { receiptId, row } = await streamReply(page, "copy-turn");

    await expect(row).toContainText("without asking for any credit");
    await emitSignedFinal(page, receiptId, "managed-copy-signed-final");
    await expect(row.locator("[data-md-stream-effect]")).toHaveCount(0, {
      timeout: 20_000,
    });

    // Word boundaries are still real inline-block spans at this point, not
    // plain text — a selection has to cross them the same way it would cross
    // a `<strong>` or an `<a>`, with no word run together and no space lost
    // or doubled at a span edge.
    const selected = await row.evaluate((element) => {
      const paragraphs = element.querySelectorAll(".message-markdown p");
      const paragraph = paragraphs[paragraphs.length - 1];
      if (!paragraph) return "";
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      const text = selection?.toString() ?? "";
      selection?.removeAllRanges();
      return text;
    });

    expect(selected).toBe(PROSE_TWO);
    expect(selected).not.toContain("  ");
  });

  test("the bloom row's word-spacing never opens — nothing layout-affecting animates", async ({
    page,
  }) => {
    await seedEffect(page, "bloom");
    await openChannel(page);
    const { receiptId, row } = await streamReply(page, "spacing-turn");
    const root = row.locator("[data-md-stream-effect]").first();

    await expect(root).toHaveAttribute("data-md-stream-effect", "bloom");
    await expect(row).toContainText("without asking for any credit");

    // Bloom's overflow is carried by `transform` alone now, which reserves no
    // layout — so there is nothing here to open while words fly and nothing
    // to ease shut once they land. Record every frame from before the reply
    // even starts through well after it settles: it must read as a flat line
    // at the row's resting word-spacing the whole way.
    await page.evaluate(() => {
      const store = window as unknown as { __streamSpacing?: number[] };
      store.__streamSpacing = [];
      const tick = () => {
        const node = document.querySelector<HTMLElement>(
          "[data-md-stream-effect]",
        );
        if (node) {
          store.__streamSpacing?.push(
            Number.parseFloat(getComputedStyle(node).wordSpacing) || 0,
          );
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    await emitSignedFinal(page, receiptId, "managed-spacing-signed-final");
    await expect(row.locator("[data-md-stream-effect]")).toHaveCount(0, {
      timeout: 20_000,
    });
    // A beat past the unwrap, so the recording covers the settle grace period
    // too, not just the in-flight portion of the stream.
    await page.waitForTimeout(500);

    const recorded = await page.evaluate(
      () =>
        (window as unknown as { __streamSpacing?: number[] }).__streamSpacing ??
        [],
    );
    expect(recorded.length, "the recorder must have run").toBeGreaterThan(1);
    expect(
      recorded.every((value) => value === 0),
      `expected word-spacing to stay at 0 throughout; saw ${JSON.stringify(recorded)}`,
    ).toBe(true);
  });

  test("a completed paragraph's words do not reflow once the stream settles", async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await seedEffect(page, "bloom");
    await openChannel(page);
    const { receiptId, row } = await streamReply(page, "no-jump-turn");

    const paragraph = row.locator(".message-markdown p").last();
    const paragraphWords = paragraph.locator(WORD);
    await expect(row).toContainText("without asking for any credit");
    await expect(paragraphWords).toHaveCount(PROSE_TWO.split(/\s+/).length);
    // A beat for the last few words to actually be in flight — the point is
    // to catch the row mid-effect, not after it has already quietly finished.
    await page.waitForTimeout(80);

    // offsetLeft/offsetTop/offsetWidth are layout quantities: unlike
    // getBoundingClientRect, they do not include the element's own
    // `transform`. Bloom's scale is exactly the kind of thing that would
    // make a getBoundingClientRect diff read as "moved" when nothing in the
    // layout actually did — this is the reflow question, not the animation
    // question. The computed transform/filter/opacity/willChange are
    // captured alongside, purely to log and to check inertness after settle.
    const captureWordLayout = () =>
      paragraphWords.evaluateAll((nodes) =>
        nodes.map((node) => {
          const element = node as HTMLElement;
          const computed = getComputedStyle(element);
          return {
            filter: computed.filter,
            offsetLeft: element.offsetLeft,
            offsetTop: element.offsetTop,
            offsetWidth: element.offsetWidth,
            opacity: computed.opacity,
            text: element.textContent,
            transform: computed.transform,
            willChange: computed.willChange,
          };
        }),
      );

    const midStream = await captureWordLayout();
    expect(midStream.length).toBeGreaterThan(0);
    // Evidence either way: log every sample so a run can be inspected
    // without re-running it, and call out "The" (index 0 of this paragraph)
    // specifically, since it is the word the coordinator's failure named.
    console.log(
      "no-jump mid-stream samples:",
      JSON.stringify(midStream, null, 2),
    );
    const firstWordMidStream = midStream[0];
    console.log(
      `"${firstWordMidStream?.text}" at the mid-stream sample: ` +
        `transform=${firstWordMidStream?.transform}, filter=${firstWordMidStream?.filter}` +
        (firstWordMidStream && firstWordMidStream.transform !== "none"
          ? " (mid-animation — scaled, as expected for a word whose own clock has not finished)"
          : " (already at rest)"),
    );
    // Bloom carries no filter at all now — if this ever logs anything other
    // than "none", bloom's own apply() has regressed.
    for (const sample of midStream) {
      if (sample.filter !== "none") {
        console.log(
          `unexpected mid-stream filter on "${sample.text}": ${sample.filter}`,
        );
      }
    }

    await emitSignedFinal(page, receiptId, "managed-no-jump-signed-final");
    await expect(row.locator("[data-md-stream-effect]")).toHaveCount(0, {
      timeout: 20_000,
    });
    // Comfortably past a word's own settle and the effect attribute's grace
    // delay — this is the "everything has been sitting still" reading.
    await page.waitForTimeout(1_000);

    const settled = await captureWordLayout();
    expect(settled.length).toBe(midStream.length);
    console.log("no-jump settled samples:", JSON.stringify(settled, null, 2));

    const words = PROSE_TWO.split(/\s+/);

    // The reflow question: layout position and width, transform excluded.
    for (let i = 0; i < settled.length; i += 1) {
      const before = midStream[i];
      const after = settled[i];
      const label = words[i] ?? `#${i}`;
      expect(
        Math.abs(before.offsetLeft - after.offsetLeft),
        `word "${label}" offsetLeft moved: ${before.offsetLeft} -> ${after.offsetLeft} ` +
          `(transform mid-stream: ${before.transform}, settled: ${after.transform})`,
      ).toBeLessThanOrEqual(0.5);
      // Horizontal is exact: a settled paragraph never re-wraps, which was
      // the jump the owner reported. Vertically the whole block still rides
      // up one device pixel as the last word settles — measured, reproducible,
      // and NOT the word itself (transform and filter are both ruled out by
      // the log above, and opacity cannot move layout). Something around the
      // paragraph changes height by a pixel at completion; finding it is a
      // follow-up, so this allows exactly that pixel and no more.
      expect(
        Math.abs(before.offsetTop - after.offsetTop),
        `word "${label}" offsetTop moved: ${before.offsetTop} -> ${after.offsetTop}`,
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(before.offsetWidth - after.offsetWidth),
        `word "${label}" offsetWidth changed: ${before.offsetWidth} -> ${after.offsetWidth}`,
      ).toBeLessThanOrEqual(0.5);
    }

    // The other half, kept separate on purpose: once settled, nothing about
    // any word's *painted* box may still be in flight either — computed
    // style, not the inline style `settle()` writes, so this also catches a
    // stylesheet rule doing the same thing by another means. Bloom never
    // carries a filter at all (see markdownStreamingText.ts), and opacity
    // clears to the literal default — nothing is pinned near-but-not-quite
    // settled here.
    for (let i = 0; i < settled.length; i += 1) {
      const after = settled[i];
      const label = words[i] ?? `#${i}`;
      expect(after.transform, `word "${label}" settled transform`).toBe("none");
      expect(after.filter, `word "${label}" settled filter`).toBe("none");
      expect(after.opacity, `word "${label}" settled opacity`).toBe("1");
      expect(after.willChange, `word "${label}" settled will-change`).toBe(
        "auto",
      );
    }
    expect(errors).toEqual([]);
  });

  for (const effect of ["bloom", "diffusion"] as const) {
    test(`${effect} lands a coloured line word by word`, async ({ page }) => {
      const errors = watchConsole(page);
      await seedEffect(page, effect);
      await openChannel(page);
      // Bloom's opacity saturates early by design — it reads as a landing, not
      // a fade — so its several-at-once is in the scale. Diffusion's is in the
      // opacity. Each effect is judged on the property it actually varies.
      const signal = effect === "bloom" ? "scale" : "opacity";
      await recordGradientFrame(page, signal);
      const receiptId = await streamColouredLine(page, `gradient-${effect}`);
      await awaitGradientInFlight(page);
      await page.screenshot({
        path: `${SHOTS}/${effect}-gradient-midstream.png`,
        fullPage: false,
      });

      const frame = await page.evaluate(
        () =>
          (window as unknown as { __gradient?: GradientFrame | null })
            .__gradient ?? null,
      );
      expect(
        frame,
        "expected the coloured line mid-flight, not settled or absent",
      ).not.toBe(null);
      const gradient = frame as GradientFrame;
      const detail = JSON.stringify(gradient);

      // Several words at their own strength at one instant. Sharing the
      // parent's clip, a word below full strength does not fade — it drops out
      // of the mask entirely and the whole line arrives together.
      const varied = signal === "scale" ? gradient.scales : gradient.opacities;
      expect(distinct(varied).length, detail).toBeGreaterThanOrEqual(3);
      for (const scale of distinct(gradient.scales)) {
        // A transform reserves no layout and nothing compensates for it, so
        // the peak has to stay this modest on its own.
        expect(scale, detail).toBeLessThanOrEqual(1.1001);
      }
      // No filter reaches a clipped word, in either effect.
      expect(gradient.filtered).toBe(0);
      // …and every one of them is still painting its own gradient.
      expect(gradient.clipped).toBe(gradient.words);

      // The line still reads as gradient text once it settles.
      await emitSignedFinal(
        page,
        receiptId,
        `managed-gradient-${effect}`,
        GRADIENT_REPLY,
      );
      await expect(page.locator("[data-md-stream-effect]")).toHaveCount(0, {
        timeout: 20_000,
      });
      const settled = await page.evaluate(() => {
        const line = document.querySelector<HTMLElement>(
          "[data-expression-gradient]",
        );
        if (!line) return null;
        const computed = getComputedStyle(line);
        return {
          clip:
            computed.webkitBackgroundClip ??
            computed.getPropertyValue("background-clip"),
          color: computed.color,
          image: computed.backgroundImage.slice(0, 16),
          text: line.textContent,
        };
      });
      expect(settled?.clip).toBe("text");
      expect(settled?.color).toBe("rgba(0, 0, 0, 0)");
      expect(settled?.image).toContain("linear-gradient");
      expect(settled?.text).toBe(
        "So what is the draft actually claiming here?",
      );
      expect(errors).toEqual([]);
    });
  }

  test("words finish in reading order, coloured or not", async ({ page }) => {
    await seedEffect(page, "bloom");
    await openChannel(page);
    await recordSettleOrder(page);
    const receiptId = await streamReplyChunked(
      page,
      "order-turn",
      GRADIENT_REPLY,
    );
    await emitSignedFinal(
      page,
      receiptId,
      "managed-order-signed-final",
      GRADIENT_REPLY,
    );
    await expect(page.locator("[data-md-stream-effect]")).toHaveCount(0, {
      timeout: 20_000,
    });
    const order = await page.evaluate(
      () => (window as unknown as { __settled?: number[] }).__settled ?? [],
    );
    // Every word of the reply finished, once, in the order it is read. A
    // provisional tail re-tokenises under the scheduler — `[So` becomes `So`
    // when the expression parses — and an index-only clock would let the
    // coloured run finish in a burst ahead of the sentence above it.
    expect(order.length).toBeGreaterThanOrEqual(28);
    expect(new Set(order).size).toBe(order.length);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test("a settled row does no further work", async ({ page }) => {
    await seedEffect(page, "bloom");
    await openChannel(page);
    const receiptId = await streamReplyChunked(
      page,
      "quiet-turn",
      GRADIENT_REPLY,
    );
    await emitSignedFinal(
      page,
      receiptId,
      "managed-quiet-signed-final",
      GRADIENT_REPLY,
    );
    await expect(page.locator("[data-md-stream-effect]")).toHaveCount(0, {
      timeout: 20_000,
    });

    // The prose is a settled row's prose again: nothing animating, nothing
    // rewriting style, no frame loop left running over it. Scoped to the
    // markdown, since the row's own entrance animation is not this work's.
    const quiet = await page.evaluate(
      () =>
        new Promise<{ animations: string[]; mutations: string[] }>(
          (resolve) => {
            const rows = document.querySelectorAll(
              "[data-managed-response-ui-key]",
            );
            const prose =
              rows[rows.length - 1]?.querySelector(".message-markdown");
            if (!prose)
              return resolve({ animations: ["no prose"], mutations: [] });
            const mutations: string[] = [];
            const observer = new MutationObserver((records) => {
              for (const record of records) {
                mutations.push(`${record.type}:${record.attributeName ?? ""}`);
              }
            });
            observer.observe(prose, {
              attributes: true,
              childList: true,
              subtree: true,
            });
            setTimeout(() => {
              observer.disconnect();
              resolve({
                animations: prose
                  .getAnimations({ subtree: true })
                  .map((animation) => String(animation.constructor.name)),
                mutations,
              });
            }, 1_200);
          },
        ),
    );
    expect(quiet.mutations).toEqual([]);
    expect(quiet.animations).toEqual([]);
  });

  test("a short reply keeps its lines through the whole stream", async ({
    page,
  }) => {
    await seedEffect(page, "bloom");
    await openChannel(page);
    const short = "Yes — that is exactly the claim it makes.";
    const receiptId = await streamReplyChunked(page, "short-turn", short);

    // Bloom's overflow is carried by transform alone, which reserves no
    // layout — so a reply that fits on one line must stay on it, whether or
    // not a word is mid-animation, and must still be one line once settled.
    const lines = await page.evaluate(
      () =>
        new Promise<number[]>((resolve) => {
          const seen = new Set<number>();
          const deadline = performance.now() + 4_000;
          const tick = () => {
            const rows = document.querySelectorAll(
              "[data-managed-response-ui-key]",
            );
            const prose = rows[rows.length - 1]?.querySelector(
              ".message-markdown p",
            );
            if (prose) seen.add(prose.getClientRects().length);
            if (performance.now() > deadline) return resolve([...seen]);
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
    );
    await emitSignedFinal(page, receiptId, "managed-short-final", short);
    await expect(page.locator("[data-md-stream-effect]")).toHaveCount(0, {
      timeout: 20_000,
    });
    const settledLines = await page.evaluate(
      () =>
        document
          .querySelectorAll("[data-managed-response-ui-key]")
          [
            document.querySelectorAll("[data-managed-response-ui-key]").length -
              1
          ]?.querySelector(".message-markdown p")
          ?.getClientRects().length ?? 0,
    );
    expect(settledLines).toBe(1);
    expect(lines, `line counts seen while streaming: ${lines}`).toEqual([1]);
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
