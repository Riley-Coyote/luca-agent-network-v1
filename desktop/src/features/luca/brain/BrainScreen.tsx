import * as React from "react";
import { useNavigate } from "@tanstack/react-router";

import { canonicalLucaResidentPubkey } from "@/features/luca/canonicalLucaResident";
import { useLucaResidentsQuery } from "@/features/luca/residents/hooks";
import { useShellFrameEnabled } from "@/shared/features/useShellFrameEnabled";
import { BrainView } from "./BrainView";

export function BrainScreen() {
  const shellFrame = useShellFrameEnabled();
  return shellFrame ? <BrainToLucaSpace /> : <BrainPage />;
}

function BrainPage() {
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <BrainView />
    </div>
  );
}

/**
 * Under the shell Brain is What Luca can read (SHELL_BUILD.md WP-13,
 * Decided 7): `/brain` opens Luca's space on Settings, at What they can
 * read, in place of itself, so Back never returns to it. Every way into
 * Brain goes through this route. With no Luca, Brain's page stays.
 */
function BrainToLucaSpace() {
  const navigate = useNavigate();
  const residents = useLucaResidentsQuery();
  const luca = canonicalLucaResidentPubkey(residents.data?.residents);
  const settled = residents.data !== undefined || residents.isError;

  React.useEffect(() => {
    if (!luca) return;
    void navigate({
      replace: true,
      search: { at: "read", profile: luca, section: "settings" },
      to: "/agents",
    } as never);
  }, [luca, navigate]);

  if (luca || !settled) return null;
  return <BrainPage />;
}
