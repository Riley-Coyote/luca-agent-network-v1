import {
  PlaceList,
  PlaceListRow,
  placeNoteTime,
} from "@/app/shell/placeRails/PlacePage";
import type { BookMemory } from "./book";
import type { ItemGroup } from "./ItemsRoom";
import { ItemsRoom } from "./ItemsRoom";
import { longDay, QuietLine, Words } from "./MnemosParts";
import { firstLine } from "./notebook";
import { answeredKey } from "./notebookLog";
import { ASK, ASK_ORDER, putTo, question } from "./notebookWords";
import type { RoomProps } from "./roomKit";

/** Questions: what its memory asks it about itself, open ones by kind and
 *  answered ones with the answer. Read only: the answers are the mind's
 *  own. Each opens the memory it asks about. */
export function QuestionsRoom(props: RoomProps) {
  const questions = props.notebook?.life.questions ?? null;
  const byId = new Map(
    (props.notebook?.memories.memories ?? []).map((m) => [m.id, m]),
  );
  const about = (id: string) => (
    <AboutMemory
      memory={byId.get(id) ?? null}
      onOpen={(memory) => props.goTo("memories", memory)}
    />
  );
  let groups: ItemGroup[] | null = null;
  if (questions) {
    const kinds = [...new Set(questions.asked.map((q) => q.kind))].sort(
      (a, b) => (ASK_ORDER[a] ?? 9) - (ASK_ORDER[b] ?? 9),
    );
    groups = [
      ...kinds.map((kind) => ({
        label: ASK[kind]?.[0] ?? kind,
        items: questions.asked
          .filter((q) => q.kind === kind)
          .map((q) => ({
            key: q.id,
            title: question(q.prompt),
            note: placeNoteTime(q.at),
            opened: () => (
              <article
                aria-label="A question"
                data-testid="mnemos-question-opened"
              >
                <h2 className="luca-mnemos-title text-base">
                  {question(q.prompt)}
                </h2>
                {q.excerpt && !byId.has(q.about) ? (
                  <Words text={q.excerpt} />
                ) : null}
                <QuietLine parts={[ASK[q.kind]?.[1], putTo(q.shown)]} />
                {about(q.about)}
              </article>
            ),
          })),
      })),
      {
        label: "Answered",
        items: questions.answered.map((q, index) => ({
          key: answeredKey(index),
          title: question(q.prompt),
          note: placeNoteTime(q.at),
          summary: q.answer ? undefined : "no answer kept",
          opened: () => (
            <article
              aria-label="An answered question"
              data-testid="mnemos-answered-opened"
            >
              <h2 className="luca-mnemos-title text-base">
                {question(q.prompt)}
              </h2>
              {q.excerpt && !byId.has(q.about) ? (
                <Words text={q.excerpt} />
              ) : null}
              {q.answer ? <Words text={q.answer} /> : null}
              <QuietLine parts={[q.at ? `Answered ${longDay(q.at)}` : null]} />
              {about(q.about)}
            </article>
          ),
        })),
      },
    ];
  }
  return (
    <ItemsRoom
      backLabel="Questions"
      empty="Its memory hasn’t asked it anything yet."
      groups={groups}
      needs="Questions"
      props={props}
      testId="mnemos-questions"
    />
  );
}

/** The memory a question asks about, to open in Memories; nothing when it
 *  isn't among the memories in view. */
function AboutMemory({
  memory,
  onOpen,
}: {
  memory: BookMemory | null;
  onOpen: (id: string) => void;
}) {
  if (!memory) return null;
  return (
    <PlaceList label="The memory it asks about" testId="mnemos-question-about">
      <PlaceListRow
        note={placeNoteTime(memory.born)}
        onOpen={() => onOpen(memory.id)}
        testId={`mnemos-question-about-${memory.id}`}
        title={firstLine(memory.content)}
      />
    </PlaceList>
  );
}
