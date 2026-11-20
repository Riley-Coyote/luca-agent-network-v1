import * as React from "react";

/**
 * Words held to a few lines on a plate: what doesn't fit is cut with a
 * fade under its last line, never scrolled inside the plate. The fade is
 * drawn only when something is cut.
 */
export function Cut({
  children,
  className,
  lines,
  testId,
}: {
  children: React.ReactNode;
  className?: string;
  lines: number;
  testId?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [cut, setCut] = React.useState(false);
  const measure = React.useCallback(() => {
    const el = ref.current;
    if (el) setCut(el.scrollHeight > el.clientHeight + 1);
  }, []);
  // After every render (the words may have changed), and on every resize.
  React.useLayoutEffect(measure);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);
  return (
    <div
      className={className ? `luca-mnemos-cut ${className}` : "luca-mnemos-cut"}
      data-cut={cut ? "" : undefined}
      data-testid={testId}
      ref={ref}
      style={{ "--cut-lines": lines } as React.CSSProperties}
    >
      {children}
    </div>
  );
}
