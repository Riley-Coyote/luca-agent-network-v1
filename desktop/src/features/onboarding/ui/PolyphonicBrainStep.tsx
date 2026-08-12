import * as React from "react";
import {
  Check,
  FilePlus2,
  FolderPlus,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";

import {
  useConnectedBrainActions,
  useConnectedBrainInventoryQuery,
  useOwnerBrainActions,
  useOwnerBrainStateQuery,
} from "@/features/luca/brain/hooks";
import { BrainConsentDialog } from "@/features/luca/brain/BrainConsentDialog";
import type {
  ConnectedBrainSourceKind,
  OwnerBrainPreview,
} from "@/shared/api/tauriBrain";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import {
  PolyphonicNotice,
  PolyphonicStepHeading,
} from "./PolyphonicSetupFrame";

const categories: Array<{
  kind: ConnectedBrainSourceKind;
  label: string;
  short: string;
}> = [
  { kind: "repository", label: "Repositories", short: "RE" },
  { kind: "codex_history", label: "Codex", short: "CO" },
  { kind: "claude_history", label: "Claude Code", short: "CL" },
];

export type PolyphonicBrainStepHandle = {
  commit: () => Promise<{
    cancelled: boolean;
    issueCount: number;
    sourceCount: number;
  }>;
};

type CommitResult = Awaited<ReturnType<PolyphonicBrainStepHandle["commit"]>>;

export const PolyphonicBrainStep = React.forwardRef<
  PolyphonicBrainStepHandle,
  { onBusyChange: (busy: boolean) => void }
>(function PolyphonicBrainStep({ onBusyChange }, ref) {
  const inventoryQuery = useConnectedBrainInventoryQuery();
  const ownerQuery = useOwnerBrainStateQuery();
  const connectedActions = useConnectedBrainActions();
  const ownerActions = useOwnerBrainActions();
  const [selected, setSelected] = React.useState(new Set<string>());
  const [preview, setPreview] = React.useState<OwnerBrainPreview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [consentOpen, setConsentOpen] = React.useState(false);
  const consentResolver = React.useRef<((result: CommitResult) => void) | null>(
    null,
  );
  const consentConfirming = React.useRef(false);
  const initializedInventory = React.useRef(false);

  const inventory = inventoryQuery.data;
  React.useEffect(() => {
    if (!inventory || initializedInventory.current) return;
    initializedInventory.current = true;
    const connectedNames = new Set(
      inventory.sources
        .filter((source) => source.status !== "disconnected")
        .map((source) => source.displayName),
    );
    setSelected(
      new Set(
        inventory.discoveries
          .filter((discovery) => !connectedNames.has(discovery.displayName))
          .map((discovery) => discovery.discoveryId),
      ),
    );
  }, [inventory]);

  const performConnection =
    React.useCallback(async (): Promise<CommitResult> => {
      const current = inventoryQuery.data;
      if (!current || selected.size === 0) {
        return {
          cancelled: false,
          issueCount: inventoryQuery.isError ? 1 : 0,
          sourceCount:
            current?.sources.filter(
              (source) => source.status !== "disconnected",
            ).length ?? 0,
        };
      }
      onBusyChange(true);
      setError(null);
      try {
        const result = await connectedActions.connect.mutateAsync({
          discoveryIds: [...selected],
          consentAccepted: true,
        });
        const refreshed = await inventoryQuery.refetch();
        const sources = refreshed.data?.sources ?? result.sources;
        return {
          cancelled: false,
          issueCount: sources.filter(
            (source) =>
              source.status === "needs_attention" ||
              source.status === "unavailable",
          ).length,
          sourceCount: sources.filter(
            (source) => source.status !== "disconnected",
          ).length,
        };
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message.replaceAll("-", " "));
        return { cancelled: false, issueCount: 1, sourceCount: 0 };
      } finally {
        onBusyChange(false);
      }
    }, [connectedActions.connect, inventoryQuery, onBusyChange, selected]);

  const commit = React.useCallback(async (): Promise<CommitResult> => {
    const hasConnection = Boolean(
      inventoryQuery.data?.sources.some(
        (source) => source.status !== "disconnected",
      ),
    );
    if (selected.size === 0 || hasConnection) return performConnection();
    setConsentOpen(true);
    return new Promise<CommitResult>((resolve) => {
      consentResolver.current = resolve;
    });
  }, [inventoryQuery.data?.sources, performConnection, selected.size]);

  React.useImperativeHandle(ref, () => ({ commit }), [commit]);

  async function pick(kind: "file" | "folder") {
    setError(null);
    try {
      const next = await ownerActions.pickSource.mutateAsync({
        selectionKind: kind,
      });
      if (next) setPreview(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function addRepositoryRoot() {
    setError(null);
    try {
      await connectedActions.addRoot.mutateAsync();
      await inventoryQuery.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function importPreview() {
    if (!preview) return;
    onBusyChange(true);
    setError(null);
    try {
      await ownerActions.commitImport.mutateAsync({
        previewId: preview.previewId,
        previewToken: preview.previewToken,
      });
      setPreview(null);
      await ownerQuery.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      onBusyChange(false);
    }
  }

  async function cancelPreview() {
    if (!preview) return;
    try {
      await ownerActions.cancelImport.mutateAsync({
        previewId: preview.previewId,
        previewToken: preview.previewToken,
      });
    } finally {
      setPreview(null);
    }
  }

  const loading = inventoryQuery.isLoading || ownerQuery.isLoading;
  return (
    <>
      <PolyphonicStepHeading
        description="Connect the places where your work already lives. Originals stay where they are, and you decide exactly what is included."
        stage="brain"
        title="Connect your work"
      />
      {loading ? (
        <p
          className="mt-8 flex items-center gap-2 text-sm text-white/55"
          role="status"
        >
          <LoaderCircle className="h-4 w-4 animate-spin" /> Finding your work…
        </p>
      ) : (
        <div className="mt-6 overflow-hidden rounded-lg border border-[hsl(var(--mn-border))] bg-[hsl(var(--mn-surface))]">
          {categories.map((category) => {
            const connected =
              inventory?.sources.filter(
                (source) =>
                  source.sourceKind === category.kind &&
                  source.status !== "disconnected",
              ) ?? [];
            const found =
              inventory?.discoveries.filter(
                (source) => source.sourceKind === category.kind,
              ) ?? [];
            const foundIds = found.map((source) => source.discoveryId);
            const isSelected =
              connected.length > 0 || foundIds.some((id) => selected.has(id));
            const detail = connected.length
              ? `${connected.length} current`
              : found.length
                ? `${found.reduce((sum, item) => sum + item.itemCount, 0)} found`
                : "Not found";
            return (
              <button
                aria-pressed={isSelected}
                className="group flex min-h-14 w-full items-center gap-3 border-b border-[hsl(var(--mn-border))] px-3.5 py-2 text-left last:border-b-0 hover:bg-[hsl(var(--mn-hover))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60 disabled:cursor-default"
                disabled={connected.length > 0 || found.length === 0}
                key={category.kind}
                onClick={() =>
                  setSelected((current) => {
                    const next = new Set(current);
                    const selecting = !foundIds.some((id) => next.has(id));
                    for (const id of foundIds) {
                      if (selecting) next.add(id);
                      else next.delete(id);
                    }
                    return next;
                  })
                }
                type="button"
              >
                <span className="flex h-8 w-8 items-center justify-center border border-[hsl(var(--mn-border))] font-mono text-xs text-white/54">
                  {category.short}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-white/88">
                    {category.label}
                  </span>
                  <span className="block text-xs text-white/46">{detail}</span>
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full border",
                    isSelected
                      ? "border-white bg-white text-black"
                      : "border-white/20 text-transparent",
                  )}
                >
                  <Check className="h-3 w-3" />
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-1">
        <Button
          className="h-9 gap-2 px-2.5 text-sm text-white/60 hover:bg-white/[0.04] hover:text-white"
          onClick={() => void addRepositoryRoot()}
          type="button"
          variant="ghost"
        >
          <FolderPlus className="h-3.5 w-3.5" /> Add repository folder…
        </Button>
        <Button
          className="h-9 gap-2 px-2.5 text-sm text-white/60 hover:bg-white/[0.04] hover:text-white"
          onClick={() => void pick("file")}
          type="button"
          variant="ghost"
        >
          <FilePlus2 className="h-3.5 w-3.5" /> Add file…
        </Button>
        <Button
          className="h-9 gap-2 px-2.5 text-sm text-white/60 hover:bg-white/[0.04] hover:text-white"
          onClick={() => void pick("folder")}
          type="button"
          variant="ghost"
        >
          <FolderPlus className="h-3.5 w-3.5" /> Add files folder…
        </Button>
      </div>

      {preview ? (
        <div className="mt-3 rounded-lg border border-[hsl(var(--mn-border))] bg-[hsl(var(--mn-surface))] p-4">
          <p className="text-sm text-white/88">{preview.displayName}</p>
          <p className="mt-1 text-xs leading-5 text-white/50">
            {preview.rows.filter((row) => row.status === "accepted").length}{" "}
            accepted · {preview.acceptedBytes.toLocaleString()} bytes
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              disabled={!preview.canCommit}
              onClick={() => void importPreview()}
              size="sm"
            >
              Import selected source
            </Button>
            <Button
              onClick={() => void cancelPreview()}
              size="sm"
              variant="ghost"
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {inventoryQuery.isError ? (
        <PolyphonicNotice kind="error">
          <div className="flex items-center justify-between gap-3">
            <span>
              Luca could not scan Brain sources. You can continue and try again
              later.
            </span>
            <Button
              onClick={() => void inventoryQuery.refetch()}
              size="sm"
              variant="ghost"
            >
              <RefreshCw /> Retry
            </Button>
          </div>
        </PolyphonicNotice>
      ) : null}
      {error ? (
        <PolyphonicNotice kind="error">
          {error.replaceAll("-", " ")}
        </PolyphonicNotice>
      ) : null}
      <p className="mt-4 border-t border-[hsl(var(--mn-border))] pt-4 text-xs leading-5 text-white/48">
        Luca keeps a private local index. Residents may send only relevant
        excerpts to their configured models. Edits and commands always ask
        first.
      </p>

      <BrainConsentDialog
        consentCopy={inventory?.consentCopy ?? ""}
        isConnecting={connectedActions.connect.isPending}
        onConfirm={() => {
          consentConfirming.current = true;
          void performConnection().then((result) => {
            consentResolver.current?.(result);
            consentResolver.current = null;
            setConsentOpen(false);
            consentConfirming.current = false;
          });
        }}
        onOpenChange={(open) => {
          setConsentOpen(open);
          if (!open && consentResolver.current && !consentConfirming.current) {
            consentResolver.current({
              cancelled: true,
              issueCount: 0,
              sourceCount:
                inventory?.sources.filter(
                  (source) => source.status !== "disconnected",
                ).length ?? 0,
            });
            consentResolver.current = null;
          }
        }}
        open={consentOpen}
        sourceLabel="selected sources"
      />
    </>
  );
});
