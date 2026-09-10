import { AlertCircle, LoaderCircle, LockKeyhole } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import * as React from "react";

import { BrainAccessPanel } from "./BrainAccessPanel";
import { readableOwnerBrainError } from "./brainErrors";
import { BrainImportPanel, type ImportActivity } from "./BrainImportPanel";
import { BrainSourceList, BrainSourceSummary } from "./BrainSourcePanel";
import { useOwnerBrainActions, useOwnerBrainStateQuery } from "./hooks";
import { useLucaResidentsQuery } from "@/features/luca/residents/hooks";
import type {
  OwnerBrainGrantInput,
  OwnerBrainPreview,
} from "@/shared/api/tauriBrain";
import { Button } from "@/shared/ui/button";

type GrantAction = "grant" | "revoke" | "reconfirm";

export function BrainFilesDetails() {
  const stateQuery = useOwnerBrainStateQuery();
  const residentsQuery = useLucaResidentsQuery();
  const actions = useOwnerBrainActions();
  const [selectedSourceId, setSelectedSourceId] = React.useState<string | null>(
    null,
  );
  const [preview, setPreview] = React.useState<OwnerBrainPreview | null>(null);
  const [activity, setActivity] = React.useState<ImportActivity>({
    state: "idle",
  });
  const [operationError, setOperationError] = React.useState<string | null>(
    null,
  );
  const cancelRequestedRef = React.useRef(false);

  const state = stateQuery.data;
  React.useEffect(() => {
    if (!state?.sources.length) {
      setSelectedSourceId(null);
      return;
    }
    if (!state.sources.some((source) => source.sourceId === selectedSourceId)) {
      setSelectedSourceId(state.sources[0].sourceId);
    }
  }, [selectedSourceId, state]);

  const selectedSource =
    state?.sources.find((source) => source.sourceId === selectedSourceId) ??
    null;
  const isGrantMutating =
    actions.grant.isPending ||
    actions.revoke.isPending ||
    actions.reconfirm.isPending;

  const pickSource = React.useCallback(
    async (kind: "file" | "folder") => {
      setOperationError(null);
      cancelRequestedRef.current = false;
      try {
        const next = await actions.pickSource.mutateAsync({
          selectionKind: kind,
        });
        if (next) {
          setPreview(next);
          setActivity({ state: "idle" });
        }
      } catch (error) {
        setOperationError(readableOwnerBrainError(error, "preview"));
      }
    },
    [actions.pickSource],
  );

  const dismissPreview = React.useCallback(async () => {
    if (!preview) return;
    try {
      await actions.cancelImport.mutateAsync({
        previewId: preview.previewId,
        previewToken: preview.previewToken,
      });
    } catch {
      // A zero-write preview can expire between dismissal and cancellation.
    }
    setPreview(null);
    setActivity({ state: "cancelled", label: "Preview cancelled" });
  }, [actions.cancelImport, preview]);

  const commitPreview = React.useCallback(async () => {
    if (!preview) return;
    setOperationError(null);
    cancelRequestedRef.current = false;
    try {
      const commit = await actions.commitImport.mutateAsync({
        previewId: preview.previewId,
        previewToken: preview.previewToken,
      });
      if (!cancelRequestedRef.current) {
        setPreview(null);
        setSelectedSourceId(commit.sourceId);
        setActivity({ state: "committed", commit });
      }
    } catch (error) {
      if (!cancelRequestedRef.current) {
        const label = readableOwnerBrainError(error, "preview");
        setOperationError(label);
        setActivity({ state: "failed", label });
      }
    }
  }, [actions.commitImport, preview]);

  const cancelImport = React.useCallback(async () => {
    if (!preview) return;
    try {
      const cancelled = await actions.cancelImport.mutateAsync({
        previewId: preview.previewId,
        previewToken: preview.previewToken,
      });
      if (cancelled) {
        cancelRequestedRef.current = true;
        setPreview(null);
        setActivity({ state: "cancelled", label: "Import cancelled" });
      } else {
        setOperationError(
          "The atomic commit has already started and can no longer be cancelled.",
        );
      }
    } catch (error) {
      setOperationError(readableOwnerBrainError(error, "preview"));
    }
  }, [actions.cancelImport, preview]);

  const changeGrant = React.useCallback(
    async (
      action: GrantAction,
      resident: { displayName: string; residentPubkey: string },
    ) => {
      if (!selectedSource) return;
      setOperationError(null);
      const input: OwnerBrainGrantInput = {
        sourceId: selectedSource.sourceId,
        residentPubkey: resident.residentPubkey,
      };
      try {
        await actions[action].mutateAsync(input);
      } catch (error) {
        setOperationError(
          `${resident.displayName}: ${readableOwnerBrainError(error, "access")}`,
        );
      }
    },
    [actions, selectedSource],
  );

  if (stateQuery.isLoading) return <BrainLoadingState />;
  if (stateQuery.isError || !state) {
    return (
      <BrainBlockingState
        description="Luca could not read the private Brain catalog. Messaging remains available."
        icon={AlertCircle}
        onRetry={() => void stateQuery.refetch()}
        title="Files are unavailable"
      />
    );
  }
  if (state.availability === "locked") {
    return (
      <BrainBlockingState
        description="Unlock the current Luca identity to read encrypted sources and access grants. Conversations remain available while Brain is locked."
        icon={LockKeyhole}
        onRetry={() => void stateQuery.refetch()}
        title="Brain is locked"
      />
    );
  }
  if (state.availability === "unavailable") {
    return (
      <BrainBlockingState
        description="The private Brain store could not be opened. No source content was exposed and messaging remains available."
        icon={AlertCircle}
        onRetry={() => void stateQuery.refetch()}
        title="Brain store unavailable"
      />
    );
  }

  return (
    <div className="min-w-0 space-y-5" data-testid="brain-files-details">
      {operationError ? (
        <div
          className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
          role="alert"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{operationError}</p>
        </div>
      ) : null}

      <BrainImportPanel
        activity={activity}
        errorMessage={null}
        isCommitting={actions.commitImport.isPending}
        isPicking={actions.pickSource.isPending}
        onCancel={() => void cancelImport()}
        onCommit={() => void commitPreview()}
        onDismissPreview={() => void dismissPreview()}
        onPick={(kind) => void pickSource(kind)}
        preview={preview}
      />

      {!preview && state.sources.length > 0 ? (
        <div className="grid min-w-0 gap-5 md:grid-cols-[minmax(12rem,0.72fr)_minmax(0,1.7fr)]">
          <aside className="min-w-0">
            <BrainSourceList
              onSelect={setSelectedSourceId}
              selectedSourceId={selectedSourceId}
              sources={state.sources}
            />
          </aside>

          <div className="min-w-0 space-y-5">
            {selectedSource ? (
              <>
                <BrainSourceSummary
                  onChooseUpdate={() =>
                    void pickSource(
                      selectedSource.sourceKind === "text_folder"
                        ? "folder"
                        : "file",
                    )
                  }
                  receipts={state.receipts}
                  source={selectedSource}
                />
                <BrainAccessPanel
                  grants={state.grants}
                  isMutating={isGrantMutating}
                  onAction={(action, resident) =>
                    void changeGrant(action, resident)
                  }
                  residents={residentsQuery.data?.residents ?? []}
                  source={selectedSource}
                />
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BrainLoadingState() {
  return (
    <div className="flex h-full items-center justify-center" role="status">
      <div className="text-center text-sm text-muted-foreground">
        <LoaderCircle className="mx-auto mb-2 h-5 w-5 animate-spin" />
        Opening private Brain catalog
      </div>
    </div>
  );
}

function BrainBlockingState({
  description,
  icon: Icon,
  onRetry,
  title,
}: {
  description: string;
  icon: LucideIcon;
  onRetry: () => void;
  title: string;
}) {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <section className="max-w-md text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl border border-border/60 bg-card/40 text-muted-foreground">
          <Icon className="h-5 w-5" />
        </div>
        <h1 className="mt-4 text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
        <Button className="mt-5" onClick={onRetry} size="sm" variant="outline">
          Try again
        </Button>
      </section>
    </div>
  );
}
