import { isTauri } from "@tauri-apps/api/core";
import {
  currentMonitor,
  getCurrentWindow,
  PhysicalPosition,
  PhysicalSize,
} from "@tauri-apps/api/window";
import * as React from "react";
import {
  canvasWindowRectsAreNear,
  planConversationCanvasWindow,
} from "@/features/artifacts/lab/conversationCanvasWindow";

/** Borrow room on the current display; restore it only if the owner hasn't moved/resized it. */
export function useTaskChatWindowSpace(open: boolean) {
  const queue = React.useRef(Promise.resolve());
  React.useEffect(() => {
    if (!open || !isTauri()) return;
    let closed = false;
    let restore: (() => Promise<void>) | undefined;
    const work = queue.current
      .then(async () => {
        const win = getCurrentWindow();
        const [inner, outer, pos, monitor, fullscreen, maximized, scale] =
          await Promise.all([
            win.innerSize(),
            win.outerSize(),
            win.outerPosition(),
            currentMonitor(),
            win.isFullscreen(),
            win.isMaximized(),
            win.scaleFactor(),
          ]);
        if (closed || !monitor) return;
        const current = {
          x: pos.x,
          y: pos.y,
          width: outer.width,
          height: outer.height,
        };
        const plan = planConversationCanvasWindow({
          current,
          fullscreen,
          maximized,
          desiredCanvasWidth: 488 * scale,
          minimumCanvasGain: 488 * scale,
          minimumCombinedWidth: 900 * scale,
          safeInset: 8 * scale,
          workArea: {
            x: monitor.workArea.position.x,
            y: monitor.workArea.position.y,
            width: monitor.workArea.size.width,
            height: monitor.workArea.size.height,
          },
        });
        if (plan.mode !== "expanded") return;
        await win.setPosition(
          new PhysicalPosition(plan.target.x, plan.target.y),
        );
        await win.setSize(
          new PhysicalSize(
            inner.width + plan.target.width - outer.width,
            inner.height,
          ),
        );
        restore = async () => {
          const [size, position, full, max] = await Promise.all([
            win.outerSize(),
            win.outerPosition(),
            win.isFullscreen(),
            win.isMaximized(),
          ]);
          if (
            full ||
            max ||
            !canvasWindowRectsAreNear(
              {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
              },
              plan.target,
              2 * scale,
            )
          )
            return;
          await win.setSize(inner);
          await win.setPosition(pos);
        };
        if (closed) await restore();
      })
      .catch((error) =>
        console.warn("Task chat stays within the current window", error),
      );
    queue.current = work;
    return () => {
      closed = true;
      queue.current = work
        .then(async () => {
          if (restore) await restore();
        })
        .catch((error) =>
          console.warn("Task chat window restoration unavailable", error),
        );
    };
  }, [open]);
}
