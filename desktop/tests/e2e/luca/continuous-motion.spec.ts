import { Buffer } from "node:buffer";
import { expect, type Page, test } from "@playwright/test";
import { TEST_IDENTITIES } from "../../helpers/bridge";
import { openMotionShell } from "../../helpers/motionShell";

type Probe = {
  inkReads: number;
  inkWrites: number;
  glowDraws: number;
  videoCallbacks: number;
  pendingVideo: number;
};
type ProbeWindow = Window & {
  __continuousMotion: Probe;
  __watchContinuousInk: (element: HTMLElement) => void;
};

test.use({
  viewport: { width: 1440, height: 900 },
  trace: "off",
  video: "off",
});

async function installProbe(page: Page) {
  await page.addInitScript(() => {
    const state: Probe = {
      inkReads: 0,
      inkWrites: 0,
      glowDraws: 0,
      videoCallbacks: 0,
      pendingVideo: 0,
    };
    const host = window as unknown as ProbeWindow;
    host.__continuousMotion = state;
    const inkStyles = new WeakSet<CSSStyleDeclaration>();
    host.__watchContinuousInk = (element) => {
      element.setAttribute("data-continuous-ink", "");
      inkStyles.add(element.style);
    };
    const bounds = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      if (this.hasAttribute("data-continuous-ink")) state.inkReads += 1;
      return bounds.call(this);
    };
    const setProperty = CSSStyleDeclaration.prototype.setProperty;
    CSSStyleDeclaration.prototype.setProperty = function (
      name,
      value,
      priority,
    ) {
      if (name === "--ink-light" && inkStyles.has(this)) state.inkWrites += 1;
      return setProperty.call(this, name, value, priority);
    };
    const drawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (
      image: CanvasImageSource,
      ...args: number[]
    ) {
      const result = Reflect.apply(drawImage, this, [image, ...args]);
      if (this.canvas.getAttribute("data-testid") === "video-review-glow") {
        state.glowDraws += 1;
      }
      return result;
    };
    // Observe the real decoder API; do not replace playback or media state.
    const request = HTMLVideoElement.prototype.requestVideoFrameCallback;
    const cancel = HTMLVideoElement.prototype.cancelVideoFrameCallback;
    const pending = new Set<number>();
    if (request && cancel) {
      HTMLVideoElement.prototype.requestVideoFrameCallback = function (
        callback,
      ) {
        if (!this.closest('[data-testid="video-review-dialog"]')) {
          return request.call(this, callback);
        }
        const id = request.call(this, (now, metadata) => {
          pending.delete(id);
          state.pendingVideo = pending.size;
          state.videoCallbacks += 1;
          callback(now, metadata);
        });
        pending.add(id);
        state.pendingVideo = pending.size;
        return id;
      };
      HTMLVideoElement.prototype.cancelVideoFrameCallback = function (id) {
        pending.delete(id);
        state.pendingVideo = pending.size;
        return cancel.call(this, id);
      };
    }
  });
}

function readProbe(page: Page) {
  return page.evaluate(
    () => (window as unknown as ProbeWindow).__continuousMotion,
  );
}

async function expectQuiet(page: Page, keys: (keyof Probe)[]) {
  const before = await readProbe(page);
  // A bounded idle window catches the previous 15fps/continuous-rAF loops.
  await page.waitForTimeout(350);
  const after = await readProbe(page);
  for (const key of keys)
    expect(after[key], `${key} must rest`).toBe(before[key]);
}

async function emit(page: Page, content: string, extraTags?: string[][]) {
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
          channelName: "general",
        }),
      ),
    )
    .toBe(true);
  await page.evaluate(
    ({ content, pubkey, extraTags }) => {
      if (!window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__)
        throw new Error("Mock emitter missing");
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__({
        channelName: "general",
        content,
        pubkey,
        extraTags,
      });
    },
    { content, pubkey: TEST_IDENTITIES.alice.pubkey, extraTags },
  );
}

test("production wet ink sleeps offscreen and clipped, then wakes on scroll and motion changes", async ({
  page,
}) => {
  await installProbe(page);
  await openMotionShell(page);
  await emit(page, "[Motion](ink:curiosity?wet)");
  const phrase = page.locator("[data-expression-wet]", { hasText: "Motion" });
  const word = phrase.locator("[data-expression-wet-word]").first();
  await expect(word).toBeVisible();
  await word.scrollIntoViewIfNeeded();
  await word.evaluate((element) => {
    if (element.closest("[data-ink-answered]"))
      throw new Error("Fixture ink was already answered");
    (window as unknown as ProbeWindow).__watchContinuousInk(
      element as HTMLElement,
    );
  });
  await expect
    .poll(async () => (await readProbe(page)).inkWrites)
    .toBeGreaterThan(0);

  await word.evaluate((element) => {
    (element as HTMLElement).style.transform = "translateY(-10000px)";
  });
  await page.waitForTimeout(250);
  await expectQuiet(page, ["inkReads", "inkWrites"]);
  const offscreen = await readProbe(page);
  await word.evaluate((element) => {
    (element as HTMLElement).style.transform = "";
  });
  await expect
    .poll(async () => (await readProbe(page)).inkWrites)
    .toBeGreaterThan(offscreen.inkWrites);

  // Keep the parser-rendered word inside its production timeline host, but
  // surround it with a deterministic inner clipping surface. No fake word or
  // alternate renderer is mounted, and real scroll/intersection events wake it.
  await phrase.evaluate((element) => {
    const scroller = document.createElement("div");
    scroller.setAttribute("data-continuous-scroller", "");
    scroller.style.cssText =
      "height:32px;width:280px;overflow:auto;position:relative";
    const spacer = document.createElement("div");
    spacer.style.height = "180px";
    element.parentNode?.insertBefore(scroller, element);
    scroller.append(spacer, element);
    scroller.scrollIntoView({ block: "center" });
  });
  const scroller = page.locator("[data-continuous-scroller]");
  await expect(scroller).toBeInViewport();
  await page.waitForTimeout(250);
  await expectQuiet(page, ["inkReads", "inkWrites"]);
  const clipped = await readProbe(page);
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(async () => (await readProbe(page)).inkWrites)
    .toBeGreaterThan(clipped.inkWrites);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(() =>
      word.evaluate((element) => getComputedStyle(element, "::after").display),
    )
    .toBe("none");
  await page.waitForTimeout(100);
  await expectQuiet(page, ["inkReads", "inkWrites"]);
  const reduced = await readProbe(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect
    .poll(async () => (await readProbe(page)).inkWrites)
    .toBeGreaterThan(reduced.inkWrites);
});

/** Tiny real WebM, generated in the browser: no committed/downloaded binary. */
async function makeClip(page: Page) {
  return page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 90;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Fixture canvas unavailable");
    const mimeType = ["video/webm;codecs=vp8", "video/webm"].find((type) =>
      MediaRecorder.isTypeSupported(type),
    );
    if (!mimeType)
      throw new Error("Browser cannot encode the local WebM fixture");
    const stream = canvas.captureStream(20);
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: Blob[] = [];
    let frame = 0;
    const draw = () => {
      context.fillStyle = frame % 20 < 10 ? "#0071e3" : "#ffffff";
      context.fillRect(0, 0, 160, 90);
      context.fillStyle = "#000000";
      context.fillRect((frame * 5) % 140, 15, 20, 60);
      frame += 1;
    };
    draw();
    const timer = setInterval(draw, 50);
    const complete = new Promise<Blob>((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => reject(new Error("Fixture recording failed"));
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    });
    try {
      recorder.start(100);
      await new Promise((resolve) => setTimeout(resolve, 2200));
      recorder.stop();
      const blob = await complete;
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(new Error("Fixture encoding failed"));
        reader.readAsDataURL(blob);
      });
    } finally {
      clearInterval(timer);
      for (const track of stream.getTracks()) track.stop();
    }
  });
}

async function visibilityGate(page: Page, hidden: boolean) {
  // Exercise the real component's document-visibility boundary without
  // changing Riley's active tab or claiming this is a native occlusion test.
  await page.evaluate((hidden) => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: hidden,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

test("production video glow rests paused and hidden, and follows real seek/play/resume", async ({
  page,
}, info) => {
  test.setTimeout(45_000);
  await installProbe(page);
  await openMotionShell(page);
  const bytes = Buffer.from(await makeClip(page), "base64");
  const sha = "7".repeat(64);
  // The production media resolver rejects arbitrary loopback origins. This
  // reserved external origin passes through unchanged, and every request is
  // fulfilled below with our generated bytes; no network media is downloaded.
  const url = `https://continuous-motion.invalid/media/${sha}.webm`;
  const served: { url: string; range: string | undefined; status: number }[] =
    [];
  const failures: { url: string; error: string | undefined }[] = [];
  page.on("requestfailed", (request) => {
    if (request.url().includes(sha))
      failures.push({
        url: request.url(),
        error: request.failure()?.errorText,
      });
  });
  await page.route(url, async (route) => {
    const range = route
      .request()
      .headers()
      .range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2]
      ? Math.min(Number(range[2]), bytes.length - 1)
      : bytes.length - 1;
    served.push({
      url: route.request().url(),
      range: route.request().headers().range,
      status: range ? 206 : 200,
    });
    await route.fulfill({
      status: range ? 206 : 200,
      contentType: "video/webm",
      headers: {
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
        ...(range
          ? { "Content-Range": `bytes ${start}-${end}/${bytes.length}` }
          : {}),
      },
      body: bytes.subarray(start, end + 1),
    });
  });
  await emit(page, `![Motion clip](${url})`, [
    [
      "imeta",
      `url ${url}`,
      "m video/webm",
      `x ${sha}`,
      `size ${bytes.length}`,
      "dim 160x90",
      "duration 2.2",
      "filename continuous-motion.webm",
    ],
  ]);
  await page
    .getByRole("button", { name: "Open video review", exact: true })
    .last()
    .click();
  const review = page.getByTestId("video-review-dialog");
  const video = review.locator("video");
  const glow = review.getByTestId("video-review-glow");
  await expect(review).toBeVisible();
  await expect(glow).toHaveAttribute("width", "256");
  await expect(glow).toHaveAttribute("height", "144");
  await expect(glow).toHaveCSS("filter", "blur(80px) saturate(1.25)");
  await expect(
    video,
    "generated fixture must survive production URL normalization",
  ).toHaveAttribute("src", url);
  await video.evaluate((element) => {
    const video = element as HTMLVideoElement;
    // Real CORS loading keeps the real decoded frame readable for the pixel
    // assertion. Playback, readyState and frame callbacks remain native.
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.loop = true;
    video.preload = "auto";
    video.load();
  });
  try {
    await expect
      .poll(() =>
        video.evaluate((element) => (element as HTMLVideoElement).readyState),
      )
      .toBeGreaterThanOrEqual(2);
  } catch (error) {
    const media = await video.evaluate((element) => {
      const video = element as HTMLVideoElement;
      return {
        src: video.getAttribute("src"),
        currentSrc: video.currentSrc,
        readyState: video.readyState,
        networkState: video.networkState,
        error: video.error
          ? { code: video.error.code, message: video.error.message }
          : null,
        duration: String(video.duration),
        paused: video.paused,
        buffered: Array.from({ length: video.buffered.length }, (_, index) => [
          video.buffered.start(index),
          video.buffered.end(index),
        ]),
        webmSupport: video.canPlayType('video/webm; codecs="vp8"'),
      };
    });
    const diagnostics = { media, fixtureBytes: bytes.length, served, failures };
    await info.attach("video-decode-diagnostics.json", {
      body: JSON.stringify(diagnostics, null, 2),
      contentType: "application/json",
    });
    throw new Error(
      `Generated media did not decode: ${JSON.stringify(diagnostics)}`,
      { cause: error },
    );
  }
  await expect
    .poll(async () => (await readProbe(page)).glowDraws)
    .toBeGreaterThan(0);
  expect(
    await video.evaluate((element) => (element as HTMLVideoElement).paused),
  ).toBe(true);
  expect(
    await glow.evaluate(
      (element) =>
        (element as HTMLCanvasElement)
          .getContext("2d")
          ?.getImageData(0, 0, 1, 1).data[3],
    ),
  ).toBeGreaterThan(0);
  await page.waitForTimeout(150);
  await expectQuiet(page, ["glowDraws", "videoCallbacks"]);
  expect((await readProbe(page)).pendingVideo).toBe(0);

  const beforeSeek = await readProbe(page);
  await video.evaluate((element) => {
    (element as HTMLVideoElement).currentTime = 0.35;
  });
  await expect
    .poll(async () => (await readProbe(page)).glowDraws)
    .toBeGreaterThan(beforeSeek.glowDraws);
  await page.waitForTimeout(100);
  await expectQuiet(page, ["glowDraws", "videoCallbacks"]);

  const beforePlay = await readProbe(page);
  await review
    .getByRole("button", { name: "Play review video", exact: true })
    .click();
  await expect
    .poll(async () => (await readProbe(page)).glowDraws)
    .toBeGreaterThan(beforePlay.glowDraws + 1);
  await visibilityGate(page, true);
  await expectQuiet(page, ["glowDraws", "videoCallbacks"]);
  expect((await readProbe(page)).pendingVideo).toBe(0);
  const hidden = await readProbe(page);
  await visibilityGate(page, false);
  await expect
    .poll(async () => (await readProbe(page)).glowDraws)
    .toBeGreaterThan(hidden.glowDraws + 1);

  await page.emulateMedia({ reducedMotion: "reduce" });
  // One preference-change still refresh is intentional; only recurring work
  // must stop. Let that event's static paint settle before the idle window.
  await page.waitForTimeout(100);
  await expectQuiet(page, ["glowDraws", "videoCallbacks"]);
  const reduced = await readProbe(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect
    .poll(async () => (await readProbe(page)).glowDraws)
    .toBeGreaterThan(reduced.glowDraws + 1);
  await review
    .getByRole("button", { name: "Pause review video", exact: true })
    .click();
  await page.waitForTimeout(100);
  await expectQuiet(page, ["glowDraws", "videoCallbacks"]);
  expect((await readProbe(page)).pendingVideo).toBe(0);
  await review
    .getByRole("button", { name: "Close video review", exact: true })
    .click();
  await expect(review).toHaveCount(0);
  await expectQuiet(page, ["glowDraws", "videoCallbacks"]);
  expect((await readProbe(page)).pendingVideo).toBe(0);
});
