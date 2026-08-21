import {
  ChevronDown,
  Files,
  GitBranch,
  LoaderCircle,
  MessagesSquare,
  UserPlus,
  UsersRound,
} from "lucide-react";
import * as React from "react";

import {
  useConnectedBrainInventoryQuery,
  useOwnerBrainStateQuery,
} from "@/features/luca/brain/hooks";
import {
  ProjectCreationFailure,
  type ProjectCreationCheckpoint,
  type ProjectCreationDraft,
  type ProjectResidentSelection,
} from "@/features/projects/lib/projectCreationTransaction";
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

export type RoomProjectDraft = ProjectCreationDraft;

export type ProjectResidentOption = {
  name: string;
  pubkey: string;
  status: string;
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
  residentOptions,
  residentsLoading,
}: {
  isCreating: boolean;
  onCreate: (
    draft: RoomProjectDraft,
    checkpoint: ProjectCreationCheckpoint | null,
  ) => Promise<ProjectCreationCheckpoint>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  residentOptions: ProjectResidentOption[];
  residentsLoading: boolean;
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
  const [includeFirstRoom, setIncludeFirstRoom] = React.useState(true);
  const [residentMode, setResidentMode] =
    React.useState<ProjectResidentSelection["mode"]>("none");
  const [selectedResidents, setSelectedResidents] = React.useState<Set<string>>(
    new Set(),
  );
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [showPeople, setShowPeople] = React.useState(false);
  const [showContext, setShowContext] = React.useState(false);
  const [checkpoint, setCheckpoint] =
    React.useState<ProjectCreationCheckpoint | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setSelected(new Set());
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    setLabel("");
    setRoomName("general");
    setIncludeFirstRoom(true);
    setResidentMode("none");
    setSelectedResidents(new Set());
    setShowPeople(false);
    setShowContext(false);
    setCheckpoint(null);
    setIsSubmitting(false);
    setError(null);
  }, [open]);

  const isBusy = isCreating || isSubmitting;
  const isCheckpointed = Boolean(checkpoint?.projectId);
  const existingSelectionInvalid =
    residentMode === "existing" && selectedResidents.size === 0;
  const submitDisabled =
    !label.trim() ||
    (includeFirstRoom && !roomName.trim()) ||
    existingSelectionInvalid ||
    isBusy;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitDisabled) return;
    const residents: ProjectResidentSelection = includeFirstRoom
      ? residentMode === "existing"
        ? { mode: "existing", pubkeys: [...selectedResidents] }
        : { mode: residentMode }
      : { mode: "none" };
    setIsSubmitting(true);
    setError(null);
    try {
      const completed = await onCreate(
        {
          label: label.trim(),
          roomName: includeFirstRoom ? roomName.trim() : null,
          sourceIds: [...selected],
          residents,
        },
        checkpoint,
      );
      setCheckpoint(completed);
      onOpenChange(false);
    } catch (cause) {
      if (cause instanceof ProjectCreationFailure) {
        setCheckpoint(cause.checkpoint);
      }
      setError(
        cause instanceof Error ? cause.message : "Couldn’t create the channel.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const loadingSources = connected.isLoading || imported.isLoading;
  return (
    <Dialog open={open} onOpenChange={(next) => !isBusy && onOpenChange(next)}>
      <DialogContent
        className="flex max-h-[min(88vh,42rem)] max-w-xl flex-col gap-0 overflow-hidden p-0"
        data-testid="create-room-project-dialog"
      >
        <DialogHeader className="border-b border-border/55 px-6 pb-5 pt-6">
          <DialogTitle>New channel</DialogTitle>
          <DialogDescription>
            Create a shared space for related conversations and work.
          </DialogDescription>
        </DialogHeader>
        <form
          className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5"
          id="create-room-project-form"
          onSubmit={submit}
        >
          <Field htmlFor="create-project-name" label="Channel name">
            <Input
              autoFocus
              data-testid="create-project-name"
              disabled={isBusy || isCheckpointed}
              id="create-project-name"
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Luca beta"
              value={label}
            />
          </Field>

          <section
            aria-labelledby="project-first-room-label"
            className="space-y-3 rounded-lg border border-border/55 bg-muted/10 p-4"
          >
            <label
              className="flex cursor-pointer items-start gap-3"
              htmlFor="project-first-room-enabled"
            >
              <Checkbox
                checked={includeFirstRoom}
                data-testid="project-first-room-enabled"
                disabled={isBusy || isCheckpointed}
                id="project-first-room-enabled"
                onCheckedChange={(checked) => {
                  const enabled = checked === true;
                  setIncludeFirstRoom(enabled);
                  if (!enabled) {
                    setResidentMode("none");
                    setSelectedResidents(new Set());
                  }
                }}
              />
              <span>
                <span
                  className="block text-sm font-medium"
                  id="project-first-room-label"
                >
                  Start with a room
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Open the channel with its first conversation, or add one
                  later.
                </span>
              </span>
            </label>
            {includeFirstRoom ? (
              <Field htmlFor="create-project-room-name" label="Room name">
                <div className="relative">
                  <MessagesSquare className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
                  <Input
                    className="pl-9"
                    data-testid="create-project-room-name"
                    disabled={isBusy || isCheckpointed}
                    id="create-project-room-name"
                    onChange={(event) => setRoomName(event.target.value)}
                    value={roomName}
                  />
                </div>
              </Field>
            ) : null}
          </section>

          {includeFirstRoom ? (
            <DisclosureSection
              description="Choose who begins in the first room."
              label="People"
              open={showPeople}
              onToggle={() => setShowPeople((current) => !current)}
              summary={
                residentMode === "existing" && selectedResidents.size > 0
                  ? `${selectedResidents.size} selected`
                  : residentMode === "new"
                    ? "Create a new agent"
                    : "Add later"
              }
            >
              <div className="grid gap-2 sm:grid-cols-3">
                <ResidentModeButton
                  active={residentMode === "none"}
                  disabled={isBusy || isCheckpointed}
                  label="Add later"
                  onClick={() => {
                    setResidentMode("none");
                    setSelectedResidents(new Set());
                  }}
                  testId="project-resident-mode-none"
                />
                <ResidentModeButton
                  active={residentMode === "existing"}
                  disabled={isBusy || isCheckpointed}
                  label="Existing agents"
                  onClick={() => setResidentMode("existing")}
                  testId="project-resident-mode-existing"
                />
                <ResidentModeButton
                  active={residentMode === "new"}
                  disabled={isBusy || isCheckpointed}
                  label="New agent"
                  onClick={() => {
                    setResidentMode("new");
                    setSelectedResidents(new Set());
                  }}
                  testId="project-resident-mode-new"
                />
              </div>
              {residentMode === "existing" ? (
                <div className="max-h-40 overflow-y-auto rounded-xl border border-border/65 bg-muted/20 p-1">
                  {residentsLoading ? (
                    <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                      <LoaderCircle className="size-4 animate-spin" /> Finding
                      residents…
                    </div>
                  ) : residentOptions.length === 0 ? (
                    <div className="flex items-start gap-2 px-3 py-4 text-sm text-muted-foreground">
                      <UsersRound className="mt-0.5 size-4 shrink-0" />
                      <span>No existing residents are available.</span>
                    </div>
                  ) : (
                    residentOptions.map((resident) => (
                      <label
                        className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-3 transition-colors hover:bg-muted/55"
                        htmlFor={`project-resident-${resident.pubkey}`}
                        key={resident.pubkey}
                      >
                        <Checkbox
                          checked={selectedResidents.has(resident.pubkey)}
                          disabled={isBusy || isCheckpointed}
                          id={`project-resident-${resident.pubkey}`}
                          onCheckedChange={(checked) => {
                            setSelectedResidents((current) => {
                              const next = new Set(current);
                              if (checked) next.add(resident.pubkey);
                              else next.delete(resident.pubkey);
                              return next;
                            });
                          }}
                        />
                        <UsersRound className="size-4 shrink-0 text-ink-faint" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">
                            {resident.name}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {resident.status}
                          </span>
                        </span>
                      </label>
                    ))
                  )}
                </div>
              ) : null}
              {residentMode === "new" ? (
                <div className="flex items-start gap-2 rounded-xl border border-border/65 bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
                  <UserPlus className="mt-0.5 size-4 shrink-0" />
                  <span>
                    After the channel is ready, Luca will open agent setup for
                    this room.
                  </span>
                </div>
              ) : null}
              <p className="text-xs leading-5 text-muted-foreground">
                Room membership does not grant tools, models, credentials, or
                Brain access.
              </p>
            </DisclosureSection>
          ) : null}

          <DisclosureSection
            description="Attach existing Brain sources to this channel."
            label="Context"
            open={showContext}
            onToggle={() => setShowContext((current) => !current)}
            summary={
              selected.size > 0 ? `${selected.size} connected` : "Not connected"
            }
          >
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-sm font-medium" id="project-context-label">
                  Connected context
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Agent access still follows Brain permissions.
                </p>
              </div>
              {options.length > 0 ? (
                <button
                  className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                  disabled={isBusy || isCheckpointed}
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
                      disabled={!option.available || isBusy || isCheckpointed}
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
                    <Files className="size-4 shrink-0 text-ink-faint" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">
                        {option.label}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {option.available
                          ? option.detail
                          : "Source needs attention"}
                      </span>
                    </span>
                  </label>
                ))
              )}
            </div>
          </DisclosureSection>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </form>
        <DialogFooter className="shrink-0 border-t border-border/55 px-6 py-4">
          <Button
            disabled={isBusy}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            disabled={submitDisabled}
            form="create-room-project-form"
            type="submit"
          >
            {isBusy
              ? "Creating…"
              : isCheckpointed
                ? "Retry setup"
                : "Create channel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DisclosureSection({
  children,
  description,
  label,
  onToggle,
  open,
  summary,
}: {
  children: React.ReactNode;
  description: string;
  label: string;
  onToggle: () => void;
  open: boolean;
  summary: string;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border/55 bg-muted/10">
      <button
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left outline-none transition-colors hover:bg-muted/25 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={onToggle}
        type="button"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{label}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {description}
          </span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {summary}
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-150",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <div className="space-y-3 border-t border-border/45 px-4 pb-4 pt-3">
          {children}
        </div>
      ) : null}
    </section>
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

function ResidentModeButton({
  active,
  disabled,
  label,
  onClick,
  testId,
}: {
  active: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        "rounded-xl border px-3 py-2 text-left text-sm transition-colors",
        active
          ? "border-foreground/25 bg-muted/65 text-foreground"
          : "border-border/65 bg-transparent text-muted-foreground hover:bg-muted/35 hover:text-foreground",
      )}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}
