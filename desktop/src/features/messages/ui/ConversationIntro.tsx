import { cn } from "@/shared/lib/cn";
import { AgentIdentitySpecimen } from "@/shared/ui/AgentIdentitySpecimen";

/**
 * PROTOTYPE — the start of a conversation, as a chat app does it.
 *
 * What this replaces was a ROOM intro: a `#` glyph, "#general", "This is the
 * beginning of the regular channel", and two large admin tiles for creating an
 * agent and adding people. Every part of that is workspace furniture — it
 * describes a place with a history and settings.
 *
 * No consumer messenger has this screen. iMessage and Telegram show nothing at
 * all; WhatsApp shows one line. Opening a conversation should present the
 * person you are about to talk to and then get out of the way, so this is the
 * resident's own mark, their name, and at most a line about who they are.
 *
 * The admin actions are not lost, they are relocated: creating an agent belongs
 * in Agents, and choosing who is in a chat belongs in the new-chat flow. A
 * conversation is not the place to administer the roster.
 */
export function ConversationIntro({
  className,
  markSeeds,
  title,
  subtitle,
}: {
  className?: string;
  /** One seed per participant — a resident's key, or a room's own id. */
  markSeeds: readonly string[];
  title: string;
  subtitle?: string | null;
}) {
  return (
    <div
      className={cn("flex w-full flex-col items-start px-3 pb-2", className)}
      data-testid="conversation-intro"
    >
      <div className="flex gap-2">
        {markSeeds.slice(0, 3).map((seed) => (
          <AgentIdentitySpecimen
            accessibleName={title}
            key={seed}
            publicKey={seed}
            // Large enough to read as a portrait rather than a list icon. This
            // is the one place the mark is the subject of the screen.
            size={56}
            state="present"
          />
        ))}
      </div>
      <p className="mt-3 text-lg font-medium leading-6 tracking-tight text-foreground">
        {title}
      </p>
      {subtitle ? (
        <p className="mt-1 max-w-xl text-sm leading-5 text-muted-foreground">
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}
