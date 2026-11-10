import * as React from "react";
import { useTheme } from "@/shared/theme/ThemeProvider";
import {
  DEFAULT_THEME_NAME,
  PAPER_THEME_NAME,
} from "@/shared/theme/theme-loader";
import {
  CONVERSATION_STUDY_KEY,
  DEFAULT_VIEW,
  SCENES,
  designBrief,
  normalizeView,
  type Scene,
  type View,
} from "./fixtures";
import "./conversationPolishStudy.css";

const MESSAGE_TYPE = "polyphonic:conversation-polish-preview";
type Saved = { id: string; name: string; view: View };

function readView(): { view: View; saved: Saved[]; error: string } {
  try {
    const value = JSON.parse(
      localStorage.getItem(CONVERSATION_STUDY_KEY) ?? "null",
    );
    const saved = Array.isArray(value?.saved)
      ? value.saved
          .filter(
            (entry: Saved) =>
              typeof entry?.id === "string" && typeof entry?.name === "string",
          )
          .map((entry: Saved) => ({
            ...entry,
            view: normalizeView(entry.view),
          }))
      : [];
    return { view: normalizeView(value?.view), saved, error: "" };
  } catch {
    return {
      view: DEFAULT_VIEW,
      saved: [],
      error: "Saved views couldn't be read. This comparison still works.",
    };
  }
}

function applyView(view: View) {
  document.documentElement.dataset.conversationStudy = view.direction;
}

/** Child only: the genuine app and its providers remain mounted throughout. */
export function ConversationPolishCanvas() {
  const { setTheme } = useTheme();
  const lastScene = React.useRef(
    new URLSearchParams(location.search).get("scene") ?? "conversation",
  );
  React.useLayoutEffect(() => {
    const params = new URLSearchParams(location.search);
    applyView(normalizeView({ direction: params.get("direction") }));
    const receive = (event: MessageEvent) => {
      if (
        event.source !== window.parent ||
        event.origin !== location.origin ||
        event.data?.type !== MESSAGE_TYPE
      )
        return;
      const view = normalizeView(event.data.view);
      applyView(view);
      setTheme(view.light ? PAPER_THEME_NAME : DEFAULT_THEME_NAME);
      const scene =
        SCENES.find((entry) => entry.id === view.scene) ?? SCENES[0];
      const hash = `#/channels/${scene.channel}`;
      if (view.scene !== lastScene.current && location.hash !== hash)
        location.hash = hash;
      lastScene.current = view.scene;
    };
    window.addEventListener("message", receive);
    window.parent.postMessage(
      { type: `${MESSAGE_TYPE}:ready` },
      location.origin,
    );
    return () => {
      window.removeEventListener("message", receive);
      delete document.documentElement.dataset.conversationStudy;
    };
  }, [setTheme]);
  return null;
}

/** Lab chrome lives outside the iframe, never inside or in place of the app. */
export function ConversationPolishStudy() {
  const [initial] = React.useState(readView);
  const [view, setView] = React.useState(initial.view);
  const [saved, setSaved] = React.useState(initial.saved);
  const [error, setError] = React.useState(initial.error);
  const [briefOpen, setBriefOpen] = React.useState(false);
  const [controlsHidden, setControlsHidden] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const frame = React.useRef<HTMLIFrameElement>(null);
  const { setTheme } = useTheme();
  const brief = designBrief(view);
  const [source] = React.useState(() => {
    const url = new URL(location.href);
    url.search = new URLSearchParams({
      experience: "conversation-polish",
      canvas: "1",
      direction: initial.view.direction,
      theme: initial.view.light ? PAPER_THEME_NAME : DEFAULT_THEME_NAME,
      scene: initial.view.scene,
    }).toString();
    url.hash = "";
    return url.href;
  });
  const send = React.useCallback(() => {
    frame.current?.contentWindow?.postMessage(
      { type: MESSAGE_TYPE, view },
      location.origin,
    );
  }, [view]);
  React.useEffect(() => {
    send();
    setTheme(view.light ? PAPER_THEME_NAME : DEFAULT_THEME_NAME);
    const ready = (event: MessageEvent) => {
      if (
        event.source === frame.current?.contentWindow &&
        event.origin === location.origin &&
        event.data?.type === `${MESSAGE_TYPE}:ready`
      )
        send();
    };
    window.addEventListener("message", ready);
    return () => window.removeEventListener("message", ready);
  }, [send, view.light, setTheme]);
  React.useEffect(() => {
    try {
      localStorage.setItem(
        CONVERSATION_STUDY_KEY,
        JSON.stringify({ version: 1, view, saved }),
      );
    } catch {
      setError(
        "This browser couldn't save the view. Copy the design brief to keep it.",
      );
    }
    setCopied(false);
  }, [view, saved]);

  return (
    <main
      className="cps-host"
      data-controls-hidden={controlsHidden ? "" : undefined}
    >
      {!controlsHidden ? (
        <header className="cps-toolbar">
          <span className="cps-label">Conversation study</span>
          <fieldset className="cps-directions">
            <legend className="sr-only">Treatment</legend>
            {(["before", "after"] as const).map((direction) => (
              <button
                key={direction}
                type="button"
                aria-pressed={view.direction === direction}
                onClick={() => setView((value) => ({ ...value, direction }))}
              >
                {direction === "before" ? "Before" : "After"}
              </button>
            ))}
          </fieldset>
          <label className="cps-select">
            <span className="sr-only">Sample conversation</span>
            <select
              aria-label="Sample conversation"
              value={view.scene}
              onChange={(event) =>
                setView((value) => ({
                  ...value,
                  scene: event.target.value as Scene,
                }))
              }
            >
              {SCENES.map((scene) => (
                <option key={scene.id} value={scene.id}>
                  {scene.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            aria-label="Switch preview theme"
            onClick={() =>
              setView((value) => ({ ...value, light: !value.light }))
            }
          >
            {view.light ? "Light" : "Dark"}
          </button>
          <span className="cps-disclaimer">
            Sample messages · Browser glass fallback
          </span>
          <button
            type="button"
            onClick={() => setBriefOpen((value) => !value)}
            aria-expanded={briefOpen}
          >
            Design brief
          </button>
          <button type="button" onClick={() => setControlsHidden(true)}>
            Hide controls
          </button>
        </header>
      ) : (
        <button
          type="button"
          className="cps-show-controls"
          onClick={() => setControlsHidden(false)}
        >
          Show comparison
        </button>
      )}
      <iframe
        ref={frame}
        className="cps-canvas"
        title="Polyphonic real conversation preview"
        src={source}
        onLoad={send}
      />
      {briefOpen && !controlsHidden ? (
        <section className="cps-brief" aria-label="Conversation design brief">
          <div className="cps-brief-actions">
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(brief);
                  setCopied(true);
                } catch {
                  setError(
                    "Copy wasn't available. Select and copy the brief below.",
                  );
                }
              }}
            >
              {copied ? "Copied" : "Copy brief"}
            </button>
            <button
              type="button"
              onClick={() =>
                setSaved((items) => [
                  ...items,
                  {
                    id: crypto.randomUUID(),
                    name: `${view.direction === "after" ? "Proposed" : "Current"} · ${view.light ? "Light" : "Dark"} · ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`,
                    view: { ...view },
                  },
                ])
              }
            >
              Save view
            </button>
            <button type="button" onClick={() => setView(DEFAULT_VIEW)}>
              Reset view
            </button>
            <button type="button" onClick={() => setBriefOpen(false)}>
              Close
            </button>
          </div>
          {saved.length ? (
            <label className="cps-select">
              Saved views{" "}
              <select
                aria-label="Restore saved view"
                value=""
                onChange={(event) => {
                  const entry = saved.find(
                    (item) => item.id === event.target.value,
                  );
                  if (entry) setView(entry.view);
                }}
              >
                <option value="" disabled>
                  Choose a saved view
                </option>
                {saved.map((entry) => (
                  <option value={entry.id} key={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <textarea readOnly aria-label="Copyable design brief" value={brief} />
          {error ? <p role="status">{error}</p> : null}
        </section>
      ) : null}
      {error && !briefOpen && !controlsHidden ? (
        <p className="cps-storage-error" role="status">
          {error}
        </p>
      ) : null}
    </main>
  );
}
