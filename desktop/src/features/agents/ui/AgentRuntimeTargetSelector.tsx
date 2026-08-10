import { Check, CircleAlert } from "lucide-react";

import type {
  AgentRuntimeTargetV1,
  RuntimeTargetOptionV1,
} from "@/shared/api/tauriOperatorForge";
import { cn } from "@/shared/lib/cn";

export function runtimeTargetKey(target: AgentRuntimeTargetV1): string {
  return target.kind === "managed"
    ? `managed:${target.runtimeId}`
    : `native:${target.runtime}`;
}

export function AgentRuntimeTargetSelector({
  disabled = false,
  onChange,
  options,
  value,
}: {
  disabled?: boolean;
  onChange: (target: AgentRuntimeTargetV1 | null) => void;
  options: RuntimeTargetOptionV1[];
  value: AgentRuntimeTargetV1 | null;
}) {
  const selectedKey = value ? runtimeTargetKey(value) : null;
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="mb-2 text-xs font-medium text-white/62">
        Default runtime
      </legend>
      <div className="grid grid-cols-2 gap-2 max-[520px]:grid-cols-1">
        {options.map((option) => {
          const key = runtimeTargetKey(option.target);
          const selected = key === selectedKey;
          const unavailable = option.readiness === "unavailable";
          return (
            <button
              aria-label={`${option.label}, ${
                option.readiness === "ready" ? "ready" : "needs setup"
              }${option.recommended ? ", recommended" : ""}`}
              aria-pressed={selected}
              className={cn(
                "flex min-h-14 items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
                selected
                  ? "border-white/34 bg-white/[0.07]"
                  : "border-white/10 bg-white/[0.025] hover:bg-white/[0.045]",
                unavailable && "cursor-not-allowed opacity-45",
              )}
              disabled={disabled || unavailable}
              key={key}
              onClick={() => onChange(option.target)}
              type="button"
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-sm text-white/88">
                  {option.label}
                  {option.recommended ? (
                    <span className="text-2xs uppercase tracking-[0.12em] text-white/38">
                      Recommended
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block truncate text-xs text-white/44">
                  {option.readiness === "ready"
                    ? "Ready"
                    : (option.reason ?? "Needs setup")}
                </span>
              </span>
              {selected ? (
                <Check aria-label="Selected" className="size-4 text-white/82" />
              ) : option.readiness === "setup_required" ? (
                <CircleAlert
                  aria-label="Needs setup"
                  className="size-4 text-white/42"
                />
              ) : null}
            </button>
          );
        })}
      </div>
      <button
        className="text-xs text-white/42 hover:text-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        onClick={() => onChange(null)}
        type="button"
      >
        Use no default runtime
      </button>
    </fieldset>
  );
}
