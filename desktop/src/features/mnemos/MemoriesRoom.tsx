import * as React from "react";
import { Search } from "lucide-react";

import {
  PlaceList,
  PlaceListRow,
  placeNoteTime,
} from "@/app/shell/placeRails/PlacePage";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { type BookStanding, standingOf, type WriteFailure } from "./adapt";
import type { BookFound, BookMemory, BookMemoryFacts } from "./book";
import {
  longDay,
  PlaceLine,
  QuietLine,
  RoomFrame,
  useLoad,
  Words,
} from "./MnemosParts";
import {
  afterLetGo,
  firstLine,
  foundWords,
  newestFirst,
  newestFirstPage,
  signedBy,
  stateWords,
} from "./notebook";
import { loadMinds, setRoomCounts } from "./placeStore";
import { DIDNT_ANSWER, type RoomProps, useAddressItem } from "./roomKit";
import { useReaderSection } from "./useReader";
import { draftKey, forgetDraft, readDraft } from "./drafts";
import { failureWords, WriteField } from "./WriteField";

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
 * and the memory opened whole beside the list. An opened memory can be
 * corrected in the person's words or let go (WP-47, Decided 4 and 5).
 */
export function MemoriesRoom(props: RoomProps) {
  const { book, mind, item, openItem, reader, writes } = props;
  const [chip, setChip] = React.useState<Chip>("all");
  const [query, setQuery] = React.useState("");
  const [asked, setAsked] = React.useState<string | null>(null);
  /** Pages read so far, from the newest end. */
  const pages = React.useRef(1);
  const [shown, setShown] = React.useState<BookMemory[]>([]);
  const [more, setMore] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const [n, setN] = React.useState(0);
  const [standingOpen, setStandingOpen] = React.useState<number | null>(null);
  /** Every memory shown in this room, whole from a list, or only its words
   *  and day from a search. */
  const seen = React.useRef(new Map<string, Seen>());
  /** The memory's numbers, as last read, so a let-go changes them at once. */
  const lastFacts = React.useRef<BookMemoryFacts | null>(null);
  /** Memories corrected or let go here: kept only until the address lets
   *  go of them, so the room never shows an old version again. */
  const gone = React.useRef(new Set<string>());
  React.useEffect(() => {
    for (const id of gone.current) {
      if (id === item) continue;
      seen.current.delete(id);
      gone.current.delete(id);
    }
  }, [item]);

  /** How many the list holds, as last read, for the next older page. */
  const total = React.useRef(0);
  const state = chip === "dormant" ? "dormant" : undefined;
  const take = (list: BookMemory[]) => {
    for (const m of list) seen.current.set(m.id, { memory: m, whole: true });
  };
  // The list: its numbers first, then the pages read so far from the
  // newest end (one at first; after a write, the same ones again, since a
  // write moves where each page starts).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `n` is Try again (or a write), asking once more.
  React.useEffect(() => {
    if (chip === "standing") return;
    let current = true;
    setFailed(false);
    (async () => {
      const facts = await book.facts();
      const { active, dormant } = facts.states;
      if (current) {
        lastFacts.current = facts;
        setRoomCounts(mind.id, { memories: active + dormant });
      }
      const count = chip === "dormant" ? dormant : active + dormant;
      const list: BookMemory[] = [];
      for (let page = 0; page < pages.current; page++) {
        const slice = newestFirstPage(count, page, PAGE);
        if (!slice) break;
        const got = await book.memories({ ...slice, state });
        list.push(...newestFirst(got.memories));
      }
      if (!current) return;
      total.current = count;
      take(list);
      setShown(list);
      setMore(newestFirstPage(count, pages.current, PAGE) !== null);
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
  }, [book, chip, mind.id, n]);

  // Older memories: one new page each time; the pages already read stay.
  const [moreFailed, setMoreFailed] = React.useState(false);
  const [moreBusy, setMoreBusy] = React.useState(false);
  const showOlder = async () => {
    const slice = newestFirstPage(total.current, pages.current, PAGE);
    if (!slice || moreBusy) return;
    setMoreBusy(true);
    setMoreFailed(false);
    try {
      const got = newestFirst(
        (await book.memories({ ...slice, state })).memories,
      );
      pages.current += 1;
      take(got);
      setShown((before) => {
        const have = new Set(before.map((m) => m.id));
        return [...before, ...got.filter((m) => !have.has(m.id))];
      });
      setMore(newestFirstPage(total.current, pages.current, PAGE) !== null);
    } catch {
      setMoreFailed(true);
    } finally {
      setMoreBusy(false);
    }
  };

  const search = useLoad(
    () => (asked ? book.search(asked) : Promise.resolve(null)),
    [book, asked],
  );
  for (const r of search.value ?? []) {
    if (!seen.current.has(r.memory.id))
      seen.current.set(r.memory.id, { memory: r.memory, whole: false });
  }

  // While a search is out, nothing is opened beside it: no memory, no
  // acts, until its results come and the first of them opens.
  const searching =
    asked !== null && search.value === null && search.failed === null;
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
  const memory =
    opened && !searching ? (seen.current.get(opened) ?? null) : null;
  const standingItem =
    chip === "standing" && asked === null && standingOpen !== null
      ? (standing.items?.[standingOpen] ?? null)
      : null;

  const pickChip = (next: Chip) => {
    setChip(next);
    pages.current = 1;
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
          if (words && words !== asked && item !== null)
            openItem(null, { replace: true });
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
        {/* The first search by meaning waits for the model to load. */}
        <span
          aria-live="polite"
          className="luca-mnemos-searching text-xs"
          data-testid="mnemos-searching"
        >
          {searching ? "Searching…" : ""}
        </span>
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
      {searching ? (
        <PlaceLine testId="mnemos-search-working">Searching…</PlaceLine>
      ) : asked !== null ? (
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
          {moreFailed ? (
            <PlaceLine
              action={{ label: "Try again", run: () => void showOlder() }}
            >
              {DIDNT_ANSWER}
            </PlaceLine>
          ) : more ? (
            <button
              aria-busy={moreBusy || undefined}
              className="luca-mnemos-more text-sm"
              data-testid="mnemos-more"
              disabled={moreBusy}
              onClick={() => void showOlder()}
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
      addressed={item}
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
          <MemoryOpened
            draft={draftKey(mind.id, `correct:${memory.memory.id}`)}
            key={memory.memory.id}
            mindName={mind.name}
            onCorrect={async (text) => {
              const was = memory.memory;
              const done = await writes.correct(was.id, text);
              // The new version, until the list reads it back.
              seen.current.set(done.id, {
                memory: {
                  ...(memory.whole ? memory.memory : wholeOf(was)),
                  id: done.id,
                  content: text,
                  author: "person",
                  corrected: done.corrected ?? new Date().toISOString(),
                },
                whole: true,
              });
              gone.current.add(was.id);
              openItem(done.id, { replace: true });
              setN((x) => x + 1);
              void loadMinds(true);
            }}
            onLetGo={async () => {
              const was = memory.memory;
              await writes.forget(was.id);
              gone.current.add(was.id);
              const facts = lastFacts.current;
              if (facts) {
                const next = afterLetGo(
                  facts,
                  memory.whole ? memory.memory.state : "active",
                );
                lastFacts.current = next;
                setRoomCounts(mind.id, {
                  memories: next.states.active + next.states.dormant,
                });
              }
              setShown((list) => list.filter((m) => m.id !== was.id));
              openItem(null, { replace: true });
              setN((x) => x + 1);
              if (asked !== null) search.again();
              void loadMinds(true);
            }}
            seen={memory}
          />
        ) : null
      }
      testId="mnemos-memories"
    />
  );
}

type Seen =
  | { memory: BookMemory; whole: true }
  | { memory: BookFound["memory"]; whole: false };

/** A search result's memory, filled out only with what a search gives. */
const wholeOf = (m: BookFound["memory"]): BookMemory => ({
  ...m,
  impact: "",
  state: "active",
  author: "unknown",
  acc: 1,
});

function MemoryOpened({
  draft,
  mindName,
  onCorrect,
  onLetGo,
  seen,
}: {
  /** Where an unsent correction is kept: one left here opens again. */
  draft: string;
  mindName: string;
  onCorrect: (text: string) => Promise<void>;
  onLetGo: () => Promise<void>;
  seen: Seen;
}) {
  const { memory } = seen;
  const [mode, setMode] = React.useState<"read" | "correct" | "asking">(() =>
    readDraft(draft) === undefined ? "read" : "correct",
  );
  const back = React.useRef<"correct" | "letgo" | null>(null);
  const correctButton = React.useRef<HTMLButtonElement>(null);
  const letGoButton = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    // Leaving the field or the question, focus goes back to what opened it.
    if (mode !== "read" || !back.current) return;
    (back.current === "correct" ? correctButton : letGoButton).current?.focus();
    back.current = null;
  }, [mode]);
  const leave = (from: "correct" | "letgo") => {
    back.current = from;
    setMode("read");
  };

  return (
    <article aria-label="A memory" data-testid="mnemos-memory-opened">
      {mode === "correct" ? (
        <WriteField
          autoFocus
          cancelLabel="Cancel"
          draft={draft}
          failLine="It couldn’t be changed. Your words are still here."
          hint={`Its own words stay in its history. ${mindName} wakes knowing you corrected it, once.`}
          initial={memory.content}
          label="Correct it, in your words"
          layout="stacked"
          needsChange
          onCancel={() => {
            forgetDraft(draft);
            leave("correct");
          }}
          onSend={onCorrect}
          sendLabel="Save correction"
          sendingLabel="Saving…"
          testId="mnemos-correct"
        />
      ) : (
        <Words text={memory.content} />
      )}
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
      {mode === "asking" ? (
        <LetGoAsk
          mindName={mindName}
          onKeep={() => leave("letgo")}
          onLetGo={onLetGo}
        />
      ) : mode === "read" &&
        !(seen.whole && seen.memory.state === "archived") ? (
        <div className="luca-mnemos-acts">
          <Button
            data-testid="mnemos-correct-open"
            onClick={() => setMode("correct")}
            ref={correctButton}
            size="quiet"
            type="button"
            variant="quiet"
          >
            Correct it
          </Button>
          <Button
            data-testid="mnemos-let-go-open"
            onClick={() => setMode("asking")}
            ref={letGoButton}
            size="quiet"
            type="button"
            variant="quiet"
          >
            Let it go
          </Button>
        </div>
      ) : null}
    </article>
  );
}

/** Let it go asks first, in the notebook's own words, before anything is
 *  sent; Keep it, or Escape, leaves it as it was. */
function LetGoAsk({
  mindName,
  onKeep,
  onLetGo,
}: {
  mindName: string;
  onKeep: () => void;
  onLetGo: () => Promise<void>;
}) {
  const id = React.useId();
  const [sending, setSending] = React.useState(false);
  const [failure, setFailure] = React.useState<WriteFailure | null>(null);
  const inFlight = React.useRef(false);
  const mounted = React.useRef(true);
  const keep = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    keep.current?.focus();
    return () => {
      mounted.current = false;
    };
  }, []);
  const yes = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setFailure(null);
    try {
      await onLetGo();
    } catch (error) {
      if (mounted.current)
        setFailure(
          typeof error === "object" && error !== null && "kind" in error
            ? (error as WriteFailure)
            : { kind: "failed", code: String(error) },
        );
    } finally {
      inFlight.current = false;
      if (mounted.current) setSending(false);
    }
  };
  const said = failure
    ? failureWords(failure, "It couldn’t be changed.")
    : null;
  return (
    <div
      aria-describedby={`${id}-d`}
      aria-labelledby={`${id}-h`}
      className="luca-mnemos-ask"
      data-testid="mnemos-let-go-ask"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !sending) {
          event.stopPropagation();
          onKeep();
        }
      }}
      role="alertdialog"
    >
      <h3 className="luca-mnemos-ask-title text-sm" id={`${id}-h`}>
        Let this memory go?
      </h3>
      <p className="luca-mnemos-ask-text text-sm" id={`${id}-d`}>
        It won't come back by its words, its meaning or its id. It's kept in the
        archive, not deleted, and {mindName} will know, once, that you let a
        memory go, though not what it said.
      </p>
      {said ? (
        <p
          className="luca-mnemos-write-said text-sm"
          data-testid="mnemos-let-go-said"
          role="status"
        >
          {said.line}
        </p>
      ) : null}
      <div className="luca-mnemos-ask-foot">
        <Button
          data-testid="mnemos-let-go-keep"
          disabled={sending}
          onClick={onKeep}
          ref={keep}
          size="quiet"
          type="button"
          variant="quiet"
        >
          Keep it
        </Button>
        <Button
          data-testid="mnemos-let-go-yes"
          disabled={sending}
          onClick={() => void yes()}
          size="quiet"
          type="button"
          variant="destructive"
        >
          {sending ? "Letting go…" : "Let it go"}
        </Button>
      </div>
    </div>
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
