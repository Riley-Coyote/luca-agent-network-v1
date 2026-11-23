import * as React from "react";

import "./mnemos-board.css";

import {
  PlaceList,
  PlaceListRow,
  placeNoteTime,
} from "@/app/shell/placeRails/PlacePage";
import { Button } from "@/shared/ui/button";
import type { WriteFailure } from "./adapt";
import type { BookSharedRow } from "./book";
import { sendShared } from "./boardWrites";
import { draftKey, mindWordsDraftKey, readDraft } from "./drafts";
import {
  longDay,
  NeedsNewer,
  PlaceLine,
  QuietLine,
  RoomFrame,
  Words,
} from "./MnemosParts";
import { firstLine, modelName } from "./notebook";
import { type RoomProps, useAddressItem } from "./roomKit";
import { confirmOnce } from "./settingsHours";
import { failureWords, WriteField } from "./WriteField";

/** The shared notebook's own words (Mnemos `shared/words.js` `SHARED`). */
const SHARED = {
  hint: "Every agent on this machine can read these words. They’re signed as you.",
  empty:
    "Nothing has been shared yet. Shared memory holds words every agent on this machine can read.",
  off: "Shared memory is off.",
  error: "Shared memory couldn’t be read just now.",
  add: "Add",
  adding: "Adding…",
  placeholder: "Write something to share",
  correction: "Your earlier words stay in the archive.",
  withdraw:
    "It won’t come back by its words, its meaning or its id. It’s kept in the archive, never deleted.",
  failed: "Shared memory couldn’t be changed just now.",
};

/** The first line of what the shared notebook said back. */
const saidLine = (said: string) => said.split("\n")[0]?.trim() ?? "";

/** Who wrote a row, as the shared notebook says it. */
const writer = (row: BookSharedRow) =>
  [row.person ? "You" : row.author, row.model ? modelName(row.model) : null]
    .filter(Boolean)
    .join(" · ");

/**
 * Shared (WP-49, Decided 8): the one notebook every mind on this Mac reads.
 * Its first row adds to it, its field on the right, as "Leave a note" does;
 * then the rows, newest first, each opened with who wrote it. A row the
 * notebook marks editable can be corrected, and let go, asked twice.
 */
export function SharedRoom(props: RoomProps) {
  const { item, mind, notebook, openItem } = props;
  const shared = notebook?.life.shared ?? null;
  const rows = React.useMemo(
    () =>
      [...(shared?.rows ?? [])].sort(
        (a, b) =>
          (b.born ? Date.parse(b.born) : 0) - (a.born ? Date.parse(a.born) : 0),
      ),
    [shared],
  );
  const opened = useAddressItem(
    mind.id,
    item,
    (id) => rows.some((r) => r.id === id),
    shared !== null,
    openItem,
  );
  const row = rows.find((r) => r.id === opened) ?? null;
  const [adding, setAdding] = React.useState(false);
  const [said, setSaid] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (item !== null) setAdding(false);
  }, [item]);
  if (!notebook || !shared) return <NeedsNewer what="Shared" />;
  if (shared.status !== "ready")
    return (
      <PlaceLine testId="mnemos-shared-not-ready">
        {shared.status === "off" ? SHARED.off : SHARED.error}
      </PlaceLine>
    );
  const add = () => {
    setAdding(true);
    setSaid(null);
    if (item !== null) openItem(null, { replace: true });
  };

  return (
    <div className="luca-mnemos-shared" data-testid="mnemos-shared-section">
      <p
        className="luca-mnemos-quiet luca-mnemos-section-line text-sm"
        data-testid="mnemos-shared-line"
      >
        {SHARED.hint}
      </p>
      <RoomFrame
        addressed={item}
        backLabel="Shared"
        first={rows[0]?.id ?? null}
        list={
          <>
            <PlaceList testId="mnemos-shared-add-list">
              <PlaceListRow
                aria-current={adding ? "true" : undefined}
                onOpen={add}
                summary={
                  readDraft(draftKey(mind.id, "shared:add"))
                    ? "Your words aren’t added yet."
                    : SHARED.placeholder
                }
                testId="mnemos-shared-add-row"
                title="Add to the shared notebook"
              />
            </PlaceList>
            {rows.length ? (
              <PlaceList testId="mnemos-shared-list">
                {rows.map((r) => (
                  <PlaceListRow
                    aria-current={r.id === opened ? "true" : undefined}
                    key={r.id}
                    note={placeNoteTime(r.born)}
                    onOpen={() => {
                      setSaid(null);
                      openItem(r.id);
                    }}
                    summary={writer(r)}
                    testId={`mnemos-shared-row-${r.id}`}
                    title={firstLine(r.content)}
                  />
                ))}
              </PlaceList>
            ) : (
              <PlaceLine>{SHARED.empty}</PlaceLine>
            )}
          </>
        }
        onBack={() => (adding ? setAdding(false) : openItem(null))}
        onOpenFirst={(id) => openItem(id, { replace: true })}
        opened={
          adding ? (
            <article
              aria-label="Add to the shared notebook"
              data-testid="mnemos-shared-add-opened"
            >
              <h2 className="luca-mnemos-title text-base">
                Add to the shared notebook
              </h2>
              <p className="luca-mnemos-quiet text-sm">{SHARED.hint}</p>
              {said ? <Said said={said} /> : null}
              <WriteField
                draft={draftKey(mind.id, "shared:add")}
                failLine={SHARED.failed}
                hideLabel
                label={SHARED.placeholder}
                onSend={async (text) => {
                  setSaid(
                    saidLine(
                      await sendShared(mind.id, {
                        command: "shared",
                        action: "add",
                        text,
                      }),
                    ),
                  );
                }}
                sendLabel={SHARED.add}
                sendingLabel={SHARED.adding}
                testId="mnemos-shared-add"
              />
            </article>
          ) : row ? (
            <>
              {/* A row let go: its words stay said above the row that
                  opens in its place, until the person opens another. */}
              {said ? <Said said={said} /> : null}
              <RowOpened
                key={row.id}
                mind={mind.id}
                onGone={(words) => {
                  setSaid(words);
                  openItem(null, { replace: true });
                }}
                row={row}
              />
            </>
          ) : said ? (
            <Said said={said} />
          ) : null
        }
        openedKey={adding ? "add" : row ? row.id : null}
        testId="mnemos-shared"
      />
    </div>
  );
}

function Said({ said }: { said: string }) {
  return (
    <p
      className="luca-mnemos-said text-sm"
      data-testid="mnemos-shared-said"
      role="status"
    >
      {said}
    </p>
  );
}

function RowOpened({
  mind,
  onGone,
  row,
}: {
  mind: string;
  onGone: (said: string) => void;
  row: BookSharedRow;
}) {
  const [mode, setMode] = React.useState<"read" | "correct" | "let-go">("read");
  const [said, setSaid] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState<string | null>(null);
  const [sending, setSending] = React.useState(false);
  const [confirm] = React.useState(() =>
    confirmOnce((memoryId: string) =>
      sendShared(mind, {
        command: "shared",
        action: "forget",
        memory_id: memoryId,
        confirmed: true,
      }),
    ),
  );
  const keepRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (mode === "let-go") keepRef.current?.focus();
  }, [mode]);
  const letGo = async () => {
    setSending(true);
    setFailed(null);
    try {
      const sent = await confirm.yes();
      if (sent.sent) onGone(saidLine(sent.said));
    } catch (error) {
      setFailed(failureWords(error as WriteFailure, SHARED.failed).line);
      // Still asked: the person may say yes again, or keep it.
      confirm.ask(row.id);
    } finally {
      setSending(false);
    }
  };
  return (
    <article aria-label="A shared memory" data-testid="mnemos-shared-opened">
      {mode === "correct" ? (
        <WriteField
          cancelLabel="Cancel"
          draft={mindWordsDraftKey(mind, `shared:correct:${row.id}`)}
          failLine={SHARED.failed}
          hint={SHARED.correction}
          initial={row.content}
          label="Correct it, in your words"
          layout="stacked"
          needsChange
          onCancel={() => setMode("read")}
          onSend={async (text) => {
            const words = await sendShared(mind, {
              command: "shared",
              action: "correct",
              memory_id: row.id,
              text,
            });
            setSaid(saidLine(words));
            setMode("read");
          }}
          sendLabel="Save correction"
          sendingLabel="Saving…"
          testId="mnemos-shared-correct"
        />
      ) : (
        <Words text={row.content} />
      )}
      <QuietLine
        parts={[row.born ? `Kept ${longDay(row.born)}` : null, writer(row)]}
        testId="mnemos-shared-who"
      />
      {said ? <Said said={said} /> : null}
      {row.editable && mode === "read" ? (
        <div className="luca-mnemos-acts">
          <Button
            data-testid="mnemos-shared-correct-open"
            onClick={() => {
              setSaid(null);
              setMode("correct");
            }}
            size="quiet"
            type="button"
            variant="quiet"
          >
            Correct it
          </Button>
          <Button
            data-testid="mnemos-shared-let-go"
            onClick={() => {
              setSaid(null);
              confirm.ask(row.id);
              setMode("let-go");
            }}
            size="quiet"
            type="button"
            variant="quiet"
          >
            Let it go
          </Button>
        </div>
      ) : null}
      {mode === "let-go" ? (
        <div
          aria-labelledby="mnemos-shared-ask-title"
          className="luca-mnemos-ask"
          data-testid="mnemos-shared-ask"
          role="alertdialog"
        >
          <p
            className="luca-mnemos-ask-title text-sm"
            id="mnemos-shared-ask-title"
          >
            Let this memory go?
          </p>
          <p className="luca-mnemos-ask-text text-sm">{SHARED.withdraw}</p>
          {failed ? (
            <p className="text-sm" role="status">
              {failed}
            </p>
          ) : null}
          <div className="luca-mnemos-ask-foot">
            <Button
              data-testid="mnemos-shared-keep"
              disabled={sending}
              onClick={() => {
                confirm.no();
                setMode("read");
              }}
              ref={keepRef}
              size="quiet"
              type="button"
              variant="quiet"
            >
              Keep it
            </Button>
            <Button
              data-testid="mnemos-shared-let-go-yes"
              disabled={sending}
              onClick={() => void letGo()}
              size="quiet"
              type="button"
            >
              {sending ? "Letting go…" : "Let it go"}
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
