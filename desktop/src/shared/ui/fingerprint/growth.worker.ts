/**
 * The CPU's growth, off the main thread: where a Mac's WebGL 2 can't render
 * to float targets, each print grows here instead (WP-39, Decided 3).
 */
import { type FingerprintKind, growOnCpu } from "./growth";

export type GrowRequest = { id: number; kind: FingerprintKind; seed: number };
export type GrowReply = { id: number; uv: Float32Array; ms: number };

/** The worker's own scope, typed by what it uses (the app's lib is the DOM's). */
const scope = self as unknown as {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<GrowRequest>) => void,
  ): void;
  postMessage(message: GrowReply, transfer: Transferable[]): void;
};

scope.addEventListener("message", (event) => {
  const { id, kind, seed } = event.data;
  const t0 = performance.now();
  const uv = growOnCpu(kind, seed);
  const reply: GrowReply = { id, uv, ms: performance.now() - t0 };
  scope.postMessage(reply, [uv.buffer]);
});
