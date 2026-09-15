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

type WordSample = {
  filter: string;
  transform: string;
  opacity: string;
  text: string;
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
}

async function send(page: Page, content: string): Promise<string> {
  // The composer mounts read-only until the channel's live subscription and
  // the editor have both settled.
  await expect(page.getByTestId("message-input")).toHaveAttribute(
    "contenteditable",
    "true",
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

/** Every word span in the row, read in one instant. */
function sampleWords(row: Locator): Promise<WordSample[]> {
  return row.evaluate((element) =>
    Array.from(element.querySelectorAll("[data-md-stream-word]")).map(
      (span) => {
        const computed = getComputedStyle(span);
        return {
          filter: computed.filter,
          transform: computed.transform,
          opacity: computed.opacity,
          text: span.textContent ?? "",
        };
      },
    ),
  );
}

function blurValues(samples: readonly WordSample[]): number[] {
  return samples
    .map((sample) => Number(/blur\(([\d.]+)px\)/.exec(sample.filter)?.[1]))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function scaleValues(samples: readonly WordSample[]): number[] {
  return samples
    .map((sample) =>
      Number(/^matrix\(([\d.]+),/.exec(sample.transform)?.[1] ?? Number.NaN),
    )
    .filter((value) => Number.isFinite(value) && value > 1);
}

function distinct(values: readonly number[]): number[] {
  return [...new Set(values.map((value) => value.toFixed(3)))].map(Number);
}

/** Poll the live row until `read` returns a value that satisfies `accept`. */
async function pollFrames<T>(
  row: Locator,
  read: (row: Locator) => Promise<T>,
  accept: (value: T) => boolean,
  attempts = 220,
): Promise<T | null> {
  let last: T | null = null;
  for (let i = 0; i < attempts; i += 1) {
    const value = await read(row);
    last = value;
    if (accept(value)) return value;
  }
  return accept(last as T) ? last : null;
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

    const midStream = await pollFrames(
      row,
      sampleWords,
      (samples) => distinct(scaleValues(samples)).length >= 3,
    );
    expect(midStream, "expected a frame with words still in flight").not.toBe(
      null,
    );
    const scales = distinct(scaleValues(midStream ?? []));
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
    const { row } = await streamReply(page, "diffusion-turn");

    // One frame that is both a gradient at the edge and settled behind it.
    const midStream = await pollFrames(
      row,
      sampleWords,
      (samples) =>
        distinct(blurValues(samples)).length >= 3 &&
        samples.some((sample) => sample.filter === "none"),
    );
    expect(midStream, "expected a frame with words still in flight").not.toBe(
      null,
    );
    const blurs = distinct(blurValues(midStream ?? []));
    expect(blurs.length).toBeGreaterThanOrEqual(3);
    for (const blur of blurs) {
      expect(blur).toBeGreaterThan(0);
      expect(blur).toBeLessThanOrEqual(5.001);
    }
    // Settled words behind the edge have left their composited layer.
    const settled = (midStream ?? []).filter(
      (sample) => sample.filter === "none",
    );
    expect(settled.length).toBeGreaterThan(0);
    for (const sample of settled) expect(sample.transform).toBe("none");

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
    // Checked repeatedly across the stream, not once after it settles.
    const leaked = await pollFrames(
      row,
      (target) =>
        target.evaluate(
          (element) =>
            element.querySelectorAll(
              `pre ${"[data-md-stream-word]"}, code ${"[data-md-stream-word]"}`,
            ).length,
        ),
      (count) => count > 0,
      60,
    );
    expect(leaked).toBe(null);
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

    await expect(root).toHaveCount(1);
    const open = await root.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).wordSpacing),
    );
    expect(open).toBeGreaterThan(0);

    await expect(row).toContainText("without asking for any credit");
    await emitSignedFinal(page, receiptId, "managed-spacing-signed-final");

    // Sample as fast as the harness allows across the 300ms ease. A keyword
    // and a length do not interpolate — if the closed value were `normal`
    // this would only ever see the open width and then zero.
    const seen: number[] = [];
    for (let i = 0; i < 400; i += 1) {
      const value = await row.evaluate((element) => {
        const node = element.querySelector<HTMLElement>(
          "[data-md-stream-effect]",
        );
        return node
          ? Number.parseFloat(getComputedStyle(node).wordSpacing)
          : null;
      });
      if (value === null) break;
      seen.push(value);
      if (seen.length > 3 && value === 0) break;
    }
    expect(
      seen.some((value) => value > 0 && value < open - 0.01),
      `expected an intermediate width; saw ${JSON.stringify(seen.slice(-40))}`,
    ).toBe(true);
    await expect(row.locator("[data-md-stream-effect]")).toHaveCount(0, {
      timeout: 15_000,
    });
  });

  test("Off renders a streamed reply plain", async ({ page }) => {
    await seedEffect(page, "off");
    await openChannel(page);
    const { row } = await streamReply(page, "off-turn");

    const appeared = await pollFrames(
      row,
      (target) => target.locator(WORD).count(),
      (count) => count > 0,
      80,
    );
    expect(appeared).toBe(null);
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

    const disturbed = await pollFrames(
      row,
      (target) =>
        target.evaluate((element) => {
          const spans = element.querySelectorAll(
            "[data-md-stream-word]",
          ).length;
          const spaced = element.querySelectorAll(
            "[data-md-stream-effect]",
          ).length;
          let styled = 0;
          const prose = element.querySelectorAll<HTMLElement>(
            ".message-markdown *",
          );
          for (const node of prose) {
            const inline = node.style;
            if (
              (inline.filter && inline.filter !== "none") ||
              (inline.transform && inline.transform !== "none")
            ) {
              styled += 1;
            }
          }
          return { spans, spaced, styled };
        }),
      (value) => value.spans > 0 || value.spaced > 0 || value.styled > 0,
      80,
    );
    expect(disturbed).toBe(null);
    await expect(row).toContainText("without asking for any credit");
  });
});
