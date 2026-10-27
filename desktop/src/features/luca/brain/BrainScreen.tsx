import { BrainCard } from "@/app/shell/placeRails/BrainCard";
import { BRAIN_VIEWS } from "@/app/shell/placeRails/placePicks";
import {
  useKeepPickInAddress,
  usePlacePick,
} from "@/app/shell/placeRails/usePlaceRails";
import { useShellFrameEnabled } from "@/shared/features/useShellFrameEnabled";
import { useHistorySearchState } from "@/shared/hooks/useHistorySearchState";
import { BrainView } from "./BrainView";

export function BrainScreen() {
  const shellFrame = useShellFrameEnabled();
  return shellFrame ? <BrainPlace /> : <BrainPage />;
}

function BrainPage() {
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <BrainView />
    </div>
  );
}

const BRAIN_SEARCH_KEYS = ["view"] as const;

/**
 * Under the shell Brain is its own place again, for the whole account
 * (BETA14_RELEASE.md WP-38, Decided 1 and 2): `/brain` opens it, its rail
 * picks Connections or Activity, and the pick is in the address (`view`),
 * as every place's is.
 */
function BrainPlace() {
  const { applyPatch } = useHistorySearchState(BRAIN_SEARCH_KEYS);
  useKeepPickInAddress("brain", applyPatch);
  const { pick } = usePlacePick("brain");
  const view =
    BRAIN_VIEWS.find((each) => each.id === pick)?.id ?? "connections";
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <BrainCard view={view} />
    </div>
  );
}
