import * as React from "react";
import { ArrowUpRight, Check, Copy, Download, X } from "lucide-react";
import { HarnessFace } from "@/app/shell/placeRails/placeFaces";
import { Usage } from "./HarnessInformation";
import {
  HOME_DEFAULT,
  HOME_KEY,
  HOME_NAMES,
  HOME_PRESETS,
  HOME_WORK,
  homeBrief,
  normalizeHome,
  type HomeDesign,
  type Runtime,
} from "./homeFixtures";
export type Saved = {
  id: string;
  name: string;
  createdAt: string;
  design: HomeDesign;
};
export function readDesign() {
  try {
    const raw = JSON.parse(localStorage.getItem(HOME_KEY) ?? "null");
    return {
      design: normalizeHome(raw?.design),
      saved: (Array.isArray(raw?.saved)
        ? raw.saved
            .filter(
              (s: Saved) =>
                typeof s?.name === "string" && typeof s?.id === "string",
            )
            .map((s: Saved) => ({ ...s, design: normalizeHome(s.design) }))
        : []) as Saved[],
      error: "",
    };
  } catch {
    return {
      design: HOME_DEFAULT,
      saved: [] as Saved[],
      error:
        "Saved directions could not be read. They have not been overwritten; copy or export this direction instead.",
    };
  }
}
export function HomeUsage({
  open,
}: {
  open: (runtime: Runtime, id?: string) => void;
}) {
  const [usageRuntime, setUsageRuntime] =
    React.useState<Runtime>("claude_code");
  return (
    <div className="home-scroll">
      <div className="home-page-heading">
        <div>
          <span className="home-eyebrow">Across your tools</span>
          <h1>Usage</h1>
          <p>Each account in its own units. No invented combined allowance.</p>
        </div>
      </div>
      <div className="home-usage-accounts">
        <button
          type="button"
          aria-pressed={usageRuntime === "claude_code"}
          onClick={() => setUsageRuntime("claude_code")}
        >
          <HarnessFace runtimeId="claude_code" />
          <span>
            Claude Code<small>API · Observed sessions</small>
          </span>
          <strong>$2.84</strong>
        </button>
        <button
          type="button"
          aria-pressed={usageRuntime === "codex"}
          onClick={() => setUsageRuntime("codex")}
        >
          <HarnessFace runtimeId="codex" />
          <span>
            Codex<small>Subscription · Provider-reported example</small>
          </span>
          <strong>
            72%<small>remaining</small>
          </strong>
        </button>
      </div>
      {usageRuntime === "claude_code" ? (
        <Usage billing="API key" />
      ) : (
        <section className="home-codex-usage">
          <h2>Codex allowance</h2>
          <div className="home-allowance">
            <strong>
              72<span>%</span>
            </strong>
            <div>
              <p>Five-hour window remaining</p>
              <small>Example reset in 2h 18m · Updated just now</small>
            </div>
          </div>
          <meter
            aria-label="Example Codex five-hour allowance remaining"
            min={0}
            max={100}
            value={72}
          />
          <p className="home-secondary">
            Account allowance is separate from a session’s context. API cost
            isn’t available for this subscription.
          </p>
          <button type="button" onClick={() => open("codex")}>
            Open Codex workspace
            <ArrowUpRight size={14} />
          </button>
        </section>
      )}
    </div>
  );
}
export function ActivityTimeline({
  quiet,
  codexWaiting,
  open,
}: {
  quiet: boolean;
  codexWaiting: boolean;
  open: (runtime: Runtime, id?: string) => void;
}) {
  return (
    <section className="home-timeline" aria-label="Activity timeline">
      <div className="home-section-head">
        <h2>
          Today<span>Last two hours</span>
        </h2>
        <span className="home-timeline-legend">
          <i />
          Working
          <i />
          Finished
        </span>
      </div>
      <div className="home-time-axis">
        <span>10:00</span>
        <span>10:30</span>
        <span>11:00</span>
        <span>11:30</span>
        <span>Now</span>
      </div>
      <div className="home-time-lanes">
        {(["claude_code", "codex"] as Runtime[]).map((runtime) => (
          <div className="home-time-row" key={runtime}>
            <span>
              <HarnessFace runtimeId={runtime} size={14} />
              {HOME_NAMES[runtime]}
            </span>
            <div className="home-time-track">
              {HOME_WORK.filter((w) => w.runtime === runtime).map((w) => (
                <button
                  key={w.id}
                  type="button"
                  data-working={
                    (!quiet &&
                      !(codexWaiting && w.runtime === "codex") &&
                      w.state === "working") ||
                    undefined
                  }
                  style={{ left: `${w.start}%`, width: `${w.end - w.start}%` }}
                  aria-label={`${HOME_NAMES[runtime]}: ${w.title}, ${!quiet && codexWaiting && w.runtime === "codex" ? "waiting" : quiet || w.state === "done" ? "finished" : "working"}`}
                  onClick={() => open(runtime, w.id)}
                >
                  <span>{w.project}</span>
                  {!quiet &&
                    !(codexWaiting && w.runtime === "codex") &&
                    w.state === "working" && <i />}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function HomeTools({
  design,
  setDesign,
  saved,
  setSaved,
  storageError,
  close,
}: {
  design: HomeDesign;
  setDesign: (v: HomeDesign) => void;
  saved: Saved[];
  setSaved: (v: Saved[]) => void;
  storageError: string;
  close: () => void;
}) {
  const [name, setName] = React.useState("");
  const [copy, setCopy] = React.useState(false);
  const [error, setError] = React.useState(storageError);
  const closeButton = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    const prior = document.activeElement as HTMLElement;
    closeButton.current?.focus();
    return () => prior?.focus();
  }, []);
  const preset =
    Object.entries(HOME_PRESETS).find(
      ([, v]) => JSON.stringify(v) === JSON.stringify(design),
    )?.[0] ?? "Custom";
  return (
    <aside
      className="hds-tools home-tools"
      aria-label="Home design lab"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      <header>
        <h2>Home design lab</h2>
        <button
          type="button"
          aria-label="Close Home design lab"
          onClick={close}
          ref={closeButton}
        >
          <X size={16} />
        </button>
      </header>
      <p>
        Sample data only. No account, message or permission changes. Browser
        glass is a stand-in.
      </p>
      <label>
        Direction · {preset}
        <select
          aria-label="Home preset"
          value={preset}
          onChange={(e) => {
            const v = HOME_PRESETS[e.target.value];
            if (v) setDesign({ ...v });
          }}
        >
          <option disabled value="Custom">
            Custom
          </option>
          {Object.keys(HOME_PRESETS).map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      <label>
        Scene
        <select
          aria-label="Home scene"
          value={design.scene}
          onChange={(e) =>
            setDesign({
              ...design,
              scene: e.target.value as HomeDesign["scene"],
            })
          }
        >
          <option value="working">Work in progress</option>
          <option value="quiet">Caught up</option>
          <option value="empty">First visit</option>
          <option value="disconnected">Connection needs attention</option>
        </select>
      </label>
      <label>
        Density
        <select
          aria-label="Home density"
          value={design.density}
          onChange={(e) =>
            setDesign({
              ...design,
              density: e.target.value as HomeDesign["density"],
            })
          }
        >
          <option value="comfortable">Comfortable</option>
          <option value="compact">Compact</option>
        </select>
      </label>
      <fieldset className="home-module-options">
        <legend>On the overview</legend>
        {(
          [
            ["timeline", "Activity timeline"],
            ["results", "Recent results"],
            ["journal", "Agent journal · Concept"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={design[key]}
              onChange={(e) =>
                setDesign({ ...design, [key]: e.target.checked })
              }
            />
            {label}
          </label>
        ))}
      </fieldset>
      <div className="hds-save">
        <input
          aria-label="Name Home direction"
          placeholder="Name this direction"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="button"
          disabled={!name.trim()}
          onClick={() => {
            setSaved([
              ...saved,
              {
                id: crypto.randomUUID(),
                name: name.trim(),
                createdAt: new Date().toISOString(),
                design: { ...design },
              },
            ]);
            setName("");
          }}
        >
          Save
        </button>
      </div>
      {saved.map((s) => (
        <div className="hds-saved" key={s.id}>
          <button
            type="button"
            onClick={() => setDesign(normalizeHome(s.design))}
          >
            {s.name}
          </button>
          <button
            type="button"
            aria-label={`Remove saved Home direction ${s.name}`}
            onClick={() => setSaved(saved.filter((v) => v.id !== s.id))}
          >
            <X size={13} />
          </button>
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={() => setDesign({ ...HOME_DEFAULT })}>
        Reset direction
      </button>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(homeBrief(design));
            setCopy(true);
          } catch {
            setCopy(false);
            setError(
              "Copy unavailable. Select the brief below to copy manually.",
            );
          }
        }}
      >
        {copy ? <Check size={13} /> : <Copy size={13} />}
        {copy ? "Copied" : "Copy design brief"}
      </button>
      <button
        type="button"
        onClick={() => {
          const url = URL.createObjectURL(
            new Blob(
              [
                JSON.stringify(
                  {
                    project: "Polyphonic",
                    study: "cross-harness-home",
                    schema: 1,
                    design,
                    saved,
                    brief: homeBrief(design),
                  },
                  null,
                  2,
                ),
              ],
              { type: "application/json" },
            ),
          );
          const a = document.createElement("a");
          a.href = url;
          a.download = "polyphonic-home-direction.json";
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}
      >
        <Download size={13} />
        Export direction
      </button>
      <details>
        <summary>Design brief</summary>
        <pre>{homeBrief(design)}</pre>
      </details>
    </aside>
  );
}
