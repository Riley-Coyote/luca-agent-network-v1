import { cn } from "@/shared/lib/cn";
import { AgentIdentitySpecimen } from "@/shared/ui/AgentIdentitySpecimen";
import { UserAvatar } from "@/shared/ui/UserAvatar";

/**
 * The start of a conversation, as a chat app does it.
 *
 * What this replaces was a ROOM intro: a `#` glyph, "#general", "This is the
 * beginning of the regular channel", and two large admin tiles for creating an
 * agent and adding people. Every part of that is workspace furniture — it
 * describes a place with a history and settings.
 *
 * No consumer messenger has this screen. iMessage and Telegram show nothing at
 * all; WhatsApp shows one line. Opening a conversation should present the
 * person you are about to talk to and then get out of the way, so this is the
 * other side's own mark, their name, and at most a line about who they are.
 * Rooms and direct conversations share it: residents wear their identity
 * glyph, people wear their disc, so the threshold reads the same as the rows
 * beneath it. It sits on the rows' reading plane, not the pane's edge.
 *
 * The admin actions are not lost, they are relocated: creating an agent belongs
 * in Agents, and choosing who is in a chat belongs in the new-chat flow. A
 * conversation is not the place to administer the roster.
 */
export type ConversationIntroMark =
  | { kind: "glyph"; key: string; seed: string; label: string }
  | {
      kind: "person";
      key: string;
      displayName: string;
      avatarUrl: string | null;
    };

/** Large enough to read as a portrait rather than a list icon. This is the
 *  one place the mark is the subject of the screen. */
const MARK_SIZE = 56;
const MARK_LIMIT = 3;

export function ConversationIntro({
  className,
  marks,
  hiddenCount = 0,
  title,
  subtitle,
  testId = "conversation-intro",
  marksTestId,
}: {
  className?: string;
  /** One mark per participant on the other side — a resident's key, a
   *  person's disc, or a room's own id. At most three are shown. */
  marks: readonly ConversationIntroMark[];
  /** Participants beyond the ones shown, when the caller already capped. */
  hiddenCount?: number;
  title: string;
  subtitle?: string | null;
  testId?: string;
  marksTestId?: string;
}) {
  const shown = marks.slice(0, MARK_LIMIT);
  const overflow = hiddenCount + Math.max(0, marks.length - MARK_LIMIT);
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-[48rem] flex-col items-start px-3 pb-2",
        className,
      )}
      data-testid={testId}
    >
      <div
        aria-hidden="true"
        className="flex items-center gap-2"
        data-testid={marksTestId}
      >
        {shown.map((mark) => (
          <div
            data-testid={marksTestId ? `${marksTestId}-participant` : undefined}
            key={mark.key}
          >
            {mark.kind === "glyph" ? (
              <AgentIdentitySpecimen
                accessibleName={mark.label}
                publicKey={mark.seed}
                size={MARK_SIZE}
                state="present"
              />
            ) : (
              <UserAvatar
                avatarUrl={mark.avatarUrl}
                className="h-14 w-14 text-base"
                displayName={mark.displayName}
                fallbackClassName="bg-primary/20 font-medium text-primary"
                size="md"
              />
            )}
          </div>
        ))}
        {overflow > 0 ? (
          <div data-testid={marksTestId ? `${marksTestId}-more` : undefined}>
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/20 font-medium text-primary">
              <span className="text-base leading-none">+{overflow}</span>
            </span>
          </div>
        ) : null}
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
