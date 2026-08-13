import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../../helpers/bridge";

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
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: async () => {
            if (permission === "denied") {
              throw new DOMException("denied", "NotAllowedError");
            }
            return stream;
          },
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
  await page.goto("/");
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
