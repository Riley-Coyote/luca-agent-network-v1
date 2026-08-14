import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

import { cn } from "@/shared/lib/cn";

type NavigationTransitionVariant = "conversation" | "route" | "section";

const navigationEase = [0.25, 1, 0.5, 1] as const;

const motionByVariant = {
  conversation: {
    enter: { opacity: 0.97 },
    duration: 0.09,
  },
  route: {
    enter: { opacity: 0.94, y: 2 },
    duration: 0.16,
  },
  section: {
    enter: { opacity: 0.96, y: 2 },
    duration: 0.14,
  },
} as const;

export function NavigationTransition({
  children,
  className,
  contentClassName,
  transitionKey,
  variant = "route",
}: {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  transitionKey: string;
  variant?: NavigationTransitionVariant;
}) {
  const reduceMotion = useReducedMotion();
  const spec = motionByVariant[variant];

  return (
    <div className={cn("relative min-h-0 min-w-0", className)}>
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className={cn("min-h-0 min-w-0", contentClassName)}
        initial={reduceMotion ? { opacity: 0.98 } : spec.enter}
        key={transitionKey}
        transition={{
          duration: reduceMotion ? 0.06 : spec.duration,
          ease: navigationEase,
        }}
      >
        {children}
      </motion.div>
    </div>
  );
}
