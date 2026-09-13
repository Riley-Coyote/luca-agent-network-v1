import type { ReactNode } from "react";

import type { ResidentNotebookAvailability } from "@/shared/api/tauriNotebook";
import { ResidentNotebookGrowthField } from "./ResidentNotebookGrowthField";

/** Keeps the resident's mark in the introduction, with stable space while loading. */
export function ResidentNotebookIntro({
  residentName,
  residentPubkey,
  availability,
  actions,
}: {
  residentName: string;
  residentPubkey: string;
  availability: ResidentNotebookAvailability | null;
  actions?: ReactNode;
}) {
  return (
    <div
      className="flex min-h-28 items-center gap-4"
      data-testid="notebook-introduction"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">Notebook</p>
        <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
          Notes are saved here for possible future context. Saving a note does
          not guarantee a later turn retrieves it; check that turn&apos;s
          receipt for what Polyphonic delivered. Journal pages stay out of
          ordinary chat unless you explicitly select them.
        </p>
        {actions ? <div className="mt-3">{actions}</div> : null}
      </div>
      {availability ? (
        <ResidentNotebookGrowthField
          availability={availability}
          residentName={residentName}
          residentPubkey={residentPubkey}
        />
      ) : (
        <span aria-hidden className="size-28 shrink-0" />
      )}
    </div>
  );
}
