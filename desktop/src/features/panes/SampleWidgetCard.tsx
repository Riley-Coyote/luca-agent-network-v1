import * as React from "react";
import { PictureInPicture2 } from "lucide-react";

import { IdentityMark } from "@/shared/ui/dot-display/identity/IdentityMark";
import { setLifted, usePaneState } from "./paneState";

/**
 * Static stand-ins. This card exists to prove the deck's geometry and the
 * lift's state-preservation, not to report anything — there is no data path
 * behind it and there is not meant to be one yet.
 */
const RESIDENTS = [
  { name: "Luca", seed: "luca", status: "reading the morning briefs" },
  { name: "Mara", seed: "mara", status: "quiet since 4:12" },
  { name: "Sol", seed: "sol", status: "waiting on a reply" },
] as const;

const MARK_SIZE_PX = 16;

/**
 * The dev-flagged sample widget.
 *
 * The seconds counter is not decoration: it is the probe for the lift's one
 * hard requirement. If lifting ever remounts the widget's React subtree this
 * number resets to zero, and the failure is visible on screen instead of
 * hiding until something real is holding state in here.
 */
export function SampleWidgetCard() {
  const { isLifted } = usePaneState();
  const [elapsedSeconds, setElapsedSeconds] = React.useState(0);

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsedSeconds((seconds) => seconds + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="sample-widget-card"
    >
      <div className="flex h-(--mn-header-title-row,42px) shrink-0 items-center justify-between gap-2 pl-4 pr-2">
        <span className="truncate text-sm">What's alive right now</span>
        {isLifted ? null : (
          <button
            className="luca-pane-float-action shrink-0"
            data-testid="lift-pane"
            onClick={() => setLifted(true)}
            title="Lift"
            type="button"
          >
            <PictureInPicture2 aria-hidden="true" className="size-3.5" />
            <span className="sr-only">Lift</span>
          </button>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4">
        {RESIDENTS.map((resident) => (
          <div className="flex items-center gap-2.5" key={resident.name}>
            <IdentityMark seed={resident.seed} size={MARK_SIZE_PX} />
            <span className="shrink-0 text-2xs">{resident.name}</span>
            <span className="truncate text-2xs text-muted-foreground">
              {resident.status}
            </span>
          </div>
        ))}
      </div>
      <div
        className="shrink-0 px-4 py-2 text-3xs text-muted-foreground"
        data-testid="sample-widget-elapsed"
      >
        {elapsedSeconds}s since this card woke up
      </div>
    </div>
  );
}
