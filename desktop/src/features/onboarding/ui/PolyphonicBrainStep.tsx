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

/** What the connection turned out to be, once it is over. It never throws:
 *  a failure is a value the reading screen can offer a choice about. */
export type BrainConnectOutcome = {
  issueCount: number;
  sourceCount: number;
  error: string | null;
};

/** The connect the owner has just authorised, handed on to the reading step.
 *  It is already running when it arrives; `retry` runs the same one again. */
export type PendingBrainConnect = {
  promise: Promise<BrainConnectOutcome>;
  retry: () => Promise<BrainConnectOutcome>;
};

export type PolyphonicBrainStepHandle = {
  commit: () => Promise<{
    cancelled: boolean;
    connect: PendingBrainConnect | null;
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

  // The whole index used to be awaited inside this card, which is why the
  // owner watched the word "Connecting" sit in a button. It is now a value
  // handed forward: the card is finished the moment consent is given.
  const performConnection =
    React.useCallback(async (): Promise<BrainConnectOutcome> => {
      const current = inventoryQuery.data;
      if (!current || selected.size === 0) {
        return {
          issueCount: inventoryQuery.isError ? 1 : 0,
          sourceCount:
            current?.sources.filter(
              (source) => source.status !== "disconnected",
            ).length ?? 0,
          error: null,
        };
      }
      try {
        const result = await connectedActions.connect.mutateAsync({
          discoveryIds: [...selected],
          consentAccepted: true,
        });
        const refreshed = await inventoryQuery.refetch();
        const sources = refreshed.data?.sources ?? result.sources;
        return {
          issueCount: sources.filter(
            (source) =>
              source.status === "needs_attention" ||
              source.status === "unavailable",
          ).length,
          sourceCount: sources.filter(
            (source) => source.status !== "disconnected",
          ).length,
          error: null,
        };
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        return {
          issueCount: 1,
          sourceCount: 0,
          error: message.replaceAll("-", " "),
        };
      }
    }, [connectedActions.connect, inventoryQuery, selected]);

  const startConnection = React.useCallback((): PendingBrainConnect => {
    const retry = () => performConnection();
    return { promise: retry(), retry };
  }, [performConnection]);

  const commit = React.useCallback(async (): Promise<CommitResult> => {
    const hasConnection = Boolean(
      inventoryQuery.data?.sources.some(
        (source) => source.status !== "disconnected",
      ),
    );
    if (selected.size === 0 || hasConnection) {
      return { cancelled: false, connect: startConnection() };
    }
    setConsentOpen(true);
    return new Promise<CommitResult>((resolve) => {
      consentResolver.current = resolve;
    });
  }, [inventoryQuery.data?.sources, startConnection, selected.size]);

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
    <div
      className="h-full overflow-y-auto overscroll-contain"
      data-prototype-scroll-owner="true"
    >
      <PolyphonicStepHeading
        description="So the first thing Luca says to you is true."
        stage="brain"
        title="What should Luca read?"
      />
      {loading ? (
        <p
          className="mt-8 flex items-center gap-2 text-sm text-white/55"
          role="status"
        >
          <LoaderCircle className="h-4 w-4 animate-spin" /> Finding your work…
        </p>
      ) : (
        <div className="mt-6 divide-y divide-white/[0.05] border-y border-white/[0.055]">
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
                // Only the box says whether a source is chosen; the row
                // itself never lights up.
                className="group flex min-h-11 w-full items-center gap-3 px-1 py-1.5 text-left transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white/30 disabled:cursor-default disabled:hover:bg-transparent"
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

      <div className="mt-2 flex flex-wrap gap-0.5">
        <Button
          className="h-8 gap-1.5 px-2 text-xs font-normal text-white/46 hover:bg-white/[0.035] hover:text-white/82"
          onClick={() => void addRepositoryRoot()}
          type="button"
          variant="ghost"
        >
          <FolderPlus className="h-3.5 w-3.5" /> Add repository folder…
        </Button>
        <Button
          className="h-8 gap-1.5 px-2 text-xs font-normal text-white/46 hover:bg-white/[0.035] hover:text-white/82"
          onClick={() => void pick("file")}
          type="button"
          variant="ghost"
        >
          <FilePlus2 className="h-3.5 w-3.5" /> Add file…
        </Button>
        <Button
          className="h-8 gap-1.5 px-2 text-xs font-normal text-white/46 hover:bg-white/[0.035] hover:text-white/82"
          onClick={() => void pick("folder")}
          type="button"
          variant="ghost"
        >
          <FolderPlus className="h-3.5 w-3.5" /> Add files folder…
        </Button>
      </div>

      {preview ? (
        <div className="mt-3 rounded-md bg-white/[0.025] p-3 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.055)]">
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
      <p className="mt-3 flex items-start gap-2.5 text-[length:var(--prototype-support-size)] leading-[1.125rem] text-[var(--prototype-muted)]">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" />
        <span>
          Luca keeps a private index here. Your originals stay where they are.
        </span>
      </p>

      <BrainConsentDialog
        consentCopy={inventory?.consentCopy ?? ""}
        isConnecting={connectedActions.connect.isPending}
        onConfirm={() => {
          // Consent is the whole of this dialog's business. Start the work,
          // close, and let the reading screen say what is happening.
          const pending = startConnection();
          const resolve = consentResolver.current;
          consentResolver.current = null;
          setConsentOpen(false);
          resolve?.({ cancelled: false, connect: pending });
        }}
        onOpenChange={(open) => {
          setConsentOpen(open);
          if (!open && consentResolver.current) {
            consentResolver.current({ cancelled: true, connect: null });
            consentResolver.current = null;
          }
        }}
        open={consentOpen}
        sourceLabel="selected sources"
      />
    </div>
  );
});
