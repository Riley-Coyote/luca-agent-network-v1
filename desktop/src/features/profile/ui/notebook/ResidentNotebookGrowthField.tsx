import { DotSigil } from "@/shared/ui/dot-display/DotSigil";
import type { ResidentNotebookAvailability } from "@/shared/api/tauriNotebook";
import { cn } from "@/shared/lib/cn";
import { useTheme } from "@/shared/theme/ThemeProvider";

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
  const { isDark } = useTheme();
  const unavailable =
    availability === "locked" || availability === "unavailable";
  const status = UNAVAILABLE_COPY[availability];

  return (
    <section
      aria-label={`${residentName} notebook field${status ? `, ${status.toLowerCase()}` : ""}`}
      className={cn(
        "relative flex size-28 shrink-0 items-center justify-center",
        className,
      )}
      data-notebook-availability={availability}
      data-testid="resident-notebook-growth-field"
    >
      <div
        className="flex items-center justify-center"
        style={{
          maskImage:
            "radial-gradient(circle closest-side, black 48%, transparent 100%)",
          WebkitMaskImage:
            "radial-gradient(circle closest-side, black 48%, transparent 100%)",
        }}
      >
        <DotSigil
          accessibleName={`${residentName} notebook field`}
          bloom={0}
          cell={4}
          className={cn(
            "relative transition-opacity duration-300 motion-reduce:transition-none",
            unavailable ? "opacity-35" : "opacity-90",
          )}
          dot={isDark ? "188,192,196" : "65,68,72"}
          scene={unavailable ? "sigil" : "recall"}
          seed={residentPubkey}
          size={104}
        />
      </div>
      {status ? (
        <p className="absolute inset-x-0 bottom-0 text-center text-2xs text-muted-foreground">
          {status}
        </p>
      ) : null}
    </section>
  );
}
