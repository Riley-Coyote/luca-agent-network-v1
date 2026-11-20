import * as React from "react";

import "./mnemos-mind.css";
import { mnemosPlace } from "../api";
import type { BookMemory } from "../book";
import { longDay, NeedsNewer, QuietLine, Words } from "../MnemosParts";
import { signedBy, stateWords } from "../notebook";
import { type NotebookView, type RoomProps, useAddressItem } from "../roomKit";
import { type FeedHoldings, nothingToDraw } from "./mindFeed";
import { firstLine } from "./drawingShape";
import { lightOf, MindFrame, type MindState } from "./mindFrame";
import { MemoryDrawing } from "./MemoryDrawing";

/** The line when the mind can't be drawn here (Decided 6). */
export const CANNOT_DRAW = "This Mac can’t draw the mind just now.";

/** The line while its first picture is being made. */
export const DRAWING = "Drawing the mind…";

export type MindRoomProps = RoomProps & {
  /** Whether The mind is the section shown (by default it is). The room can
   *  stay mounted while another section is: not shown, its picture pauses
   *  (`MindFrame.setShown`), and it goes only when the room unmounts. */
  shown?: boolean;
};

/**
 * The mind (WP-50): Mnemos's own picture of a mind, every memory a cell and
 * every link a fibre, drawn by its own engine in a frame of the app's own
 * files and fed only from what the place has read. A memory pressed opens
 * beside it, quietly, and the address keeps it.
 */
export function MindRoom({ shown = true, ...props }: MindRoomProps) {
  if (!props.notebook) return shown ? <NeedsNewer what="The mind" /> : null;
  const empty = nothingToDraw(props.notebook);
  if (empty)
    return shown ? <NothingToDraw line={empty(props.mind.name)} /> : null;
  return <Mind {...props} notebook={props.notebook} shown={shown} />;
}

/** An empty mind: nothing to draw, said where the picture would be, in
 *  the picture's own quiet line (not the line for a Mac that can't). */
function NothingToDraw({ line }: { line: string }) {
  return (
    <section
      aria-label="The mind"
      className="luca-mnemos-mind"
      data-state="empty"
      data-testid="mnemos-mind"
    >
      <p className="luca-mnemos-mind-line text-xs" />
      <div className="luca-mnemos-mind-stage">
        <p
          className="luca-mnemos-mind-note text-sm"
          data-testid="mnemos-mind-empty"
        >
          {line}
        </p>
      </div>
    </section>
  );
}

/** What the mind's frame asks of the session: what came to it since a
 *  moment, at the page's own pace. */
function usePulse(mind: string, notebook: NotebookView) {
  const gives = notebook.hello.parts.includes("pulse");
  return React.useCallback(
    async (since: string | null) => {
      if (!gives) return { now: new Date().toISOString(), events: [] };
      try {
        const reply = await mnemosPlace.read(mind, {
          command: "notebook",
          part: "pulse",
          ...(since ? { since } : {}),
        });
        return reply.kind === "notebook" && reply.part === "pulse"
          ? reply.document
          : null;
      } catch {
        return null;
      }
    },
    [gives, mind],
  );
}

/** What the mind's page reads once, as it starts: the app's dark and
 *  light, and whether motion is to be reduced (the engine's own still way,
 *  `mind.js` `reduce`). A key that changes when any of them does, so a
 *  room kept mounted makes its frame again rather than keep a picture
 *  that moves when it shouldn't. */
const STARTS_WITH = [
  "(prefers-color-scheme: dark)",
  "(prefers-reduced-motion: reduce)",
];

function useLookKey() {
  return React.useSyncExternalStore(
    (listener) => {
      const observer = new MutationObserver(listener);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class", "data-theme", "data-buzz-theme", "style"],
      });
      const media = STARTS_WITH.map((query) => matchMedia(query));
      for (const each of media) each.addEventListener("change", listener);
      return () => {
        observer.disconnect();
        for (const each of media) each.removeEventListener("change", listener);
      };
    },
    () =>
      [
        document.documentElement.className,
        document.documentElement.dataset.buzzTheme ?? "",
        ...STARTS_WITH.map((query) => matchMedia(query).matches),
      ].join("|"),
    () => "",
  );
}

function Mind({
  goTo,
  item,
  mind,
  notebook,
  openItem,
  shown,
}: RoomProps & { notebook: NotebookView; shown: boolean }) {
  const host = React.useRef<HTMLDivElement>(null);
  const panel = React.useRef<HTMLElement>(null);
  const frame = React.useRef<MindFrame | null>(null);
  const [state, setState] = React.useState<MindState>({ kind: "drawing" });
  const [hovered, setHovered] = React.useState<string | null>(null);
  const memories = notebook.memories.memories;
  const byId = React.useMemo(
    () => new Map(memories.map((m) => [m.id, m])),
    [memories],
  );
  // Not shown, the address is another section's: the mind neither reads
  // nor lets go of its item.
  const picked = useAddressItem(
    mind.id,
    shown ? item : null,
    (id) => byId.has(id),
    shown,
    openItem,
  );
  const pulse = usePulse(mind.id, notebook);
  // Read afresh at every request: the frame sees the place's reading as it
  // is now (and, once it has gone, nothing: `MindFrame.destroy`).
  const holdings = React.useRef<FeedHoldings | null>(null);
  holdings.current = {
    life: notebook.life,
    memories: notebook.memories,
    pulse,
  };
  const ids = React.useRef<readonly string[]>([]);
  ids.current = React.useMemo(() => memories.map((m) => m.id), [memories]);
  const pickedBy = React.useRef<"press" | null>(null);
  const handlers = React.useRef({ openItem });
  handlers.current = { openItem };
  const shownNow = React.useRef(shown);
  shownNow.current = shown;
  // The app's look, as the picture was last shown in it: a change while
  // it isn't shown waits until it is.
  const look = useLookKey();
  const [lookShown, setLookShown] = React.useState(look);
  React.useEffect(() => {
    if (shown) setLookShown(look);
  }, [look, shown]);

  // One frame for as long as the room is mounted, made again when the
  // app's look or its reduced motion changes (both are read as it starts).
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new look asks for a new frame; the rest is read through refs.
  React.useEffect(() => {
    const el = host.current;
    if (!el) return;
    setState({ kind: "drawing" });
    setHovered(null);
    const made = new MindFrame(el, {
      holdings: () => holdings.current,
      light: lightOf(el),
      ids: () => ids.current,
      onState: setState,
      onPick: (id) => {
        pickedBy.current = "press";
        handlers.current.openItem(id);
      },
      onLetGo: () => handlers.current.openItem(null),
      onHover: setHovered,
      shown: shownNow.current,
    });
    frame.current = made;
    return () => {
      made.destroy();
      if (frame.current === made) frame.current = null;
    };
  }, [mind.id, lookShown]);

  React.useEffect(() => {
    frame.current?.setShown(shown);
    if (!shown) setHovered(null);
  }, [shown]);

  React.useEffect(() => {
    if (state.kind === "cannot") frame.current?.destroy();
  }, [state.kind]);

  React.useEffect(() => {
    if (!shown) return;
    frame.current?.show(picked);
    if (picked && pickedBy.current === "press") panel.current?.focus();
    pickedBy.current = null;
  }, [picked, shown]);
  React.useEffect(() => {
    if (shown && state.kind === "drawn") frame.current?.show(picked);
  }, [state.kind, picked, shown]);

  const memory = picked ? (byId.get(picked) ?? null) : null;
  const named = hovered ? byId.get(hovered) : undefined;
  const line = named
    ? firstLine(named.content)
    : state.kind === "drawn"
      ? state.counts
      : "";
  return (
    <section
      aria-hidden={shown ? undefined : true}
      aria-label="The mind"
      className="luca-mnemos-mind"
      data-shown={String(shown)}
      data-state={state.kind}
      data-testid="mnemos-mind"
      inert={!shown}
    >
      <p
        className="luca-mnemos-mind-line text-xs"
        data-named={named ? "" : undefined}
        data-testid="mnemos-mind-count"
      >
        {line}
      </p>
      <div className="luca-mnemos-mind-stage">
        <div className="luca-mnemos-mind-host" ref={host} />
        {state.kind === "drawing" ? (
          <p
            className="luca-mnemos-mind-note text-sm"
            data-testid="mnemos-mind-drawing"
            role="status"
          >
            {DRAWING}
          </p>
        ) : null}
        {state.kind === "cannot" ? (
          <p
            className="luca-mnemos-mind-note text-sm"
            data-testid="mnemos-mind-cannot"
          >
            {CANNOT_DRAW} Everything in it is in the{" "}
            <button
              className="luca-mnemos-link"
              data-testid="mnemos-mind-to-log"
              onClick={() => goTo("log")}
              type="button"
            >
              Log
            </button>
            .
          </p>
        ) : null}
        {memory && state.kind !== "cannot" ? (
          <PickedMemory
            memory={memory}
            mindName={mind.name}
            onOpen={() => goTo("memories", memory.id)}
            onWhole={() => openItem(null)}
            ref={panel}
          />
        ) : null}
      </div>
    </section>
  );
}

/** The memory picked in the mind (Decided 4): its drawing, its words, its
 *  quiet line, and the place's two quiet ways on, on the place's plate. */
const PickedMemory = React.forwardRef<
  HTMLElement,
  {
    memory: BookMemory;
    mindName: string;
    onOpen: () => void;
    onWhole: () => void;
  }
>(function PickedMemory({ memory, mindName, onOpen, onWhole }, ref) {
  return (
    <aside
      aria-label="The memory picked in the mind"
      className="luca-mnemos-plate luca-mnemos-mind-picked"
      data-testid="mnemos-mind-picked"
      ref={ref}
      tabIndex={-1}
    >
      <div className="luca-mnemos-mind-drawing">
        <MemoryDrawing memory={memory} />
      </div>
      <Words className="luca-mnemos-mind-words text-sm" text={memory.content} />
      <QuietLine
        parts={[
          `Kept ${longDay(memory.born)}`,
          stateWords(memory.state),
          signedBy(memory, { name: mindName }),
        ]}
        testId="mnemos-mind-picked-line"
      />
      <p className="luca-mnemos-mind-ways text-sm">
        <button
          className="luca-mnemos-link"
          data-testid="mnemos-mind-open-it"
          onClick={onOpen}
          type="button"
        >
          Open it
        </button>
        <button
          className="luca-mnemos-link"
          data-testid="mnemos-mind-whole"
          onClick={onWhole}
          type="button"
        >
          The whole mind
        </button>
      </p>
    </aside>
  );
});
