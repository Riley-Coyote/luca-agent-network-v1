import { openUrl } from "@tauri-apps/plugin-opener";
import type { ComponentType } from "react";
import { ExternalLink, RefreshCcw, RotateCw } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Spinner } from "@/shared/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

import { useOptionalUpdaterContext } from "./hooks/UpdaterProvider";
import type { UpdateStatus } from "./hooks/use-updater";

const indicatorButtonClass =
  "relative text-ink-faint hover:bg-muted/60 hover:text-foreground";

type IndicatorIcon = ComponentType<{
  "aria-hidden"?: boolean;
  className?: string;
}>;

const variants: Record<
  "available" | "downloading" | "installing" | "manual-required" | "ready",
  {
    Icon: IndicatorIcon;
    iconClassName?: string;
    label: string;
    badgeColor: string;
  }
> = {
  available: {
    Icon: RefreshCcw,
    label: "Update available",
    badgeColor: "bg-primary",
  },
  downloading: {
    Icon: Spinner,
    iconClassName: "h-4 w-4 border-2",
    label: "Downloading update\u2026",
    badgeColor: "bg-primary",
  },
  installing: {
    Icon: Spinner,
    iconClassName: "h-4 w-4 border-2",
    label: "Installing update\u2026",
    badgeColor: "bg-primary",
  },
  "manual-required": {
    Icon: ExternalLink,
    label:
      "Update available — download from GitHub (use AppImage for auto-updates)",
    badgeColor: "bg-primary",
  },
  ready: {
    Icon: RotateCw,
    label: "Update now",
    badgeColor: "bg-emerald-500",
  },
};

function getVariant(state: UpdateStatus["state"]) {
  if (
    state === "available" ||
    state === "downloading" ||
    state === "installing" ||
    state === "manual-required" ||
    state === "ready"
  ) {
    return variants[state];
  }
  return null;
}

export function UpdateIndicator({ className }: { className?: string }) {
  // The conversation header this sits in is also the header a pop-out chat
  // window renders, and a pop-out deliberately owns no updater. No updater,
  // nothing to indicate.
  const updater = useOptionalUpdaterContext();
  const variant = updater ? getVariant(updater.status.state) : null;

  if (!updater || !variant) {
    return null;
  }

  const { status, installAndRelaunch } = updater;

  const { Icon, iconClassName = "h-4 w-4", label, badgeColor } = variant;
  const isActionable =
    status.state === "ready" || status.state === "manual-required";
  const handleClick =
    status.state === "ready"
      ? installAndRelaunch
      : status.state === "manual-required"
        ? () => {
            void openUrl(status.releaseUrl);
          }
        : null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          className={`${indicatorButtonClass} ${className ?? ""}`}
          disabled={!isActionable}
          onClick={() => {
            if (handleClick) {
              void handleClick();
            }
          }}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Icon aria-hidden className={iconClassName} />
          <span
            className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${badgeColor} animate-pulse`}
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
