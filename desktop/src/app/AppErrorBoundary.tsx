import { getVersion } from "@tauri-apps/api/app";
import * as React from "react";

import { appendUiLog, readRecentAppLog } from "@/shared/lib/appLog";
import {
  formatCrashReport,
  formatErrorLine,
} from "@/shared/lib/appLog.helpers";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";

/**
 * What the owner sees when React gives up on a subtree.
 *
 * Before this, a render error blanked the window: React unmounts the whole tree
 * when nothing catches, so one broken component took the rail, the sidebar and
 * every conversation with it, and left a white rectangle with no way back.
 *
 * Two rules shape the surface:
 *
 * * **It is a pane, not a dialog.** A dialog implies the app behind it still
 *   works. The pane says exactly which screen is broken and leaves the rest of
 *   the shell — the rail, the sidebar, the other conversations — alive.
 * * **It hands over evidence.** "Copy report" produces the error, the build it
 *   happened on, and the last lines of `polyphonic.log`, which is the whole of
 *   what a bug report needs and more than a screenshot can carry.
 */

type Props = {
  children: React.ReactNode;
  /** Named the way the owner would name it: "Conversation", "Settings". */
  screen: string;
};

type State = {
  error: unknown;
  /** Bumped by "Reload this screen" so the subtree remounts from scratch. */
  generation: number;
};

export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, generation: 0 };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    // The log is the durable copy; the surface below is the immediate one.
    appendUiLog(
      "error",
      "react.boundary",
      formatErrorLine(`render error in ${this.props.screen}`, error),
    );
    const componentStack = info.componentStack?.trim();
    if (componentStack) {
      appendUiLog(
        "error",
        "react.boundary",
        `component stack: ${componentStack
          .split("\n")
          .slice(0, 3)
          .map((line) => line.trim())
          .join(" | ")}`,
      );
    }
  }

  private reset = (): void => {
    this.setState((previous) => ({
      error: null,
      generation: previous.generation + 1,
    }));
  };

  render(): React.ReactNode {
    if (this.state.error === null) {
      return (
        <React.Fragment key={this.state.generation}>
          {this.props.children}
        </React.Fragment>
      );
    }
    return (
      <CrashSurface
        error={this.state.error}
        onReset={this.reset}
        screen={this.props.screen}
      />
    );
  }
}

/** Copy through the platform clipboard, with the old-school path as backup. */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or no secure context — fall through.
  }
  try {
    const holder = document.createElement("textarea");
    holder.value = text;
    holder.setAttribute("readonly", "");
    holder.style.position = "fixed";
    holder.style.opacity = "0";
    document.body.appendChild(holder);
    holder.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(holder);
    return copied;
  } catch {
    return false;
  }
}

export function CrashSurface({
  className,
  error,
  onReset,
  screen,
}: {
  className?: string;
  error: unknown;
  onReset: () => void;
  screen: string;
}) {
  const [copyState, setCopyState] = React.useState<
    "idle" | "copying" | "copied" | "failed"
  >("idle");

  const copyReport = React.useCallback(async () => {
    setCopyState("copying");
    const [appVersion, logLines] = await Promise.all([
      // The build stamp is the fallback, not "unknown": a crash report with no
      // build number cannot be matched to a release.
      getVersion().catch(() => __APP_VERSION__),
      readRecentAppLog(false),
    ]);
    const report = formatCrashReport({
      appVersion,
      capturedAt: new Date().toISOString(),
      error,
      logLines,
      screen,
    });
    setCopyState((await copyToClipboard(report)) ? "copied" : "failed");
  }, [error, screen]);

  return (
    <div
      className={cn(
        // `h-full` for the root boundary (its parent is #root, a definite
        // height); `flex-1` for a pane boundary inside a flex column. Both
        // land the surface in the middle of whatever it replaced.
        "flex h-full min-h-0 w-full flex-1 items-center justify-center bg-background px-6 py-10 text-foreground",
        className,
      )}
      data-testid="app-error-boundary"
      role="alert"
    >
      <div className="w-full max-w-[420px]">
        <p className="text-base font-medium">Something broke here.</p>
        <p
          className="mt-1.5 text-sm text-muted-foreground"
          data-testid="app-error-screen"
        >
          {screen} stopped rendering.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button
            data-testid="app-error-reload"
            onClick={onReset}
            size="sm"
            type="button"
          >
            Reload this screen
          </Button>
          <Button
            data-testid="app-error-copy"
            disabled={copyState === "copying"}
            onClick={() => void copyReport()}
            size="sm"
            type="button"
            variant="outline"
          >
            {copyState === "copied"
              ? "Report copied"
              : copyState === "failed"
                ? "Copy failed"
                : "Copy report"}
          </Button>
        </div>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          The report carries the error, this build, and the last lines of the
          app log. It stays on this Mac until you paste it somewhere.
        </p>
      </div>
    </div>
  );
}
