import { invoke } from "@tauri-apps/api/core";

import { type WriteFailure, writeFailure } from "./adapt";
import { mnemosPlace, type PlaceWrite } from "./api";

/**
 * The person's writes to the quiet hours and the shared notebook (two of
 * the seven, `write_mnemos_place`), and Mnemos's own page. Each is sent
 * once, only from the person's own act; what Mnemos said comes back as it
 * said it.
 */

type HoursWrite = Extract<PlaceWrite, { command: "hours" }>;
type SharedWrite = Extract<PlaceWrite, { command: "shared" }>;

/** Sends one write; throws a `WriteFailure` when it didn't happen (its
 *  sentence, when Mnemos refused in its own words). */
async function sendOnce(
  mind: string,
  write: HoursWrite | SharedWrite,
): Promise<string> {
  let written: Awaited<ReturnType<typeof mnemosPlace.write>>;
  try {
    written = await mnemosPlace.write(mind, write);
  } catch (error) {
    throw writeFailure(error);
  }
  if (written.kind !== write.command)
    throw { kind: "failed", code: "invalid_reply" } satisfies WriteFailure;
  return written.said;
}

/** Turn the quiet hours on at these times, or off: what the scheduler said. */
export const sendHours = (mind: string, write: HoursWrite) =>
  sendOnce(mind, write);

/** Add to, correct, or let go of the shared notebook: what it said. */
export const sendShared = (mind: string, write: SharedWrite) =>
  sendOnce(mind, write);

/** Starts the person's own `mnemos log` for the open mind (Rust
 *  `open_mnemos_own_page`), without waiting on it. */
export const openOwnPage = (mind: string) =>
  invoke<void>("open_mnemos_own_page", { mind });
