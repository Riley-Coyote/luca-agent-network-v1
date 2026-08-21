import * as React from "react";
import { TerminalSquare } from "lucide-react";

import type { AcpRuntimeCatalogEntry } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { HARNESS_LOGOS, type HarnessId } from "@/shared/ui/HarnessLogo";

// The one logo map lives in HarnessLogo; the picker keys it by catalog id.
const RUNTIME_LOGOS: Partial<Record<string, string>> = HARNESS_LOGOS as Partial<
  Record<HarnessId | string, string>
>;

function isBuzzRuntime(runtime: AcpRuntimeCatalogEntry): boolean {
  return runtime.id.trim().toLowerCase() === "buzz-agent";
}

export function getRuntimeDisplayLabel(
  runtime: AcpRuntimeCatalogEntry,
): string {
  return isBuzzRuntime(runtime) ? "Local runtime" : runtime.label;
}

function getRuntimeLogoUrl(runtime: AcpRuntimeCatalogEntry): string | null {
  return RUNTIME_LOGOS[runtime.id.trim().toLowerCase()] ?? null;
}

export function RuntimeIcon({
  className = "h-8 w-8",
  runtime,
}: {
  className?: string;
  runtime: AcpRuntimeCatalogEntry;
}) {
  const [imageFailed, setImageFailed] = React.useState(false);
  const { isDark } = useTheme();
  const runtimeLogoUrl = getRuntimeLogoUrl(runtime);
  const imageUrl = runtimeLogoUrl ?? runtime.avatarUrl;
  const shouldForceForegroundColor = !runtimeLogoUrl && runtime.id === "goose";

  if (isBuzzRuntime(runtime)) {
    return (
      <TerminalSquare
        className={cn(className, "text-foreground")}
        strokeWidth={1.25}
      />
    );
  }

  if (imageUrl && !imageFailed) {
    return (
      <img
        alt=""
        className={cn(
          "rounded-md object-contain",
          className,
          shouldForceForegroundColor &&
            (isDark ? "brightness-0 invert" : "brightness-0"),
        )}
        onError={() => setImageFailed(true)}
        src={imageUrl}
      />
    );
  }

  return (
    <TerminalSquare
      className={cn(className, "text-foreground")}
      strokeWidth={1.25}
    />
  );
}
