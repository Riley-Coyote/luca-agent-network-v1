import {
  AlertTriangle,
  Ban,
  Check,
  LoaderCircle,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";

import type {
  BrainConnectionQueueItem,
  BrainConnectionQueueStatus,
} from "./brainConnectionQueue";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { cn } from "@/shared/lib/cn";

export function BrainConnectionDialog({
  consentCopy,
  items,
  onConfirm,
  onOpenChange,
  onRetry,
  onSelectAll,
  onStop,
  onToggle,
  open,
  running,
  selectedIds,
  sourceLabel,
  stopRequested,
}: {
  consentCopy: string;
  items: BrainConnectionQueueItem[];
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  onRetry: (discoveryId: string) => void;
  onSelectAll: (selected: boolean) => void;
  onStop: () => void;
  onToggle: (discoveryId: string, selected: boolean) => void;
  open: boolean;
  running: boolean;
  selectedIds: ReadonlySet<string>;
  sourceLabel: string;
  stopRequested: boolean;
}) {
  const selectable = items.filter((item) => item.status === "available");
  const selectedCount = items.filter((item) =>
    selectedIds.has(item.discovery.discoveryId),
  ).length;
  const selectedSelectableCount = selectable.filter((item) =>
    selectedIds.has(item.discovery.discoveryId),
  ).length;
  const allSelected =
    selectable.length > 0 && selectedSelectableCount === selectable.length;
  const settled = items.some((item) => item.status !== "available");

  return (
    <Dialog
      modal={false}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && running) return;
        onOpenChange(nextOpen);
      }}
      open={open}
    >
      <DialogContent
        aria-describedby="brain-connection-description"
        className="max-w-xl border border-border/70 bg-background"
        data-testid="brain-connection-dialog"
        overlayClassName="pointer-events-none"
        overlayVariant="transparent"
        onEscapeKeyDown={(event) => {
          if (running) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (running) event.preventDefault();
        }}
        showCloseButton={false}
      >
        <DialogHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl border border-border/60 bg-card/50 text-muted-foreground">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <DialogTitle>Choose {sourceLabel}</DialogTitle>
          <DialogDescription
            className="text-sm leading-relaxed"
            id="brain-connection-description"
          >
            Select only the sources Luca should connect. Nothing is written to
            the originals.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-3 border-y border-border/45 py-2.5 text-xs">
          <Button
            disabled={running || settled || selectable.length === 0}
            onClick={() => onSelectAll(!allSelected)}
            size="xs"
            type="button"
            variant="ghost"
          >
            {allSelected ? "Clear" : "Select all"}
          </Button>
          <span aria-live="polite" className="text-muted-foreground">
            {selectedCount} selected
          </span>
        </div>

        <fieldset
          aria-label={`Available ${sourceLabel}`}
          className="max-h-72 space-y-2 overflow-y-auto pr-1"
        >
          {items.map((item) => {
            const id = `brain-source-${item.discovery.discoveryId}`;
            const selected = selectedIds.has(item.discovery.discoveryId);
            const canSelect = item.status === "available" && !running;
            return (
              <div
                className="flex min-h-14 items-center gap-3 rounded-xl border border-border/55 bg-card/20 px-3.5 py-3"
                data-testid={`brain-connection-source-${item.discovery.discoveryId}`}
                key={item.discovery.discoveryId}
              >
                <Checkbox
                  aria-label={`Select ${item.discovery.displayName}`}
                  checked={selected}
                  disabled={!canSelect}
                  id={id}
                  onCheckedChange={(checked) =>
                    onToggle(item.discovery.discoveryId, checked === true)
                  }
                />
                <label className="min-w-0 flex-1" htmlFor={id}>
                  <span className="block truncate text-sm font-medium">
                    {item.discovery.displayName}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {sourceLocation(item)} · {item.discovery.itemCount} item
                    {item.discovery.itemCount === 1 ? "" : "s"}
                  </span>
                  {item.error ? (
                    <span className="mt-1 block text-xs text-destructive">
                      {item.error}
                    </span>
                  ) : null}
                </label>
                <QueueStatus status={item.status} />
                {item.status === "failed" && !running ? (
                  <Button
                    aria-label={`Retry ${item.discovery.displayName}`}
                    onClick={() => onRetry(item.discovery.discoveryId)}
                    size="xs"
                    type="button"
                    variant="outline"
                  >
                    <RotateCcw /> Retry
                  </Button>
                ) : null}
              </div>
            );
          })}
        </fieldset>

        <div className="flex items-start gap-2.5 rounded-xl border border-border/55 bg-card/25 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
          <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{consentCopy}</span>
        </div>

        <DialogFooter>
          {running ? (
            <Button
              disabled={stopRequested}
              onClick={onStop}
              type="button"
              variant="outline"
            >
              {stopRequested ? "Stopping after current source" : "Stop"}
            </Button>
          ) : settled ? (
            <Button onClick={() => onOpenChange(false)} type="button">
              Close
            </Button>
          ) : (
            <>
              <Button
                onClick={() => onOpenChange(false)}
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button
                disabled={selectedCount === 0}
                onClick={onConfirm}
                type="button"
              >
                Connect {selectedCount || "selected"} source
                {selectedCount === 1 ? "" : "s"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function sourceLocation(item: BrainConnectionQueueItem) {
  switch (item.discovery.sourceKind) {
    case "repository":
      return "Repository on this Mac";
    case "codex_history":
      return "Codex sessions on this Mac";
    case "claude_history":
      return "Claude Code sessions on this Mac";
  }
}

function QueueStatus({ status }: { status: BrainConnectionQueueStatus }) {
  if (status === "available") return null;
  const details: Record<
    Exclude<BrainConnectionQueueStatus, "available">,
    { icon: typeof Check; label: string; tone: string }
  > = {
    queued: {
      icon: LoaderCircle,
      label: "Queued",
      tone: "text-muted-foreground",
    },
    connecting: {
      icon: LoaderCircle,
      label: "Connecting",
      tone: "text-sky-400",
    },
    current: { icon: Check, label: "Current", tone: "text-emerald-400" },
    needs_attention: {
      icon: AlertTriangle,
      label: "Needs attention",
      tone: "text-amber-400",
    },
    failed: {
      icon: AlertTriangle,
      label: "Failed",
      tone: "text-destructive",
    },
    cancelled: {
      icon: Ban,
      label: "Cancelled",
      tone: "text-muted-foreground",
    },
  };
  const detail = details[status];
  const Icon = detail.icon;
  return (
    <span
      aria-live={status === "failed" ? "assertive" : "polite"}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 text-xs",
        detail.tone,
      )}
    >
      <Icon
        className={cn(
          "h-3.5 w-3.5",
          (status === "queued" || status === "connecting") && "animate-spin",
        )}
      />
      {detail.label}
    </span>
  );
}
