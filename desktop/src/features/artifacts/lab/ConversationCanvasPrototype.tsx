import { Ellipsis, FileCode2, PanelRightOpen, X } from "lucide-react";
import * as React from "react";

import { ARTIFACT_LAB_FIXTURES } from "@/features/artifacts/lab/fixtures";
import type {
  ConversationCanvasMode,
  ConversationCanvasPhase,
} from "@/features/artifacts/lab/useConversationCanvasPrototype";
import { ArtifactPreview } from "@/features/artifacts/ui/ArtifactPreview";

import "./conversation-canvas-prototype.css";

const artifact = ARTIFACT_LAB_FIXTURES[0];

export function ConversationCanvasPrototype({
  close,
  hasOpened,
  mode,
  open,
  phase,
}: {
  close: () => void;
  hasOpened: boolean;
  mode: ConversationCanvasMode;
  open: () => void;
  phase: ConversationCanvasPhase;
}) {
  const launcherRef = React.useRef<HTMLButtonElement>(null);
  const visible = phase !== "closed";

  React.useEffect(() => {
    if (!visible && hasOpened) launcherRef.current?.focus();
  }, [hasOpened, visible]);

  if (!visible) {
    return hasOpened ? (
      <button
        aria-label={`Reopen ${artifact.title}`}
        className="luca-conversation-canvas-launcher"
        data-testid="conversation-canvas-launcher"
        onClick={open}
        ref={launcherRef}
        type="button"
      >
        <FileCode2 aria-hidden />
        <span>{artifact.title}</span>
        <PanelRightOpen aria-hidden />
      </button>
    ) : null;
  }

  return (
    <aside
      aria-label={`Canvas preview of ${artifact.title}`}
      className="luca-conversation-canvas"
      data-canvas-mode={mode}
      data-canvas-phase={phase}
      data-testid="conversation-canvas"
    >
      <header className="luca-conversation-canvas__header">
        <div className="luca-conversation-canvas__identity">
          <span className="luca-conversation-canvas__mark" aria-hidden>
            <FileCode2 />
          </span>
          <div>
            <div className="luca-conversation-canvas__title-row">
              <h2>{artifact.title}</h2>
              <span>v{artifact.versions[0].number}</span>
            </div>
            <p>Luca · #{artifact.conversation} · updated now</p>
          </div>
        </div>
        <div className="luca-conversation-canvas__actions">
          <span className="luca-conversation-canvas__mode">Preview</span>
          <button aria-label="More Canvas actions" type="button">
            <Ellipsis aria-hidden />
          </button>
          <button
            aria-label="Close Canvas"
            data-testid="close-conversation-canvas"
            onClick={close}
            type="button"
          >
            <X aria-hidden />
          </button>
        </div>
      </header>
      <div className="luca-conversation-canvas__body">
        <div className="luca-conversation-canvas__artifact">
          <ArtifactPreview artifact={artifact} />
        </div>
      </div>
      <span aria-live="polite" className="sr-only">
        {phase === "open" ? `${artifact.title} opened in Canvas` : ""}
      </span>
    </aside>
  );
}
