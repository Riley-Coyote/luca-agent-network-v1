import * as React from "react";
import { createPortal } from "react-dom";
import { listen } from "@tauri-apps/api/event";
import { UtilityOverlayProvider } from "@/shared/ui/utilityOverlay";
import { useQuickChat } from "./useQuickChat";
import { QuickChatPanel } from "./ui/QuickChatPanel";
import { quickChatTarget } from "./context";

type Highlight = { conversationId: string; route: string; targetId: string };

export function QuickChatRoot({
  children,
  onOpenConversation,
  onOpenAgentSetup,
}: {
  children: React.ReactNode;
  onOpenConversation: (id: string) => void;
  onOpenAgentSetup: () => void;
}) {
  const model = useQuickChat({ onOpenConversation, onOpenAgentSetup });
  const latest = React.useRef(model);
  latest.current = model;
  const [highlight, setHighlight] = React.useState<Highlight | null>(null);
  React.useEffect(() => {
    let disposed = false;
    const listeners: Array<() => void> = [];
    for (const name of [
      "quickchat-effort-result",
      "quickchat-effort-capabilities",
    ]) {
      void listen(name, ({ payload }) => {
        window.dispatchEvent(new CustomEvent(name, { detail: payload }));
      })
        .then((dispose) => {
          if (disposed) dispose();
          else listeners.push(dispose);
        })
        .catch(() => {});
    }
    return () => {
      disposed = true;
      for (const dispose of listeners) dispose();
    };
  }, []);

  React.useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.code === "KeyL"
      ) {
        event.preventDefault();
        latest.current.setOpen(!latest.current.open);
      }
    };
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, []);
  React.useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<Highlight>("quickchat-highlight", ({ payload }) => {
      if (
        latest.current.channelId !== payload.conversationId ||
        payload.route !== (location.hash || location.pathname) ||
        !quickChatTarget(payload.targetId)
      )
        return;
      setHighlight(payload);
    })
      .then((dispose) => {
        if (disposed) dispose();
        else unlisten = dispose;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  React.useEffect(() => {
    if (!highlight || highlight.conversationId !== model.channelId) {
      setHighlight(null);
      return;
    }
    const element = quickChatTarget(highlight.targetId);
    if (!element) return;
    element.classList.add("quickchat-guidance-target");
    const clear = () => setHighlight(null);
    const timer = window.setTimeout(clear, 7000);
    window.addEventListener("hashchange", clear);
    document.addEventListener("pointerdown", clear, { once: true });
    document.addEventListener("keydown", clear, { once: true });
    return () => {
      element.classList.remove("quickchat-guidance-target");
      clearTimeout(timer);
      window.removeEventListener("hashchange", clear);
      document.removeEventListener("pointerdown", clear);
      document.removeEventListener("keydown", clear);
    };
  }, [highlight, model.channelId]);
  return (
    <UtilityOverlayProvider
      render={(host) =>
        createPortal(
          <div
            data-quickchat=""
            style={{
              visibility: model.capturing ? "hidden" : undefined,
              pointerEvents: "auto",
            }}
          >
            <QuickChatPanel model={model} />
          </div>,
          host ?? document.body,
        )
      }
    >
      {children}
      <style>{`.quickchat-guidance-target { outline: 2px solid currentColor !important; outline-offset: 4px; border-radius: 6px; }`}</style>
    </UtilityOverlayProvider>
  );
}
