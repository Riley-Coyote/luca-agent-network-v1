import * as React from "react";
import { MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import {
  resolveManagedInput,
  type ManagedInputValue,
  type PendingManagedInput,
} from "@/shared/api/managedInputs";

/** Native questions reuse the existing approval surface without granting access. */
export function ManagedInputCard({
  pending,
  compact = false,
}: {
  pending: PendingManagedInput;
  compact?: boolean;
}) {
  return (
    <ManagedInputForm
      key={pending.pendingId}
      pending={pending}
      compact={compact}
    />
  );
}

function ManagedInputForm({
  pending,
  compact,
}: {
  pending: PendingManagedInput;
  compact: boolean;
}) {
  const [answers, setAnswers] = React.useState<
    Record<string, ManagedInputValue>
  >({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inFlight = React.useRef(false);
  const submit = async (action: "answered" | "declined" | "cancelled") => {
    if (inFlight.current) return;
    if (action === "answered") {
      const missing = pending.request.fields.find((field) => {
        const value = answers[field.key];
        return (
          field.required &&
          (Array.isArray(value)
            ? value.length === 0
            : typeof value !== "string" || value.trim().length === 0)
        );
      });
      if (missing) {
        setError(`Answer “${missing.label}” before sending.`);
        return;
      }
      const tooLong = pending.request.fields.some((field) => {
        const value = answers[field.key];
        return (
          field.kind === "text" &&
          typeof value === "string" &&
          new TextEncoder().encode(value).length > 4096
        );
      });
      if (tooLong) {
        setError("A text answer is too long. Shorten it before sending.");
        return;
      }
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await resolveManagedInput(
        pending.pendingId,
        action,
        action === "answered" ? answers : {},
      );
      setAnswers({});
      toast(
        action === "answered"
          ? "Response sent to the agent"
          : "Question skipped",
      );
    } catch (cause) {
      inFlight.current = false;
      setError(
        cause instanceof Error
          ? cause.message
          : typeof cause === "string"
            ? cause
            : "This question is no longer waiting.",
      );
      setBusy(false);
    }
  };
  return (
    <section
      aria-label="Agent question required"
      className="min-w-0 max-w-full border border-border bg-card text-card-foreground shadow-sm"
      data-testid="managed-input-card"
      aria-busy={busy}
    >
      <form
        className={compact ? "p-3" : "p-4"}
        onSubmit={(event) => {
          event.preventDefault();
          void submit("answered");
        }}
      >
        <div className="flex items-start gap-3">
          <MessageCircle
            aria-hidden
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">The agent has a question</p>
            <p className="mt-1 whitespace-pre-wrap wrap-anywhere text-sm leading-5 text-muted-foreground">
              {pending.request.message}
            </p>
          </div>
        </div>
        <div className="mt-3 grid gap-3">
          {pending.request.fields.map((field) => (
            <fieldset className="min-w-0" disabled={busy} key={field.key}>
              <legend className="max-w-full wrap-anywhere text-sm font-medium">
                {field.label}
                {field.required ? " *" : ""}
              </legend>
              {field.description ? (
                <p className="mt-1 whitespace-pre-wrap wrap-anywhere text-xs text-muted-foreground">
                  {field.description}
                </p>
              ) : null}
              {field.kind === "text" ? (
                <input
                  aria-label={field.label}
                  className="mt-2 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                  maxLength={4096}
                  required={field.required}
                  type="text"
                  value={
                    typeof answers[field.key] === "string"
                      ? (answers[field.key] as string)
                      : ""
                  }
                  onChange={(event) =>
                    setAnswers((current) => ({
                      ...current,
                      [field.key]: event.target.value,
                    }))
                  }
                />
              ) : (
                <div className="mt-2 grid gap-2">
                  {field.options.map((option) => {
                    const value = answers[field.key];
                    const selected =
                      field.kind === "single"
                        ? value === option.value
                        : Array.isArray(value) && value.includes(option.value);
                    return (
                      <label
                        className="flex min-w-0 cursor-pointer items-start gap-2 text-sm"
                        key={option.value}
                      >
                        <input
                          className="mt-0.5 shrink-0"
                          checked={selected}
                          name={`${pending.pendingId}-${field.key}`}
                          type={field.kind === "single" ? "radio" : "checkbox"}
                          required={field.required && field.kind === "single"}
                          onChange={() =>
                            setAnswers((current) => {
                              if (field.kind === "single")
                                return {
                                  ...current,
                                  [field.key]: option.value,
                                };
                              const values = Array.isArray(current[field.key])
                                ? (current[field.key] as string[])
                                : [];
                              return {
                                ...current,
                                [field.key]: selected
                                  ? values.filter((v) => v !== option.value)
                                  : [...values, option.value],
                              };
                            })
                          }
                        />
                        <span className="min-w-0 wrap-anywhere">
                          {option.label}
                          {option.description ? (
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              {option.description}
                            </span>
                          ) : null}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </fieldset>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          This sends an answer only. It does not approve tools or change access.
        </p>
        {error ? (
          <p
            className="mt-2 wrap-anywhere text-sm text-destructive"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          <Button
            disabled={busy}
            onClick={() => void submit("declined")}
            size="sm"
            type="button"
            variant="ghost"
          >
            Skip
          </Button>
          <Button disabled={busy} size="sm" type="submit">
            {busy ? "Sending…" : "Send answer"}
          </Button>
        </div>
      </form>
    </section>
  );
}
