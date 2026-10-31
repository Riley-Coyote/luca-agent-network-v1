import * as React from "react";
import { Download, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import {
  brief,
  MATERIALS,
  normalize,
  PRESETS,
  presetName,
  type Design,
  type Saved,
} from "./design";

export function DesignTools({
  design,
  setDesign,
  saved,
  setSaved,
  error,
}: {
  design: Design;
  setDesign: (next: Design) => void;
  saved: Saved[];
  setSaved: (next: Saved[]) => void;
  error: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [manual, setManual] = React.useState(false);
  const change = (partial: Partial<Design>) =>
    setDesign(normalize({ ...design, ...partial }));
  const text = brief(design);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setMessage("Design brief copied.");
      setManual(false);
    } catch {
      setManual(true);
      setMessage("Clipboard unavailable. Select and copy the brief below.");
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              project: "Polyphonic",
              study: "temporary-surfaces",
              schema: 2,
              design,
              saved,
              brief: text,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "polyphonic-temporary-surfaces.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage("JSON export requested. Saved variations are included.");
  }
  return (
    <>
      <button
        className="ts-tools-toggle"
        type="button"
        aria-expanded={open}
        aria-controls="ts-tools"
        onClick={() => setOpen(!open)}
      >
        <SlidersHorizontal size={15} /> Design lab
      </button>
      {open && (
        <aside
          className="ts-tools"
          id="ts-tools"
          aria-label="Temporary surface design controls"
        >
          <header>
            <div>
              <strong>Temporary surfaces</strong>
              <small>{presetName(design)} · local prototype</small>
            </div>
            <button
              type="button"
              aria-label="Close design controls"
              onClick={() => setOpen(false)}
            >
              <X size={17} />
            </button>
          </header>
          <p className="ts-tools-note">
            Production composer, unchanged. These controls affect the cards
            only. Previous v1 variations remain stored separately.
          </p>
          <fieldset>
            <legend>Direction</legend>
            <div className="ts-presets">
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
          </fieldset>
          <fieldset>
            <legend>Material</legend>
            <div className="ts-presets">
              {MATERIALS.map((m) => (
                <button
                  type="button"
                  key={m.id}
                  aria-pressed={design.material === m.id}
                  onClick={() => change({ material: m.id })}
                >
                  {m.name}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="ts-check">
            <input
              type="checkbox"
              checked={design.signal}
              onChange={(e) => change({ signal: e.target.checked })}
            />
            Blue light on asks
          </label>
          <label className="ts-check">
            <input
              type="checkbox"
              checked={design.depth}
              onChange={(e) => change({ depth: e.target.checked })}
            />
            Edge depth
          </label>
          <label>
            Card inset <output>{design.inset}px</output>
            <input
              aria-label="Card inset"
              type="range"
              min="12"
              max="64"
              step="2"
              value={design.inset}
              onChange={(e) => change({ inset: Number(e.target.value) })}
            />
          </label>
          <small>The composer’s width and geometry never change.</small>
          <label>
            Surface tone <output>{design.shade}</output>
            <input
              aria-label="Surface tone"
              type="range"
              min="16"
              max="40"
              value={design.shade}
              onChange={(e) => change({ shade: Number(e.target.value) })}
            />
          </label>
          <label className="ts-check">
            <input
              type="checkbox"
              checked={design.compact}
              onChange={(e) => change({ compact: e.target.checked })}
            />
            Compact spacing
          </label>
          <label className="ts-check">
            <input
              type="checkbox"
              checked={design.opaque}
              onChange={(e) => change({ opaque: e.target.checked })}
            />
            Reduced-transparency fallback
          </label>
          <label className="ts-check">
            <input
              type="checkbox"
              checked={design.motion}
              onChange={(e) => change({ motion: e.target.checked })}
            />
            Surface motion
          </label>
          <section aria-label="Saved design variations">
            <h3>Save a variation</h3>
            <form
              className="ts-save"
              onSubmit={(e) => {
                e.preventDefault();
                if (!name.trim()) return;
                setSaved([
                  ...saved,
                  {
                    id: crypto.randomUUID(),
                    name: name.trim(),
                    created: new Date().toISOString(),
                    schema: 2,
                    design: { ...design },
                  },
                ]);
                setName("");
                setMessage(
                  error
                    ? "Kept in memory only. Export to keep this variation."
                    : "Variation saved in this browser.",
                );
              }}
            >
              <input
                aria-label="Variation name"
                value={name}
                placeholder="Name this direction"
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
              />
              <button type="submit" disabled={!name.trim()}>
                Save
              </button>
            </form>
            {saved.map((v) => (
              <div className="ts-saved" key={v.id}>
                <button
                  type="button"
                  onClick={() => {
                    setDesign(normalize(v.design));
                    setMessage(`Restored ${v.name}.`);
                  }}
                >
                  {v.name}
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${v.name}`}
                  onClick={() => setSaved(saved.filter((s) => s.id !== v.id))}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
            <small>
              Local to this browser and port. Export for a portable copy.
            </small>
          </section>
          <div className="ts-tool-actions">
            <button type="button" onClick={() => void copy()}>
              Copy design brief
            </button>
            <button
              type="button"
              onClick={download}
              aria-label="Export design JSON"
            >
              <Download size={16} />
            </button>
            <button
              type="button"
              onClick={() => {
                setDesign({ ...PRESETS["Quiet card"] });
                setMessage(
                  "Starting direction restored. Saved variations kept.",
                );
              }}
              aria-label="Reset design"
            >
              <RotateCcw size={16} />
            </button>
          </div>
          {(message || error) && (
            <p className="ts-tools-note" role="status">
              {error || message}
            </p>
          )}
          {manual && (
            <textarea
              aria-label="Design brief to copy"
              readOnly
              rows={8}
              value={text}
              onFocus={(e) => e.target.select()}
            />
          )}
        </aside>
      )}
    </>
  );
}
