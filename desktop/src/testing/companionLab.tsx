/** Isolated current-component study. Browser simulation only; no native calls. */
import * as React from "react";
import { Check, Copy, Download, Settings2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { cn } from "@/shared/lib/cn";
import { CompanionExperienceControls, type CompanionExperienceDesign } from "@/features/profile/ui/companion/CompanionExperienceControls";
import { companionPreviewState, reduceCompanionPreview, type CompanionPreviewScene } from "@/features/profile/ui/companion/companionExperienceState";

export const COMPANION_LAB_STORAGE_KEY = "ui-design-lab.polyphonic.companion.v1";
const SCENES: readonly { id: CompanionPreviewScene; label: string }[] = [
  { id: "off", label: "Off · first choice" }, { id: "context", label: "Permitted sources" },
  { id: "carried", label: "Carried thread & quiet creation" }, { id: "paused", label: "Paused" },
  { id: "unavailable", label: "Source unavailable" }, { id: "busy", label: "Busy · sample task" },
  { id: "privacy", label: "Native-history choice" },
];
const PRESETS: readonly { name: string; design: CompanionExperienceDesign }[] = [
  { name: "Quiet", design: { density: "comfortable", measureRem: 36, identity: "sphere", contextDetail: "quiet" } },
  { name: "Context close", design: { density: "compact", measureRem: 38, identity: "glyph", contextDetail: "expanded" } },
  { name: "Room to carry", design: { density: "comfortable", measureRem: 42, identity: "sphere", contextDetail: "quiet" } },
];
type SavedVariation = { id: string; name: string; createdAt: string; version: 1; design: CompanionExperienceDesign; scene: CompanionPreviewScene };
type LabStorage = { version: 1; design: CompanionExperienceDesign; variants: SavedVariation[] };

function normalizeDesign(value: unknown): CompanionExperienceDesign {
  const input = value && typeof value === "object" ? value as Partial<CompanionExperienceDesign> : {};
  return {
    density: input.density === "compact" ? "compact" : "comfortable",
    measureRem: typeof input.measureRem === "number" && Number.isFinite(input.measureRem) ? Math.max(32, Math.min(46, input.measureRem)) : 36,
    identity: input.identity === "glyph" ? "glyph" : "sphere",
    contextDetail: input.contextDetail === "expanded" ? "expanded" : "quiet",
  };
}
function readStorage(): { value: LabStorage; error: string | null } {
  const fallback: LabStorage = { version: 1, design: { ...PRESETS[0].design }, variants: [] };
  try {
    const raw = window.localStorage.getItem(COMPANION_LAB_STORAGE_KEY);
    if (!raw) return { value: fallback, error: null };
    if (raw.length > 128 * 1024) return { value: fallback, error: "Saved lab data is too large and was left untouched. New local saves are disabled." };
    const stored = JSON.parse(raw) as Partial<LabStorage>;
    if (stored.version !== 1 || !Array.isArray(stored.variants)) return { value: fallback, error: "Saved lab data uses a different format. It was left untouched." };
    const valid = stored.variants.filter((item) => item && item.version === 1 && typeof item.id === "string" && item.id.length <= 128 && typeof item.name === "string" && item.name.length <= 80 && typeof item.createdAt === "string" && item.createdAt.length <= 64 && SCENES.some((scene) => scene.id === item.scene))
      .map((item) => ({ id: item.id, name: item.name, createdAt: item.createdAt, version: 1 as const, design: normalizeDesign(item.design), scene: item.scene }));
    if (valid.length !== stored.variants.length) return { value: { ...fallback, variants: valid }, error: "Some saved directions could not be restored. Original storage was left untouched." };
    return { value: { version: 1, design: normalizeDesign(stored.design), variants: valid }, error: null };
  } catch {
    return { value: fallback, error: "Local storage is unavailable or malformed. The lab still works; saved data was not cleared." };
  }
}
function briefFor(design: CompanionExperienceDesign, preset: string, scene: CompanionPreviewScene) {
  return `Polyphonic companion experience — isolated UI study, not approved product integration.\n\nDirection: ${preset}. Use the current shell’s real Button, Switch, identity glyph/sphere, neutral theme tokens, and rem-based typography. ${design.density} spacing; ${design.measureRem}rem reading measure; ${design.identity} identity; ${design.contextDetail} current-context detail. Preview scene: ${scene}.\n\nKeep one explicitly chosen companion. Separate short-lived observation, meaningful-note promotion, and provider sharing for each exact source. Awareness Pause and background-work Pause remain independent. Keep Shared carried commitments distinct from the companion’s own questions, and quiet creations on the shelf rather than automatically messaging.\n\nNever advertise unsupported account feeds, all-app text access, ordinary live-context injection, or verified private Codex planning. Local observations expire within 15 minutes; native/cloud history can retain transmitted bytes. Browser glass and every source/job/receipt here are simulations. Preserve normal messaging and readable keyboard/focus/compact layouts. No production mount or permission/model/capture calls before Riley reviews a direction.`;
}

export function CompanionExperienceLab() {
  const [initial] = React.useState(readStorage);
  const [design, setDesign] = React.useState(initial.value.design);
  const [variants, setVariants] = React.useState(initial.value.variants);
  const [storageError, setStorageError] = React.useState(initial.error);
  const [storageWritable, setStorageWritable] = React.useState(!initial.error);
  const [scene, setScene] = React.useState<CompanionPreviewScene>("off");
  const [preview, setPreview] = React.useState(() => companionPreviewState("off"));
  const [controlsVisible, setControlsVisible] = React.useState(true);
  const [compactViewport, setCompactViewport] = React.useState(false);
  const [open, setOpen] = React.useState(true);
  const [variationName, setVariationName] = React.useState("");
  const [copied, setCopied] = React.useState(false);
  const [manualCopy, setManualCopy] = React.useState(false);
  const [sampleNoteOpen, setSampleNoteOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [pendingSource, setPendingSource] = React.useState<string | undefined>();
  const preset = PRESETS.find((candidate) => JSON.stringify(candidate.design) === JSON.stringify(design))?.name ?? "Custom";
  const brief = briefFor(design, preset, scene);

  function persist(nextDesign: CompanionExperienceDesign, nextVariants: SavedVariation[]) {
    if (!storageWritable) return;
    try {
      window.localStorage.setItem(COMPANION_LAB_STORAGE_KEY, JSON.stringify({ version: 1, design: nextDesign, variants: nextVariants } satisfies LabStorage));
      setStorageError(null);
    } catch {
      setStorageError("Local save failed. This direction remains available in memory; export JSON to keep it.");
    }
  }
  function updateDesign(patch: Partial<CompanionExperienceDesign>) {
    const next = normalizeDesign({ ...design, ...patch });
    setDesign(next); persist(next, variants); setCopied(false);
  }
  function changeScene(next: CompanionPreviewScene) {
    setScene(next);
    // Preview-only interaction state resets; design tuning does not remount it.
    setPreview(companionPreviewState(next));
    setHistoryOpen(next === "privacy");
  }
  const shown = preview;
  function act(action: Parameters<typeof reduceCompanionPreview>[1]) {
    if (action.type === "companion" && action.companion !== preview.companion) {
      setScene("off"); setHistoryOpen(false); setPendingSource(undefined);
    }
    setPreview((previous) => reduceCompanionPreview(previous, action));
  }
  function saveVariation() {
    const name = variationName.trim();
    if (!name) return;
    if (variants.length >= 20) { setStorageError("Twenty directions are saved. Export or explicitly remove one before adding another."); return; }
    const next = [...variants, { id: crypto.randomUUID(), name: name.slice(0, 80), createdAt: new Date().toISOString(), version: 1 as const, design: { ...design }, scene }];
    setVariants(next); setVariationName(""); persist(design, next);
  }
  async function copyBrief() {
    try { await navigator.clipboard.writeText(brief); setCopied(true); setManualCopy(false); }
    catch { setCopied(false); setManualCopy(true); }
  }
  function exportJson() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ project: "Polyphonic", study: "Companion experience", version: 1, design, scene, variants, brief }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "polyphonic-companion-lab-v1.json"; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  function historyAnswer(choice: "declined" | "sample_allowed") {
    act({ type: "history", choice });
    if (choice === "sample_allowed" && pendingSource) act({ type: "source", id: pendingSource, choice: "egress", enabled: true });
    setHistoryOpen(false); setPendingSource(undefined);
  }

  return <>
    {!open ? <Button variant="outline" className="fixed right-5 top-5 z-40" onClick={() => setOpen(true)}>Open companion study</Button> : null}
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[64rem] overflow-y-auto" data-testid="companion-experience-lab">
        <DialogHeader className="pr-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <DialogTitle>Companion experience</DialogTitle>
            <Button size="sm" variant="ghost" onClick={() => setControlsVisible(!controlsVisible)}><Settings2 aria-hidden />{controlsVisible ? "Hide lab controls" : "Show lab controls"}</Button>
          </div>
          <DialogDescription>Current-component study · sample data only. Native glass is a browser simulation. No sources, model, or background task are active.</DialogDescription>
        </DialogHeader>
        <div className={cn("grid min-w-0 gap-7", controlsVisible && "md:grid-cols-[13rem_minmax(0,1fr)]")}>
          {controlsVisible ? <aside aria-label="Companion lab controls" className="min-w-0 space-y-5 text-xs">
            <fieldset className="space-y-2"><legend className="mb-2 text-xs font-medium">Direction · {preset}</legend>
              {PRESETS.map((candidate) => <Button key={candidate.name} variant={preset === candidate.name ? "secondary" : "ghost"} size="sm" className="w-full justify-start" onClick={() => updateDesign(candidate.design)}>{candidate.name}</Button>)}
            </fieldset>
            <LabSelect label="Scene" value={scene} onChange={(value) => changeScene(value as CompanionPreviewScene)} options={SCENES.map((item) => ({ value: item.id, label: item.label }))} />
            <LabSelect label="Spacing" value={design.density} onChange={(value) => updateDesign({ density: value as CompanionExperienceDesign["density"] })} options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} />
            <label className="block space-y-2"><span>Reading measure · {design.measureRem}rem</span><input type="range" min={32} max={46} step={1} value={design.measureRem} onChange={(event) => updateDesign({ measureRem: Number(event.target.value) })} className="w-full accent-foreground" /></label>
            <LabSelect label="Identity" value={design.identity} onChange={(value) => updateDesign({ identity: value as CompanionExperienceDesign["identity"] })} options={[{ value: "sphere", label: "Current sphere" }, { value: "glyph", label: "Current glyph" }]} />
            <LabSelect label="Context detail" value={design.contextDetail} onChange={(value) => updateDesign({ contextDetail: value as CompanionExperienceDesign["contextDetail"] })} options={[{ value: "quiet", label: "Quiet summary" }, { value: "expanded", label: "Source detail" }]} />
            <Button variant="outline" size="sm" className="w-full" onClick={() => setCompactViewport(!compactViewport)}>{compactViewport ? "Use full panel width" : "Test compact width"}</Button>
            {compactViewport ? <p className="leading-5 text-muted-foreground">22rem viewport at 1:1. Reading measure is clamped to the available width, not scaled.</p> : null}
            {scene === "carried" ? <LabSelect label="Sample resident decision" value={shown.own} onChange={(value) => act({ type: "own", disposition: value as typeof shown.own })} options={[{ value: "pursue", label: "Pursue" }, { value: "defer", label: "Defer" }, { value: "decline", label: "Decline" }]} /> : null}
            <div className="space-y-2 border-t border-border/45 pt-4">
              <label className="block space-y-2"><span>Save a direction</span><Input aria-label="Variation name" value={variationName} maxLength={80} placeholder="Name this direction" onChange={(event) => setVariationName(event.target.value)} /></label>
              <Button size="sm" variant="outline" disabled={!variationName.trim() || !storageWritable} onClick={saveVariation}>Save variation</Button>
              {variants.map((variation) => <div key={variation.id} className="flex items-center gap-1">
                <Button size="sm" variant="ghost" className="min-w-0 flex-1 justify-start overflow-hidden text-ellipsis" onClick={() => { const next = normalizeDesign(variation.design); setDesign(next); changeScene(variation.scene); persist(next, variants); }}>{variation.name}</Button>
                <Button size="icon-xs" variant="ghost" aria-label={`Remove ${variation.name}`} onClick={() => { const next = variants.filter((item) => item.id !== variation.id); setVariants(next); persist(design, next); }}>×</Button>
              </div>)}
              <Button size="sm" variant="ghost" className="w-full justify-start" onClick={() => { updateDesign(PRESETS[0].design); changeScene("off"); }}>Reset study, keep variations</Button>
              <Button size="sm" variant="ghost" className="w-full justify-start" onClick={exportJson}><Download aria-hidden />Export JSON</Button>
              {storageError ? <p className="leading-5 text-muted-foreground" role="status">{storageError}</p> : null}
              {!storageWritable ? <Button size="sm" variant="outline" onClick={() => { setStorageWritable(true); setStorageError("New local saves are enabled. The next save will replace incompatible data in this lab’s namespace."); }}>Allow replacing this lab’s saved data</Button> : null}
              <p className="leading-5 text-muted-foreground">Directions stay in this browser and local origin only. Mock grants and messages are not saved.</p>
            </div>
          </aside> : null}
          <div className="min-w-0" style={compactViewport ? { maxWidth: "22rem", marginInline: "auto", width: "100%" } : undefined}>
            <CompanionExperienceControls state={shown} design={design} onAction={act} onOpenCreation={() => setSampleNoteOpen(true)} onReviewHistory={(sourceId) => { setPendingSource(sourceId); setHistoryOpen(true); }} />
          </div>
        </div>
        {controlsVisible ? <details className="border-t border-border/45 pt-4"><summary className="cursor-pointer text-xs font-medium">Live design brief</summary><p className="mt-3 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{brief}</p><Button size="sm" variant="ghost" className="mt-3" onClick={() => void copyBrief()}>{copied ? <Check aria-hidden /> : <Copy aria-hidden />}{copied ? "Copied" : "Copy brief"}</Button>{manualCopy ? <label className="mt-3 block space-y-2 text-xs">Clipboard unavailable · select and copy below<Textarea value={brief} readOnly rows={10} /></label> : null}</details> : null}
      </DialogContent>
    </Dialog>
    <Dialog open={sampleNoteOpen} onOpenChange={setSampleNoteOpen}><DialogContent><DialogHeader><DialogTitle>A note on the small study</DialogTitle><DialogDescription>Sample authored creation · not a real native execution or Library record.</DialogDescription></DialogHeader><div className="space-y-4 text-sm leading-6"><p>The useful constraint is a clear first choice. Let everything else arrive when it becomes relevant.</p><p>Keep source access visible, but keep the work itself calm. A quiet note can wait on the shelf without becoming a message.</p><p className="text-xs text-muted-foreground">Sample receipt: local Library preservation · two source references · no publication.</p></div><Button variant="outline" onClick={() => setSampleNoteOpen(false)}>Close sample note</Button></DialogContent></Dialog>
    <Dialog open={historyOpen} onOpenChange={setHistoryOpen}><DialogContent><DialogHeader><DialogTitle>Where selected context could stay</DialogTitle><DialogDescription>Sample consent prompt. This does not change native settings or enable sharing.</DialogDescription></DialogHeader><div className="space-y-3 text-sm leading-6"><p>Sending selected context to your companion’s native runtime can leave it in that runtime’s chat history, and may send it to a cloud provider.</p><p>Local expiry, Pause, and Forget cannot erase copies already received there. Keeping meaningful notes is a separate choice.</p><p className="text-xs text-muted-foreground">Live context in ordinary chat remains off while this scope is reviewed. Private Codex planning is also unverified.</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => historyAnswer("declined")}>Keep sharing off</Button><Button variant="secondary" onClick={() => historyAnswer("sample_allowed")}>Allow in this sample</Button><Button variant="ghost" onClick={() => setHistoryOpen(false)}>Decide later</Button></div></DialogContent></Dialog>
  </>;
}

function LabSelect({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  const id = React.useId();
  return <label className="block space-y-2" htmlFor={id}><span>{label}</span><select id={id} value={value} onChange={(event) => onChange(event.target.value)} className="h-9 w-full rounded-lg border border-input/40 bg-background px-2 text-xs">{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}
