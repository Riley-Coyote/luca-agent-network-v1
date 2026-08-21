export type CanvasWindowRect = {
  height: number;
  width: number;
  x: number;
  y: number;
};

export type CanvasWindowPlan = {
  mode: "contained" | "expanded" | "focus";
  target: CanvasWindowRect;
};

type CanvasWindowPlanInput = {
  current: CanvasWindowRect;
  desiredCanvasWidth?: number;
  fullscreen?: boolean;
  maximized?: boolean;
  minimumCanvasGain?: number;
  minimumCombinedWidth?: number;
  safeInset?: number;
  workArea: CanvasWindowRect;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

/**
 * Plans a rightward Canvas expansion without assuming a particular display.
 * The conversation-side edge remains fixed whenever the display has room;
 * otherwise the window shifts left only far enough to keep the new right edge
 * inside the current monitor's work area.
 */
export function planConversationCanvasWindow({
  current,
  desiredCanvasWidth = 720,
  fullscreen = false,
  maximized = false,
  minimumCanvasGain = 480,
  minimumCombinedWidth = 1220,
  safeInset = 8,
  workArea,
}: CanvasWindowPlanInput): CanvasWindowPlan {
  if (fullscreen || maximized) {
    return { mode: "contained", target: current };
  }

  const usableWidth = Math.max(0, workArea.width - safeInset * 2);
  if (usableWidth < minimumCombinedWidth) {
    return { mode: "focus", target: current };
  }

  const targetWidth = Math.min(current.width + desiredCanvasWidth, usableWidth);
  const gainedWidth = targetWidth - current.width;
  if (gainedWidth < minimumCanvasGain) {
    return { mode: "contained", target: current };
  }

  const workLeft = workArea.x + safeInset;
  const workRight = workArea.x + workArea.width - safeInset;
  const currentRight = current.x + current.width;
  const roomOnRight = Math.max(0, workRight - currentRight);
  const shiftLeft = Math.max(0, gainedWidth - roomOnRight);
  const targetX = clamp(
    current.x - shiftLeft,
    workLeft,
    Math.max(workLeft, workRight - targetWidth),
  );

  return {
    mode: "expanded",
    target: {
      height: current.height,
      width: targetWidth,
      x: targetX,
      y: current.y,
    },
  };
}

export function canvasWindowRectsAreNear(
  first: CanvasWindowRect,
  second: CanvasWindowRect,
  tolerance = 12,
) {
  return (
    Math.abs(first.height - second.height) <= tolerance &&
    Math.abs(first.width - second.width) <= tolerance &&
    Math.abs(first.x - second.x) <= tolerance &&
    Math.abs(first.y - second.y) <= tolerance
  );
}
