import { Outlet, createRootRoute } from "@tanstack/react-router";

import { AppShell } from "@/app/AppShell";
import { PopoutShell } from "@/app/popout/PopoutShell";
import { isPopoutWindow } from "@/app/popout/popoutMode";

/**
 * The shell the routed conversation sits in.
 *
 * A pop-out window loads the same bundle and the same routes as the main
 * window; what differs is the frame around them. `isPopoutWindow()` is fixed
 * for the life of a document, so this picks once and never swaps.
 */
function RootShell() {
  if (isPopoutWindow()) {
    return (
      <PopoutShell>
        <Outlet />
      </PopoutShell>
    );
  }

  return <AppShell />;
}

export const Route = createRootRoute({
  component: RootShell,
});
