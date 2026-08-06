import * as React from "react";
import {
  AlertCircle,
  Check,
  ExternalLink,
  FileClock,
  LoaderCircle,
  Pencil,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import {
  getChannelIdFromTags,
  getThreadReference,
} from "@/features/messages/lib/threading";
import { getEventById } from "@/shared/api/tauri";
import {
  correctResidentHandoff,
  forgetResidentHandoff,
  getResidentContinuity,
  type ResidentContinuityInspector,
  type ResidentHandoff,
  retryResidentHandoff,
  setResidentContinuityEnabled,
} from "@/shared/api/tauriContinuity";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { Button } from "@/shared/ui/button";
import { Switch } from "@/shared/ui/switch";
import { Textarea } from "@/shared/ui/textarea";

type HandoffDraft = {
  summary: string;
  unresolvedThreads: string;
  commitments: string;
  explicitPreferences: string;
};

const EMPTY_DRAFT: HandoffDraft = {
  summary: "",
  unresolvedThreads: "",
  commitments: "",
  explicitPreferences: "",
};

export function ResidentContinuityPanel({
  residentPubkey,
}: {
  residentPubkey: string;
}) {
  const { goChannel } = useAppNavigation();
  const [data, setData] = React.useState<ResidentContinuityInspector | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [confirmForget, setConfirmForget] = React.useState(false);
  const [draft, setDraft] = React.useState<HandoffDraft>(EMPTY_DRAFT);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getResidentContinuity(residentPubkey));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [residentPubkey]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  React.useEffect(() => {
    const state = data?.job?.state;
    if (state !== "pending" && state !== "running") return;
    const interval = window.setInterval(() => void refresh(), 2_500);
    return () => window.clearInterval(interval);
  }, [data?.job?.state, refresh]);

  React.useEffect(() => {
    if (data?.handoff && !editing) {
      setDraft(toDraft(data.handoff));
    }
  }, [data?.handoff, editing]);

  const apply = React.useCallback(
    async (
      action: () => Promise<ResidentContinuityInspector>,
      success: string,
    ) => {
      setBusy(true);
      setError(null);
      try {
        const next = await action();
        setData(next);
        toast.success(success);
        return true;
      } catch (cause) {
        const message = errorMessage(cause);
        setError(message);
        toast.error(message);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  async function saveDraft(nextDraft = draft) {
    const correction = {
      summary: nextDraft.summary.trim(),
      unresolvedThreads: lines(nextDraft.unresolvedThreads),
      commitments: lines(nextDraft.commitments),
      explicitPreferences: lines(nextDraft.explicitPreferences),
    };
    const saved = await apply(
      () => correctResidentHandoff(residentPubkey, correction),
      "Continuity corrected.",
    );
    if (saved) setEditing(false);
  }

  async function removeItem(
    field: "unresolvedThreads" | "commitments" | "explicitPreferences",
    index: number,
  ) {
    if (!data?.handoff) return;
    const next = toDraft(data.handoff);
    next[field] = lines(next[field])
      .filter((_, itemIndex) => itemIndex !== index)
      .join("\n");
    setDraft(next);
    await saveDraft(next);
  }

  async function openSource(eventId: string) {
    try {
      const event = await getEventById(eventId);
      const channelId = getChannelIdFromTags(event.tags);
      if (!channelId)
        throw new Error("The source conversation is unavailable.");
      const thread = getThreadReference(event.tags);
      await goChannel(channelId, {
        messageId: eventId,
        threadRootId: thread.rootId,
      });
    } catch (cause) {
      toast.error(errorMessage(cause));
    }
  }

  if (loading && !data) {
    return (
      <div className="flex min-h-32 items-center justify-center text-sm text-muted-foreground">
        <LoaderCircle className="mr-2 size-4 animate-spin" />
        Loading continuity…
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="resident-continuity-panel">
      <section className="overflow-hidden rounded-2xl bg-muted/20">
        <div className="flex items-start justify-between gap-4 px-4 py-4">
          <div className="min-w-0">
            <h4 className="text-sm font-medium text-foreground">Continuity</h4>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              Luca keeps one small encrypted handoff for this resident. It is
              separate from the agent&apos;s native memory and configuration.
            </p>
          </div>
          <Switch
            aria-label="Enable resident continuity"
            checked={data?.enabled ?? true}
            disabled={busy}
            onCheckedChange={(enabled) => {
              void apply(
                () => setResidentContinuityEnabled(residentPubkey, enabled),
                enabled ? "Continuity enabled." : "Continuity disabled.",
              );
            }}
          />
        </div>
        <div className="border-t border-border/50 px-4 py-3">
          <ContinuityStatus data={data} />
        </div>
      </section>

      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {data?.job?.canRetry ? (
        <Button
          className="w-full"
          disabled={busy || !data.enabled}
          onClick={() =>
            void apply(
              () => retryResidentHandoff(residentPubkey),
              "Continuity retry scheduled.",
            )
          }
          variant="outline"
        >
          <RotateCcw /> Retry failed handoff
        </Button>
      ) : null}

      {data?.handoff ? (
        editing ? (
          <HandoffEditor
            busy={busy}
            draft={draft}
            onCancel={() => {
              setDraft(toDraft(data.handoff as ResidentHandoff));
              setEditing(false);
            }}
            onChange={setDraft}
            onSave={() => void saveDraft()}
          />
        ) : (
          <HandoffView
            handoff={data.handoff}
            onEdit={() => setEditing(true)}
            onForget={() => setConfirmForget(true)}
            onOpenSource={(eventId) => void openSource(eventId)}
            onRemoveItem={(field, index) => void removeItem(field, index)}
          />
        )
      ) : (
        <ContinuityEmptyState
          availability={data?.availability ?? "unavailable"}
        />
      )}

      <AlertDialog onOpenChange={setConfirmForget} open={confirmForget}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Forget this handoff?</AlertDialogTitle>
            <AlertDialogDescription>
              Luca will permanently purge the encrypted handoff and its prior
              revisions. The agent&apos;s native memory is not changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                void apply(
                  () => forgetResidentHandoff(residentPubkey),
                  "Encrypted handoff forgotten.",
                ).then((forgotten) => {
                  if (forgotten) setConfirmForget(false);
                });
              }}
            >
              Forget handoff
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ContinuityStatus({
  data,
}: {
  data: ResidentContinuityInspector | null;
}) {
  const job = data?.job;
  const active = job?.state === "pending" || job?.state === "running";
  return (
    <div className="flex items-center justify-between gap-3 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
      <span>{data?.enabled ? data.availability : "disabled"}</span>
      <span className="flex items-center gap-1.5">
        {active ? <LoaderCircle className="size-3 animate-spin" /> : null}
        {job ? job.state : "no jobs"}
      </span>
    </div>
  );
}

function HandoffView({
  handoff,
  onEdit,
  onForget,
  onOpenSource,
  onRemoveItem,
}: {
  handoff: ResidentHandoff;
  onEdit: () => void;
  onForget: () => void;
  onOpenSource: (eventId: string) => void;
  onRemoveItem: (
    field: "unresolvedThreads" | "commitments" | "explicitPreferences",
    index: number,
  ) => void;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border/60 bg-background/30">
      <div className="flex items-center justify-between gap-3 border-b border-border/50 px-4 py-3">
        <div>
          <p className="text-sm font-medium">Current handoff</p>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
            {relativeDate(handoff.updatedAt)} · revision {handoff.revision}
            {handoff.pinnedOwnerCorrection ? " · owner corrected" : ""}
          </p>
        </div>
        <Button
          aria-label="Correct handoff"
          onClick={onEdit}
          size="icon"
          variant="ghost"
        >
          <Pencil />
        </Button>
      </div>
      <div className="space-y-5 px-4 py-4">
        {handoff.summary ? (
          <div>
            <SectionLabel>Summary</SectionLabel>
            <p className="mt-2 text-sm leading-6 text-foreground/90">
              {handoff.summary}
            </p>
          </div>
        ) : null}
        <HandoffItems
          field="unresolvedThreads"
          items={handoff.unresolvedThreads}
          label="Unresolved"
          onRemove={onRemoveItem}
        />
        <HandoffItems
          field="commitments"
          items={handoff.commitments}
          label="Commitments"
          onRemove={onRemoveItem}
        />
        <HandoffItems
          field="explicitPreferences"
          items={handoff.explicitPreferences}
          label="Explicit preferences"
          onRemove={onRemoveItem}
        />
        <div>
          <SectionLabel>Sources</SectionLabel>
          <div className="mt-2 flex flex-wrap gap-2">
            {handoff.sourceEventIds.map((eventId) => (
              <button
                className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-2 py-1 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                key={eventId}
                onClick={() => onOpenSource(eventId)}
                type="button"
              >
                {eventId.slice(0, 8)}
                <ExternalLink className="size-3" />
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="border-t border-border/50 px-4 py-3">
        <Button
          className="px-0 text-muted-foreground"
          onClick={onForget}
          variant="ghost"
        >
          <Trash2 /> Forget handoff
        </Button>
      </div>
    </section>
  );
}

function HandoffItems({
  field,
  items,
  label,
  onRemove,
}: {
  field: "unresolvedThreads" | "commitments" | "explicitPreferences";
  items: string[];
  label: string;
  onRemove: (
    field: "unresolvedThreads" | "commitments" | "explicitPreferences",
    index: number,
  ) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <ul className="mt-2 divide-y divide-border/40">
        {items.map((item, index) => (
          <li
            className="group flex items-start gap-2 py-2 first:pt-0 last:pb-0"
            key={`${field}-${item}`}
          >
            <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/60" />
            <span className="min-w-0 flex-1 text-sm leading-5 text-foreground/85">
              {item}
            </span>
            <button
              aria-label={`Remove ${label.toLowerCase()} item`}
              className="shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100"
              onClick={() => onRemove(field, index)}
              type="button"
            >
              <X className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HandoffEditor({
  busy,
  draft,
  onCancel,
  onChange,
  onSave,
}: {
  busy: boolean;
  draft: HandoffDraft;
  onCancel: () => void;
  onChange: (draft: HandoffDraft) => void;
  onSave: () => void;
}) {
  const fields: Array<{
    key: keyof HandoffDraft;
    label: string;
    rows: number;
    hint?: string;
  }> = [
    { key: "summary", label: "Summary", rows: 4 },
    {
      key: "unresolvedThreads",
      label: "Unresolved threads",
      rows: 3,
      hint: "One item per line",
    },
    {
      key: "commitments",
      label: "Commitments",
      rows: 3,
      hint: "One item per line",
    },
    {
      key: "explicitPreferences",
      label: "Explicit preferences",
      rows: 3,
      hint: "One item per line",
    },
  ];
  return (
    <section className="space-y-4 rounded-2xl border border-border/60 bg-background/30 px-4 py-4">
      <div>
        <p className="text-sm font-medium">Correct handoff</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Your correction becomes the pinned effective revision.
        </p>
      </div>
      {fields.map((field) => (
        <div className="block" key={field.key}>
          <label
            className="flex items-center justify-between gap-2 text-xs font-medium text-foreground/85"
            htmlFor={`resident-continuity-${field.key}`}
          >
            <span>{field.label}</span>
            {field.hint ? (
              <span className="font-normal text-muted-foreground">
                {field.hint}
              </span>
            ) : null}
          </label>
          <Textarea
            className="mt-1.5 resize-y bg-background/60 text-sm leading-5"
            disabled={busy}
            id={`resident-continuity-${field.key}`}
            onChange={(event) =>
              onChange({ ...draft, [field.key]: event.target.value })
            }
            rows={field.rows}
            value={draft[field.key]}
          />
        </div>
      ))}
      <div className="flex justify-end gap-2">
        <Button disabled={busy} onClick={onCancel} variant="ghost">
          Cancel
        </Button>
        <Button disabled={busy} onClick={onSave}>
          {busy ? <LoaderCircle className="animate-spin" /> : <Check />}
          Save correction
        </Button>
      </div>
    </section>
  );
}

function ContinuityEmptyState({ availability }: { availability: string }) {
  const copy =
    availability === "locked"
      ? "Continuity is locked. Messaging still works normally."
      : availability === "invalid"
        ? "This handoff could not be authenticated. Messaging is unaffected."
        : availability === "unavailable"
          ? "Continuity is temporarily unavailable. Messaging is unaffected."
          : "No handoff yet. After a meaningful exchange, this resident may preserve a compact working-state summary.";
  return (
    <div className="flex min-h-40 flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 px-6 py-8 text-center">
      <FileClock className="size-5 text-muted-foreground" />
      <p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
        {copy}
      </p>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
      {children}
    </p>
  );
}

function toDraft(handoff: ResidentHandoff): HandoffDraft {
  return {
    summary: handoff.summary,
    unresolvedThreads: handoff.unresolvedThreads.join("\n"),
    commitments: handoff.commitments.join("\n"),
    explicitPreferences: handoff.explicitPreferences.join("\n"),
  };
}

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function relativeDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "updated" : date.toLocaleString();
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
