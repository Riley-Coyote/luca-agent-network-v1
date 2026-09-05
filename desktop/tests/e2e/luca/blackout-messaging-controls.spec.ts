import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../../helpers/bridge";

const CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const MANAGED_AGENT_PUBKEY = "b".repeat(64);
const PRESENTATION_EVENT = "luca://managed-presentation";

async function commandLog(page: Page) {
  return page.evaluate(
    () =>
      (
        window as Window & {
          __BUZZ_E2E_COMMANDS__?: string[];
        }
      ).__BUZZ_E2E_COMMANDS__ ?? [],
  );
}

function commandCount(commands: string[], command: string) {
  return commands.filter((entry) => entry === command).length;
}

async function emitManagedFrame(
  page: Page,
  input: {
    kind: "turn_started" | "public_chunk" | "cancelled";
    receiptId: string;
    sequence: number;
    publicChunk?: string;
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
        resident_pubkey: MANAGED_AGENT_PUBKEY,
        conversation_id: CHANNEL_ID,
        turn_id: "blackout-cancellation",
        dispatch_receipt_id: input.receiptId,
        session_epoch: 7,
        sequence: input.sequence,
        ...(input.publicChunk ? { public_chunk: input.publicChunk } : {}),
      },
    },
  );
}

async function installAudioRecorder(
  page: Page,
  permission: "granted" | "denied" = "granted",
) {
  await page.addInitScript(
    ({ permission }) => {
      const testWindow = window as Window & {
        __LUCA_AUDIO_TRACK_STOP_COUNT__?: number;
      };
      testWindow.__LUCA_AUDIO_TRACK_STOP_COUNT__ = 0;

      const stream = {
        getTracks: () => [
          {
            stop: () => {
              testWindow.__LUCA_AUDIO_TRACK_STOP_COUNT__ =
                (testWindow.__LUCA_AUDIO_TRACK_STOP_COUNT__ ?? 0) + 1;
            },
          },
        ],
      } as unknown as MediaStream;
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: async () => {
          if (permission === "denied") {
            throw new DOMException("denied", "NotAllowedError");
          }
          return stream;
        },
      });

      class FakeMediaRecorder extends EventTarget {
        static isTypeSupported(type: string) {
          return type === "audio/mp4;codecs=mp4a.40.2" || type === "audio/mp4";
        }

        mimeType: string;
        state: RecordingState = "inactive";

        constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
          super();
          this.mimeType = options?.mimeType ?? "";
        }

        start() {
          this.state = "recording";
        }

        stop() {
          if (this.state === "inactive") return;
          this.state = "inactive";
          const dataEvent = new Event("dataavailable") as BlobEvent;
          Object.defineProperty(dataEvent, "data", {
            value: new Blob(["mock-audio"], { type: this.mimeType }),
          });
          this.dispatchEvent(dataEvent);
          this.dispatchEvent(new Event("stop"));
        }
      }
      Object.defineProperty(window, "MediaRecorder", {
        configurable: true,
        value: FakeMediaRecorder,
      });
    },
    { permission },
  );
}

async function openGeneral(page: Page) {
  await page.goto("/?e2e=mock");
  await expect(page.getByTestId("channel-general")).toBeVisible();
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("message-input")).toBeEditable();
}

test("records MP4 audio into the ordinary attachment and send path", async ({
  page,
}) => {
  await installAudioRecorder(page);
  await installMockBridge(page, {
    uploadDescriptors: [
      {
        url: `https://mock.relay/media/${"d".repeat(64)}.m4a`,
        sha256: "d".repeat(64),
        size: 10,
        type: "audio/mp4",
        uploaded: 1_800_000_000,
        filename: "voice-message.m4a",
      },
    ],
  });
  await openGeneral(page);

  const record = page.getByTestId("record-audio");
  await expect(record).toHaveAccessibleName("Record audio");
  await record.click();
  await expect(record).toHaveAccessibleName("Stop recording");
  await expect(record).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("audio-recording-state")).toContainText("0:00");

  await record.click();
  await expect(record).toHaveAccessibleName("Record audio");
  await expect(page.getByTestId("message-composer")).toContainText(
    "voice-message.m4a",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __BUZZ_E2E_COMMANDS__?: string[];
            }
          ).__BUZZ_E2E_COMMANDS__ ?? [],
      ),
    )
    .toContain("upload_media_bytes");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __LUCA_AUDIO_TRACK_STOP_COUNT__?: number;
            }
          ).__LUCA_AUDIO_TRACK_STOP_COUNT__ ?? 0,
      ),
    )
    .toBe(1);

  await page.getByTestId("message-input").fill("Voice note attached");
  await page.getByTestId("send-message").click();
  await expect(page.getByText("Voice note attached")).toBeVisible();
});

test("discard and Escape stop microphone capture without uploading", async ({
  page,
}) => {
  await installAudioRecorder(page);
  await installMockBridge(page);
  await openGeneral(page);

  await page.getByTestId("record-audio").click();
  await page.getByTestId("discard-audio-recording").click();
  await expect(page.getByTestId("record-audio")).toHaveAccessibleName(
    "Record audio",
  );

  await page.getByTestId("record-audio").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("record-audio")).toHaveAccessibleName(
    "Record audio",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __LUCA_AUDIO_TRACK_STOP_COUNT__?: number;
            }
          ).__LUCA_AUDIO_TRACK_STOP_COUNT__ ?? 0,
      ),
    )
    .toBe(2);
  const commands = await page.evaluate(
    () =>
      (
        window as Window & {
          __BUZZ_E2E_COMMANDS__?: string[];
        }
      ).__BUZZ_E2E_COMMANDS__ ?? [],
  );
  expect(commands).not.toContain("upload_media_bytes");
});

test("microphone denial is clear and leaves ordinary messaging available", async ({
  page,
}) => {
  await installAudioRecorder(page, "denied");
  await installMockBridge(page);
  await openGeneral(page);

  await page.getByTestId("record-audio").click();
  await expect(page.getByRole("alert")).toContainText(
    "Microphone access wasn't granted. Check Luca in System Settings.",
  );
  await expect(page.getByTestId("message-input")).toBeEditable();
  await expect(page.getByTestId("send-message")).toBeDisabled();
});

test("blackout composer sends, replies, mentions, visits, and activates through ordinary controls", async ({
  page,
}) => {
  await installMockBridge(page, {
    managedAgents: [
      {
        pubkey: MANAGED_AGENT_PUBKEY,
        name: "fizz",
        status: "stopped",
      },
    ],
  });
  await openGeneral(page);

  await expect(page.getByTestId("record-audio")).toHaveAccessibleName(
    "Record audio",
  );
  await expect(page.getByTestId("send-message")).toBeDisabled();
  await page.getByTestId("message-composer-add").click();
  await expect(
    page.getByRole("menuitem", { name: "Mention someone" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Attach files" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Formatting" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  const before = await commandLog(page);
  const input = page.getByTestId("message-input");
  await input.fill("Loop in @fizz");
  const suggestion = page
    .getByTestId("mention-autocomplete")
    .locator("button", { hasText: "fizz" });
  await expect(suggestion.getByText("not in channel")).toBeVisible();
  await input.press("Enter");
  await page.keyboard.type(" for the preview");
  await page.getByTestId("send-message").click();

  await expect
    .poll(async () =>
      commandCount(await commandLog(page), "start_managed_agent"),
    )
    .toBeGreaterThan(commandCount(before, "start_managed_agent"));
  expect(commandCount(await commandLog(page), "add_channel_members")).toBe(
    commandCount(before, "add_channel_members"),
  );

  const sent = page
    .getByTestId("message-row")
    .filter({ hasText: "for the preview" })
    .last();
  await expect(
    sent.locator("[data-mention].agent-mention-highlight", { hasText: "fizz" }),
  ).toBeVisible();
  await sent.hover();
  await sent.getByRole("button", { name: "Reply" }).click();
  const composer = page.getByTestId("message-composer");
  await expect(
    page.getByText("Replying to You", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cancel reply" }),
  ).toBeVisible();
  await composer.getByTestId("message-input").fill("Thread reply is visible");
  await composer.getByTestId("send-message").click();
  await expect(
    page
      .getByTestId("message-row")
      .filter({ hasText: "Thread reply is visible" }),
  ).toBeVisible();
  await expect(page.getByText("Replying to You", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "Cancel reply" })).toHaveCount(
    0,
  );
});

test("blackout owner controls react, remove, edit, attach, and confirm deletion", async ({
  page,
}) => {
  await installMockBridge(page, {
    uploadDescriptors: [
      {
        url: `https://mock.relay/media/${"a".repeat(64)}.pdf`,
        sha256: "a".repeat(64),
        size: 42,
        type: "application/pdf",
        uploaded: 1_800_000_000,
        filename: "blackout-proof.pdf",
      },
    ],
  });
  await openGeneral(page);

  await page.getByTestId("message-composer-add").click();
  await page.getByRole("menuitem", { name: "Attach files" }).click();
  await expect(page.getByTestId("message-composer")).toContainText(
    "blackout-proof.pdf",
  );
  await page.getByTestId("message-input").fill("Owner control proof");
  await page.getByTestId("send-message").click();

  let row = page
    .getByTestId("message-row")
    .filter({ hasText: "Owner control proof" })
    .last();
  await expect(row).toBeVisible();
  await row.hover();
  await row.getByRole("button", { name: "React with :+1:" }).click();
  const reaction = row.getByLabel("Toggle 👍 reaction");
  await expect(reaction).toBeVisible();
  await reaction.click();
  await expect(reaction).toHaveCount(0);

  await row.hover();
  await row.getByLabel("More actions").click();
  await page.getByRole("menuitem", { name: "Edit message" }).click();
  const input = page.getByTestId("message-input");
  await expect(page.getByTestId("edit-target")).toBeVisible();
  await input.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Owner control proof edited");
  await page.getByTestId("send-message").click();
  row = page
    .getByTestId("message-row")
    .filter({ hasText: "Owner control proof edited" })
    .last();
  await expect(row).toBeVisible();

  await row.hover();
  await row.getByLabel("More actions").click();
  await page.getByRole("menuitem", { name: "Delete message" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(row).toBeVisible();

  await row.hover();
  await row.getByLabel("More actions").click();
  await page.getByRole("menuitem", { name: "Delete message" }).click();
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(row).toBeHidden();
});

test("blackout cancellation preserves partial text and offers a directed retry", async ({
  page,
}) => {
  await installMockBridge(page, {
    managedAgents: [
      {
        channelNames: ["general"],
        name: "fizz",
        pubkey: MANAGED_AGENT_PUBKEY,
        status: "running",
      },
    ],
  });
  await openGeneral(page);

  await page.getByTestId("message-input").fill("Start cancellable work");
  await page.getByTestId("send-message").click();
  const ownerRow = page
    .getByTestId("message-row")
    .filter({ hasText: "Start cancellable work" })
    .last();
  const receiptId = await ownerRow.getAttribute("data-message-id");
  if (!receiptId) throw new Error("Expected an owner dispatch receipt.");

  await emitManagedFrame(page, {
    kind: "turn_started",
    receiptId,
    sequence: 1,
  });
  await emitManagedFrame(page, {
    kind: "public_chunk",
    publicChunk: "Keep this partial response.",
    receiptId,
    sequence: 2,
  });
  await expect(page.getByText("Keep this partial response.")).toBeVisible();
  await page.getByRole("button", { name: "Stop fizz" }).click();
  await expect
    .poll(async () =>
      commandCount(await commandLog(page), "cancel_managed_turn"),
    )
    .toBeGreaterThan(0);

  await emitManagedFrame(page, { kind: "cancelled", receiptId, sequence: 3 });
  await expect(
    page
      .locator("[data-managed-response-ui-key]")
      .filter({ hasText: "Keep this partial response." })
      .getByTestId("managed-response-status"),
  ).toHaveText("Stopped · Response may be incomplete");
  await expect(page.getByText("Keep this partial response.")).toBeVisible();
  await page.getByRole("button", { name: "Retry fizz" }).click();
  await expect(
    page
      .getByTestId("message-row")
      .filter({ hasText: "Start cancellable work" }),
  ).toHaveCount(2);
});
