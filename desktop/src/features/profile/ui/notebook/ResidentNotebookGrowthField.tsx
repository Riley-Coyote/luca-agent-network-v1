import { DotSigil } from "@/shared/ui/dot-display/DotSigil";
import type { ResidentNotebookAvailability } from "@/shared/api/tauriNotebook";
import { cn } from "@/shared/lib/cn";

/**
 * A resident-specific Notebook mark. This is a private-space signifier, not a
 * measure of capability, activity, or progress.
 */
export type NotebookAvailability = ResidentNotebookAvailability;

export interface ResidentNotebookGrowthFieldProps {
  residentPubkey: string;
  residentName: string;
  availability: NotebookAvailability;
  className?: string;
}

const UNAVAILABLE_COPY: Partial<Record<NotebookAvailability, string>> = {
  locked: "Private notebook locked",
  unavailable: "Private notebook unavailable",
};

export function ResidentNotebookGrowthField({
  residentPubkey,
  residentName,
  availability,
  className,
}: ResidentNotebookGrowthFieldProps) {
  const unavailable =
    availability === "locked" || availability === "unavailable";
  const status = UNAVAILABLE_COPY[availability];

  return (
    <section
      aria-label={`${residentName} notebook field${status ? `, ${status.toLowerCase()}` : ""}`}
      className={cn(
        "relative flex h-28 w-full items-center justify-center overflow-hidden border border-border/60 bg-black/80",
        className,
      )}
      data-notebook-availability={availability}
      data-testid="resident-notebook-growth-field"
    >
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-foreground/[0.07]" />
      <DotSigil
        accessibleName={`${residentName} notebook field`}
        bloom={0}
        cell={4}
        className={cn(
          "relative transition-opacity duration-300 motion-reduce:transition-none",
          unavailable ? "opacity-35" : "opacity-90",
        )}
        dot="188,192,196"
        scene={unavailable ? "sigil" : "recall"}
        seed={residentPubkey}
        size={104}
      />
      {status ? (
        <p className="absolute inset-x-3 bottom-2 text-center font-mono text-3xs uppercase tracking-caps-wide text-muted-foreground">
          {status}
        </p>
      ) : null}
    </section>
  );
}
