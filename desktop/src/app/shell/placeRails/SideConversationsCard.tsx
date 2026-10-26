import "@/app/shell/shell-activity.css";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import {
  PlaceList,
  PlaceListRow,
  PlacePage,
} from "@/app/shell/placeRails/PlacePage";
import { PlacePageHead } from "@/app/shell/placeRails/PlacePageHead";
import {
  type SideConversation,
  shownAt,
  sideDays,
  sideTitle,
  turnsLabel,
} from "@/features/exchange/sideConversations";
import { noteOpenSide } from "@/features/exchange/openSide";
import { useSideConversations } from "@/features/exchange/useSideConversations";

/**
 * Side conversations (NAVIGATION.md, "Activity"; SHELL_BUILD.md WP-14,
 * Decided 5): one feed, by day, of everything agents say to each other for
 * you: an agent asking another in one of your rooms, an agent asking Claude
 * Code or Codex. Each row opens where it happened: an exchange at its first
 * message, a task in its room, where its receipt is.
 */
export function SideConversationsCard() {
  const { items, nameOf, roomOf } = useSideConversations();
  const { goChannel } = useAppNavigation();
  const days = sideDays(items);
  return (
    <PlacePage testId="side-conversations-card">
      <PlacePageHead eyebrow="Activity" title="Side conversations" />
      <p className="luca-place-page-line">
        What your agents say to each other, and what they ask Claude Code and
        Codex, in the conversations you share with them.
      </p>
      {items.length === 0 ? (
        <p className="luca-place-page-line" data-testid="side-empty">
          No side conversations yet. When Luca asks another agent, or Claude
          Code or Codex, it shows here.
        </p>
      ) : (
        days.map((day) => (
          <PlaceList key={day.key} label={day.label} testId="side-day">
            {day.items.map((item) => (
              <SideRow
                item={item}
                key={`${item.kind}:${item.id}`}
                nameOf={nameOf}
                onOpen={() => {
                  // The rail marks it under Luca, not its room (WP-18).
                  noteOpenSide(item);
                  void goChannel(
                    item.conversationId,
                    item.kind === "exchange"
                      ? { messageId: item.rootEventId }
                      : undefined,
                  );
                }}
                roomOf={roomOf}
              />
            ))}
          </PlaceList>
        ))
      )}
    </PlacePage>
  );
}

/** A time of day: the day is the list's heading. */
function timeOfDay(at: number | null) {
  return at
    ? new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(at))
    : "";
}

function SideRow({
  item,
  nameOf,
  onOpen,
  roomOf,
}: {
  item: SideConversation;
  nameOf: (pubkey: string) => string;
  onOpen: () => void;
  roomOf: (conversationId: string) => string;
}) {
  const title = sideTitle(item, nameOf);
  const room = roomOf(item.conversationId);
  const summary = item.kind === "task" ? item.summary : room;
  const turns = item.kind === "exchange" ? turnsLabel(item.turns) : "";
  return (
    <PlaceListRow
      data-side-kind={item.kind}
      data-side-state={item.word}
      detail={
        <>
          <span className="luca-side-state" data-live={item.live || undefined}>
            {item.word}
          </span>
          <span className="luca-side-turns">{turns}</span>
        </>
      }
      note={
        item.kind === "exchange" && item.live ? "now" : timeOfDay(shownAt(item))
      }
      onOpen={onOpen}
      openLabel={[title, summary, item.word, room && `in ${room}`]
        .filter(Boolean)
        .join(", ")}
      summary={summary}
      testId={`side-row-${item.id}`}
      title={title}
    />
  );
}
