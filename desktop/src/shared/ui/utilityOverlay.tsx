import * as React from "react";

type Host = { element: HTMLDivElement; order: number };
const HostContext = React.createContext<((host: Host) => () => void) | null>(
  null,
);

/** Keeps utility content inside the active modal's focus scope. */
export function UtilityOverlayProvider({
  children,
  render,
}: {
  children: React.ReactNode;
  render: (host: HTMLElement | null) => React.ReactNode;
}) {
  const [hosts, setHosts] = React.useState<Host[]>([]);
  const register = React.useCallback((host: Host) => {
    setHosts((current) => [...current, host]);
    return () =>
      setHosts((current) => current.filter((entry) => entry !== host));
  }, []);
  const active = hosts.reduce<Host | null>(
    (latest, host) => (!latest || host.order > latest.order ? host : latest),
    null,
  );
  return (
    <HostContext.Provider value={register}>
      {children}
      {render(active?.element ?? null)}
    </HostContext.Provider>
  );
}

/** A top-layer presentation host remains a DOM child of its modal. */
export function UtilityOverlayHost() {
  const register = React.useContext(HostContext);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!register || !element) return;
    const modal = element.closest("[role='dialog'],[role='alertdialog']");
    let unregister: (() => void) | undefined;
    const sync = () => {
      if (modal?.getAttribute("data-state") === "closed") {
        unregister?.();
        unregister = undefined;
        element.hidePopover?.();
      } else if (!unregister) {
        element.showPopover?.();
        unregister = register({ element, order: performance.now() });
      }
    };
    sync();
    const observer = new MutationObserver(sync);
    if (modal)
      observer.observe(modal, {
        attributes: true,
        attributeFilter: ["data-state"],
      });
    return () => {
      observer.disconnect();
      unregister?.();
      element.hidePopover?.();
    };
  }, [register]);
  if (!register) return null;
  return (
    <div
      ref={ref}
      popover="manual"
      data-utility-overlay-host=""
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        maxWidth: "none",
        maxHeight: "none",
        margin: 0,
        padding: 0,
        border: 0,
        background: "transparent",
        overflow: "visible",
        pointerEvents: "none",
      }}
    />
  );
}

/** Let the focused utility consume Escape before its enclosing modal closes. */
export function utilityEscapeHandler(handler?: (event: KeyboardEvent) => void) {
  return (event: KeyboardEvent) => {
    if (
      event.target instanceof Element &&
      (event.target.closest("[data-quickchat]") ||
        document.querySelector('[data-testid="quickchat-panel"]'))
    ) {
      event.preventDefault();
      return;
    }
    handler?.(event);
  };
}
