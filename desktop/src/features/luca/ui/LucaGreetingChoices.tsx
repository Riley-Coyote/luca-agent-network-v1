import * as React from "react";

import { cn } from "@/shared/lib/cn";

/** Optional first messages, sent through the ordinary conversation path. */
export const LUCA_GREETING_CHOICES = [
  "Start something",
  "Bring in existing work",
] as const;

export function LucaGreetingChoices({
  className,
  disabled = false,
  onChoose,
}: {
  className?: string;
  disabled?: boolean;
  onChoose: (choice: string) => void | Promise<void>;
}) {
  const [sending, setSending] = React.useState<string | null>(null);

  return (
    <fieldset
      aria-label="Places to begin"
      className={cn(
        "mt-4 flex w-full flex-wrap justify-center gap-2",
        className,
      )}
      data-testid="luca-greeting-choices"
    >
      {LUCA_GREETING_CHOICES.map((choice, index) => {
        return (
          <button
            className={cn(
              "group flex max-w-full items-center gap-2 rounded-lg border border-foreground/10 px-3 py-2 text-left text-sm text-foreground/80 transition-colors duration-150",
              "hover:bg-accent hover:text-foreground",
              "focus-visible:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              "disabled:cursor-default disabled:opacity-50",
            )}
            data-testid={`luca-greeting-choice-${index + 1}`}
            disabled={disabled || sending !== null}
            key={choice}
            onClick={() => {
              setSending(choice);
              void Promise.resolve()
                .then(() => onChoose(choice))
                .catch(() => {
                  // The conversation send path displays its error and retry.
                })
                .finally(() => setSending(null));
            }}
            type="button"
          >
            <span className="min-w-0">{choice}</span>
          </button>
        );
      })}
    </fieldset>
  );
}
