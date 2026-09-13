import * as React from "react";
import type { QuickChatEffort } from "@/features/quickchat/types";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { mountPhosphorEffort } from "@/features/quickchat/ui/phosphor-effort.js";
import "./thinking-effort.css";

export type ThinkingEffortControlProps = {
  effort: QuickChatEffort;
  position: number;
  onPositionChange: (position: number) => void;
  onCommit: (value: string) => void;
  active?: boolean;
  testId?: string;
};

const clampPosition = (position: number) => Math.max(0, Math.min(3, position));

export function getThinkingEffortLabel(value: {
  value: string;
  label: string;
}) {
  return value.value.toLowerCase() === "xhigh" ? "Extra high" : value.label;
}

export function ThinkingEffortControl({
  effort,
  position,
  onPositionChange,
  onCommit,
  active = true,
  testId = "thinking-effort",
}: ThinkingEffortControlProps) {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const input = React.useRef<HTMLInputElement>(null);
  const host = React.useRef<HTMLDivElement>(null);
  const field = React.useRef<ReturnType<typeof mountPhosphorEffort> | null>(
    null,
  );
  const lastCommit = React.useRef<string | null>(null);
  const { isDark } = useTheme();
  const values = effort.values;
  const supported = effort.supported && values.length >= 2;
  const selected = supported
    ? values[Math.round((clampPosition(position) / 3) * (values.length - 1))]
    : undefined;

  React.useEffect(() => {
    if (!supported || !canvas.current || !input.current || !host.current)
      return;
    const mounted = mountPhosphorEffort({
      canvas: canvas.current,
      input: input.current,
      containers: [host.current],
      themeRoot: host.current,
    });
    field.current = mounted;
    return () => {
      mounted.destroy();
      field.current = null;
    };
  }, [supported]);

  React.useEffect(() => {
    field.current?.setActive(active && supported);
  }, [active, supported]);

  React.useEffect(() => {
    if (host.current) host.current.dataset.theme = isDark ? "inverse" : "paper";
    field.current?.refreshTheme();
  }, [isDark]);

  React.useLayoutEffect(() => {
    if (!input.current) return;
    input.current.value = String(clampPosition(position));
    field.current?.update();
  }, [position]);

  if (!supported && !effort.awaitingFirstReply) {
    return (
      <p className="text-xs text-muted-foreground">
        {effort.reason ??
          "Thinking effort is managed by this resident’s runtime."}
      </p>
    );
  }

  const selectAt = (rawPosition: number) => {
    const next = clampPosition(rawPosition);
    if (input.current) input.current.value = String(next);
    field.current?.update();
    onPositionChange(next);
  };

  const commit = () => {
    if (!supported || !input.current || effort.pending) return;
    // The live input is authoritative at release. React may not yet have
    // rendered the final input event, especially after a fast drag.
    const index = Math.round(
      (clampPosition(Number(input.current.value)) / 3) * (values.length - 1),
    );
    const value = values[index]?.value;
    if (value && value !== effort.value && value !== lastCommit.current) {
      lastCommit.current = value;
      onCommit(value);
    }
  };

  return (
    <div
      ref={host}
      className="thinking-effort"
      data-theme={isDark ? "inverse" : "paper"}
      style={{ "--ink": isDark ? "#f5f3ef" : "#282624" } as React.CSSProperties}
    >
      <div className="thinking-effort__meta text-xs">
        <span>Thinking effort</span>
        <span>{selected ? getThinkingEffortLabel(selected) : "—"}</span>
      </div>
      <div
        className="thinking-effort__track"
        data-inert={!supported ? "true" : undefined}
      >
        {supported && <canvas ref={canvas} aria-hidden="true" tabIndex={-1} />}
        <input
          ref={input}
          data-testid={supported ? testId : `${testId}-unavailable`}
          aria-label="Thinking effort"
          aria-valuetext={selected && getThinkingEffortLabel(selected)}
          type="range"
          min={0}
          max={3}
          step={0.001}
          value={supported ? clampPosition(position) : 0}
          disabled={!supported || effort.pending}
          onChange={(event) => selectAt(Number(event.currentTarget.value))}
          onPointerDown={() => {
            lastCommit.current = null;
          }}
          onPointerUp={commit}
          onPointerCancel={commit}
          onBlur={commit}
          onKeyUp={(event) => {
            if (
              [
                "ArrowLeft",
                "ArrowRight",
                "ArrowUp",
                "ArrowDown",
                "Home",
                "End",
              ].includes(event.key)
            )
              commit();
          }}
          onKeyDown={(event) => {
            const key = event.key;
            if (
              ![
                "ArrowLeft",
                "ArrowRight",
                "ArrowUp",
                "ArrowDown",
                "Home",
                "End",
              ].includes(key)
            )
              return;
            event.preventDefault();
            lastCommit.current = null;
            if (key === "Home") return selectAt(0);
            if (key === "End") return selectAt(3);
            const direction =
              key === "ArrowRight" || key === "ArrowUp" ? 1 : -1;
            const current = Number(event.currentTarget.value);
            if (event.shiftKey) return selectAt(current + direction * 0.03);
            const step = 3 / (values.length - 1);
            const index = current / step;
            const nextIndex =
              direction > 0
                ? Math.floor(index + 0.000001) + 1
                : Math.ceil(index - 0.000001) - 1;
            selectAt(nextIndex * step);
          }}
        />
      </div>
      <p
        className="thinking-effort__status text-2xs text-muted-foreground"
        role="status"
      >
        {!supported
          ? (effort.reason ?? "Available after the first reply")
          : effort.pending
            ? "Updating effort…"
            : selected?.value === effort.value
              ? (effort.reason ?? "Selected for your next message")
              : "Release to select effort"}
      </p>
    </div>
  );
}
