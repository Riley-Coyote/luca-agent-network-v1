/** Visual-only control signal study. Never invokes an agent, IPC or permission. */
import * as React from "react";
import { Check, Copy, Settings2, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import "./companionControlLab.css";

export const CONTROL_LAB_KEY = "ui-design-lab.polyphonic.control-signal.v1";
type Design = {
  strength: number;
  width: number;
  glow: number;
  motion: boolean;
};
type Variation = {
  id: string;
  name: string;
  createdAt: string;
  version: 1;
  design: Design;
};
type Saved = { version: 1; design: Design; variations: Variation[] };
const PRESETS: { name: string; design: Design }[] = [
  {
    name: "Quiet edge",
    design: { strength: 0.26, width: 1, glow: 12, motion: true },
  },
  {
    name: "Soft halo",
    design: { strength: 0.36, width: 1, glow: 24, motion: true },
  },
  {
    name: "Clear signal",
    design: { strength: 0.5, width: 1.5, glow: 16, motion: false },
  },
];
function normalize(value: unknown): Design {
  const input = (
    value && typeof value === "object" ? value : {}
  ) as Partial<Design>;
  const number = (
    value: unknown,
    fallback: number,
    min: number,
    max: number,
  ) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.max(min, Math.min(max, value))
      : fallback;
  return {
    strength: number(input.strength, 0.26, 0.12, 0.65),
    width: number(input.width, 1, 0.5, 2),
    glow: number(input.glow, 12, 0, 32),
    motion: input.motion !== false,
  };
}
function readSaved(): { data: Saved; error: string | null } {
  const fallback: Saved = {
    version: 1,
    design: PRESETS[0].design,
    variations: [],
  };
  try {
    const raw = localStorage.getItem(CONTROL_LAB_KEY);
    if (!raw) return { data: fallback, error: null };
    if (raw.length > 128 * 1024) throw new Error("oversized");
    const saved = JSON.parse(raw) as Saved;
    if (saved.version !== 1 || !Array.isArray(saved.variations))
      throw new Error("schema");
    if (
      saved.variations.some(
        (v) =>
          v?.version !== 1 ||
          typeof v.id !== "string" ||
          typeof v.name !== "string" ||
          v.name.length > 80 ||
          typeof v.createdAt !== "string",
      )
    )
      throw new Error("variation");
    return {
      data: {
        version: 1,
        design: normalize(saved.design),
        variations: saved.variations.map((v) => ({
          ...v,
          design: normalize(v.design),
        })),
      },
      error: null,
    };
  } catch {
    return {
      data: fallback,
      error:
        "Saved data was left untouched. This preview still works; copy the brief to keep your choices.",
    };
  }
}

export function CompanionControlLab() {
  const [initial] = React.useState(readSaved);
  const [design, setDesign] = React.useState(initial.data.design);
  const [variations, setVariations] = React.useState(initial.data.variations);
  const [error, setError] = React.useState(initial.error);
  const [visible, setVisible] = React.useState(false);
  const [mode, setMode] = React.useState<"active" | "settings" | "idle">(
    "active",
  );
  const [name, setName] = React.useState("");
  const [copied, setCopied] = React.useState(false);
  const [manualCopy, setManualCopy] = React.useState(false);
  const preset =
    PRESETS.find((p) => JSON.stringify(p.design) === JSON.stringify(design))
      ?.name ?? "Custom";
  const brief = `Polyphonic — app-control signal, isolated visual study; not yet integrated.\nDirection: ${preset}. Keep the existing shell, geometry, typography and theme. Use a neutral-white inset edge at ${Math.round(design.strength * 100)}% strength, ${design.width}px width, ${design.glow}px soft inner glow. ${design.motion ? "Use a slow 3.6-second opacity breath only while actual UI control is active." : "Keep the edge stationary."}\nShow a concise companion identity/status and an accessible Stop control. Keep all app content readable and usable; the edge never intercepts clicks. Respect reduced motion with a steady signal. Bind production visibility to actual app-control activity, not thinking, background work or the entire assistant turn. Clear it on completion, cancellation, error or lost connection.\nFor supported settings changes, apply the typed operation without navigating and return a truthful receipt in chat; do not illuminate the app. This lab simulates both states and never operates the app or changes permissions. Browser glass is a visual approximation. Native lifecycle and Stop wiring require separate verification.\nLocal variations stay in this browser/origin.`;
  function persist(next: Design, saved = variations) {
    if (initial.error) return;
    try {
      localStorage.setItem(
        CONTROL_LAB_KEY,
        JSON.stringify({
          version: 1,
          design: next,
          variations: saved,
        } satisfies Saved),
      );
      setError(null);
    } catch {
      setError("Local save failed. Copy the brief to keep this direction.");
    }
  }
  function update(patch: Partial<Design>) {
    const next = normalize({ ...design, ...patch });
    setDesign(next);
    persist(next);
    setCopied(false);
  }
  function save() {
    if (!name.trim()) return;
    const next = [
      ...variations,
      {
        id: crypto.randomUUID(),
        name: name.trim().slice(0, 80),
        createdAt: new Date().toISOString(),
        version: 1 as const,
        design: { ...design },
      },
    ];
    setVariations(next);
    persist(design, next);
    setName("");
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(brief);
      setCopied(true);
      setManualCopy(false);
    } catch {
      setManualCopy(true);
      setCopied(false);
    }
  }
  const style = {
    "--control-strength": design.strength,
    "--control-width": `${design.width}px`,
    "--control-glow": `${design.glow}px`,
  } as React.CSSProperties;
  return (
    <>
      {mode === "active" ? (
        <>
          <div
            className="companion-control-edge"
            data-testid="control-preview-edge"
            data-motion={design.motion}
            style={style}
            aria-hidden="true"
          />
          <div className="companion-control-badge" role="status">
            <span className="companion-control-preview-word">Preview</span>
            <span>Luca is using Polyphonic</span>
            <button
              type="button"
              onClick={() => setMode("idle")}
              aria-label="Stop simulated app control"
            >
              Stop
            </button>
          </div>
        </>
      ) : null}
      {mode === "settings" ? (
        <div className="companion-control-receipt" role="status">
          <Check size={16} aria-hidden="true" />
          <div>
            <strong>Following Claude Code</strong>
            <p>
              I’ll keep up with new activity. Your other choices are unchanged.
            </p>
            <small>Sample chat receipt · no settings changed</small>
          </div>
          <button
            type="button"
            aria-label="Dismiss sample receipt"
            onClick={() => setMode("idle")}
          >
            <X size={16} />
          </button>
        </div>
      ) : null}
      {!visible ? (
        <Button
          className="companion-control-toggle"
          variant="outline"
          size="sm"
          onClick={() => setVisible(true)}
        >
          <Settings2 size={14} />
          Control signal lab · {preset}
        </Button>
      ) : null}
      {visible ? (
        <aside
          className="companion-control-panel"
          aria-label="App control design lab"
        >
          <header>
            <div>
              <strong>Control signal</strong>
              <p>Visual study · no agent running</p>
            </div>
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => setVisible(false)}
              aria-label="Hide lab controls"
            >
              <X size={16} />
            </Button>
          </header>
          <fieldset>
            <legend>Preview state</legend>
            <div className="companion-control-options">
              {(
                [
                  ["active", "Using the app"],
                  ["settings", "Settings receipt"],
                  ["idle", "Idle"],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  size="sm"
                  variant={mode === value ? "secondary" : "ghost"}
                  aria-pressed={mode === value}
                  onClick={() => setMode(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Direction · {preset}</legend>
            <div className="companion-control-options">
              {PRESETS.map((p) => (
                <Button
                  key={p.name}
                  size="sm"
                  variant={preset === p.name ? "secondary" : "ghost"}
                  aria-pressed={preset === p.name}
                  onClick={() => update(p.design)}
                >
                  {p.name}
                </Button>
              ))}
            </div>
          </fieldset>
          <label className="companion-control-range">
            Edge strength <span>{Math.round(design.strength * 100)}%</span>
            <input
              type="range"
              min="0.12"
              max="0.65"
              step="0.01"
              value={design.strength}
              onChange={(e) => update({ strength: Number(e.target.value) })}
            />
          </label>
          <label className="companion-control-range">
            Edge width <span>{design.width}px</span>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.5"
              value={design.width}
              onChange={(e) => update({ width: Number(e.target.value) })}
            />
          </label>
          <label className="companion-control-range">
            Glow reach <span>{design.glow}px</span>
            <input
              type="range"
              min="0"
              max="32"
              step="2"
              value={design.glow}
              onChange={(e) => update({ glow: Number(e.target.value) })}
            />
          </label>
          <label className="companion-control-motion">
            <input
              type="checkbox"
              checked={design.motion}
              onChange={(e) => update({ motion: e.target.checked })}
            />
            Gentle breathing motion
          </label>
          <fieldset>
            <legend>Save a variation</legend>
            <div className="companion-control-save">
              <Input
                aria-label="Variation name"
                maxLength={80}
                placeholder="Name this direction"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Button size="sm" disabled={!name.trim()} onClick={save}>
                Save
              </Button>
            </div>
            {variations.map((v) => (
              <div className="companion-control-saved" key={v.id}>
                <button
                  type="button"
                  onClick={() => update(v.design)}
                  aria-label={`Restore ${v.name}`}
                >
                  {v.name}
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${v.name}`}
                  onClick={() => {
                    const next = variations.filter((x) => x.id !== v.id);
                    setVariations(next);
                    persist(design, next);
                  }}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </fieldset>
          <div className="companion-control-options">
            <Button variant="outline" size="sm" onClick={() => void copy()}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy design brief"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => update(PRESETS[0].design)}
            >
              Reset design
            </Button>
          </div>
          <details open={manualCopy || undefined}>
            <summary>
              {manualCopy
                ? "Select and copy the brief manually"
                : "Design brief"}
            </summary>
            <textarea
              aria-label="Design brief"
              readOnly
              value={brief}
              onFocus={(e) => {
                if (manualCopy) e.target.select();
              }}
            />
          </details>
          {error ? <p role="alert">{error}</p> : null}
          <p className="companion-control-note">
            Only the overlay is experimental. The shell underneath uses current
            production components. Saved variations stay in this browser.
          </p>
        </aside>
      ) : null}
    </>
  );
}
