import * as React from "react";
import { Copy, FolderOpen, ScrollText } from "lucide-react";
import { toast } from "sonner";

import { readRecentAppLog, revealAppLogFolder } from "@/shared/lib/appLog";
import { copyTextToClipboard } from "@/shared/lib/clipboard";
import { Button } from "@/shared/ui/button";
import { SettingsOptionRow } from "./SettingsOptionGroup";

/**
 * The two things an owner actually wants from a log: to see it, and to send it.
 *
 * "Open log folder" reveals `polyphonic.log` in the file manager. "Copy recent
 * log" takes the last 200 lines with absolute paths intact — this copy stays on
 * the Mac, and the path is usually the useful part. The redacted variant is the
 * one Send Feedback attaches, because that text leaves the machine.
 */
export function AppLogActions({ className }: { className?: string }) {
  const [isCopying, setIsCopying] = React.useState(false);

  const copyRecent = React.useCallback(async () => {
    setIsCopying(true);
    try {
      const lines = await readRecentAppLog(false);
      if (lines.trim().length === 0) {
        toast.error("The app log is empty or unreadable.");
        return;
      }
      copyTextToClipboard(lines, "Recent log copied");
    } finally {
      setIsCopying(false);
    }
  }, []);

  return (
    <SettingsOptionRow className={className} data-testid="app-log-actions">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted/50">
          <ScrollText className="size-4 text-muted-foreground" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium">Application log</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Everything Polyphonic printed this launch, kept on this Mac and
            rotated at 5 MB. Secrets are removed before anything is written.
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          data-testid="app-log-open-folder"
          onClick={() => {
            void revealAppLogFolder().then((revealed) => {
              if (!revealed) {
                toast.error("Could not open the log folder.");
              }
            });
          }}
          size="sm"
          type="button"
          variant="ghost"
        >
          <FolderOpen className="mr-1.5 size-3.5" /> Open log folder
        </Button>
        <Button
          data-testid="app-log-copy-recent"
          disabled={isCopying}
          onClick={() => void copyRecent()}
          size="sm"
          type="button"
          variant="ghost"
        >
          <Copy className="mr-1.5 size-3.5" /> Copy recent log
        </Button>
      </div>
    </SettingsOptionRow>
  );
}
