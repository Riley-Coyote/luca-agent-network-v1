/** Isolated rail study. Every conversation and status is a safe fixture. */
import * as React from "react";
import { ChevronDown, ChevronRight, Copy, Plus, Settings2 } from "lucide-react";
import { ResidentIdentityMark } from "@/features/channels/ui/ResidentIdentityMark";
import {
  RAIL_ROW_CLASS,
  RAIL_CONTROL_CLASS,
  RailSectionHeader,
} from "@/features/sidebar/ui/ChatList";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

export const RAIL_STUDY_KEY = "ui-design-lab.polyphonic.inline-sessions.v1";
const presets = [
  { name: "Current rail", width: 224 },
  { name: "Narrow rail", width: 192 },
  { name: "Long titles", width: 280 },
];
type Saved = { id: string; name: string; width: number };
function read() {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(RAIL_STUDY_KEY);
    const data = JSON.parse(raw ?? "null");
    return {
      width: Math.max(192, Math.min(320, Number(data?.width) || 224)),
      saved: (Array.isArray(data?.saved) ? data.saved : []).filter(
        (v: Saved) => typeof v.name === "string" && Number.isFinite(v.width),
      ) as Saved[],
    };
  } catch {
    if (raw !== null) {
      try {
        localStorage.setItem(`${RAIL_STUDY_KEY}.recovery`, raw);
      } catch {
        /* Storage may be unavailable; keep the lab usable. */
      }
    }
    return { width: 224, saved: [] as Saved[] };
  }
}
export function RailStudy() {
  const [initial] = React.useState(read);
  const [width, setWidth] = React.useState(initial.width);
  const [saved, setSaved] = React.useState(initial.saved);
  const [name, setName] = React.useState("");
  const [open, setOpen] = React.useState(true);
  const [controls, setControls] = React.useState(true);
  const [expanded, setExpanded] = React.useState(true);
  const [selected, setSelected] = React.useState("Luca");
  const [notice, setNotice] = React.useState("");
  const brief = `Polyphonic desktop — inline agent sessions. Keep the existing materials, glyphs and typography. Rail width: ${width}px. Luca has one stable row above other agents and opens the persistent owner/Luca DM without a disclosure. Other residents use trailing chevrons and directly selectable indented sessions. Keep project rooms and earlier conversations accessible. Expansion survives navigation and restart. No second agent column. Browser study uses only sample data; native material and runtime continuity need separate verification.`;
  React.useEffect(() => {
    try {
      localStorage.setItem(RAIL_STUDY_KEY, JSON.stringify({ width, saved }));
    } catch {
      setNotice(
        "Local save unavailable; copy the brief to retain this direction.",
      );
    }
  }, [width, saved]);
  return (
    <>
      <Button
        className="fixed right-5 top-5 z-40"
        variant="outline"
        onClick={() => setOpen(true)}
      >
        Open rail study
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[62rem]">
          <DialogHeader>
            <DialogTitle>One rail, persistent Luca</DialogTitle>
            <DialogDescription>
              Current-shell study · sample conversations only · browser material
              approximation
            </DialogDescription>
          </DialogHeader>
          <Button
            variant="ghost"
            size="sm"
            className="w-fit"
            onClick={() => setControls(!controls)}
          >
            <Settings2 />
            {controls ? "Hide controls" : "Show controls"}
          </Button>
          <div className="flex min-w-0 flex-wrap gap-6">
            {controls && (
              <aside
                className="w-44 shrink-0 space-y-3 text-xs"
                aria-label="Rail study controls"
              >
                <p>
                  {presets.find((p) => p.width === width)?.name ?? "Custom"}
                </p>
                {presets.map((p) => (
                  <Button
                    key={p.name}
                    className="w-full justify-start"
                    variant="ghost"
                    size="sm"
                    onClick={() => setWidth(p.width)}
                  >
                    {p.name}
                  </Button>
                ))}
                <label className="block">
                  Rail width · {width}px
                  <input
                    aria-label="Rail width"
                    className="w-full"
                    type="range"
                    min="192"
                    max="320"
                    value={width}
                    onChange={(e) => setWidth(Number(e.target.value))}
                  />
                </label>
                <input
                  aria-label="Variation name"
                  className="w-full rounded border border-border bg-background p-2"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Name variation"
                  maxLength={80}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!name.trim()}
                  onClick={() => {
                    setSaved([
                      ...saved,
                      { id: crypto.randomUUID(), name: name.trim(), width },
                    ]);
                    setName("");
                  }}
                >
                  Save variation
                </Button>
                {saved.map((v) => (
                  <Button
                    key={v.id ?? v.name}
                    size="sm"
                    variant="ghost"
                    className="w-full truncate"
                    onClick={() =>
                      setWidth(Math.max(192, Math.min(320, v.width)))
                    }
                  >
                    {v.name}
                  </Button>
                ))}
                <Button size="sm" variant="ghost" onClick={() => setWidth(224)}>
                  Reset study
                </Button>
              </aside>
            )}
            <div className="flex min-h-96 min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-background">
              <nav
                aria-label="Rail preview"
                className="shrink-0 bg-sidebar p-2"
                style={{ width }}
              >
                <RailSectionHeader title="Projects" />
                <button
                  className={RAIL_ROW_CLASS}
                  onClick={() => setSelected("Project room")}
                  type="button"
                >
                  Field notes
                </button>
                <div className="mt-4">
                  <button
                    className={RAIL_ROW_CLASS}
                    data-sidebar="menu-button"
                    data-active={selected === "Luca" || undefined}
                    onClick={() => setSelected("Luca")}
                    type="button"
                  >
                    <ResidentIdentityMark
                      publicKey={"9".repeat(64)}
                      personaId="builtin:fizz"
                      accessibleName="Luca"
                      decorative
                      presentation="glyph"
                      size={20}
                    />
                    <span className="text-sm">Luca</span>
                  </button>
                </div>
                <RailSectionHeader title="Agents" />
                <button
                  className={RAIL_ROW_CLASS}
                  aria-expanded={expanded}
                  onClick={() => setExpanded(!expanded)}
                  type="button"
                >
                  <ResidentIdentityMark
                    publicKey={"a".repeat(64)}
                    accessibleName="Atlas"
                    decorative
                    presentation="glyph"
                    size={20}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">Atlas</span>
                  {expanded ? (
                    <ChevronDown className="size-3.5" />
                  ) : (
                    <ChevronRight className="size-3.5" />
                  )}
                </button>
                {expanded && (
                  <div className="ml-5 border-l border-border/40 pl-1">
                    {[
                      "Current conversation",
                      "A longer session title about the next iteration",
                    ].map((title) => (
                      <button
                        key={title}
                        className={RAIL_ROW_CLASS}
                        data-sidebar="menu-button"
                        data-active={selected === title || undefined}
                        onClick={() => setSelected(title)}
                        title={title}
                        type="button"
                      >
                        <span className="min-w-0 truncate text-sm">
                          {title}
                        </span>
                      </button>
                    ))}
                    <button
                      className={`${RAIL_CONTROL_CLASS} min-h-8 gap-2 px-2 text-xs`}
                      onClick={() =>
                        setNotice(
                          "Sample only: create a separate conversation with Atlas.",
                        )
                      }
                      type="button"
                    >
                      <Plus className="size-3" />
                      New session
                    </button>
                  </div>
                )}
                <RailSectionHeader title="Runtimes" />
                <div className="px-2 py-2 text-sm text-muted-foreground">
                  Codex
                </div>
              </nav>
              <section className="min-w-0 flex-1 border-l border-border/40 p-5">
                <h2 className="truncate text-sm">{selected}</h2>
                <p className="mt-8 text-sm text-muted-foreground">
                  The conversation opens directly beside the main rail.
                </p>
              </section>
            </div>
          </div>
          {controls && (
            <div className="space-y-2">
              <textarea
                aria-label="Design brief"
                readOnly
                value={brief}
                className="h-24 w-full rounded bg-muted/30 p-2 text-xs"
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(brief);
                    setNotice("Brief copied.");
                  } catch {
                    setNotice("Select the brief above and copy it manually.");
                  }
                }}
              >
                <Copy />
                Copy brief
              </Button>
            </div>
          )}
          <p role="status" className="text-xs text-muted-foreground">
            {notice ||
              "Saved variations stay in this browser and origin. No live messages or agents."}
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
