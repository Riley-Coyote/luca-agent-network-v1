import * as React from "react";
import { createPortal } from "react-dom";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { invokeTauri } from "@/shared/api/tauri";
import { useShellFrameEnabled } from "@/shared/features/useShellFrameEnabled";
import { useIsFullscreen } from "@/shared/lib/useIsFullscreen";
import "./companionAppControl.css";

type Control = {
  id: string;
  name: string;
  abort: AbortController;
  stopping: Promise<unknown> | null;
};

function resolve(id: string, action: "begin" | "complete" | "stop" | "failed") {
  return invokeTauri<string>("resolve_polyphonic_app_control", {
    requestId: id,
    action,
  });
}

/** A brief, cancellable handoff before agent-requested navigation moves the UI. */
export function useCompanionAppControl() {
  const [visible, setVisible] = React.useState<Control | null>(null);
  const current = React.useRef<Control | null>(null);
  const mounted = React.useRef(true);

  const clear = React.useCallback((control: Control) => {
    if (current.current !== control) return;
    current.current = null;
    if (mounted.current) setVisible(null);
  }, []);

  React.useEffect(() => {
    mounted.current = true;
    const subscription = listen<{ requestId: string }>(
      "polyphonic-app-control-ended",
      ({ payload }) => {
        const control = current.current;
        if (!control || payload?.requestId !== control.id) return;
        control.abort.abort();
        clear(control);
      },
    );
    void subscription.catch(() => {});
    return () => {
      mounted.current = false;
      const control = current.current;
      if (control) {
        control.abort.abort();
        void resolve(control.id, "failed").catch(() => {});
        current.current = null;
      }
      void subscription.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [clear]);

  const run = React.useCallback(
    async (id: string, name: string, navigate: () => Promise<unknown>) => {
      if (current.current) {
        await resolve(id, "failed").catch(() => {});
        return;
      }
      const control: Control = {
        id,
        name,
        abort: new AbortController(),
        stopping: null,
      };
      current.current = control;
      setVisible(control);
      const timeout = window.setTimeout(() => {
        control.abort.abort();
        void resolve(id, "failed").catch(() => {});
        clear(control);
      }, 15_000);
      let completed = false;
      try {
        // This is automatic, not another approval. Give the owner a visible
        // chance to Stop before a requested view replaces their current view.
        await new Promise<void>((done) => {
          const timer = window.setTimeout(done, 600);
          control.abort.signal.addEventListener(
            "abort",
            () => {
              window.clearTimeout(timer);
              done();
            },
            { once: true },
          );
        });
        if (control.abort.signal.aborted) return;
        const status = await resolve(id, "begin");
        if (status !== "running" || control.abort.signal.aborted) return;
        await navigate();
        if (!control.abort.signal.aborted) {
          completed = (await resolve(id, "complete")) === "completed";
        }
      } catch {
        if (!control.abort.signal.aborted) {
          toast.error(
            "The requested view could not be opened. You can keep talking normally.",
          );
        }
      } finally {
        window.clearTimeout(timeout);
        if (control.stopping) await control.stopping;
        else if (!completed) await resolve(id, "failed").catch(() => {});
        clear(control);
      }
    },
    [clear],
  );

  const stop = React.useCallback(() => {
    const control = current.current;
    if (!control || control.stopping) return;
    control.stopping = resolve(control.id, "stop").catch(() => {
      toast.error(
        "Navigation stopped here, but the app could not confirm the stop with the agent.",
      );
    });
    control.abort.abort();
  }, []);

  return { visible, run, stop };
}

const DAY_PILL = '[data-testid="message-timeline-day-divider"]';
const ASIDE = "data-companion-aside";

/** The nearest ancestor that scrolls `element`. */
function scrollerOf(element: Element): Element | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll") return node;
  }
  return null;
}

/** Whether a day pill sits stuck at its scroller's top: its sticky top is
 *  resolved inside the scroller's padding (the timeline's 22), so the line
 *  is the scroller's top, its border and padding, and the sticky offset. A
 *  pill resting there before any scroll is at the card's top too. */
function stuckAtTop(section: HTMLElement): boolean {
  const scroller = scrollerOf(section);
  if (!scroller) return false;
  const top = Number.parseFloat(getComputedStyle(section).top);
  if (!Number.isFinite(top)) return false;
  const scrollerStyle = getComputedStyle(scroller);
  const line =
    scroller.getBoundingClientRect().top +
    Number.parseFloat(scrollerStyle.borderTopWidth || "0") +
    Number.parseFloat(scrollerStyle.paddingTop || "0") +
    top;
  return Math.abs(section.getBoundingClientRect().top - line) < 1;
}

/**
 * Under the shell's frame, while the badge shows: a day pill stuck at the
 * card's top under the badge steps aside (fades out, shell-finish.css), and
 * every pill comes back when the badge goes (WP-09a).
 */
function useDayPillsStepAside(badge: React.RefObject<HTMLElement | null>) {
  const shellFrame = useShellFrameEnabled();
  React.useEffect(() => {
    if (!shellFrame) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const box = badge.current?.getBoundingClientRect();
      for (const section of document.querySelectorAll<HTMLElement>(DAY_PILL)) {
        const pill = section.firstElementChild?.getBoundingClientRect();
        const under =
          box !== undefined &&
          pill !== undefined &&
          pill.left < box.right &&
          pill.right > box.left;
        section.toggleAttribute(ASIDE, under && stuckAtTop(section));
      }
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    update();
    // Scrolling moves a pill to or from the top; a conversation opening
    // brings new ones. A light sweep catches what neither event reports.
    document.addEventListener("scroll", schedule, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", schedule);
    const sweep = window.setInterval(schedule, 400);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      window.clearInterval(sweep);
      for (const section of document.querySelectorAll(
        `${DAY_PILL}[${ASIDE}]`,
      )) {
        section.removeAttribute(ASIDE);
      }
    };
  }, [badge, shellFrame]);
}

/** The halo, square in full screen as the window is (shell-finish.css). */
function ControlHalo() {
  const fullscreen = useIsFullscreen();
  return (
    <div
      className="polyphonic-control-halo"
      data-fullscreen={fullscreen ? "" : undefined}
      data-testid="app-control-halo"
      aria-hidden="true"
    />
  );
}

/** Soft halo approved in the control-signal lab. No observation or authority. */
export function CompanionAppControl({
  control,
  onStop,
}: {
  control: { name: string } | null;
  onStop: () => void;
}) {
  if (!control) return null;
  return createPortal(
    <>
      <ControlHalo />
      <ControlBadge name={control.name} onStop={onStop} />
    </>,
    document.body,
  );
}

function ControlBadge({ name, onStop }: { name: string; onStop: () => void }) {
  const badge = React.useRef<HTMLDivElement>(null);
  useDayPillsStepAside(badge);
  return (
    <div
      className="polyphonic-control-badge text-sm"
      data-testid="app-control-badge"
      ref={badge}
    >
      <span
        className="polyphonic-control-label"
        role="status"
        title={`${name} is using Polyphonic`}
      >
        {name} is using Polyphonic
      </span>
      <button type="button" onClick={onStop} aria-label="Stop app navigation">
        Stop
      </button>
    </div>
  );
}
