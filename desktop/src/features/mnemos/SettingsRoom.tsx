import * as React from "react";

import "./mnemos-board.css";

import { PlaceList, PlaceListRow } from "@/app/shell/placeRails/PlacePage";
import { Button } from "@/shared/ui/button";
import { Switch } from "@/shared/ui/switch";
import type { WriteFailure } from "./adapt";
import { scheduleOf } from "./boardWords";
import { openOwnPage, sendHours } from "./boardWrites";
import { NeedsNewer } from "./MnemosParts";
import { modelName } from "./notebook";
import type { NotebookView, RoomProps } from "./roomKit";
import {
  changeSentence,
  confirmOnce,
  type HoursSetting,
  type HourTimes,
  hoursWrite,
  sameHours,
  savedHours,
} from "./settingsHours";
import { failureWords } from "./WriteField";

/**
 * Settings (WP-49, Decided 5): three quiet groups. The quiet hours, the one
 * setting that's the person's: nothing is sent as they change it; the
 * change is said back first, and their yes sends one request. Jev, shown
 * only: there is no key field here. And about this memory.
 */
export function SettingsRoom({ mind, notebook }: RoomProps) {
  if (!notebook) return <NeedsNewer what="Settings" />;
  return (
    <div className="luca-mnemos-settings" data-testid="mnemos-settings">
      <QuietHours mind={mind.id} notebook={notebook} />
      <Jev mind={mind.id} notebook={notebook} />
      <About notebook={notebook} />
    </div>
  );
}

const ROWS: { kind: keyof HourTimes; label: string; what: string }[] = [
  { kind: "mine", label: "Its own hour", what: "An hour to itself" },
  { kind: "ours", label: "Our hour", what: "Half an hour for the day’s work" },
  { kind: "dream", label: "The dream", what: "A short time each night" },
];

/** What the last send came to: Mnemos's own words, as given. */
type Outcome =
  | { kind: "said"; said: string }
  | { kind: "refused"; said: string }
  | { kind: "failed"; line: string };

function QuietHours({
  mind,
  notebook,
}: {
  mind: string;
  notebook: NotebookView;
}) {
  const { life } = notebook;
  const plan = scheduleOf(life.schedule);
  const saved = savedHours(plan);
  const [edit, setEdit] = React.useState<HoursSetting | null>(null);
  const [asking, setAsking] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [outcome, setOutcome] = React.useState<Outcome | null>(null);
  const [confirm] = React.useState(() => ({
    current: confirmOnce((write: ReturnType<typeof hoursWrite>) =>
      sendHours(mind, write),
    ),
  }));
  // The ask takes focus when it appears, so the keyboard answers it.
  const yesRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (asking) yesRef.current?.focus();
  }, [asking]);
  const shown = edit ?? saved;
  const changed = !sameHours(shown, saved);
  const notLoaded = plan.filter((p) => !p.loaded).length;
  const name = life.identity.name || "it";
  const person = life.identity.person;
  const ask = changeSentence(name, saved, shown);
  const change = (next: HoursSetting) => {
    setEdit(next);
    setAsking(false);
    confirm.current.no();
  };

  const yes = async () => {
    setSending(true);
    setOutcome(null);
    try {
      const sent = await confirm.current.yes();
      if (sent.sent) {
        setOutcome({ kind: "said", said: sent.said });
        setEdit(null);
      }
    } catch (error) {
      const failure = error as WriteFailure;
      setOutcome(
        failure.kind === "said"
          ? { kind: "refused", said: failure.said }
          : {
              kind: "failed",
              line: failureWords(
                failure,
                "The quiet hours couldn’t be changed just now.",
              ).line,
            },
      );
    } finally {
      setSending(false);
      setAsking(false);
    }
  };

  return (
    <section
      aria-label="Quiet hours"
      className="luca-mnemos-settings-group"
      data-testid="mnemos-settings-hours"
    >
      <PlaceList label="Quiet hours">
        <PlaceListRow
          detail={
            <Switch
              aria-label="Quiet hours"
              checked={shown.on}
              data-testid="mnemos-hours-switch"
              disabled={sending}
              onCheckedChange={(on) => change({ ...shown, on })}
            />
          }
          summary={`Time between conversations that’s ${name}’s own. They run Claude on its own and use ${person ? `${person}’s` : "your"} Claude plan.`}
          testId="mnemos-hours-on"
          title={shown.on ? "On" : "Off"}
        />
        {ROWS.map((row) => (
          <PlaceListRow
            detail={
              <input
                aria-label={`${row.label}, starts at`}
                className="luca-mnemos-time text-sm tabular-nums"
                data-testid={`mnemos-hours-${row.kind}`}
                disabled={!shown.on || sending}
                onChange={(event) =>
                  change({ ...shown, [row.kind]: event.target.value })
                }
                type="time"
                value={shown[row.kind]}
              />
            }
            key={row.kind}
            summary={row.what}
            title={row.label}
          />
        ))}
      </PlaceList>
      {notLoaded ? (
        <p className="luca-mnemos-quiet text-xs">
          {notLoaded === plan.length
            ? "Scheduled, but not loaded: they won’t run until they are."
            : `${notLoaded} ${notLoaded === 1 ? "hour" : "hours"} scheduled but not loaded.`}
        </p>
      ) : null}
      {asking ? (
        <div
          aria-labelledby="mnemos-hours-ask-title"
          className="luca-mnemos-ask"
          data-testid="mnemos-hours-ask"
          role="alertdialog"
        >
          <p
            className="luca-mnemos-ask-title text-sm"
            id="mnemos-hours-ask-title"
          >
            {ask.title}
          </p>
          <p
            className="luca-mnemos-ask-text text-sm"
            data-testid="mnemos-hours-ask-text"
          >
            {ask.text}
          </p>
          <div className="luca-mnemos-ask-foot">
            <Button
              data-testid="mnemos-hours-ask-no"
              disabled={sending}
              onClick={() => {
                confirm.current.no();
                setAsking(false);
              }}
              size="quiet"
              type="button"
              variant="quiet"
            >
              Not now
            </Button>
            <Button
              data-testid="mnemos-hours-ask-yes"
              disabled={sending}
              onClick={() => void yes()}
              ref={yesRef}
              size="quiet"
              type="button"
            >
              {sending ? "Saving…" : ask.yes}
            </Button>
          </div>
        </div>
      ) : (
        <div className="luca-mnemos-settings-foot">
          <span
            aria-live="polite"
            className="luca-mnemos-quiet text-xs"
            data-testid="mnemos-hours-hint"
          >
            {changed
              ? "Not saved yet."
              : saved.on
                ? "Scheduled on this Mac."
                : "Off. Nothing runs between conversations."}
          </span>
          {changed ? (
            <>
              <Button
                data-testid="mnemos-hours-undo"
                onClick={() => change(saved)}
                size="quiet"
                type="button"
                variant="quiet"
              >
                Undo
              </Button>
              <Button
                data-testid="mnemos-hours-save"
                onClick={() => {
                  confirm.current.ask(hoursWrite(shown));
                  setOutcome(null);
                  setAsking(true);
                }}
                size="quiet"
                type="button"
              >
                Save
              </Button>
            </>
          ) : null}
        </div>
      )}
      {outcome ? (
        <p
          className={
            outcome.kind === "said"
              ? "luca-mnemos-said text-sm"
              : "luca-mnemos-said luca-mnemos-said-no text-sm"
          }
          data-testid={
            outcome.kind === "said"
              ? "mnemos-hours-said"
              : "mnemos-hours-refused"
          }
          role="status"
        >
          {outcome.kind === "failed" ? outcome.line : outcome.said}
        </p>
      ) : null}
    </section>
  );
}

/** Jev, shown only: on or off, whether a key is saved, and where it's set.
 *  Never the key; there is no key field anywhere in this app. */
function Jev({ mind, notebook }: { mind: string; notebook: NotebookView }) {
  const jev = notebook.life.jev;
  const [starting, setStarting] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const start = async () => {
    if (starting) return;
    setStarting(true);
    setFailed(false);
    try {
      await openOwnPage(mind);
    } catch {
      setFailed(true);
    } finally {
      setStarting(false);
    }
  };
  return (
    <section
      aria-label="Jev"
      className="luca-mnemos-settings-group"
      data-testid="mnemos-settings-jev"
    >
      <PlaceList label="Jev">
        <PlaceListRow
          detail={jev ? (jev.on && jev.key ? "On" : "Off") : "Not known"}
          summary="Judges which memories really bear on each message you send. It’s a service from TypeSafe, and it runs only with a key of your own."
          testId="mnemos-jev-on"
          title="Judging which memories come up"
        />
        <PlaceListRow
          detail={jev?.key ? "Saved" : "None"}
          summary={
            jev?.key
              ? "A key is saved on this Mac."
              : "No key is saved on this Mac."
          }
          testId="mnemos-jev-key"
          title="Key"
        />
      </PlaceList>
      <div className="luca-mnemos-settings-foot">
        <span className="luca-mnemos-quiet text-xs">
          Jev is set on Mnemos’s own page.
        </span>
        <Button
          data-testid="mnemos-own-page"
          disabled={starting}
          onClick={() => void start()}
          size="quiet"
          type="button"
          variant="quiet"
        >
          Open Mnemos’s own page
        </Button>
      </div>
      {failed ? (
        <p
          className="luca-mnemos-said luca-mnemos-said-no text-sm"
          data-testid="mnemos-own-page-failed"
          role="status"
        >
          Mnemos’s own page couldn’t be started on this Mac.
        </p>
      ) : null}
    </section>
  );
}

const sizeWords = (bytes: number | undefined) => {
  if (bytes === undefined) return null;
  const mb = bytes / 1_048_576;
  return mb >= 10
    ? `${Math.round(mb).toLocaleString("en-US")} MB`
    : `${mb.toFixed(1)} MB`;
};

/** About this memory: whose it is and where it's kept. */
function About({ notebook }: { notebook: NotebookView }) {
  const { identity, memory } = notebook.life;
  const rows = [
    { key: "name", title: "Name", value: identity.name },
    {
      key: "model",
      title: "Model",
      value: identity.model ? modelName(identity.model) : "",
    },
    {
      key: "whose",
      title: "Whose it is",
      value: identity.person || identity.personId,
    },
    { key: "project", title: "Project", value: identity.project },
    { key: "store", title: "Where it’s kept", value: identity.store },
    { key: "size", title: "How large", value: sizeWords(memory.storeBytes) },
    { key: "mnemos", title: "Mnemos", value: notebook.hello.mnemos },
  ].filter((r) => r.value);
  return (
    <section
      aria-label="About this memory"
      className="luca-mnemos-settings-group"
      data-testid="mnemos-settings-about"
    >
      <PlaceList label="About this memory">
        {rows.map((r) => (
          <PlaceListRow
            detail={
              <span className="luca-mnemos-settings-value">{r.value}</span>
            }
            key={r.key}
            testId={`mnemos-about-${r.key}`}
            title={r.title}
          />
        ))}
      </PlaceList>
    </section>
  );
}
