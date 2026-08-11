import { Files, GitBranch, LoaderCircle, MessagesSquare } from "lucide-react";
import * as React from "react";

import {
  useConnectedBrainInventoryQuery,
  useOwnerBrainStateQuery,
} from "@/features/luca/brain/hooks";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";

export type RoomProjectDraft = {
  label: string;
  roomName: string;
  sourceIds: string[];
};

type SourceOption = {
  id: string;
  label: string;
  detail: string;
  available: boolean;
};

export function CreateRoomProjectDialog({
  isCreating,
  onCreate,
  onOpenChange,
  open,
}: {
  isCreating: boolean;
  onCreate: (draft: RoomProjectDraft) => Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const connected = useConnectedBrainInventoryQuery();
  const imported = useOwnerBrainStateQuery();
  const options = React.useMemo<SourceOption[]>(() => {
    const candidates: SourceOption[] = [
      ...(connected.data?.sources ?? []).map(
        (source): SourceOption => ({
          id: source.sourceId,
          label: source.displayName,
          detail:
            source.sourceKind === "repository"
              ? "Repository"
              : source.sourceKind === "codex_history"
                ? "Codex history"
                : "Claude Code history",
          available: source.status === "current",
        }),
      ),
      ...(imported.data?.sources ?? []).map(
        (source): SourceOption => ({
          id: source.sourceId,
          label: source.displayName,
          detail:
            source.sourceKind === "text_folder" ? "Knowledge folder" : "File",
          available: source.status === "ready",
        }),
      ),
    ];
    return [
      ...new Map(candidates.map((option) => [option.id, option])).values(),
    ];
  }, [connected.data?.sources, imported.data?.sources]);
  const [label, setLabel] = React.useState("");
  const [roomName, setRoomName] = React.useState("general");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [error, setError] = React.useState<string | null>(null);
  const initializedRef = React.useRef(false);

  React.useEffect(() => {
    if (!open) {
      initializedRef.current = false;
      setSelected(new Set());
      return;
    }
    if (!initializedRef.current && options.length > 0) {
      initializedRef.current = true;
      setSelected(
        new Set(
          options
            .filter((option) => option.available)
            .map((option) => option.id),
        ),
      );
    }
  }, [open, options]);

  React.useEffect(() => {
    if (!open) return;
    setLabel("");
    setRoomName("general");
    setError(null);
  }, [open]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!label.trim() || !roomName.trim() || isCreating) return;
    setError(null);
    try {
      await onCreate({
        label: label.trim(),
        roomName: roomName.trim(),
        sourceIds: [...selected],
      });
      onOpenChange(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Couldn’t create the project.",
      );
    }
  };

  const loadingSources = connected.isLoading || imported.isLoading;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !isCreating && onOpenChange(next)}
    >
      <DialogContent
        className="max-w-xl gap-5"
        data-testid="create-room-project-dialog"
      >
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            Create a focused place for conversations and the work they should
            stay close to.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          id="create-room-project-form"
          onSubmit={submit}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field htmlFor="create-project-name" label="Project name">
              <Input
                autoFocus
                data-testid="create-project-name"
                disabled={isCreating}
                id="create-project-name"
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Polyphonic"
                value={label}
              />
            </Field>
            <Field htmlFor="create-project-room-name" label="First room">
              <div className="relative">
                <MessagesSquare className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/55" />
                <Input
                  className="pl-9"
                  data-testid="create-project-room-name"
                  disabled={isCreating}
                  id="create-project-room-name"
                  onChange={(event) => setRoomName(event.target.value)}
                  value={roomName}
                />
              </div>
            </Field>
          </div>

          <section
            aria-labelledby="project-context-label"
            className="space-y-2"
          >
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-sm font-medium" id="project-context-label">
                  Connected context
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Optional. Resident access still follows Brain permissions.
                </p>
              </div>
              {options.length > 0 ? (
                <button
                  className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() =>
                    setSelected(
                      selected.size > 0
                        ? new Set()
                        : new Set(
                            options
                              .filter((option) => option.available)
                              .map((option) => option.id),
                          ),
                    )
                  }
                  type="button"
                >
                  {selected.size > 0 ? "Clear" : "Select all"}
                </button>
              ) : null}
            </div>
            <div className="max-h-48 overflow-y-auto rounded-xl border border-border/65 bg-muted/20 p-1">
              {loadingSources ? (
                <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                  <LoaderCircle className="size-4 animate-spin" /> Finding
                  connected work…
                </div>
              ) : options.length === 0 ? (
                <div className="flex items-start gap-2 px-3 py-4 text-sm text-muted-foreground">
                  <GitBranch className="mt-0.5 size-4 shrink-0" />
                  <span>
                    No Brain sources are connected yet. You can add them later.
                  </span>
                </div>
              ) : (
                options.map((option) => (
                  <label
                    className={cn(
                      "flex min-h-12 items-center gap-3 rounded-lg px-3 transition-colors",
                      option.available
                        ? "cursor-pointer hover:bg-muted/55"
                        : "opacity-50",
                    )}
                    htmlFor={`project-source-${option.id}`}
                    key={option.id}
                  >
                    <Checkbox
                      checked={selected.has(option.id)}
                      disabled={!option.available || isCreating}
                      id={`project-source-${option.id}`}
                      onCheckedChange={(checked) => {
                        setSelected((current) => {
                          const next = new Set(current);
                          if (checked) next.add(option.id);
                          else next.delete(option.id);
                          return next;
                        });
                      }}
                    />
                    <Files className="size-4 shrink-0 text-muted-foreground/60" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">
                        {option.label}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {option.available ? option.detail : "Needs attention"}
                      </span>
                    </span>
                  </label>
                ))
              )}
            </div>
          </section>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </form>
        <DialogFooter>
          <Button
            disabled={isCreating}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            disabled={!label.trim() || !roomName.trim() || isCreating}
            form="create-room-project-form"
            type="submit"
          >
            {isCreating ? "Creating…" : "Create project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  children,
  htmlFor,
  label,
}: {
  children: React.ReactNode;
  htmlFor: string;
  label: string;
}) {
  return (
    <label className="space-y-1.5" htmlFor={htmlFor}>
      <span className="block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
