import * as React from "react";

type MainInsetContextValue = {
  mainInsetRef: React.RefObject<HTMLElement | null>;
  widthPx: number;
};

const MainInsetContext = React.createContext<MainInsetContextValue | null>(
  null,
);

export function MainInsetProvider({
  children,
  mainInsetRef,
}: {
  children: React.ReactNode;
  mainInsetRef: React.RefObject<HTMLElement | null>;
}) {
  const [widthPx, setWidthPx] = React.useState(0);

  React.useEffect(() => {
    let frameId: number | null = null;
    let cleanup: (() => void) | null = null;

    const attach = () => {
      const element = mainInsetRef.current;
      if (!element) {
        frameId = window.requestAnimationFrame(attach);
        return;
      }

      const updateWidth = () => {
        setWidthPx(element.getBoundingClientRect().width);
      };

      updateWidth();
      if (typeof ResizeObserver === "undefined") {
        window.addEventListener("resize", updateWidth);
        cleanup = () => window.removeEventListener("resize", updateWidth);
        return;
      }

      const observer = new ResizeObserver(updateWidth);
      observer.observe(element);
      cleanup = () => observer.disconnect();
    };

    attach();
    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      cleanup?.();
    };
  }, [mainInsetRef]);

  const value = React.useMemo(
    () => ({ mainInsetRef, widthPx }),
    [mainInsetRef, widthPx],
  );

  return (
    <MainInsetContext.Provider value={value}>
      {children}
    </MainInsetContext.Provider>
  );
}

/** Ref to the app `<main>` inset element where shared chrome CSS vars live. */
export function useMainInsetRef() {
  const context = React.useContext(MainInsetContext);
  if (!context) {
    throw new Error("useMainInsetRef must be used within MainInsetProvider");
  }
  return context.mainInsetRef;
}

/** Stable outer-shell width for responsive decisions inside routed surfaces. */
export function useMainInsetWidth() {
  const context = React.useContext(MainInsetContext);
  if (!context) {
    throw new Error("useMainInsetWidth must be used within MainInsetProvider");
  }
  return context.widthPx;
}
