import * as React from "react";

import "./mnemos-board.css";

import { PlaceList, PlaceListRow } from "@/app/shell/placeRails/PlacePage";
import { Button } from "@/shared/ui/button";
import { openOwnPage } from "./boardWrites";
import { NeedsNewer } from "./MnemosParts";
import { modelName } from "./notebook";
import { QuietHours } from "./QuietHoursGroup";
import type { NotebookView, RoomProps } from "./roomKit";

/**
 * Settings (WP-49, Decided 5): three quiet groups. The quiet hours, the one
 * setting that's the person's, each hour by itself (WP-54,
 * `QuietHoursGroup`): nothing is sent as they change them; the change is
 * said back first, and their yes sends one request. Jev, shown only: there
 * is no key field here. And about this memory.
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
