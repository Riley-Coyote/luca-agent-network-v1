import * as React from "react";
import { createPortal } from "react-dom";
import { PanelBottomOpen } from "lucide-react";

import { SampleWidgetCard } from "./SampleWidgetCard";
import { setLifted, usePaneState, useWidgetPaneEnabled } from "./paneState";

/** How much of the floating pane's header must stay on screen, in CSS px. */
const HEADER_KEEP_ON_SCREEN_PX = 48;
/** rAF lerp factor while dragging — the pane follows the hand with weight. */
const DRAG_LERP = 0.22;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The floating layer the widget pane can be lifted into.
 *
 * THE ONE INVARIANT HERE: lifting must not remount the widget. React tears a
 * subtree down and rebuilds it whenever the JSX that owns it moves, which
 * would reset anything the widget was holding — a running timer, a scroll
 * position, an open menu. So the widget is rendered into a container element
 * created once and never replaced, and the LIFT MOVES THAT ELEMENT (a plain
 * `appendChild` between the docked slot and the floating layer). React never
 * sees the move, because React does not observe DOM parentage — only the
 * portal target's identity, which is stable for the life of this component.
 *
 * Mounted once at the shell so the layer outlives every drawer remount.
 */
export function LiftedPane() {
  const enabled = useWidgetPaneEnabled();
  const { dockedSlot, isDeckMounted, isLifted } = usePaneState();

  const [container] = React.useState(() => {
    const element = document.createElement("div");
    element.className = "luca-pane-widget-body";
    return element;
  });

  const floatRef = React.useRef<HTMLDivElement | null>(null);
  const [floatSlot, setFloatSlot] = React.useState<HTMLElement | null>(null);

  const positionRef = React.useRef({ x: 0, y: 0 });
  const targetRef = React.useRef({ x: 0, y: 0 });
  const sizeRef = React.useRef({ height: 0, width: 0 });
  const frameRef = React.useRef<number | null>(null);
  const grabRef = React.useRef<{ dx: number; dy: number } | null>(null);
  const draggingRef = React.useRef(false);
  const [isDragging, setIsDragging] = React.useState(false);

  const paint = React.useCallback(() => {
    const element = floatRef.current;
    if (!element) return;
    const { x, y } = positionRef.current;
    const scale = draggingRef.current ? 1.01 : 1;
    element.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
  }, []);

  const clampTarget = React.useCallback((x: number, y: number) => {
    const { width } = sizeRef.current;
    return {
      x: Math.min(
        window.innerWidth - HEADER_KEEP_ON_SCREEN_PX,
        Math.max(HEADER_KEEP_ON_SCREEN_PX - width, x),
      ),
      // The header is the pane's top edge, so keeping the pane's top on screen
      // keeps the whole header on screen.
      y: Math.min(
        window.innerHeight - HEADER_KEEP_ON_SCREEN_PX,
        Math.max(0, y),
      ),
    };
  }, []);

  const settle = React.useCallback(() => {
    const factor = prefersReducedMotion() ? 1 : DRAG_LERP;
    const position = positionRef.current;
    const target = targetRef.current;
    position.x += (target.x - position.x) * factor;
    position.y += (target.y - position.y) * factor;
    if (
      Math.abs(target.x - position.x) < 0.1 &&
      Math.abs(target.y - position.y) < 0.1
    ) {
      position.x = target.x;
      position.y = target.y;
      paint();
      frameRef.current = null;
      return;
    }
    paint();
    frameRef.current = window.requestAnimationFrame(settle);
  }, [paint]);

  const nudge = React.useCallback(
    (x: number, y: number) => {
      targetRef.current = clampTarget(x, y);
      if (frameRef.current === null) {
        frameRef.current = window.requestAnimationFrame(settle);
      }
    },
    [clampTarget, settle],
  );

  // Capture the docked geometry BEFORE the move effect below reparents the
  // container, so the pane lifts off exactly where it was sitting.
  React.useLayoutEffect(() => {
    if (!isLifted || !dockedSlot) return;
    const rect = dockedSlot.getBoundingClientRect();
    sizeRef.current = { height: rect.height, width: rect.width };
    positionRef.current = { x: rect.left, y: rect.top };
    targetRef.current = { x: rect.left, y: rect.top };
  }, [dockedSlot, isLifted]);

  // The move itself. One `appendChild`; no React tree is re-parented.
  React.useEffect(() => {
    const target = isLifted ? floatSlot : dockedSlot;
    if (!target) return;
    if (container.parentElement !== target) target.appendChild(container);
  }, [container, dockedSlot, floatSlot, isLifted]);

  React.useLayoutEffect(() => {
    if (!isLifted) return;
    const element = floatRef.current;
    if (!element) return;
    element.style.width = `${sizeRef.current.width}px`;
    element.style.height = `${sizeRef.current.height}px`;
    // The element's first computed transform is `none`, so the settle
    // transition would otherwise animate the pane in from the layer's origin
    // — a fly-in from the top-left corner instead of a lift in place.
    // Suppress it for exactly one frame, flush, then hand the transition back.
    element.style.transition = "none";
    paint();
    void element.getBoundingClientRect();
    element.style.transition = "";
  }, [isLifted, paint]);

  React.useEffect(() => {
    if (!isLifted) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setLifted(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isLifted]);

  React.useEffect(
    () => () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    },
    [],
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    grabRef.current = {
      dx: event.clientX - positionRef.current.x,
      dy: event.clientY - positionRef.current.y,
    };
    draggingRef.current = true;
    setIsDragging(true);
    paint();
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const grab = grabRef.current;
    if (!grab) return;
    nudge(event.clientX - grab.dx, event.clientY - grab.dy);
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!grabRef.current) return;
    grabRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    draggingRef.current = false;
    setIsDragging(false);
    // The scale settles back through CSS; the position is already where the
    // hand left it.
    paint();
  };

  if (!enabled) return null;

  return (
    <>
      {isDeckMounted || isLifted
        ? createPortal(<SampleWidgetCard />, container)
        : null}
      {isLifted
        ? createPortal(
            <div className="luca-pane-float-layer">
              <div
                className="luca-pane-float"
                data-dragging={isDragging ? "true" : "false"}
                data-luca-card
                data-testid="lifted-pane"
                ref={floatRef}
              >
                <div
                  className="luca-pane-float-header"
                  data-testid="lifted-pane-header"
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={endDrag}
                  onLostPointerCapture={endDrag}
                >
                  <span className="luca-pane-float-title text-2xs">Widget</span>
                  <button
                    className="luca-pane-float-action"
                    data-testid="dock-pane"
                    onClick={() => setLifted(false)}
                    onPointerDown={(event) => event.stopPropagation()}
                    title="Dock"
                    type="button"
                  >
                    <PanelBottomOpen aria-hidden="true" className="size-3.5" />
                    <span className="sr-only">Dock</span>
                  </button>
                </div>
                <div className="luca-pane-float-slot" ref={setFloatSlot} />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
