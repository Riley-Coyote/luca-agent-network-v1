import * as React from "react";
import { createPortal } from "react-dom";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { invokeTauri } from "@/shared/api/tauri";
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
      <div
        className="polyphonic-control-halo"
        data-testid="app-control-halo"
        aria-hidden="true"
      />
      <div
        className="polyphonic-control-badge text-sm"
        data-testid="app-control-badge"
      >
        <span
          className="polyphonic-control-label"
          role="status"
          title={`${control.name} is using Polyphonic`}
        >
          {control.name} is using Polyphonic
        </span>
        <button type="button" onClick={onStop} aria-label="Stop app navigation">
          Stop
        </button>
      </div>
    </>,
    document.body,
  );
}
