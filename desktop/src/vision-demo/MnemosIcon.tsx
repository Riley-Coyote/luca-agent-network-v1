import {
  Activity,
  BadgeCheck,
  BookOpenText,
  Brain,
  History,
  MessagesSquare,
  UsersRound,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";

export type MnemosIconName =
  | "network"
  | "agents"
  | "brain"
  | "continuity"
  | "memory"
  | "receipt"
  | "activity";

const icons = {
  network: MessagesSquare,
  agents: UsersRound,
  brain: Brain,
  continuity: History,
  memory: BookOpenText,
  receipt: BadgeCheck,
  activity: Activity,
} satisfies Record<MnemosIconName, LucideIcon>;

const iconNames = {
  network: "messages-square",
  agents: "users-round",
  brain: "brain",
  continuity: "history",
  memory: "book-open-text",
  receipt: "badge-check",
  activity: "activity",
} satisfies Record<MnemosIconName, string>;

type MnemosIconProps = LucideProps & {
  name: MnemosIconName;
  title?: string;
};

/**
 * The small, semantic icon vocabulary used by Mnemos product surfaces.
 * Cryptographic agent identity specimens intentionally remain separate.
 */
export function MnemosIcon({ name, title, ...props }: MnemosIconProps) {
  const Icon = icons[name];

  return (
    <Icon
      aria-hidden={title ? undefined : true}
      aria-label={title}
      data-icon-library="lucide"
      data-lucide-icon={iconNames[name]}
      data-mnemos-icon={name}
      role={title ? "img" : undefined}
      strokeWidth={1.75}
      {...props}
    />
  );
}
