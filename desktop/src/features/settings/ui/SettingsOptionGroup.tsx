import type * as React from "react";

import { cn } from "@/shared/lib/cn";

/**
 * A group of settings rows. Under the shell's frame the shared page draws it
 * without its box (`data-settings-box`: shell-settings.css, WP-17), its rows
 * (`data-settings-option-row`) on the page's axis.
 */
export function SettingsOptionGroup({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("overflow-hidden rounded-2xl bg-muted/20", className)}
      data-settings-box=""
      {...props}
    />
  );
}

export function SettingsOptionRow({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex min-h-16 items-center justify-between gap-4 px-4 py-3 text-sm",
        className,
      )}
      data-settings-option-row=""
      {...props}
    />
  );
}
