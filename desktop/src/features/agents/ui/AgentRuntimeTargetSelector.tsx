import { Check, ChevronDown, CircleAlert } from "lucide-react";

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
  appearance = "cards",
  disabled = false,
  onChange,
  options,
  value,
}: {
  appearance?: "cards" | "onboarding";
  disabled?: boolean;
  onChange: (target: AgentRuntimeTargetV1 | null) => void;
  options: RuntimeTargetOptionV1[];
  value: AgentRuntimeTargetV1 | null;
}) {
  const selectedKey = value ? runtimeTargetKey(value) : null;
  const selectedOption = selectedKey
    ? options.find((option) => runtimeTargetKey(option.target) === selectedKey)
    : null;

  if (appearance === "onboarding") {
    return (
      <fieldset disabled={disabled}>
        <legend className="mb-1.5 text-xs font-medium text-white/52">
          Default runtime
        </legend>
        <div className="relative">
          <select
            aria-label="Default runtime"
            className="h-9 w-full appearance-none rounded-md border border-white/[0.09] bg-white/[0.03] px-3 pr-9 text-sm text-white/88 outline-none transition-colors hover:bg-white/[0.05] focus:border-white/20 focus:ring-2 focus:ring-white/35 disabled:cursor-not-allowed disabled:opacity-50"
            onChange={(event) => {
              const next = options.find(
                (option) =>
                  runtimeTargetKey(option.target) === event.target.value,
              );
              onChange(next?.target ?? null);
            }}
            value={selectedKey ?? ""}
          >
            <option value="">No default runtime</option>
            {options.map((option) => (
              <option
                disabled={option.readiness === "unavailable"}
                key={runtimeTargetKey(option.target)}
                value={runtimeTargetKey(option.target)}
              >
                {option.label}
                {option.recommended ? " — Recommended" : ""}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden
            className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/38"
          />
        </div>
        <p className="mt-1 min-h-4 text-xs leading-4 text-white/38">
          {selectedOption
            ? selectedOption.readiness === "ready"
              ? `${selectedOption.label} is ready${selectedOption.recommended ? " and recommended for this Mac" : ""}.`
              : (selectedOption.reason ?? "This runtime needs attention.")
            : "You can choose a runtime later in Settings."}
        </p>
      </fieldset>
    );
  }

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
