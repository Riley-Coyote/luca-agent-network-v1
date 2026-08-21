import { ArrowRight } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import * as React from "react";

import { cn } from "@/shared/lib/cn";

/**
 * Luca's opening offer, in Luca's own words, as part of Luca's message: an
 * option list under the greeting. Each is sent as the owner's message when
 * chosen — the real Luca answers it — so nothing here is a command or a
 * shortcut around the conversation. Five is the ceiling; the last is the
 * quietest.
 */
export const LUCA_GREETING_CHOICES = [
  "Show me what you found",
  "Connect my projects and past sessions",
  "Set up or bring in an agent",
  "Show me around",
  "Just chat",
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
  const reduceMotion = useReducedMotion();
  const [sending, setSending] = React.useState<string | null>(null);

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      aria-label="Places to begin"
      className={cn(
        "mt-3 w-full max-w-[28rem] overflow-hidden rounded-lg border border-border/80 bg-transparent",
        className,
      )}
      data-testid="luca-greeting-choices"
      initial={reduceMotion ? false : { opacity: 0, y: 4 }}
      role="group"
      transition={
        reduceMotion
          ? { duration: 0 }
          : { delay: 0.25, duration: 0.4, ease: [0.2, 0, 0, 1] }
      }
    >
      {LUCA_GREETING_CHOICES.map((choice, index) => {
        const last = index === LUCA_GREETING_CHOICES.length - 1;
        const isSending = sending === choice;
        return (
          <button
            className={cn(
              "group flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-ink-muted transition-colors duration-150",
              index > 0 && "border-t border-border/60",
              "hover:bg-accent hover:text-foreground",
              "focus-visible:bg-accent focus-visible:outline-none",
              "disabled:cursor-default disabled:opacity-50",
              last && "text-ink-faint",
            )}
            data-testid={`luca-greeting-choice-${index + 1}`}
            disabled={disabled || sending !== null}
            key={choice}
            onClick={() => {
              setSending(choice);
              void Promise.resolve(onChoose(choice)).finally(() =>
                setSending(null),
              );
            }}
            type="button"
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-2 shrink-0 rounded-full border border-foreground/40 transition-colors",
                "group-hover:border-foreground/70 group-hover:bg-foreground/70",
                isSending && "border-foreground bg-foreground",
              )}
            />
            <span className="min-w-0 flex-1">{choice}</span>
            <ArrowRight
              aria-hidden="true"
              className="size-3.5 shrink-0 text-foreground/0 transition-colors group-hover:text-ink-faint"
            />
          </button>
        );
      })}
    </motion.div>
  );
}
