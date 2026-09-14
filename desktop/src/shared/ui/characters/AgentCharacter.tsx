import * as React from "react";

import { cn } from "@/shared/lib/cn";
import type { AgentVisualState } from "@/shared/ui/AgentIdentitySpecimen";
import {
  type CharacterId,
  useCharacterMotionEnabled,
} from "./characterAppearance";

const ASSET_VERSION = "v1";

function spriteSize(size: number): 20 | 28 | 32 {
  if (size <= 22) return 20;
  if (size <= 30) return 28;
  return 32;
}

export function characterFrameUrl(
  id: CharacterId,
  size: number,
  frame: "rest" | "gesture",
): string {
  return `/characters/${ASSET_VERSION}/${id}-${spriteSize(size)}-${frame}.png`;
}

function cadenceFor(
  publicKey: string,
  id: CharacterId,
  state: AgentVisualState,
): number {
  if (state === "working") return 3200;
  if (state === "thinking" || state === "responding") return 4900;
  let checksum = 0;
  const identity = `${publicKey}:${id}`;
  for (let index = 0; index < identity.length; index += 1) {
    checksum = (checksum + identity.charCodeAt(index) * (index + 1)) % 1024;
  }
  return 8000 + (checksum % 13) * 1000;
}

export function AgentCharacter({
  accessibleName,
  className,
  id,
  motion = "still",
  publicKey,
  size,
  state = "present",
}: {
  accessibleName: string;
  className?: string;
  id: CharacterId;
  motion?: "ambient" | "still";
  publicKey: string;
  size: number;
  state?: AgentVisualState;
}) {
  const host = React.useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = React.useState(false);
  const [gesture, setGesture] = React.useState(false);
  const motionEnabled = useCharacterMotionEnabled();
  const canMove =
    motion === "ambient" &&
    motionEnabled &&
    state !== "unavailable" &&
    state !== "fault";

  React.useEffect(() => {
    if (!canMove || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(Boolean(entry?.isIntersecting));
    });
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, [canMove]);

  React.useEffect(() => {
    if (!canMove || !visible) {
      setGesture(false);
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (document.hidden || reduced.matches) {
        setGesture(false);
        return;
      }
      timeout = setTimeout(
        () => {
          setGesture(true);
          timeout = setTimeout(() => {
            setGesture(false);
            schedule();
          }, 320);
        },
        cadenceFor(publicKey, id, state),
      );
    };
    const reset = () => {
      if (timeout) clearTimeout(timeout);
      setGesture(false);
      schedule();
    };
    schedule();
    document.addEventListener("visibilitychange", reset);
    reduced.addEventListener("change", reset);
    return () => {
      if (timeout) clearTimeout(timeout);
      document.removeEventListener("visibilitychange", reset);
      reduced.removeEventListener("change", reset);
    };
  }, [canMove, id, publicKey, state, visible]);

  return (
    <span
      aria-label={`${accessibleName} character, ${state}`}
      className={cn("agent-character", className)}
      data-character-id={id}
      data-agent-state={state}
      ref={host}
      role="img"
      style={{ width: size, height: size }}
    >
      <img
        alt=""
        className="agent-character-frame"
        draggable={false}
        src={characterFrameUrl(id, size, "rest")}
        style={{ visibility: gesture ? "hidden" : "visible" }}
      />
      {canMove ? (
        <img
          alt=""
          aria-hidden="true"
          className="agent-character-frame"
          draggable={false}
          src={characterFrameUrl(id, size, "gesture")}
          style={{ visibility: gesture ? "visible" : "hidden" }}
        />
      ) : null}
    </span>
  );
}
