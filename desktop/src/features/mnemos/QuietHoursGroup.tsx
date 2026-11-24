import * as React from "react";

import "./mnemos-board.css";

import {
  PlaceListRow,
  PlaceSectionLabel,
} from "@/app/shell/placeRails/PlacePage";
import { Button } from "@/shared/ui/button";
import { Switch } from "@/shared/ui/switch";
import type { WriteFailure } from "./adapt";
import type { HourKind } from "./api";
import type { BookHourSetting, BookQuietHours } from "./book";
import { scheduleOf } from "./boardWords";
import { sendHours } from "./boardWrites";
import { NeedsNewer, QuietMenu } from "./MnemosParts";
import type { NotebookView } from "./roomKit";
import {
  confirmOnce,
  HOUR_ROWS,
  type HoursSetting,
  hermesHour,
  hoursAsk,
  hoursChanged,
  hoursHint,
  hoursWrite,
  isChanged,
  lengthsFor,
  lengthWord,
  onlineLine,
  savedHours,
} from "./settingsHours";
import { failureWords } from "./WriteField";

/**
 * Settings › Quiet hours (WP-54): one row for each hour, in the notebook's
 * order, each with its own switch; under an hour that's on, when it starts,
 * how long it may last, and whether it can go online (never the dream).
 * Nothing is sent as the person changes them: Save says the change back
 * first, and their yes sends one `hours` request holding only what changed.
 * Inside Hermes the hours are only read; from a Mnemos before 0.7.0 the
 * group is one line.
 */
export function QuietHours({
  mind,
  notebook,
}: {
  mind: string;
  notebook: NotebookView;
}) {
  const { life } = notebook;
  const name = life.identity.name || "it";
  const quiet = life.quietHours;
  if (!quiet)
    return (
      <Group>
        <NeedsNewer what="Choosing each quiet hour" />
      </Group>
    );
  if (quiet.where === "hermes")
    return <HermesHours name={name} quiet={quiet} />;
  return (
    <HoursHere
      mind={mind}
      name={name}
      person={life.identity.person}
      quiet={quiet}
      schedule={life.schedule}
    />
  );
}

/** The group and its label. */
function Group({ children }: { children: React.ReactNode }) {
  return (
    <section
      aria-label="Quiet hours"
      className="luca-mnemos-settings-group"
      data-testid="mnemos-settings-hours"
    >
      <PlaceSectionLabel label="Quiet hours" />
      {children}
    </section>
  );
}

/** What the last send came to: Mnemos's refusal as given, or one line. */
type Outcome =
  | { kind: "refused"; said: string }
  | { kind: "failed"; line: string };

function HoursHere({
  mind,
  name,
  person,
  quiet,
  schedule,
}: {
  mind: string;
  name: string;
  person: string | null;
  quiet: Extract<BookQuietHours, { where: "here" }>;
  schedule: Record<string, unknown>[];
}) {
  const saved = savedHours(quiet);
  const [edit, setEdit] = React.useState<HoursSetting | null>(null);
  // What was saved, held until the notebook is read again (`from`).
  const [afterSave, setAfterSave] = React.useState<{
    from: BookQuietHours;
    hours: HoursSetting;
  } | null>(null);
  const [asking, setAsking] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [said, setSaid] = React.useState<string | null>(null);
  const [outcome, setOutcome] = React.useState<Outcome | null>(null);
  const [confirm] = React.useState(() =>
    confirmOnce((write: ReturnType<typeof hoursWrite>) =>
      sendHours(mind, write),
    ),
  );
  const groupRef = React.useRef<HTMLElement>(null);
  const yesRef = React.useRef<HTMLButtonElement>(null);
  // The ask takes focus when it appears, so the keyboard answers it.
  React.useEffect(() => {
    if (asking) yesRef.current?.focus();
  }, [asking]);
  // When the ask closes, the keyboard goes back to where the person is:
  // the foot's Save while the change is still there, else the first hour's
  // switch. Set on close, used once the ask has left the page.
  const [returnTo, setReturnTo] = React.useState<"save" | "first" | null>(null);
  React.useEffect(() => {
    if (asking || !returnTo) return;
    const target = groupRef.current?.querySelector<HTMLElement>(
      returnTo === "save"
        ? "[data-testid='mnemos-hours-save']"
        : "[data-hour-on]",
    );
    target?.focus({ preventScroll: true });
    setReturnTo(null);
  }, [asking, returnTo]);

  const plan = scheduleOf(schedule);
  const notLoaded = plan.filter((p) => !p.loaded).length;
  const opening = (
    <p
      className="luca-mnemos-settings-lede text-sm"
      data-testid="mnemos-hours-lede"
    >
      Time between conversations that’s {name}’s own. They run Claude on its own
      and use {person ? `${person}’s` : "your"} Claude plan.
    </p>
  );
  if (!saved)
    return (
      <Group>
        {opening}
        <p
          className="luca-mnemos-quiet text-xs"
          data-testid="mnemos-hours-unread"
        >
          The quiet hours couldn’t be read just now.
        </p>
      </Group>
    );

  // Until the notebook is read again, what was just saved is what's saved,
  // so a change made meanwhile sends only itself.
  const base = afterSave && afterSave.from === quiet ? afterSave.hours : saved;
  const shown = edit ?? base;
  const changed = edit ? hoursChanged(edit, base) : {};
  const dirty = isChanged(changed);
  const ask = hoursAsk(name, changed, shown, base);

  const set = (kind: HourKind, patch: Partial<BookHourSetting>) => {
    setEdit({ ...shown, [kind]: { ...shown[kind], ...patch } });
    setAsking(false);
    confirm.no();
    setSaid(null);
    setOutcome(null);
  };

  const yes = async () => {
    setSending(true);
    setOutcome(null);
    try {
      const sent = await confirm.yes();
      if (sent.sent) {
        setAfterSave({ from: quiet, hours: shown });
        setEdit(null);
        setSaid(sent.said);
        setReturnTo("first");
      }
    } catch (error) {
      const failure = error as WriteFailure;
      setReturnTo("save");
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
      ref={groupRef}
    >
      <PlaceSectionLabel label="Quiet hours" />
      {opening}
      <ul className="luca-place-plate luca-mnemos-hours-plate">
        {HOUR_ROWS.map(({ kind, label, line }) => (
          <HourRow
            blocked={
              sending ||
              Boolean(quiet.cant && !base[kind].on && !shown[kind].on)
            }
            busy={sending}
            hour={shown[kind]}
            key={kind}
            kind={kind}
            label={label}
            line={line}
            set={(patch) => set(kind, patch)}
          />
        ))}
      </ul>
      {quiet.cant ? (
        <p
          className="luca-mnemos-quiet text-xs"
          data-testid="mnemos-hours-cant"
        >
          {quiet.cant}
        </p>
      ) : null}
      {notLoaded ? (
        <p
          className="luca-mnemos-quiet text-xs"
          data-testid="mnemos-hours-unloaded"
        >
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
          <div className="luca-mnemos-ask-lines">
            {ask.lines.map((l) => (
              <p
                className="luca-mnemos-ask-line text-sm tabular-nums"
                data-testid="mnemos-hours-ask-line"
                key={l}
              >
                {l}
              </p>
            ))}
          </div>
          {ask.sentences.map((l) => (
            <p
              className="luca-mnemos-ask-text text-sm"
              data-testid="mnemos-hours-ask-sentence"
              key={l}
            >
              {l}
            </p>
          ))}
          <div className="luca-mnemos-ask-foot">
            <Button
              data-testid="mnemos-hours-ask-no"
              disabled={sending}
              onClick={() => {
                confirm.no();
                setAsking(false);
                setReturnTo("save");
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
              {sending ? "Saving…" : "Save"}
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
            {hoursHint(shown, changed, said)}
          </span>
          {dirty ? (
            <>
              <Button
                data-testid="mnemos-hours-undo"
                disabled={sending}
                onClick={() => {
                  setEdit(null);
                  setOutcome(null);
                  groupRef.current
                    ?.querySelector<HTMLElement>("[data-hour-on]")
                    ?.focus({ preventScroll: true });
                }}
                size="quiet"
                type="button"
                variant="quiet"
              >
                Undo
              </Button>
              <Button
                data-testid="mnemos-hours-save"
                disabled={sending}
                onClick={() => {
                  confirm.ask(hoursWrite(changed));
                  setOutcome(null);
                  setAsking(true);
                }}
                size="quiet"
                type="button"
              >
                {sending ? "Saving…" : "Save"}
              </Button>
            </>
          ) : null}
        </div>
      )}
      {outcome ? (
        <p
          className="luca-mnemos-said luca-mnemos-said-no text-sm"
          data-testid="mnemos-hours-refused"
          role="status"
        >
          {outcome.kind === "failed" ? outcome.line : outcome.said}
        </p>
      ) : null}
    </section>
  );
}

/** One hour: its row and switch, and under it, while it's on, its three
 *  quiet lines. */
function HourRow({
  blocked,
  busy,
  hour,
  kind,
  label,
  line,
  set,
}: {
  blocked: boolean;
  busy: boolean;
  hour: BookHourSetting;
  kind: HourKind;
  label: string;
  line: string;
  set: (patch: Partial<BookHourSetting>) => void;
}) {
  const id = `mnemos-set-${kind}`;
  return (
    <li className="luca-mnemos-hour" data-testid={id}>
      <PlaceListRow
        as="div"
        detail={
          <Switch
            aria-label={label}
            checked={hour.on}
            data-hour-on={kind}
            data-testid={`${id}-on`}
            disabled={blocked}
            onCheckedChange={(on) => set({ on })}
          />
        }
        summary={line}
        title={label}
      />
      {hour.on ? (
        <div className="luca-mnemos-hour-lines" data-testid={`${id}-lines`}>
          <div className="luca-mnemos-hour-line">
            <label className="luca-mnemos-hour-k" htmlFor={`${id}-at`}>
              Starts at
            </label>
            <input
              aria-label={`${label}, starts at`}
              className="luca-mnemos-time tabular-nums"
              data-testid={`${id}-at`}
              disabled={busy}
              id={`${id}-at`}
              onChange={(event) => set({ at: event.target.value })}
              type="time"
              value={hour.at}
            />
          </div>
          <div className="luca-mnemos-hour-line">
            <span className="luca-mnemos-hour-k">How long</span>
            <QuietMenu
              disabled={busy}
              label={`${label}, how long`}
              onChange={(value) => set({ minutes: Number(value) })}
              options={lengthsFor(hour.minutes).map((n) => ({
                id: String(n),
                label: lengthWord(n),
              }))}
              shown={hour.minutes === null ? "" : lengthWord(hour.minutes)}
              testId={`${id}-minutes`}
              value={hour.minutes === null ? "" : String(hour.minutes)}
            />
          </div>
          {kind === "dream" ? (
            <div className="luca-mnemos-hour-line" data-testid={`${id}-never`}>
              <span className="luca-mnemos-hour-k">Never online.</span>
            </div>
          ) : (
            <div className="luca-mnemos-hour-line luca-mnemos-hour-online">
              <span className="luca-mnemos-hour-k">Can go online</span>
              <Switch
                aria-label={`${label}, can go online`}
                checked={hour.online}
                data-testid={`${id}-online`}
                disabled={busy}
                onCheckedChange={(online) => set({ online })}
              />
              <span
                className="luca-mnemos-hour-say"
                data-testid={`${id}-online-line`}
              >
                {onlineLine(hour.online)}
              </span>
            </div>
          )}
        </div>
      ) : null}
    </li>
  );
}

/** Inside Hermes: each hour as Hermes has it scheduled, only to read. */
function HermesHours({
  name,
  quiet,
}: {
  name: string;
  quiet: Extract<BookQuietHours, { where: "hermes" }>;
}) {
  return (
    <Group>
      <p
        className="luca-mnemos-settings-lede text-sm"
        data-testid="mnemos-hours-lede"
      >
        Time between conversations that’s {name}’s own. They run on the model
        Hermes uses, each costing what a short conversation with it costs, and
        only while Hermes’s gateway is running.
      </p>
      <ul className="luca-place-plate luca-mnemos-hours-plate">
        {HOUR_ROWS.map(({ kind, label, line }) => {
          const h = hermesHour(kind, quiet.hours);
          return (
            <li
              className="luca-mnemos-hour"
              data-testid={`mnemos-set-${kind}`}
              key={kind}
            >
              <PlaceListRow
                as="div"
                detail={
                  <span
                    className="luca-mnemos-hour-state"
                    data-testid={`mnemos-set-${kind}-state`}
                  >
                    {h.state}
                    <span className="sr-only"> ({label})</span>
                  </span>
                }
                summary={line}
                title={label}
              />
              {h.starts ? (
                <div
                  className="luca-mnemos-hour-lines"
                  data-testid={`mnemos-set-${kind}-lines`}
                >
                  <div className="luca-mnemos-hour-line">
                    <span className="luca-mnemos-hour-k">{h.starts.label}</span>
                    <span className="luca-mnemos-hour-v tabular-nums">
                      {h.starts.value}
                    </span>
                  </div>
                  {h.online ? (
                    <div className="luca-mnemos-hour-line luca-mnemos-hour-online">
                      <span className="luca-mnemos-hour-k">
                        {h.online.label}
                      </span>
                      {h.online.line ? (
                        <span className="luca-mnemos-hour-say">
                          {h.online.line}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  {h.notLimited ? (
                    <div className="luca-mnemos-hour-line">
                      <span className="luca-mnemos-hour-say">
                        Not limited to its memory: it runs with the tools Hermes
                        gives every scheduled job.
                      </span>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {quiet.hours ? null : (
        <p
          className="luca-mnemos-quiet text-xs"
          data-testid="mnemos-hours-unread"
        >
          Mnemos can’t read Hermes’s scheduled jobs just now, so it can’t say
          which of these are on.
        </p>
      )}
      <p
        className="luca-mnemos-quiet text-xs"
        data-testid="mnemos-hours-hermes"
      >
        Hermes runs these as its own scheduled jobs. To change them, ask {name}.
      </p>
    </Group>
  );
}
