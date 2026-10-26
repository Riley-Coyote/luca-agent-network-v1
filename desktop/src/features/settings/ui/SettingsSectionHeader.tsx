import { createContext, type ReactNode, useContext } from "react";

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
 * The Settings page's own title (the section's name), where a card is drawn
 * on the Settings page; null anywhere else.
 */
export const SettingsPageTitleContext = createContext<string | null>(null);

function titleWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0 && word !== "and");
}

/**
 * Whether a group's label only repeats the page's title: every word of one is
 * in the other ("Appearance" under "Appearance", "Keyboard shortcuts" under
 * "Shortcuts", "About Polyphonic" under "About"). Such a label says nothing
 * the title has not (SHELL_BUILD.md WP-22, 2, as WP-19 d6 for eyebrows).
 */
export function labelRepeatsTitle(label: string, title: string): boolean {
  const a = titleWords(label);
  const b = titleWords(title);
  if (a.length === 0 || b.length === 0) return false;
  return a.every((w) => b.includes(w)) || b.every((w) => a.includes(w));
}

/**
 * Page title for a Settings card. Thin wrapper over the shared {@link PageHeader}
 * that preserves the `mb-12` spacing every Settings card relies on.
 *
 * Under the shell's frame the page's own head names the section (the group
 * as its eyebrow, the section as its title: SettingsView), so a card's header
 * is a group's head on the shared page, as the study draws one: its name as
 * the small label, its line beneath, its action at the end (WP-17, 1). A
 * label that only repeats the page's title is left to the title (WP-22, 2).
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
  const pageTitle = useContext(SettingsPageTitleContext);
  if (frame) {
    // A label that only repeats the page's title goes; its line stays
    // (WP-22, 2). A label that says something else stays.
    const repeats =
      typeof title === "string" &&
      pageTitle != null &&
      labelRepeatsTitle(title, pageTitle);
    return (
      <div
        className="luca-settings-group-head-page"
        data-settings-group-head={repeats ? "page-line" : ""}
      >
        <div className="min-w-0">
          {repeats ? null : <h2 className="type-eyebrow">{title}</h2>}
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
