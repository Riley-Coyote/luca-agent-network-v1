import * as React from "react";
import { createPortal } from "react-dom";
import { House } from "lucide-react";
import { router as appRouter } from "@/app/router";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import type { Runtime } from "./homeFixtures";

export type HomeView = "overview" | "work" | "usage" | Runtime;
type Destination = { view: HomeView; session?: string };

/** Study-only route adapter; no production routes or navigation are modified. */
export function destinationForPath(path: string): Destination | null {
  const family = /^\/apps\/(home|claude|codex)\/?$/.exec(path)?.[1];
  return family === "home"
    ? { view: "overview" }
    : family === "claude"
      ? { view: "claude_code" }
      : family === "codex"
        ? { view: "codex" }
        : null;
}

let destination: Destination = destinationForPath(
  window.location.hash.slice(1).split("?")[0],
) ?? { view: "overview" };
let requestedPath: string | null = null;
const listeners = new Set<() => void>();
function publish(next: Destination) {
  destination = next;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function goHomeStudy(view: HomeView, session?: string) {
  publish({ view, session });
  const appId =
    view === "claude_code" ? "claude" : view === "codex" ? "codex" : "home";
  const path = `/apps/${appId}`;
  if (appRouter.state.location.pathname !== path) {
    requestedPath = path;
    void appRouter
      .navigate({ to: "/apps/$appId", params: { appId }, search: {} })
      .catch(() => {
        requestedPath = null;
      });
  }
}

export function useHomeStudyDestination() {
  return React.useSyncExternalStore(subscribe, () => destination);
}

/** Mounted outside the page portal, so Home remains reachable from Chats. */
export function HomeNavigation() {
  const [slot, setSlot] = React.useState<HTMLElement | null>(null);
  const current = useHomeStudyDestination();
  const onHome = current.view !== "claude_code" && current.view !== "codex";
  const [pageVisible, setPageVisible] = React.useState(
    Boolean(destinationForPath(appRouter.state.location.pathname)),
  );
  React.useEffect(() => {
    let previous = appRouter.history.location.pathname;
    return appRouter.history.subscribe(({ location }) => {
      const path = location.pathname;
      setPageVisible(Boolean(destinationForPath(path)));
      if (path === previous) return;
      previous = path;
      if (requestedPath === path) {
        requestedPath = null;
        return;
      }
      requestedPath = null;
      const next = destinationForPath(path);
      if (next) publish(next);
    });
  }, []);
  React.useEffect(() => {
    let holder: HTMLDivElement | null = null;
    const attach = () => {
      if (document.querySelector('[data-testid="open-home-dashboard"]')) return;
      if (holder?.isConnected) return;
      const chats = document.querySelector(
        '[data-testid="shell-place-conversations"]',
      );
      if (!chats?.parentElement) return;
      holder = document.createElement("div");
      holder.className = "home-place-slot";
      chats.parentElement.insertBefore(holder, chats);
      setSlot(holder);
    };
    const observer = new MutationObserver(attach);
    observer.observe(document.getElementById("root") ?? document.body, {
      childList: true,
      subtree: true,
    });
    attach();
    return () => {
      observer.disconnect();
      holder?.remove();
    };
  }, []);
  React.useLayoutEffect(() => {
    if (!slot || !onHome || !pageVisible) return;
    const chats = document.querySelector(
      '[data-testid="shell-place-conversations"]',
    );
    const aria = chats?.getAttribute("aria-current");
    chats?.removeAttribute("aria-current");
    document.documentElement.setAttribute("data-home-place-active", "");
    return () => {
      document.documentElement.removeAttribute("data-home-place-active");
      if (aria && chats?.isConnected) chats.setAttribute("aria-current", aria);
    };
  }, [onHome, pageVisible, slot]);
  return slot
    ? createPortal(
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="luca-place home-place-button"
              data-testid="home-study-place"
              aria-label="Home"
              aria-current={onHome && pageVisible ? "page" : undefined}
              data-current={onHome && pageVisible ? "true" : undefined}
              onClick={() => goHomeStudy("overview")}
            >
              <House aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Home</TooltipContent>
        </Tooltip>,
        slot,
      )
    : null;
}
