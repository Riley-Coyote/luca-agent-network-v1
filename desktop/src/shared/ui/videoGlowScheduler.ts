const FRAME_INTERVAL_MS = 1000 / 15;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Keep the review's colour wash current without an idle canvas loop. A paused
 * video may await one decoded frame, but never owns a recurring frame loop.
 */
export function attachVideoGlow(
  video: HTMLVideoElement,
  draw: () => void,
): () => void {
  const motion = globalThis.matchMedia?.(REDUCED_MOTION_QUERY);
  let disposed = false;
  let generation = 0;
  let pending: { kind: "video" | "animation"; id: number } | null = null;
  let decodedFrames =
    typeof video.requestVideoFrameCallback === "function" &&
    typeof video.cancelVideoFrameCallback === "function";
  let lastDrawMs = -Infinity;
  let lastMediaTime = Number.NaN;

  const blocked = () => disposed || document.hidden;
  const playing = () => !video.paused && !video.ended && !video.seeking;

  function cancel(): void {
    generation += 1;
    if (!pending) return;
    const { kind, id } = pending;
    pending = null;
    if (kind === "animation") cancelAnimationFrame(id);
    else {
      try {
        video.cancelVideoFrameCallback(id);
      } catch {
        // A source replacement may have invalidated the browser's callback.
        // The generation guard still makes any late delivery harmless.
      }
    }
  }

  function paint(nowMs: number, mediaTime: number, force = false): boolean {
    if (blocked() || video.seeking || video.readyState < 2) return false;
    if (
      !force &&
      (mediaTime === lastMediaTime || nowMs - lastDrawMs < FRAME_INTERVAL_MS)
    ) {
      return false;
    }
    try {
      draw();
      lastDrawMs = nowMs;
      lastMediaTime = mediaTime;
      return true;
    } catch {
      // Loading/decoding may not have produced a drawable image yet. A media
      // event or decoded-frame callback retries; paused rAF polling never does.
      return false;
    }
  }

  function schedule(waitForPausedFrame = false): void {
    if (
      blocked() ||
      motion?.matches === true ||
      pending ||
      video.seeking ||
      (!playing() && !waitForPausedFrame)
    )
      return;
    const currentGeneration = generation;
    if (decodedFrames) {
      try {
        const id = video.requestVideoFrameCallback((nowMs, metadata) => {
          if (disposed || currentGeneration !== generation) return;
          pending = null;
          if (blocked() || motion?.matches === true) return;
          paint(nowMs, metadata.mediaTime, !playing());
          if (playing()) schedule();
        });
        pending = { kind: "video", id };
        return;
      } catch {
        // Some media engines expose the API but cannot use it for this source.
        decodedFrames = false;
      }
    }
    if (!playing() || video.readyState < 2) return;
    const id = requestAnimationFrame((nowMs) => {
      if (disposed || currentGeneration !== generation) return;
      pending = null;
      if (blocked() || motion?.matches === true || !playing()) return;
      paint(nowMs, video.currentTime);
      schedule();
    });
    pending = { kind: "animation", id };
  }

  function refresh(): void {
    cancel();
    if (blocked()) return;
    const painted = paint(performance.now(), video.currentTime, true);
    // Reduced motion keeps the material's still image, not its moving wash.
    if (motion?.matches === true) return;
    // HAVE_CURRENT_DATA can arrive before a paused video's first drawable
    // image. Retain one decoded-frame notification in that case, not a timer.
    schedule(!painted && !video.ended);
  }

  function onTimeUpdate(): void {
    if (blocked() || pending) return;
    if (playing()) schedule();
    else if (video.currentTime !== lastMediaTime) refresh();
  }

  function onPlayback(): void {
    schedule();
  }

  const refreshEvents = [
    "loadeddata",
    "canplay",
    "seeked",
    "pause",
    "ended",
  ] as const;
  const stopEvents = [
    "seeking",
    "waiting",
    "stalled",
    "emptied",
    "loadstart",
    "error",
  ] as const;
  for (const event of refreshEvents) video.addEventListener(event, refresh);
  for (const event of stopEvents) video.addEventListener(event, cancel);
  video.addEventListener("play", onPlayback);
  video.addEventListener("playing", onPlayback);
  video.addEventListener("timeupdate", onTimeUpdate);
  document.addEventListener("visibilitychange", refresh);
  motion?.addEventListener("change", refresh);
  refresh();

  return () => {
    if (disposed) return;
    disposed = true;
    cancel();
    for (const event of refreshEvents)
      video.removeEventListener(event, refresh);
    for (const event of stopEvents) video.removeEventListener(event, cancel);
    video.removeEventListener("play", onPlayback);
    video.removeEventListener("playing", onPlayback);
    video.removeEventListener("timeupdate", onTimeUpdate);
    document.removeEventListener("visibilitychange", refresh);
    motion?.removeEventListener("change", refresh);
  };
}
