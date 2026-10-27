import { Brain, RefreshCw } from "lucide-react";

import { PlacePage } from "@/app/shell/placeRails/PlacePage";
import { PlacePageHead } from "@/app/shell/placeRails/PlacePageHead";
import type { BrainViewId } from "@/app/shell/placeRails/placePicks";
import { BrainView } from "@/features/luca/brain/BrainView";
import {
  useConnectedBrainInventoryQuery,
  useWhatTheyCanRead,
} from "@/features/luca/brain/hooks";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";

/**
 * Brain's place, in the one card (BETA14_RELEASE.md WP-38, Decided 2): the
 * head (Brain's icon on the face tile, its name, and what the account's
 * minds can read, in a breath), then Brain's body as it is, for the whole
 * account. The rail picks the body's view; the head holds the scan, the
 * page's one action, where the body's tab strip held it.
 */
export function BrainCard({ view }: { view: BrainViewId }) {
  const reads = useWhatTheyCanRead(true);
  const connected = useConnectedBrainInventoryQuery();
  return (
    <PlacePage testId="brain-place">
      <PlacePageHead
        action={
          <Button
            aria-label="Scan for Brain sources"
            disabled={connected.isFetching}
            onClick={() => void connected.refetch()}
            size="quiet"
            type="button"
            variant="quiet"
          >
            <RefreshCw
              className={cn(
                connected.isFetching &&
                  "animate-spin motion-reduce:animate-none",
              )}
            />
            Scan again
          </Button>
        }
        face={<Brain />}
        state={reads || undefined}
        title="Brain"
      />
      <BrainView view={view} />
    </PlacePage>
  );
}
