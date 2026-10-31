import * as React from "react";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  RotateCcw,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  AGENT_SPACE_KEY,
  PRESETS,
  type Saved,
  brief,
  normalize,
  presetName,
  readDesign,
} from "./design";

export function useStudyDesign() {
  const [initial] = React.useState(readDesign);
  const [design, setDesign] = React.useState(initial.design);
  const [saved, setSaved] = React.useState(initial.saved);
  const [storageError, setStorageError] = React.useState(initial.error);
  React.useEffect(() => {
    if (initial.error) return;
    try {
      localStorage.setItem(
        AGENT_SPACE_KEY,
        JSON.stringify({ schema: 1, design, saved }),
      );
      setStorageError("");
    } catch {
      setStorageError(
        "Could not save in this browser. Export your choices to keep them.",
      );
    }
  }, [design, saved, initial.error]);
  return { design, setDesign, saved, setSaved, storageError };
}

export function StudyTools({
  design,
  setDesign,
  saved,
  setSaved,
  storageError,
  scenario,
  onScenario,
}: ReturnType<typeof useStudyDesign> & {
  scenario: string;
  onScenario: (value: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [feedback, setFeedback] = React.useState("");
  const [manual, setManual] = React.useState(false);
  const toggleRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLElement>(null);
  const close = () => {
    setOpen(false);
    toggleRef.current?.focus();
  };
  React.useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(brief(design));
      setFeedback("Brief copied");
      setManual(false);
    } catch {
      setFeedback("Select and copy the brief below.");
      setManual(true);
    }
  }
  function download() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            project: "Polyphonic",
            study: "Agent spaces",
            schema: 1,
            design,
            saved,
            brief: brief(design),
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "polyphonic-agent-spaces.json";
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setFeedback("Design export downloaded");
  }
  return (
    <>
      <button
        className="as-lab-toggle"
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        ref={toggleRef}
      >
        <SlidersHorizontal size={14} /> Design lab <ChevronDown size={12} />
      </button>
      {open && (
        <aside
          className="as-lab-panel"
          aria-label="Design lab controls"
          tabIndex={-1}
          ref={panelRef}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              close();
            }
          }}
        >
          <header>
            <div>
              <strong>Agent spaces</strong>
              <span>Refine the organization, not the shell.</span>
            </div>
            <button
              className="as-icon"
              type="button"
              onClick={close}
              aria-label="Close design controls"
            >
              <X />
            </button>
          </header>
          <p className="as-lab-note">
            Sample data · no live changes.
            <br />
            The browser glass is simulated.
          </p>
          <label htmlFor="as-preset">
            Direction <small>{presetName(design)}</small>
          </label>
          <div className="as-presets" id="as-preset">
            {Object.entries(PRESETS).map(([key, value]) => (
              <button
                type="button"
                key={key}
                aria-pressed={presetName(design) === key}
                onClick={() => setDesign({ ...value })}
              >
                {key}
              </button>
            ))}
          </div>
          <label htmlFor="as-width">
            Reading width <small>{design.width}px max</small>
          </label>
          <input
            id="as-width"
            type="range"
            min="640"
            max="960"
            step="20"
            value={design.width}
            onChange={(e) =>
              setDesign(normalize({ ...design, width: Number(e.target.value) }))
            }
          />
          <label className="as-check">
            <input
              type="checkbox"
              checked={design.compact}
              onChange={(e) =>
                setDesign({ ...design, compact: e.target.checked })
              }
            />{" "}
            Compact rows
          </label>
          <label className="as-check">
            <input
              type="checkbox"
              checked={design.descriptions}
              onChange={(e) =>
                setDesign({ ...design, descriptions: e.target.checked })
              }
            />{" "}
            Supporting descriptions
          </label>
          <label htmlFor="as-scenario">Preview state</label>
          <select
            id="as-scenario"
            value={scenario}
            onChange={(e) => onScenario(e.target.value)}
          >
            <option value="settled">Established companion</option>
            <option value="new">Just arrived</option>
            <option value="attention">Needs attention</option>
          </select>
          <div className="as-lab-rule" />
          <label htmlFor="as-variation">Save a variation</label>
          <form
            className="as-save-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              const v: Saved = {
                id: crypto.randomUUID(),
                name: name.trim(),
                created: new Date().toISOString(),
                schema: 1,
                design: { ...design },
              };
              setSaved([...saved, v]);
              setName("");
              setFeedback(
                storageError
                  ? "Kept in this session. Export to preserve it."
                  : "Variation saved in this browser",
              );
            }}
          >
            <input
              id="as-variation"
              placeholder="Give this direction a name"
              value={name}
              maxLength={70}
              onChange={(e) => setName(e.target.value)}
            />
            <button type="submit" disabled={!name.trim()} className="as-button">
              Save
            </button>
          </form>
          {saved.length > 0 && (
            <div className="as-saved">
              {saved.map((v) => (
                <div key={v.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setDesign(normalize(v.design));
                      setFeedback(`Restored ${v.name}`);
                    }}
                  >
                    {v.name}
                  </button>
                  <button
                    type="button"
                    className="as-icon"
                    aria-label={`Delete saved variation ${v.name}`}
                    onClick={() =>
                      setSaved(saved.filter((item) => item.id !== v.id))
                    }
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="as-lab-actions">
            <button
              type="button"
              className="as-button"
              onClick={() => {
                setDesign({ ...PRESETS.Balanced });
                setFeedback("Starting design restored. Saved variations kept.");
              }}
            >
              <RotateCcw />
              Reset
            </button>
            <button type="button" className="as-button" onClick={download}>
              <Download />
              Export
            </button>
          </div>
          <details className="as-brief" open={manual || undefined}>
            <summary>Implementation brief</summary>
            <textarea
              aria-label="Copyable design brief"
              value={brief(design)}
              readOnly
              rows={9}
            />
          </details>
          <button
            type="button"
            className="as-button as-wide"
            onClick={() => void copy()}
          >
            {feedback === "Brief copied" ? <Check /> : <Copy />}Copy design
            brief
          </button>
          <p role="status" className="as-lab-feedback">
            {storageError ||
              feedback ||
              "Variations stay in this browser. Export to share."}
          </p>
        </aside>
      )}
    </>
  );
}
