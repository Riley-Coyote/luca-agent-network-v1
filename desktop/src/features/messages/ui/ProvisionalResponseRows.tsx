import { Square } from "lucide-react";
import * as React from "react";

import type { ManagedPresentationRow } from "@/features/messages/managedPresentationStore";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { Button } from "@/shared/ui/button";

const phaseLabel: Record<ManagedPresentationRow["phase"], string> = {
  thinking: "Thinking…",
  working: "Working…",
  writing: "Writing…",
  finalizing: "Finalizing response…",
  cancelled: "Response stopped",
  failed: "Couldn’t finish · send again to retry",
};

const ProvisionalResponseRow = React.memo(function ProvisionalResponseRow({
  onCancel,
  profiles,
  row,
}: {
  onCancel?: (row: ManagedPresentationRow) => void;
  profiles?: UserProfileLookup;
  row: ManagedPresentationRow;
}) {
  const name = resolveUserLabel({ pubkey: row.residentPubkey, profiles });
  const active = !["cancelled", "failed"].includes(row.phase);
  return (
    <div
      className="group/provisional px-1 py-2"
      data-testid="provisional-response-row"
    >
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-medium text-foreground/90">{name}</span>
        <span className="text-xs text-muted-foreground/65">
          {phaseLabel[row.phase]}
        </span>
        {active && onCancel ? (
          <Button
            aria-label={`Stop ${name}`}
            className="ml-auto h-6 w-6 px-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/provisional:opacity-100 motion-reduce:transition-none"
            onClick={() => onCancel(row)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Square className="size-3" />
          </Button>
        ) : null}
      </div>
      {row.publicText ? (
        <div
          aria-hidden="true"
          className="mt-1 whitespace-pre-wrap break-words text-base leading-relaxed text-foreground/90"
        >
          {row.publicText}
        </div>
      ) : active ? (
        <span
          aria-hidden="true"
          className="mt-2 block size-1.5 rounded-full bg-foreground/50 motion-safe:animate-pulse"
        />
      ) : null}
      <span aria-live="polite" className="sr-only">
        {name}: {phaseLabel[row.phase]}
      </span>
    </div>
  );
});

export function ProvisionalResponseRows({
  onCancel,
  profiles,
  rows,
}: {
  onCancel?: (row: ManagedPresentationRow) => void;
  profiles?: UserProfileLookup;
  rows: readonly ManagedPresentationRow[];
}) {
  if (rows.length === 0) return null;
  return (
    <div
      className="flex flex-col gap-1 pb-2"
      data-testid="provisional-response-rows"
    >
      {rows.map((row) => (
        <ProvisionalResponseRow
          key={`${row.residentPubkey}:${row.dispatchReceiptId}`}
          onCancel={onCancel}
          profiles={profiles}
          row={row}
        />
      ))}
    </div>
  );
}
