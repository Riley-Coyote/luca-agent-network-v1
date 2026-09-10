import * as React from "react";

import type { TimelineMessage } from "@/features/messages/types";
import type { Channel } from "@/shared/api/types";
import { useOptionalSidebar } from "@/shared/ui/sidebarContext";
import {
  isCanonicalLucaDm,
  useCanonicalLucaPubkey,
} from "./canonicalLucaResident";

// Carry the first-entry layout across the setup/app mount boundary. The
// greeting is already durable: show it immediately without simulated work.
const ARRIVAL_KEY = "polyphonic-onboarding.luca-arrival.v1";

export function markLucaArrival(channelId: string) {
  try {
    window.sessionStorage.setItem(ARRIVAL_KEY, channelId);
  } catch {
    // The conversation still works when session storage is unavailable.
  }
}

export function hasPendingLucaArrival(): boolean {
  try {
    return Boolean(window.sessionStorage.getItem(ARRIVAL_KEY));
  } catch {
    return false;
  }
}

export function useLucaArrival({
  activeChannel,
  currentPubkey,
  messages,
}: {
  activeChannel: Channel | null;
  currentPubkey: string | undefined;
  messages: TimelineMessage[];
}) {
  const lucaPubkey = useCanonicalLucaPubkey();
  const sidebar = useOptionalSidebar();
  const channelId = activeChannel?.id ?? null;
  const setOpen = sidebar?.setOpen;
  const setOpenMobile = sidebar?.setOpenMobile;
  React.useEffect(() => {
    if (!channelId) return;
    try {
      if (window.sessionStorage.getItem(ARRIVAL_KEY) !== channelId) return;
      window.sessionStorage.removeItem(ARRIVAL_KEY);
      setOpen?.(false);
      setOpenMobile?.(false);
    } catch {
      // Sidebar availability never gates conversation.
    }
  }, [channelId, setOpen, setOpenMobile]);

  const isLucaDm =
    lucaPubkey !== null &&
    isCanonicalLucaDm(activeChannel, currentPubkey, lucaPubkey);
  return { isLucaDm, lucaPubkey, visibleMessages: messages };
}
