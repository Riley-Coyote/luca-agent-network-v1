import "@/app/shell/shell-place-rails.css";
import { Sidebar, SidebarInset } from "@/shared/ui/sidebar";
import { Skeleton } from "@/shared/ui/skeleton";

const NAV_ROWS = ["one", "two", "three", "four", "five", "six"] as const;
const FIELD_ROWS = ["one", "two", "three"] as const;
/** The section list's shape: its four groups and their rows. */
const FRAME_NAV_GROUPS = [
  { key: "account", rows: 2 },
  { key: "experience", rows: 4 },
  { key: "agents", rows: 3 },
  { key: "application", rows: 3 },
] as const;

function SettingsPanelSkeleton() {
  return (
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
  );
}

/**
 * The panel under the frame, on the shared place page the loaded section is
 * on (SettingsView, WP-17): the axis 640 wide, the head's face tile beside
 * its 12 eyebrow line and 22 title (BETA14_RELEASE.md WP-33, Decided 1), 26
 * under it, then the group's rows, so nothing moves when the section
 * arrives.
 */
function SettingsFramePanelSkeleton() {
  return (
    <div className="luca-place-page-axis" data-testid="settings-loading-panel">
      <div className="luca-place-page-head" data-faced="">
        <Skeleton className="h-10 w-10 shrink-0 rounded-[11px]" />
        <div className="luca-place-page-who">
          <div className="flex h-[19px] items-center">
            <Skeleton className="h-3 w-20" />
          </div>
          <div className="flex h-[26.4px] items-center">
            <Skeleton className="h-5 w-48" />
          </div>
        </div>
      </div>
      <div className="space-y-6">
        {FIELD_ROWS.map((row) => (
          <div key={row}>
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-2 h-9 w-full rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Under the shell's frame the skeleton is the frame's two cards (the lip and
 * the places are the shell's, already drawn): the section list's card, open
 * or closed as the list is, and the panels' card, in the same places and
 * motion as the screen that replaces them.
 */
function SettingsFrameLoadingFallback() {
  return (
    <div
      aria-hidden="true"
      className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
      data-testid="settings-loading-fallback"
    >
      <Sidebar
        className="!border-r-0"
        collapsible="offcanvas"
        data-luca-settings-list=""
        frame
        variant="sidebar"
      >
        <div className="luca-settings-scroll">
          <div className="luca-settings-list">
            {FRAME_NAV_GROUPS.map((group) => (
              <div className="luca-settings-group" key={group.key}>
                <div className="luca-settings-group-head">
                  <Skeleton className="h-2.5 w-16" />
                </div>
                {Array.from({ length: group.rows }, (_, row) => (
                  <div
                    className="luca-settings-row"
                    // biome-ignore lint/suspicious/noArrayIndexKey: a fixed skeleton.
                    key={row}
                  >
                    <Skeleton className="h-3 w-24" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </Sidebar>
      <SidebarInset
        className="isolate relative min-h-0 min-w-0 overflow-hidden bg-sidebar"
        data-luca-settings-card-host=""
      >
        <div
          className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
          data-buzz-content-surface
          data-luca-conversation-surface
        >
          {/* The content plane, as the loaded page is, so Settings arrives
              by the places' order even while its panels load (WP-17, 4). */}
          <section className="luca-place-page overflow-hidden [view-transition-name:luca-content]">
            <SettingsFramePanelSkeleton />
          </section>
        </div>
      </SidebarInset>
    </div>
  );
}

/**
 * The settings chunk's suspense fallback — the master-detail shape in
 * skeleton, so opening Settings never flashes a blank frame while the
 * lazy screen loads.
 */
export function SettingsLoadingFallback({
  frame = false,
}: {
  /** Drawn inside the shell's frame (the `shell-frame` preview feature). */
  frame?: boolean;
} = {}) {
  if (frame) return <SettingsFrameLoadingFallback />;
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
        <SettingsPanelSkeleton />
      </div>
    </div>
  );
}
