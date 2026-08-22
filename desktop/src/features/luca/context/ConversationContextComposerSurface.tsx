import {
  AlertTriangle,
  Check,
  ChevronDown,
  CircleDot,
  Folder,
  FolderOpen,
  RotateCcw,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import {
  createRoomProject,
  deleteRoomProject,
  updateRoomProjectSources,
} from "@/features/channels/lib/roomProjects";
import { useCommunities } from "@/features/communities/useCommunities";
import { useConnectedBrainInventoryQuery } from "@/features/luca/brain/hooks";
import {
  useConversationContextActions,
  useConversationContextQuery,
} from "@/features/luca/context/hooks";
import { useIdentityQuery } from "@/shared/api/hooks";
import type { ConnectedBrainSource } from "@/shared/api/tauriBrain";
import type {
  ConversationContextSource,
  ConversationContextView,
} from "@/shared/api/tauriConversationContext";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { Input } from "@/shared/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui/sheet";
import { cn } from "@/shared/lib/cn";

export type ConversationProjectContext = {
  projectId: string;
  label: string;
  sourceIds: string[];
};

export type ConversationContextComposerConfig = {
  conversationId: string;
  conversationName: string;
  project: ConversationProjectContext | null;
  changesDisabled: boolean;
};

type DraftPrimary = "inherit" | "none" | `source:${string}`;

function effectiveSourceIds(view: ConversationContextView): string[] {
  return [
    ...(view.primary ? [view.primary.sourceId] : []),
    ...view.additionalSources.map((source) => source.sourceId),
  ];
}

function initialPrimary(
  view: ConversationContextView,
  hasProject: boolean,
): DraftPrimary {
  if (view.primary?.origin === "room") {
    return `source:${view.primary.sourceId}`;
  }
  if (hasProject) return "inherit";
  return "none";
}

function sourceStatus(source: ConnectedBrainSource) {
  switch (source.status) {
    case "current":
      return "Available";
    case "connecting":
      return "Connecting";
    default:
      return "Needs attention";
  }
}

function ContextChip({
  onClick,
  view,
}: {
  onClick: () => void;
  view: ConversationContextView;
}) {
  if (view.status === "empty") return null;
  const count = view.additionalSources.length;
  return (
    <button
      className={cn(
        "mb-1.5 flex min-w-0 max-w-full items-center gap-1.5 self-start rounded-md border border-border/70 bg-plate/70 px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-plate hover:text-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
        view.status === "missing_primary" &&
          "border-destructive/40 text-destructive",
      )}
      data-testid="conversation-context-chip"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        // Opening after the originating click completes keeps Radix's
        // outside-interaction guard from immediately dismissing the sheet.
        window.setTimeout(onClick, 0);
      }}
      type="button"
    >
      {view.status === "missing_primary" ? (
        <AlertTriangle className="size-3.5 shrink-0" />
      ) : (
        <Folder className="size-3.5 shrink-0" />
      )}
      <span className="truncate">
        {view.primary?.label ?? "Conversation context"}
      </span>
      {count > 0 ? (
        <span className="shrink-0 text-muted-foreground">+{count}</span>
      ) : null}
    </button>
  );
}

function SourceMeta({ source }: { source: ConversationContextSource }) {
  return (
    <span className="text-2xs text-muted-foreground">
      {source.origin === "project" ? "From project" : "This room"}
      {source.nativeDirectory ? " · Direct folder access" : " · Brain only"}
    </span>
  );
}

export function ConversationContextComposerSurface({
  config,
  onOpenChange,
  onSendBlockedChange,
  open,
}: {
  config: ConversationContextComposerConfig;
  onOpenChange: (open: boolean) => void;
  onSendBlockedChange?: (blocked: boolean) => void;
  open: boolean;
}) {
  const identity = useIdentityQuery();
  const communities = useCommunities();
  const inventory = useConnectedBrainInventoryQuery();
  const context = useConversationContextQuery({
    conversationId: config.conversationId,
    projectId: config.project?.projectId ?? null,
    projectSourceIds: config.project?.sourceIds ?? [],
  });
  const actions = useConversationContextActions(config.conversationId);
  const [draftPrimary, setDraftPrimary] = React.useState<DraftPrimary>("none");
  const [draftAdditional, setDraftAdditional] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [marker, setMarker] = React.useState<string | null>(null);
  const [newProjectName, setNewProjectName] = React.useState("");
  const view = context.data ?? null;
  const hasProject = config.project !== null;

  React.useEffect(() => {
    onSendBlockedChange?.(view?.status === "missing_primary");
  }, [onSendBlockedChange, view?.status]);

  React.useEffect(() => {
    if (!open || !view) return;
    setDraftPrimary(initialPrimary(view, hasProject));
    setDraftAdditional(
      new Set(
        view.additionalSources
          .filter((source) => source.origin === "room")
          .map((source) => source.sourceId),
      ),
    );
    setError(null);
  }, [hasProject, open, view]);

  const repositorySources = React.useMemo(
    () =>
      (inventory.data?.sources ?? []).filter(
        (source) => source.sourceKind === "repository",
      ),
    [inventory.data?.sources],
  );
  const allSources = inventory.data?.sources ?? [];
  const projectAdditional = new Set(
    view?.additionalSources
      .filter((source) => source.origin === "project")
      .map((source) => source.sourceId) ?? [],
  );
  const busy =
    actions.update.isPending ||
    actions.promote.isPending ||
    actions.clearOverride.isPending ||
    actions.pickFolder.isPending;
  const controlsDisabled = config.changesDisabled || busy;

  async function save() {
    if (!view || controlsDisabled) return;
    setError(null);
    const primaryMode: "inherit" | "none" | "source" = draftPrimary.startsWith(
      "source:",
    )
      ? "source"
      : draftPrimary === "inherit"
        ? "inherit"
        : "none";
    const primarySourceId = draftPrimary.startsWith("source:")
      ? draftPrimary.slice("source:".length)
      : null;
    try {
      const next = await actions.update.mutateAsync({
        conversationId: config.conversationId,
        projectId: config.project?.projectId ?? null,
        expectedRevision: view.revision,
        primaryMode,
        primarySourceId,
        additionalSourceIds: [...draftAdditional],
      });
      setMarker(
        next.primary
          ? `Working in ${next.primary.label} from here.`
          : "Working without a primary folder from here.",
      );
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function relink() {
    if (!view) return;
    setError(null);
    try {
      const next = await actions.pickFolder.mutateAsync({
        conversationId: config.conversationId,
        projectId: config.project?.projectId ?? null,
        expectedRevision: view.revision,
      });
      if (next?.primary) {
        setMarker(`Working in ${next.primary.label} from here.`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function continueWithoutPrimary() {
    if (!view) return;
    setError(null);
    try {
      await actions.update.mutateAsync({
        conversationId: config.conversationId,
        projectId: config.project?.projectId ?? null,
        expectedRevision: view.revision,
        primaryMode: "none",
        primarySourceId: null,
        additionalSourceIds: view.additionalSources
          .filter((source) => source.origin === "room")
          .map((source) => source.sourceId),
      });
      setMarker("Working without a primary folder from here.");
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function clearOverride() {
    if (!view) return;
    setError(null);
    try {
      const next = await actions.clearOverride.mutateAsync({
        conversationId: config.conversationId,
        projectId: config.project?.projectId ?? null,
        expectedRevision: view.revision,
      });
      setMarker(
        next.primary
          ? `Working in ${next.primary.label} from here.`
          : "Project context restored.",
      );
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function saveToProject() {
    if (!view || !config.project) return;
    setError(null);
    try {
      const next = await actions.promote.mutateAsync({
        conversationId: config.conversationId,
        projectId: config.project.projectId,
        expectedRevision: view.revision,
      });
      updateRoomProjectSources(
        identity.data?.pubkey,
        communities.activeCommunity?.relayUrl,
        config.project.projectId,
        effectiveSourceIds(next),
      );
      toast.success(`Saved context to ${config.project.label}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function saveAsProject() {
    if (!view) return;
    const label = newProjectName.trim();
    if (!label) {
      setError("Name the project first.");
      return;
    }
    const project = createRoomProject(
      identity.data?.pubkey,
      communities.activeCommunity?.relayUrl,
      {
        label,
        roomId: config.conversationId,
        sourceIds: effectiveSourceIds(view),
      },
    );
    if (!project) {
      setError("This room could not be saved as a project.");
      return;
    }
    try {
      await actions.promote.mutateAsync({
        conversationId: config.conversationId,
        projectId: project.id,
        expectedRevision: view.revision,
      });
      toast.success(`Saved as ${project.label}`);
      onOpenChange(false);
    } catch (cause) {
      deleteRoomProject(
        identity.data?.pubkey,
        communities.activeCommunity?.relayUrl,
        project.id,
      );
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      {marker ? (
        <div
          className="mb-1.5 flex items-center gap-2 text-2xs text-muted-foreground"
          data-testid="conversation-context-marker"
          role="status"
        >
          <span className="h-px flex-1 bg-border/50" />
          <span>{marker}</span>
          <span className="h-px flex-1 bg-border/50" />
        </div>
      ) : null}
      {view ? (
        <ContextChip onClick={() => onOpenChange(true)} view={view} />
      ) : null}
      {view?.status === "missing_primary" ? (
        <div
          className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs"
          data-testid="conversation-context-missing-primary"
          role="alert"
        >
          <span className="min-w-0 flex-1 text-destructive">
            {view.primary?.label ?? "The working folder"} can’t be found.
          </span>
          <button
            className="font-medium text-ink underline-offset-4 hover:underline disabled:opacity-50"
            disabled={controlsDisabled}
            onClick={() => void relink()}
            type="button"
          >
            Relink
          </button>
          <button
            className="font-medium text-ink underline-offset-4 hover:underline disabled:opacity-50"
            disabled={controlsDisabled}
            onClick={() => void continueWithoutPrimary()}
            type="button"
          >
            Continue without it
          </button>
        </div>
      ) : null}
      {error && !open ? (
        <p
          className="mb-1.5 px-1 text-xs text-destructive"
          data-testid="conversation-context-inline-error"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <SheetContent
        className="z-[51] flex w-full flex-col gap-0 overflow-y-auto border-border/70 bg-background p-0 sm:max-w-md"
        data-testid="conversation-context-drawer"
        side="right"
      >
        <SheetHeader className="border-b border-border/60 px-5 pb-4 pt-5 text-left">
          <SheetTitle className="text-base font-medium">
            Conversation context
          </SheetTitle>
          <SheetDescription>
            Choose what this room is working on. The resident keeps the same
            identity and settings.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 px-5 py-5">
          {config.changesDisabled ? (
            <p className="rounded-lg border border-border/60 bg-plate px-3 py-2 text-xs text-muted-foreground">
              Context can be changed after the resident finishes responding.
            </p>
          ) : null}

          {context.isPending ? (
            <p className="text-sm text-muted-foreground">Loading context…</p>
          ) : context.isError ? (
            <p className="text-sm text-destructive">
              {context.error instanceof Error
                ? context.error.message
                : "Context is unavailable."}
            </p>
          ) : view ? (
            <>
              {view.status === "missing_primary" ? (
                <div
                  className="rounded-xl border border-destructive/30 bg-destructive/5 p-3"
                  role="alert"
                >
                  <p className="text-sm text-ink">
                    {view.primary?.label ?? "The working folder"} can’t be
                    found.
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Your draft is safe. Relink it or continue without a primary
                    folder in this room.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      disabled={controlsDisabled}
                      onClick={() => void relink()}
                      size="sm"
                      type="button"
                    >
                      Relink
                    </Button>
                    <Button
                      disabled={controlsDisabled}
                      onClick={() => void continueWithoutPrimary()}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Continue without it
                    </Button>
                  </div>
                </div>
              ) : null}

              <section aria-labelledby="context-working-folder">
                <h3
                  className="text-xs font-medium text-ink"
                  id="context-working-folder"
                >
                  Working folder
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  The primary folder used by native tools and commands.
                </p>
                <div className="mt-3 space-y-1.5">
                  {config.project ? (
                    <PrimaryChoice
                      checked={draftPrimary === "inherit"}
                      disabled={controlsDisabled}
                      label={`Use ${config.project.label} default`}
                      meta="From project"
                      onChange={() => setDraftPrimary("inherit")}
                      value="inherit"
                    />
                  ) : null}
                  <PrimaryChoice
                    checked={draftPrimary === "none"}
                    disabled={controlsDisabled}
                    label="No primary folder"
                    meta="Brain context can still be used"
                    onChange={() => setDraftPrimary("none")}
                    value="none"
                  />
                  {repositorySources.map((source) => (
                    <PrimaryChoice
                      checked={draftPrimary === `source:${source.sourceId}`}
                      disabled={controlsDisabled || source.status !== "current"}
                      key={source.sourceId}
                      label={source.displayName}
                      meta={sourceStatus(source)}
                      onChange={() =>
                        setDraftPrimary(`source:${source.sourceId}`)
                      }
                      value={source.sourceId}
                    />
                  ))}
                </div>
                <Button
                  className="mt-2 px-0 text-muted-foreground"
                  disabled={controlsDisabled}
                  onClick={() => void relink()}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <FolderOpen />
                  Choose connected folder…
                </Button>
              </section>

              <section aria-labelledby="context-additional-sources">
                <h3
                  className="text-xs font-medium text-ink"
                  id="context-additional-sources"
                >
                  Additional sources
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Extra folders are passed to supported runtimes. Histories and
                  unavailable folders remain Brain context.
                </p>
                <div className="mt-3 space-y-1.5">
                  {allSources.length === 0 ? (
                    <p className="rounded-lg bg-plate px-3 py-2 text-xs text-muted-foreground">
                      Connect sources in Brain to add them here.
                    </p>
                  ) : (
                    allSources.map((source) => {
                      const inherited = projectAdditional.has(source.sourceId);
                      const checked =
                        inherited || draftAdditional.has(source.sourceId);
                      const isPrimary =
                        draftPrimary === `source:${source.sourceId}`;
                      return (
                        <label
                          className="flex items-start gap-3 rounded-lg border border-border/60 bg-plate/40 px-3 py-2.5"
                          htmlFor={`context-source-${source.sourceId}`}
                          key={source.sourceId}
                        >
                          <Checkbox
                            checked={checked}
                            disabled={
                              controlsDisabled || inherited || isPrimary
                            }
                            onCheckedChange={(next) => {
                              setDraftAdditional((current) => {
                                const updated = new Set(current);
                                if (next === true) updated.add(source.sourceId);
                                else updated.delete(source.sourceId);
                                return updated;
                              });
                            }}
                            id={`context-source-${source.sourceId}`}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-ink">
                              {source.displayName}
                            </span>
                            <span className="block text-2xs text-muted-foreground">
                              {inherited
                                ? "From project"
                                : isPrimary
                                  ? "Working folder"
                                  : source.sourceKind === "repository"
                                    ? "Folder and Brain"
                                    : "Brain only"}
                              {` · ${sourceStatus(source)}`}
                            </span>
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </section>

              <details className="group rounded-xl border border-border/60 bg-plate/30">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 text-xs font-medium text-ink">
                  <span>Available here</span>
                  <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <div className="space-y-3 border-t border-border/60 px-3 py-3">
                  {view.capabilities.map((capability) => (
                    <div
                      className="flex items-start gap-2"
                      key={capability.label}
                    >
                      {capability.state === "needs_attention" ? (
                        <AlertTriangle className="mt-0.5 size-3.5 text-destructive" />
                      ) : capability.state === "available" ? (
                        <Check className="mt-0.5 size-3.5 text-primary" />
                      ) : (
                        <CircleDot className="mt-0.5 size-3.5 text-muted-foreground" />
                      )}
                      <div>
                        <p className="text-xs text-ink">{capability.label}</p>
                        <p className="text-2xs text-muted-foreground">
                          {capability.state === "runtime_managed"
                            ? "Runtime managed · "
                            : capability.state === "available"
                              ? "Available · "
                              : "Needs attention · "}
                          {capability.detail}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </details>

              {error ? (
                <p className="text-xs text-destructive" role="alert">
                  {error}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
                <Button
                  disabled={controlsDisabled}
                  onClick={() => void save()}
                  size="sm"
                  type="button"
                >
                  Save for this room
                </Button>
                {config.project ? (
                  <Button
                    disabled={controlsDisabled}
                    onClick={() => void saveToProject()}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Save to project
                  </Button>
                ) : null}
                {config.project ? (
                  <Button
                    className="ml-auto"
                    disabled={controlsDisabled}
                    onClick={() => void clearOverride()}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    <RotateCcw />
                    Use project context
                  </Button>
                ) : null}
              </div>

              {!config.project && view.status !== "empty" ? (
                <div className="space-y-2 rounded-xl border border-border/60 bg-plate/30 p-3">
                  <div>
                    <p className="text-xs font-medium text-ink">
                      Keep this as a project
                    </p>
                    <p className="mt-1 text-2xs text-muted-foreground">
                      The room stays the same and inherits these context
                      defaults.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      aria-label="Project name"
                      disabled={controlsDisabled}
                      onChange={(event) =>
                        setNewProjectName(event.target.value)
                      }
                      placeholder={config.conversationName}
                      value={newProjectName}
                    />
                    <Button
                      disabled={controlsDisabled}
                      onClick={() => void saveAsProject()}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Save as project
                    </Button>
                  </div>
                </div>
              ) : null}

              {view.primary ? (
                <div className="sr-only">
                  <SourceMeta source={view.primary} />
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PrimaryChoice({
  checked,
  disabled,
  label,
  meta,
  onChange,
  value,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  meta: string;
  onChange: () => void;
  value: string;
}) {
  return (
    <label
      className={cn(
        "flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors",
        checked
          ? "border-primary/40 bg-primary/5"
          : "border-border/60 bg-plate/40",
        disabled && "opacity-60",
      )}
    >
      <input
        checked={checked}
        className="mt-0.5 size-4 accent-primary"
        disabled={disabled}
        name="conversation-working-folder"
        onChange={onChange}
        type="radio"
        value={value}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-ink">{label}</span>
        <span className="block text-2xs text-muted-foreground">{meta}</span>
      </span>
    </label>
  );
}
