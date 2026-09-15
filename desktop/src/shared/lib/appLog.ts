import { invoke, isTauri } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

import {
  createRateLimiter,
  formatConsoleArguments,
  formatErrorLine,
} from "./appLog.helpers";

/**
 * The webview's end of `polyphonic.log`.
 *
 * A React error used to reach exactly one place — a devtools console nobody has
 * open — while the native half of the same failure was written to disk. This
 * module closes that gap: `window.onerror`, unhandled rejections, and every
 * `console.error`/`console.warn` are teed into the same file, in order, with
 * the same timestamps.
 *
 * Rate limited at the source. A component that throws on every frame would
 * otherwise put tens of thousands of IPC calls between the user and their disk;
 * past the budget the log records the count and stays quiet for the rest of the
 * second.
 */

/** Matches the native ceiling in `diag.rs`; the native side is the backstop. */
const MAX_LINES_PER_SECOND = 20;

const limiter = createRateLimiter(MAX_LINES_PER_SECOND);

/** Re-entrancy guard: a failing log call must never log about itself. */
let dispatching = false;
let installed = false;

/**
 * Is there an IPC bridge to talk to?
 *
 * `isTauri()` alone is not the question. It reads a flag only the real Tauri
 * IPC init script sets, so it is false under the Playwright mock bridge — which
 * is exactly where the specs need these lines to land. A bare browser preview
 * with no bridge at all has neither, and stays silent.
 */
function hasTauriBridge(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return isTauri() || "__TAURI_INTERNALS__" in window;
}

/** Fire-and-forget one line at the native log. Never throws, never awaits. */
export function appendUiLog(
  level: "error" | "warn" | "info",
  source: string,
  message: string,
): void {
  if (!hasTauriBridge() || dispatching) {
    return;
  }
  const decision = limiter.admit(Date.now());
  if (!decision.allow) {
    return;
  }

  dispatching = true;
  try {
    if (decision.droppedBefore > 0) {
      void invoke("append_ui_log", {
        level: "warn",
        source,
        message: `dropped ${decision.droppedBefore} lines from the webview (rate limit)`,
      }).catch(() => {});
    }
    void invoke("append_ui_log", { level, source, message }).catch(() => {});
  } catch {
    // An IPC bridge that refuses the call is not worth a second failure.
  } finally {
    dispatching = false;
  }
}

/**
 * Tee the global error channels into the app log.
 *
 * Idempotent, and additive by design: `console.error` keeps printing to the
 * console, the existing handlers keep running, and nothing here changes what
 * the user sees.
 */
export function installAppLogBridge(): void {
  if (installed || typeof window === "undefined" || !hasTauriBridge()) {
    return;
  }
  installed = true;

  window.addEventListener(
    "error",
    (event) => {
      // A failed <script>/<img>/<link> fires the same event with no `error`
      // and no `message`. Reporting "unknown error" for those would hide the
      // one thing worth knowing, which is what failed to load.
      const failedResource =
        event.target instanceof HTMLElement
          ? (event.target.getAttribute("src") ??
            event.target.getAttribute("href"))
          : null;
      if (failedResource) {
        appendUiLog(
          "error",
          "window.onerror",
          `resource failed to load: ${failedResource}`,
        );
        return;
      }
      const detail = event.error ?? event.message ?? "unknown error";
      appendUiLog(
        "error",
        "window.onerror",
        formatErrorLine("uncaught", detail),
      );
    },
    // Resource errors do not bubble; only the capture phase sees them.
    true,
  );

  window.addEventListener("unhandledrejection", (event) => {
    appendUiLog(
      "error",
      "unhandledrejection",
      formatErrorLine("unhandled rejection", event.reason),
    );
  });

  teeConsole("error");
  teeConsole("warn");
}

/** Wrap one console method so it also reaches the log file. */
function teeConsole(method: "error" | "warn"): void {
  const original = console[method].bind(console);
  console[method] = (...args: unknown[]) => {
    original(...args);
    appendUiLog(method, `console.${method}`, formatConsoleArguments(args));
  };
}

/** The tail of the app log. `redactPaths` for text that leaves this Mac. */
export async function readRecentAppLog(redactPaths: boolean): Promise<string> {
  if (!hasTauriBridge()) {
    return "";
  }
  try {
    return await invoke<string>("read_recent_app_log", { redactPaths });
  } catch {
    return "";
  }
}

/** Where the log file lives, or null when the native side cannot say. */
export async function appLogPath(): Promise<string | null> {
  if (!hasTauriBridge()) {
    return null;
  }
  try {
    return await invoke<string>("app_log_path");
  } catch {
    return null;
  }
}

/** Show the log file in the OS file manager. */
export async function revealAppLogFolder(): Promise<boolean> {
  const path = await appLogPath();
  if (!path) {
    return false;
  }
  try {
    await revealItemInDir(path);
    return true;
  } catch {
    // The opener permission can be absent in a stripped build; say so rather
    // than pretending a window opened somewhere off-screen.
    return false;
  }
}
