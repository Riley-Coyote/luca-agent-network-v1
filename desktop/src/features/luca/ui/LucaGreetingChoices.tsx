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
  "Connect projects and chats",
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
      className={cn("mt-3 flex w-full max-w-xl flex-wrap gap-2", className)}
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
        return (
          <button
            className={cn(
              "group flex max-w-full items-center gap-2 rounded-lg border border-border/80 px-3 py-2 text-left text-sm text-ink-muted transition-colors duration-150",
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
            <span className="min-w-0">{choice}</span>
          </button>
        );
      })}
    </motion.div>
  );
}
