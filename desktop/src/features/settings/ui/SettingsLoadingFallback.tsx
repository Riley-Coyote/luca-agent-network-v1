import { Skeleton } from "@/shared/ui/skeleton";

const NAV_ROWS = ["one", "two", "three", "four", "five", "six"] as const;
const FIELD_ROWS = ["one", "two", "three"] as const;

/**
 * The settings chunk's suspense fallback — the master-detail shape in
 * skeleton, so opening Settings never flashes a blank frame while the
 * lazy screen loads.
 */
export function SettingsLoadingFallback() {
  return (
    <div
      aria-hidden="true"
      className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
      data-testid="settings-loading-fallback"
    >
      <div className="hidden w-56 shrink-0 flex-col gap-1 border-r border-border/40 px-3 pt-14 md:flex">
        <Skeleton className="mb-3 h-4 w-20" />
        {NAV_ROWS.map((row) => (
          <Skeleton className="h-8 w-full rounded-lg" key={row} />
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex h-12 items-center border-b border-border/40 px-4">
          <Skeleton className="h-4 w-28" />
        </div>
        <div className="mx-auto w-full max-w-2xl px-6 pt-8">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="mt-3 h-4 w-72 max-w-full" />
          <div className="mt-8 space-y-6">
            {FIELD_ROWS.map((row) => (
              <div key={row}>
                <Skeleton className="h-4 w-32" />
                <Skeleton className="mt-2 h-9 w-full rounded-lg" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
