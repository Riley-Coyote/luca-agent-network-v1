import * as React from "react";

export const AUDIO_RECORDING_MIME_TYPES = [
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
] as const;

export type AudioAttachmentRecorderStatus =
  | "idle"
  | "requesting"
  | "recording"
  | "preparing";

export function selectAudioRecordingMimeType(
  recorder: Pick<typeof MediaRecorder, "isTypeSupported">,
): string | null {
  return (
    AUDIO_RECORDING_MIME_TYPES.find((mimeType) =>
      recorder.isTypeSupported(mimeType),
    ) ?? null
  );
}

export function formatAudioRecordingElapsed(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, "0")}`;
}

export function stopMediaStreamTracks(
  stream: Pick<MediaStream, "getTracks"> | null,
): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

export function audioRecordingFailureMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access wasn't granted. Check Luca in System Settings.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No microphone is available.";
  }
  if (name === "NotSupportedError") {
    return "Audio recording isn't supported on this device.";
  }
  return "Luca couldn't record audio. No message was sent.";
}

type UseAudioAttachmentRecorderOptions = {
  disabled?: boolean;
  uploadFile: (file: File) => Promise<void>;
};

export function useAudioAttachmentRecorder({
  disabled = false,
  uploadFile,
}: UseAudioAttachmentRecorderOptions) {
  const [status, setStatus] =
    React.useState<AudioAttachmentRecorderStatus>("idle");
  const [elapsedSeconds, setElapsedSeconds] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const canceledRef = React.useRef(false);
  const mountedRef = React.useRef(true);
  const requestIdRef = React.useRef(0);
  const uploadFileRef = React.useRef(uploadFile);
  uploadFileRef.current = uploadFile;

  const releaseStream = React.useCallback(() => {
    stopMediaStreamTracks(streamRef.current);
    streamRef.current = null;
  }, []);

  const cancel = React.useCallback(() => {
    requestIdRef.current += 1;
    canceledRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    recorderRef.current = null;
    chunksRef.current = [];
    releaseStream();
    if (mountedRef.current) {
      setElapsedSeconds(0);
      setStatus("idle");
    }
  }, [releaseStream]);

  const stop = React.useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, []);

  const start = React.useCallback(async () => {
    if (disabled || status !== "idle") return;
    setError(null);

    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Audio recording isn't supported on this device.");
      return;
    }
    const mimeType = selectAudioRecordingMimeType(MediaRecorder);
    if (!mimeType) {
      setError("Audio recording isn't supported on this device.");
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    canceledRef.current = false;
    setStatus("requesting");

    let stream: MediaStream | null = null;
    try {
      stream = await mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (!mountedRef.current || requestId !== requestIdRef.current) {
        stopMediaStreamTracks(stream);
        return;
      }

      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      });
      recorder.addEventListener("error", () => {
        canceledRef.current = true;
        chunksRef.current = [];
        releaseStream();
        recorderRef.current = null;
        if (mountedRef.current) {
          setStatus("idle");
          setError("Luca couldn't record audio. No message was sent.");
        }
      });
      recorder.addEventListener("stop", () => {
        const chunks = chunksRef.current;
        const wasCanceled = canceledRef.current;
        chunksRef.current = [];
        recorderRef.current = null;
        releaseStream();
        if (wasCanceled || !mountedRef.current) return;
        if (chunks.length === 0) {
          setStatus("idle");
          setError("Luca couldn't record audio. No message was sent.");
          return;
        }

        setStatus("preparing");
        const file = new File(chunks, `voice-message-${Date.now()}.m4a`, {
          type: mimeType,
        });
        void uploadFileRef.current(file).finally(() => {
          if (mountedRef.current) {
            setElapsedSeconds(0);
            setStatus("idle");
          }
        });
      });
      recorder.start();
      setElapsedSeconds(0);
      setStatus("recording");
    } catch (recordingError) {
      stopMediaStreamTracks(stream);
      releaseStream();
      recorderRef.current = null;
      if (mountedRef.current && requestId === requestIdRef.current) {
        setStatus("idle");
        setError(audioRecordingFailureMessage(recordingError));
      }
    }
  }, [disabled, releaseStream, status]);

  React.useEffect(() => {
    if (status !== "recording") return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1_000));
    }, 250);
    return () => window.clearInterval(timer);
  }, [status]);

  React.useEffect(() => {
    if (status !== "recording") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [cancel, status]);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      canceledRef.current = true;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      recorderRef.current = null;
      chunksRef.current = [];
      releaseStream();
    };
  }, [releaseStream]);

  return {
    cancel,
    dismissError: () => setError(null),
    elapsedSeconds,
    error,
    start,
    status,
    stop,
  };
}
