import * as React from "react";

import { SandpileActivityIndicator } from "@/shared/ui/SandpileActivityIndicator";
import "@/shared/ui/mote3d.js";
import motePoster from "./mote-chat-poster.png";
import "./chatAgentMark.css";

const TRANSITION_MS = 560;

/** The same small stage stays beside an agent's words for the whole turn. */
export function ChatAgentMark({
  active,
  name,
  seed,
}: {
  active: boolean;
  name: string;
  seed: string;
}) {
  const [showSandpile, setShowSandpile] = React.useState(active);
  const [visualActive, setVisualActive] = React.useState(false);
  const [liveMote, setLiveMote] = React.useState(false);

  React.useEffect(() => {
    if (active) {
      setShowSandpile(true);
      const frame = window.requestAnimationFrame(() => setVisualActive(true));
      return () => window.cancelAnimationFrame(frame);
    }
    setVisualActive(false);
    const timeout = window.setTimeout(
      () => setShowSandpile(false),
      TRANSITION_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [active]);

  return (
    <span
      aria-label={`${name} ${active ? "working" : "identity"} mark`}
      className="luca-chat-agent-mark"
      data-active={visualActive}
      data-testid="chat-agent-mark"
      onPointerEnter={() => {
        if (
          !active &&
          !window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ) {
          setLiveMote(true);
        }
      }}
      onPointerLeave={() => setLiveMote(false)}
      role="img"
    >
      <img
        alt=""
        aria-hidden="true"
        className="luca-chat-agent-mark__mote"
        src={motePoster}
      />
      {liveMote && !active
        ? React.createElement("mote-3d", {
            "aria-hidden": true,
            className: "luca-chat-agent-mark__live-mote",
            expression: "ambient",
            "no-caustic": "",
            species: "mote",
            style: { height: 49, width: 49 },
            tint: "#b8b8b8",
          })
        : null}
      {showSandpile ? (
        <span aria-hidden="true" className="luca-chat-agent-mark__sandpile">
          <SandpileActivityIndicator seed={`${seed}:activity`} size={40} />
        </span>
      ) : null}
      <span aria-hidden="true" className="luca-chat-agent-mark__wake" />
    </span>
  );
}
