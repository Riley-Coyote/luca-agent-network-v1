import * as React from "react";

import "./mnemos-mind.css";
import { Button } from "@/shared/ui/button";
import { mnemosPlace } from "../api";
import type { BookMemory } from "../book";
import { longDay, NeedsNewer, QuietLine, Words } from "../MnemosParts";
import { signedBy, stateWords } from "../notebook";
import { plural } from "../notebookWords";
import { type NotebookView, type RoomProps, useAddressItem } from "../roomKit";
import type { FeedHoldings } from "./mindFeed";
import { lightOf, MindFrame, type MindState } from "./mindFrame";
import { MemoryDrawing } from "./MemoryDrawing";

/** The line when the mind can't be drawn here (Decided 6). */
export const CANNOT_DRAW = "This Mac can’t draw the mind just now.";

/**
 * The mind (WP-50): Mnemos's own picture of a mind, every memory a cell and
 * every link a fibre, drawn by its own engine in a frame of the app's own
 * files and fed only from what the place has read. A memory pressed opens
 * beside it, quietly, and the address keeps it.
 */
export function MindRoom(props: RoomProps) {
  if (!props.notebook) return <NeedsNewer what="The mind" />;
  return <Mind {...props} notebook={props.notebook} />;
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

/** The app's look, as a key that changes when its dark and light do. */
function useLookKey() {
  return React.useSyncExternalStore(
    (listener) => {
      const observer = new MutationObserver(listener);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class", "data-theme", "data-buzz-theme", "style"],
      });
      const media = matchMedia("(prefers-color-scheme: dark)");
      media.addEventListener("change", listener);
      return () => {
        observer.disconnect();
        media.removeEventListener("change", listener);
      };
    },
    () =>
      `${document.documentElement.className}|${document.documentElement.dataset.buzzTheme ?? ""}|${matchMedia("(prefers-color-scheme: dark)").matches}`,
    () => "",
  );
}

function Mind({
  goTo,
  item,
  mind,
  notebook,
  openItem,
}: RoomProps & { notebook: NotebookView }) {
  const host = React.useRef<HTMLDivElement>(null);
  const panel = React.useRef<HTMLElement>(null);
  const frame = React.useRef<MindFrame | null>(null);
  const [state, setState] = React.useState<MindState>({ kind: "drawing" });
  const memories = notebook.memories.memories;
  const byId = React.useMemo(
    () => new Map(memories.map((m) => [m.id, m])),
    [memories],
  );
  const picked = useAddressItem(
    mind.id,
    item,
    (id) => byId.has(id),
    true,
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
  const look = useLookKey();

  // One frame for as long as the section is shown, made again when the
  // app's look changes (its light is given when it starts).
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new look asks for a new frame; the rest is read through refs.
  React.useEffect(() => {
    const el = host.current;
    if (!el) return;
    setState({ kind: "drawing" });
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
    });
    frame.current = made;
    return () => {
      made.destroy();
      if (frame.current === made) frame.current = null;
    };
  }, [mind.id, look]);

  React.useEffect(() => {
    if (state.kind === "cannot") frame.current?.destroy();
  }, [state.kind]);

  React.useEffect(() => {
    frame.current?.show(picked);
    if (picked && pickedBy.current === "press") panel.current?.focus();
    pickedBy.current = null;
  }, [picked]);
  React.useEffect(() => {
    if (state.kind === "drawn") frame.current?.show(picked);
  }, [state.kind, picked]);

  const memory = picked ? (byId.get(picked) ?? null) : null;
  const count =
    state.kind === "drawn"
      ? state.counts
      : state.kind === "drawing"
        ? `Drawing ${plural(memories.length, "memory", "memories")}…`
        : "";
  return (
    <section
      aria-label="The mind"
      className="luca-mnemos-mind"
      data-state={state.kind}
      data-testid="mnemos-mind"
    >
      <header className="luca-mnemos-mind-head">
        <h2 className="luca-mnemos-mind-title text-base">The mind</h2>
        <p
          aria-live="polite"
          className="luca-mnemos-mind-count text-xs"
          data-testid="mnemos-mind-count"
        >
          {count}
        </p>
      </header>
      <div className="luca-mnemos-mind-stage">
        <div className="luca-mnemos-mind-host" ref={host} />
        {state.kind === "cannot" ? (
          <p
            className="luca-mnemos-mind-cannot text-sm"
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
 *  quiet line, and the place's two quiet ways on. */
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
      className="luca-mnemos-mind-picked"
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
      <div className="luca-mnemos-acts">
        <Button
          data-testid="mnemos-mind-open-it"
          onClick={onOpen}
          size="quiet"
          type="button"
          variant="quiet"
        >
          Open it
        </Button>
        <Button
          data-testid="mnemos-mind-whole"
          onClick={onWhole}
          size="quiet"
          type="button"
          variant="quiet"
        >
          The whole mind
        </Button>
      </div>
    </aside>
  );
});
