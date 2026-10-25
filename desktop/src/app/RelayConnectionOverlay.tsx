import { AnimatePresence, motion } from "motion/react";

import { SidebarConnectionStatusCard } from "@/features/sidebar/ui/SidebarConnectionStatusCard";
import { SidebarRelayConnectionCard } from "@/features/sidebar/ui/SidebarRelayConnectionCard";
import type { useSidebarRelayConnectionCard } from "@/features/sidebar/ui/useSidebarRelayConnectionCard";
import { cn } from "@/shared/lib/cn";
import { useIsMobile } from "@/shared/hooks/use-mobile";
import { useRelayConnection } from "@/shared/api/useRelayConnection";
import { useShellFrameEnabled } from "@/shared/features/useShellFrameEnabled";
import { useSidebar } from "@/shared/ui/sidebar";

type RelayConnectionOverlayProps = {
  card: ReturnType<typeof useSidebarRelayConnectionCard>;
  errorMessage?: string;
  hasCommunityRail?: boolean;
  isHuddleDrawerOpen?: boolean;
};

/**
 * Fixed bottom-left overlay that shows the relay reconnect card when the
 * sidebar is collapsed. When the sidebar is open, the card lives in the
 * sidebar footer instead (and this overlay is hidden). Offsets itself for
 * the community rail (48px) and huddle drawer when present.
 *
 * Also surfaces non-unreachable disconnect errors (e.g. auth rejections)
 * when the sidebar is hidden, since those errors are only rendered inside
 * the sidebar footer, which is off-canvas when collapsed.
 *
 * Under the shell's frame it retires (SHELL_SPEC.md, "The reconnecting
 * card", Decided 4): it would sit over the places column. There a closed
 * rail says a connection problem with the dot on the avatar, and opening it
 * shows the card in the rail's footer (app/shell/shellStatus.ts).
 */
export function RelayConnectionOverlay({
  card,
  errorMessage,
  hasCommunityRail,
  isHuddleDrawerOpen,
}: RelayConnectionOverlayProps) {
  const { open: sidebarOpen, openMobile } = useSidebar();
  const isMobile = useIsMobile();
  const connectionState = useRelayConnection();
  const frame = useShellFrameEnabled();

  // Show the overlay when the sidebar surface isn't visible:
  // - Desktop: sidebar is collapsed (open === false)
  // - Mobile: the sheet is closed (openMobile === false)
  const isSidebarSurfaceHidden = isMobile ? !openMobile : !sidebarOpen;
  const shouldShowReconnectCard =
    !frame && card.showSidebarRelayConnectionCard && isSidebarSurfaceHidden;

  // Show a non-unreachable error (e.g. auth rejection) when the sidebar is
  // hidden and the reconnect card isn't already covering it.
  const hasNonUnreachableError =
    Boolean(errorMessage) &&
    !card.hasRelayUnreachableError &&
    connectionState === "disconnected";
  const shouldShowErrorFallback =
    !frame &&
    hasNonUnreachableError &&
    isSidebarSurfaceHidden &&
    !shouldShowReconnectCard;

  return (
    <AnimatePresence>
      {shouldShowReconnectCard ? (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "pointer-events-none fixed z-50 w-[284px]",
            hasCommunityRail ? "left-[60px]" : "left-3",
            isHuddleDrawerOpen
              ? "bottom-[calc(var(--buzz-huddle-drawer-height,0px)+12px)]"
              : "bottom-3",
          )}
          exit={{ opacity: 0, y: 20 }}
          initial={{ opacity: 0, y: -20 }}
          key="relay-connection-overlay"
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="pointer-events-auto rounded-xl bg-background shadow-md">
            <SidebarRelayConnectionCard
              isConnected={card.isRelayConnectionSuccess}
              isReconnectPending={card.isRelayReconnectPending}
              isWaitingOnReconnectHook={card.isWaitingOnReconnectHook}
              onDismiss={card.onDismissRelayConnectionCard}
              onReconnect={card.onReconnectRelay}
            />
          </div>
        </motion.div>
      ) : null}
      {shouldShowErrorFallback ? (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "pointer-events-none fixed z-50 w-[284px]",
            hasCommunityRail ? "left-[60px]" : "left-3",
            isHuddleDrawerOpen
              ? "bottom-[calc(var(--buzz-huddle-drawer-height,0px)+12px)]"
              : "bottom-3",
          )}
          exit={{ opacity: 0, y: 20 }}
          initial={{ opacity: 0, y: -20 }}
          key="relay-error-overlay"
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* Same card the open sidebar shows, so the collapsed rail does not
              get its own, worse, version of the connection voice. */}
          <div className="pointer-events-auto rounded-xl bg-background shadow-md">
            <SidebarConnectionStatusCard
              errorMessage={errorMessage ?? ""}
              testId="relay-error-overlay"
            />
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
