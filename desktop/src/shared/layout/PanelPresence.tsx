import * as React from "react";
import { useEscapeKey } from "@/shared/hooks/useEscapeKey";

const PanelPresenceContext = React.createContext<boolean | null>(null);

/** Keep the last panel through its exit, including when it renders in a portal. */
export function PanelPresence({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose?: () => void;
}) {
  const present = Boolean(children);
  // The retained element is only ever read once `children` has gone null, so
  // capturing it must not schedule a render. State here re-rendered on every
  // parent render (JSX children are a fresh object each time), which turned
  // one panel update into a render-phase update loop behind the drawer; a ref
  // holds the same element identity, so the exit still reconciles in place.
  const retainedRef = React.useRef<React.ReactNode>(null);
  const [, dropRetained] = React.useReducer((count: number) => count + 1, 0);
  const [visible, setVisible] = React.useState(false);
  const frameReady = React.useRef(false);
  const triggerRef = React.useRef<HTMLElement | null>(null);
  useEscapeKey(() => onClose?.(), present && Boolean(onClose));
  if (present) retainedRef.current = children;

  React.useLayoutEffect(() => {
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (present) {
      if (
        document.activeElement instanceof HTMLElement &&
        !document.activeElement.closest("[data-panel-open]")
      ) {
        triggerRef.current = document.activeElement;
      }
      if (reduced || frameReady.current) {
        frameReady.current = true;
        setVisible(true);
        return;
      }
      // A mounted frame must paint at zero before receiving its open target.
      let secondFrame = 0;
      const firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => {
          frameReady.current = true;
          setVisible(true);
        });
      });
      return () => {
        cancelAnimationFrame(firstFrame);
        cancelAnimationFrame(secondFrame);
      };
    }
    setVisible(false);
    const focused = document.activeElement;
    if (
      triggerRef.current?.isConnected &&
      (focused === document.body ||
        (focused instanceof Element && focused.closest("[data-panel-open]")))
    ) {
      triggerRef.current.focus({ preventScroll: true });
    }
    const token = getComputedStyle(document.documentElement)
      .getPropertyValue("--motion-duration-standard")
      .trim();
    const duration =
      Number.parseFloat(token) * (token.endsWith("ms") ? 1 : 1000);
    const timer = window.setTimeout(
      () => {
        frameReady.current = false;
        retainedRef.current = null;
        dropRetained();
      },
      reduced ? 0 : (Number.isFinite(duration) ? duration : 240) + 32,
    );
    return () => window.clearTimeout(timer);
  }, [present]);

  return (
    <PanelPresenceContext.Provider value={present && visible}>
      {children || retainedRef.current}
    </PanelPresenceContext.Provider>
  );
}

/** Null identifies standalone hosts that do not retain their closing content. */
export function usePanelPresence() {
  return React.useContext(PanelPresenceContext);
}
