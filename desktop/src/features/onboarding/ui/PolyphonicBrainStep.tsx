import * as React from "react";
import {
  Check,
  FilePlus2,
  FolderGit2,
  FolderPlus,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  ShieldCheck,
  TerminalSquare,
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
  icon: typeof FolderGit2;
  kind: ConnectedBrainSourceKind;
  label: string;
}> = [
  { icon: FolderGit2, kind: "repository", label: "Repositories" },
  { icon: TerminalSquare, kind: "codex_history", label: "Codex" },
  {
    icon: MessageSquareText,
    kind: "claude_history",
    label: "Claude Code",
  },
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
        <div className="mt-7 space-y-1 rounded-xl bg-white/[0.018] p-1 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.035)]">
          {categories.map((category) => {
            const SourceIcon = category.icon;
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
                className={cn(
                  "group flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-white/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/40 disabled:cursor-default disabled:hover:bg-transparent",
                  isSelected && "bg-white/[0.055]",
                )}
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
                <span className="flex h-7 w-7 items-center justify-center text-white/40">
                  <SourceIcon className="h-4 w-4" strokeWidth={1.5} />
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
                    "flex h-[1.125rem] w-[1.125rem] items-center justify-center rounded-[0.3rem] border transition-colors",
                    isSelected
                      ? "border-white bg-white text-black"
                      : "border-white/18 text-transparent group-hover:border-white/32",
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
          className="h-9 gap-2 px-2.5 text-sm font-normal text-white/50 hover:bg-white/[0.035] hover:text-white/82"
          onClick={() => void addRepositoryRoot()}
          type="button"
          variant="ghost"
        >
          <FolderPlus className="h-3.5 w-3.5" /> Add repository folder…
        </Button>
        <Button
          className="h-9 gap-2 px-2.5 text-sm font-normal text-white/50 hover:bg-white/[0.035] hover:text-white/82"
          onClick={() => void pick("file")}
          type="button"
          variant="ghost"
        >
          <FilePlus2 className="h-3.5 w-3.5" /> Add file…
        </Button>
        <Button
          className="h-9 gap-2 px-2.5 text-sm font-normal text-white/50 hover:bg-white/[0.035] hover:text-white/82"
          onClick={() => void pick("folder")}
          type="button"
          variant="ghost"
        >
          <FolderPlus className="h-3.5 w-3.5" /> Add files folder…
        </Button>
      </div>

      {preview ? (
        <div className="mt-3 rounded-xl bg-white/[0.025] p-4 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.035)]">
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
      <p className="mt-4 flex items-start gap-2.5 text-xs leading-5 text-white/40">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/34" />
        <span>
          Luca keeps a private local index. Residents may send only relevant
          excerpts to their configured models. Edits and commands always ask
          first.
        </span>
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
