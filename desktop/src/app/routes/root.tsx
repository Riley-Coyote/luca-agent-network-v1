import { Outlet, createRootRoute } from "@tanstack/react-router";
import * as React from "react";

import { AppShell } from "@/app/AppShell";
import { PopoutShell } from "@/app/popout/PopoutShell";
import { isPopoutWindow, popoutCorrespondence } from "@/app/popout/popoutMode";
import { CorrespondenceWindow } from "@/features/exchange/ui/CorrespondenceWindow";

function CorrespondenceRoot({
  correspondenceId,
  taskId,
}: {
  correspondenceId: string;
  taskId: string | null;
}) {
  const [title, setTitle] = React.useState("Agent correspondence");
  return (
    <PopoutShell title={title}>
      <CorrespondenceWindow
        correspondenceId={correspondenceId}
        initialTaskId={taskId}
        onTitleChange={setTitle}
      />
    </PopoutShell>
  );
}

/**
 * The shell the routed conversation sits in.
 *
 * A pop-out window loads the same bundle and the same routes as the main
 * window; what differs is the frame around them. `isPopoutWindow()` is fixed
 * for the life of a document, so this picks once and never swaps.
 */
function RootShell() {
  if (isPopoutWindow()) {
    const correspondence = popoutCorrespondence();
    if (correspondence) return <CorrespondenceRoot {...correspondence} />;
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
