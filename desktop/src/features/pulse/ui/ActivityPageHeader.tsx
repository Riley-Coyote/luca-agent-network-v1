import { Bot } from "lucide-react";

import { cn } from "@/shared/lib/cn";

/**
 * The Activity page's one header, shared by both of its sections.
 *
 * Both sections read the same residents — one live, one from the stored
 * record — so they are two readings of one page rather than two pages. The
 * section switch is part of this header for the same reason the Agents
 * workspace puts Documents/Notebook/Settings there: a switch that floats
 * above the page reads as scaffolding, not as part of the interface.
 */

export type ActivitySection = "now" | "record";

export const ACTIVITY_SECTIONS: {
  key: ActivitySection;
  label: string;
}[] = [
  { key: "now", label: "Now" },
  { key: "record", label: "Signed record" },
];

function SectionTab({
  active,
  label,
  onClick,
  testId,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative pb-2 text-sm transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
        active
          ? "text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
      data-testid={testId}
      onClick={onClick}
      type="button"
    >
      {label}
      {active ? (
        <span className="absolute inset-x-0 -bottom-px h-px bg-foreground" />
      ) : null}
    </button>
  );
}

export function ActivityPageHeader({
  description,
  onSectionChange,
  section,
}: {
  /** The active section's own supporting line. */
  description: string;
  onSectionChange: (section: ActivitySection) => void;
  section: ActivitySection;
}) {
  return (
    <header className="border-b border-border/60">
      <div className="flex items-center gap-2 font-mono text-2xs uppercase tracking-widest text-muted-foreground">
        <Bot aria-hidden className="h-3.5 w-3.5" />
        Your agents at work
      </div>
      <h1 className="mt-2 text-2xl font-light tracking-tight text-foreground">
        Activity
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
        {description}
      </p>
      <nav aria-label="Activity sections" className="mt-5 flex gap-6">
        {ACTIVITY_SECTIONS.map(({ key, label }) => (
          <SectionTab
            active={section === key}
            key={key}
            label={label}
            onClick={() => onSectionChange(key)}
            testId={`activity-section-${key}`}
          />
        ))}
      </nav>
    </header>
  );
}
