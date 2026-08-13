import assert from "node:assert/strict";
import test from "node:test";

import {
  audioRecordingFailureMessage,
  formatAudioRecordingElapsed,
  selectAudioRecordingMimeType,
  stopMediaStreamTracks,
} from "./useAudioAttachmentRecorder.ts";

test("selects only the approved MP4 audio formats in preference order", () => {
  const checked = [];
  const recorder = {
    isTypeSupported(type) {
      checked.push(type);
      return type === "audio/mp4";
    },
  };

  assert.equal(selectAudioRecordingMimeType(recorder), "audio/mp4");
  assert.deepEqual(checked, ["audio/mp4;codecs=mp4a.40.2", "audio/mp4"]);
  assert.equal(
    selectAudioRecordingMimeType({ isTypeSupported: () => false }),
    null,
  );
});

test("formats recording duration for an accessible compact timer", () => {
  assert.equal(formatAudioRecordingElapsed(0), "0:00");
  assert.equal(formatAudioRecordingElapsed(9.9), "0:09");
  assert.equal(formatAudioRecordingElapsed(65), "1:05");
});

test("stops every acquired media track", () => {
  let stopped = 0;
  stopMediaStreamTracks({
    getTracks: () => [{ stop: () => stopped++ }, { stop: () => stopped++ }],
  });
  assert.equal(stopped, 2);
});

test("uses clear, bounded microphone failure copy", () => {
  assert.equal(
    audioRecordingFailureMessage(new DOMException("denied", "NotAllowedError")),
    "Microphone access wasn't granted. Check Luca in System Settings.",
  );
  assert.equal(
    audioRecordingFailureMessage(new DOMException("missing", "NotFoundError")),
    "No microphone is available.",
  );
  assert.equal(
    audioRecordingFailureMessage(new Error("other")),
    "Luca couldn't record audio. No message was sent.",
  );
});
