import type { ReactNode } from "react";

import { useShellFrameEnabled } from "@/shared/features/useShellFrameEnabled";
import { PageHeader } from "@/shared/ui/PageHeader";

/**
 * What the app calls itself in Settings: Polyphonic under the shell's frame
 * (SHELL_BUILD.md WP-17, 6), where Luca is the companion, not the app.
 */
export function useSettingsAppName(): "Polyphonic" | "Luca" {
  return useShellFrameEnabled() ? "Polyphonic" : "Luca";
}

/**
 * Page title for a Settings card. Thin wrapper over the shared {@link PageHeader}
 * that preserves the `mb-12` spacing every Settings card relies on.
 *
 * Under the shell's frame the page's own head names the section (the group
 * as its eyebrow, the section as its title: SettingsView), so a card's header
 * is a group's head on the shared page, as the study draws one: its name as
 * the small label, its line beneath, its action at the end (WP-17, 1).
 */
export function SettingsSectionHeader({
  action,
  description,
  title,
}: {
  action?: ReactNode;
  description: ReactNode;
  title: ReactNode;
}) {
  const frame = useShellFrameEnabled();
  if (frame) {
    return (
      <div
        className="luca-settings-group-head-page"
        data-settings-group-head=""
      >
        <div className="min-w-0">
          <h2 className="type-eyebrow">{title}</h2>
          {description ? (
            <p className="luca-settings-group-line">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    );
  }
  return (
    <PageHeader
      action={action}
      className="mb-12"
      description={description}
      title={title}
    />
  );
}
