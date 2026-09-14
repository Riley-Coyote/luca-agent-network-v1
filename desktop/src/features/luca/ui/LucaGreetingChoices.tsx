import * as React from "react";

import { cn } from "@/shared/lib/cn";

export function LucaGreetingChoices({
  className,
  disabled = false,
  options,
  onChoose,
}: {
  className?: string;
  disabled?: boolean;
  options: readonly string[];
  onChoose: (choice: string) => void | Promise<void>;
}) {
  const [sending, setSending] = React.useState<string | null>(null);
  const sendingRef = React.useRef(false);

  return (
    <fieldset
      aria-label="Suggested replies"
      className={cn(
        "mt-4 flex w-full flex-wrap justify-center gap-2",
        className,
      )}
      data-testid="luca-greeting-choices"
    >
      {options.map((choice, index) => {
        return (
          <button
            className={cn(
              "group flex max-w-full items-center gap-2 rounded-lg bg-foreground/5 px-3 py-2 text-left text-sm text-foreground/80 transition-colors duration-150",
              "hover:bg-accent hover:text-foreground",
              "focus-visible:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              "disabled:cursor-default disabled:opacity-50",
            )}
            data-testid={`luca-greeting-choice-${index + 1}`}
            disabled={disabled || sending !== null}
            key={choice}
            onClick={() => {
              if (disabled || sendingRef.current) return;
              sendingRef.current = true;
              setSending(choice);
              void Promise.resolve()
                .then(() => onChoose(choice))
                .catch(() => {
                  // The conversation send path displays its error and retry.
                })
                .finally(() => {
                  sendingRef.current = false;
                  setSending(null);
                });
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
