import * as React from "react";
import { Search } from "lucide-react";

import {
  PlaceList,
  PlaceListRow,
  placeNoteTime,
} from "@/app/shell/placeRails/PlacePage";
import { cn } from "@/shared/lib/cn";
import { type BookStanding, standingOf } from "./adapt";
import type { BookFound, BookMemory } from "./book";
import {
  longDay,
  PlaceLine,
  QuietLine,
  RoomFrame,
  useLoad,
  Words,
} from "./MnemosParts";
import {
  firstLine,
  foundWords,
  newestFirst,
  newestFirstPage,
  signedBy,
  stateWords,
} from "./notebook";
import { setRoomCounts } from "./placeStore";
import { DIDNT_ANSWER, type RoomProps, useAddressItem } from "./roomKit";
import { useReaderSection } from "./useReader";

const PAGE = 50;
type Chip = "all" | "dormant" | "standing";
const CHIPS: { id: Chip; label: string }[] = [
  { id: "all", label: "All" },
  { id: "dormant", label: "Gone quiet" },
  { id: "standing", label: "Standing" },
];

/**
 * Memories (WP-45, Decided 5): newest first, asked from the end of the
 * engine's oldest-first list; All, Gone quiet, and Standing (the old
 * reader's, words only); a search by meaning that says how each was found;
 * and the memory opened whole beside the list.
 */
export function MemoriesRoom(props: RoomProps) {
  const { book, mind, item, openItem, reader } = props;
  const [chip, setChip] = React.useState<Chip>("all");
  const [query, setQuery] = React.useState("");
  const [asked, setAsked] = React.useState<string | null>(null);
  const [pages, setPages] = React.useState(1);
  const [shown, setShown] = React.useState<BookMemory[]>([]);
  const [more, setMore] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const [n, setN] = React.useState(0);
  const [standingOpen, setStandingOpen] = React.useState<number | null>(null);
  /** Every memory shown in this room, whole from a list, or only its words
   *  and day from a search. */
  const seen = React.useRef(new Map<string, Seen>());

  // The list: its numbers first, then pages from the newest end.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `n` is Try again, asking once more.
  React.useEffect(() => {
    if (chip === "standing") return;
    let current = true;
    setFailed(false);
    (async () => {
      const facts = await book.facts();
      const { active, dormant } = facts.states;
      if (current) setRoomCounts(mind.id, { memories: active + dormant });
      const total = chip === "dormant" ? dormant : active + dormant;
      const list: BookMemory[] = [];
      for (let page = 0; page < pages; page++) {
        const slice = newestFirstPage(total, page, PAGE);
        if (!slice) break;
        const got = await book.memories({
          ...slice,
          state: chip === "dormant" ? "dormant" : undefined,
        });
        list.push(...newestFirst(got.memories));
      }
      if (!current) return;
      for (const m of list) seen.current.set(m.id, { memory: m, whole: true });
      setShown(list);
      setMore(newestFirstPage(total, pages, PAGE) !== null);
      setLoaded(true);
    })().catch(() => {
      if (current) {
        setFailed(true);
        setLoaded(true);
      }
    });
    return () => {
      current = false;
    };
  }, [book, chip, mind.id, pages, n]);

  const search = useLoad(
    () => (asked ? book.search(asked) : Promise.resolve(null)),
    [book, asked],
  );
  for (const r of search.value ?? []) {
    if (!seen.current.has(r.memory.id))
      seen.current.set(r.memory.id, { memory: r.memory, whole: false });
  }

  const standing = useReaderSection(reader, "standing", standingOf);

  const opened = useAddressItem(
    mind.id,
    item,
    (id) => seen.current.has(id),
    asked !== null
      ? search.value !== null || search.failed !== null
      : chip === "standing" || loaded,
    openItem,
  );
  const memory = opened ? (seen.current.get(opened) ?? null) : null;
  const standingItem =
    chip === "standing" && asked === null && standingOpen !== null
      ? (standing.items?.[standingOpen] ?? null)
      : null;

  const pickChip = (next: Chip) => {
    setChip(next);
    setPages(1);
    setShown([]);
    setLoaded(false);
    setStandingOpen(null);
    setAsked(null);
    setQuery("");
  };

  const list = (
    <>
      <form
        className="luca-mnemos-search"
        onSubmit={(event) => {
          event.preventDefault();
          const words = query.trim();
          setAsked(words ? words : null);
        }}
      >
        <Search aria-hidden />
        <input
          aria-label="Search its memory"
          className="text-sm"
          data-testid="mnemos-search"
          maxLength={400}
          onChange={(event) => {
            setQuery(event.target.value);
            if (!event.target.value.trim()) setAsked(null);
          }}
          placeholder="Search its memory"
          type="search"
          value={query}
        />
      </form>
      {asked === null ? (
        <fieldset className="luca-mnemos-chips" aria-label="Which memories">
          {CHIPS.map((each) => (
            <button
              aria-pressed={chip === each.id}
              className={cn("luca-mnemos-chip text-xs")}
              data-testid={`mnemos-chip-${each.id}`}
              key={each.id}
              onClick={() => pickChip(each.id)}
              type="button"
            >
              {each.label}
            </button>
          ))}
        </fieldset>
      ) : null}
      {asked !== null ? (
        <SearchResults
          failed={search.failed !== null}
          onOpen={openItem}
          opened={opened}
          results={search.value}
          again={search.again}
        />
      ) : chip === "standing" ? (
        <StandingList
          items={standing.items}
          line={standing.line}
          onOpen={setStandingOpen}
          opened={standingOpen}
        />
      ) : failed ? (
        <PlaceLine
          action={{ label: "Try again", run: () => setN((x) => x + 1) }}
        >
          {DIDNT_ANSWER}
        </PlaceLine>
      ) : !loaded ? null : shown.length === 0 ? (
        <PlaceLine>
          {chip === "dormant"
            ? "Nothing has gone quiet."
            : "It hasn’t kept a memory yet."}
        </PlaceLine>
      ) : (
        <>
          <PlaceList testId="mnemos-memories-list">
            {shown.map((m) => (
              <PlaceListRow
                aria-current={m.id === opened ? "true" : undefined}
                data-memory={m.id}
                key={m.id}
                note={placeNoteTime(m.born)}
                onOpen={() => openItem(m.id)}
                summary={m.state === "active" ? undefined : stateWords(m.state)}
                testId={`mnemos-memory-${m.id}`}
                title={firstLine(m.content)}
              />
            ))}
          </PlaceList>
          {more ? (
            <button
              className="luca-mnemos-more text-sm"
              data-testid="mnemos-more"
              onClick={() => setPages((x) => x + 1)}
              type="button"
            >
              Show older memories
            </button>
          ) : null}
        </>
      )}
    </>
  );

  const first =
    asked !== null
      ? (search.value?.[0]?.memory.id ?? null)
      : chip === "standing"
        ? standing.items?.length
          ? "standing:0"
          : null
        : (shown[0]?.id ?? null);

  return (
    <RoomFrame
      backLabel="Memories"
      first={first}
      list={list}
      onBack={() => {
        if (standingItem) setStandingOpen(null);
        else openItem(null);
      }}
      onOpenFirst={(key) => {
        if (key === "standing:0") setStandingOpen(0);
        else openItem(key, { replace: true });
      }}
      openedKey={
        standingItem ? `standing:${standingOpen}` : memory ? opened : null
      }
      opened={
        standingItem ? (
          <article aria-label="A standing memory">
            <Words text={standingItem.text} />
            <QuietLine
              parts={[
                standingItem.at ? `Kept ${longDay(standingItem.at)}` : null,
                "standing",
              ]}
            />
          </article>
        ) : memory ? (
          <MemoryOpened mindName={mind.name} seen={memory} />
        ) : null
      }
      testId="mnemos-memories"
    />
  );
}

type Seen =
  | { memory: BookMemory; whole: true }
  | { memory: BookFound["memory"]; whole: false };

function MemoryOpened({ mindName, seen }: { mindName: string; seen: Seen }) {
  const { memory } = seen;
  return (
    <article aria-label="A memory" data-testid="mnemos-memory-opened">
      <Words text={memory.content} />
      {seen.whole && seen.memory.impact ? (
        <div className="luca-mnemos-impact">
          <p className="luca-mnemos-label text-2xs">
            What it changed, in its words
          </p>
          <p className="text-sm">{seen.memory.impact}</p>
        </div>
      ) : null}
      <QuietLine
        parts={
          seen.whole
            ? [
                `Kept ${longDay(memory.born)}`,
                stateWords(seen.memory.state),
                seen.memory.corrected
                  ? `corrected ${longDay(seen.memory.corrected)}`
                  : "never corrected",
                signedBy(seen.memory, { name: mindName }),
              ]
            : [`Kept ${longDay(memory.born)}`]
        }
        testId="mnemos-memory-line"
      />
    </article>
  );
}

function SearchResults({
  again,
  failed,
  onOpen,
  opened,
  results,
}: {
  again: () => void;
  failed: boolean;
  onOpen: (id: string) => void;
  opened: string | null;
  results: BookFound[] | null;
}) {
  if (failed)
    return (
      <PlaceLine action={{ label: "Try again", run: again }}>
        {DIDNT_ANSWER}
      </PlaceLine>
    );
  if (!results) return null;
  if (!results.length)
    return (
      <PlaceLine testId="mnemos-search-empty">
        Nothing close. Try other words, or fewer.
      </PlaceLine>
    );
  return (
    <PlaceList
      count={results.length}
      label="What it found"
      testId="mnemos-search-results"
    >
      {results.map((r) => (
        <PlaceListRow
          aria-current={r.memory.id === opened ? "true" : undefined}
          key={r.memory.id}
          note={placeNoteTime(r.memory.born)}
          onOpen={() => onOpen(r.memory.id)}
          summary={`found ${foundWords(r.found)}`}
          testId={`mnemos-found-${r.memory.id}`}
          title={firstLine(r.memory.content)}
        />
      ))}
    </PlaceList>
  );
}

function StandingList({
  items,
  line,
  onOpen,
  opened,
}: {
  items: BookStanding[] | null;
  line: string | null;
  onOpen: (index: number) => void;
  opened: number | null;
}) {
  if (line) return <PlaceLine testId="mnemos-reader-line">{line}</PlaceLine>;
  if (!items) return null;
  if (!items.length) return <PlaceLine>Nothing is standing.</PlaceLine>;
  return (
    <PlaceList testId="mnemos-standing-list">
      {items.map((each, index) => (
        <PlaceListRow
          aria-current={index === opened ? "true" : undefined}
          // biome-ignore lint/suspicious/noArrayIndexKey: the reader gives standing memories no id; the list is read once and never reordered.
          key={index}
          note={placeNoteTime(each.at)}
          onOpen={() => onOpen(index)}
          title={firstLine(each.text)}
        />
      ))}
    </PlaceList>
  );
}
