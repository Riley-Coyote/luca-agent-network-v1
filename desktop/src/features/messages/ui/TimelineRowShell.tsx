import type * as React from "react";

import { timelineRowReserveStyle } from "@/features/messages/lib/rowHeightEstimate";
import {
  getTimelineItemKey,
  type TimelineNonDayItem,
} from "@/features/messages/lib/timelineItems";
import { cn } from "@/shared/lib/cn";

export function TimelineRowShell({
  children,
  item,
  useContentVisibility = true,
}: {
  children: React.ReactNode;
  item: TimelineNonDayItem;
  useContentVisibility?: boolean;
}) {
  return (
    <div
      className={cn("px-0", useContentVisibility && "timeline-row-cv")}
      data-luca-reading-plane
      data-timeline-item-key={getTimelineItemKey(item)}
      data-visit-active-guests={item.activeVisitGuests?.join(",")}
      data-visit-span={item.visitSpan}
      data-visit-threshold={item.visitThreshold}
      style={useContentVisibility ? timelineRowReserveStyle(item) : undefined}
    >
      {children}
    </div>
  );
}
