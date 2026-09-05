import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { LoaderCircle } from "lucide-react";

import {
  connectConnectedBrainSource,
  discoverConnectedBrainSources,
  type ConnectedBrainInventory,
} from "@/shared/api/tauriBrain";
import {
  authorizeRepositoryConnectionProposal,
  finishRepositoryConnectionProposal,
  listRepositoryConnectionProposals,
  listenRepositoryConnectionProposals,
  listenRepositoryConnectionProposalResolutions,
  type RepositoryConnectionProposalV1,
} from "@/shared/api/tauriRepositoryConnectionProposals";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { BrainConnectionDialog } from "./BrainConnectionDialog";
import { createBrainConnectionQueueItems } from "./brainConnectionQueue";
import { connectedBrainInventoryQueryKey } from "./hooks";

type PendingReview = {
  proposal: RepositoryConnectionProposalV1;
  inventory: ConnectedBrainInventory | null;
  selectedId: string | null;
  phase:
    | "loading"
    | "review"
    | "connecting"
    | "verifying"
    | "closing"
    | "attention";
  attempted: boolean;
  ending: boolean;
  busy: boolean;
  error: string | null;
  expiry: ReturnType<typeof setTimeout> | null;
};

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Review a host proposal using the existing Brain picker and consent policy. */
export function RepositoryConnectionProposalDialog({
  ownerPubkey,
}: {
  ownerPubkey?: string;
}) {
  const queryClient = useQueryClient();
  const active = React.useRef<PendingReview | null>(null);
  const handled = React.useRef(new Set<string>());
  const [view, setView] = React.useState<PendingReview | null>(null);
  const errorRef = React.useRef<HTMLDivElement>(null);

  const isReviewActive = React.useCallback(
    (pending: PendingReview) => active.current === pending && !pending.ending,
    [],
  );
  const show = React.useCallback((pending: PendingReview) => {
    if (active.current === pending) setView({ ...pending });
  }, []);
  const dismiss = React.useCallback((pending: PendingReview) => {
    if (pending.expiry) clearTimeout(pending.expiry);
    if (active.current === pending) {
      active.current = null;
      setView(null);
    }
  }, []);
  const loadReview = React.useCallback(
    async (pending: PendingReview) => {
      if (!isReviewActive(pending)) return;
      pending.phase = "loading";
      pending.error = null;
      show(pending);
      try {
        await authorizeRepositoryConnectionProposal(pending.proposal.requestId);
        if (!isReviewActive(pending) || pending.busy) return;
        const inventory = await discoverConnectedBrainSources();
        if (!isReviewActive(pending) || pending.busy) return;
        pending.inventory = inventory;
        pending.selectedId = null;
        pending.phase = "review";
        if (
          !inventory.discoveries.some(
            (item) => item.sourceKind === "repository",
          )
        ) {
          pending.phase = "attention";
          pending.error =
            "No repositories were found. Open Brain to review your discovery folders, then try this review again.";
        }
        show(pending);
      } catch (cause) {
        if (!isReviewActive(pending)) return;
        pending.phase = "attention";
        pending.error = errorMessage(cause);
        show(pending);
      }
    },
    [isReviewActive, show],
  );

  React.useEffect(() => {
    if (!ownerPubkey) return;
    let disposed = false;
    const stops: UnlistenFn[] = [];
    const remember = (requestId: string) => {
      handled.current.add(requestId);
      if (handled.current.size > 128) {
        const oldest = handled.current.values().next().value;
        if (oldest) handled.current.delete(oldest);
      }
    };
    const receive = (proposal: RepositoryConnectionProposalV1) => {
      if (
        disposed ||
        !proposal ||
        typeof proposal.requestId !== "string" ||
        typeof proposal.ownerPubkey !== "string" ||
        typeof proposal.purpose !== "string" ||
        proposal.ownerPubkey.toLowerCase() !== ownerPubkey.toLowerCase() ||
        handled.current.has(proposal.requestId)
      )
        return;
      remember(proposal.requestId);
      const remaining =
        Date.parse(proposal.createdAt) + 15 * 60_000 - Date.now();
      if (!Number.isFinite(remaining) || remaining <= 0) {
        void finishRepositoryConnectionProposal(
          proposal.requestId,
          "closed",
        ).catch(() => {});
        return;
      }
      if (
        active.current ||
        document.querySelector(
          '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
        )
      ) {
        void finishRepositoryConnectionProposal(
          proposal.requestId,
          "busy",
        ).catch(() => {});
        return;
      }
      const pending: PendingReview = {
        proposal,
        inventory: null,
        selectedId: null,
        phase: "loading",
        attempted: false,
        ending: false,
        busy: false,
        error: null,
        expiry: null,
      };
      active.current = pending;
      pending.expiry = setTimeout(() => {
        if (active.current !== pending) return;
        dismiss(pending);
        void finishRepositoryConnectionProposal(
          proposal.requestId,
          "closed",
        ).catch(() => {});
      }, remaining);
      void loadReview(pending);
    };
    void (async () => {
      const stopResolved = await listenRepositoryConnectionProposalResolutions(
        (requestId) => {
          if (disposed) return;
          remember(requestId);
          const pending = active.current;
          if (pending?.proposal.requestId === requestId) dismiss(pending);
        },
      );
      if (disposed) {
        stopResolved();
        return;
      }
      stops.push(stopResolved);
      const stopProposals = await listenRepositoryConnectionProposals(receive);
      if (disposed) {
        stopProposals();
        return;
      }
      stops.push(stopProposals);
      for (const proposal of await listRepositoryConnectionProposals())
        receive(proposal);
    })().catch(() => {});
    return () => {
      disposed = true;
      for (const stop of stops) stop();
      const pending = active.current;
      active.current = null;
      setView(null);
      handled.current.clear();
      if (pending) {
        if (pending.expiry) clearTimeout(pending.expiry);
        // Ending this owner surface also ends its review. Late IPC completions
        // cannot reopen it or start another operation in a replacement surface.
        void finishRepositoryConnectionProposal(
          pending.proposal.requestId,
          "closed",
        ).catch(() => {});
      }
    };
  }, [ownerPubkey, dismiss, loadReview]);

  React.useEffect(() => {
    if (view?.error) errorRef.current?.focus();
  }, [view?.error]);

  async function verify(pending: PendingReview) {
    if (!isReviewActive(pending)) return;
    pending.busy = true;
    pending.phase = "verifying";
    pending.error = null;
    show(pending);
    try {
      // The host rereads the actual source, index and current grants, including
      // on a lost-ACK replay. This never repeats the connection mutation.
      await finishRepositoryConnectionProposal(
        pending.proposal.requestId,
        "connected",
      );
      if (isReviewActive(pending)) dismiss(pending);
    } catch (cause) {
      if (!isReviewActive(pending)) return;
      pending.busy = false;
      pending.phase = "attention";
      pending.error = errorMessage(cause);
      show(pending);
    }
  }

  async function connect() {
    const pending = active.current;
    if (
      !pending ||
      pending.busy ||
      pending.attempted ||
      pending.phase !== "review"
    )
      return;
    const selected = pending.inventory?.discoveries.find(
      (item) =>
        item.discoveryId === pending.selectedId &&
        item.sourceKind === "repository",
    );
    if (!selected) return;
    pending.busy = true;
    pending.phase = "connecting";
    show(pending);
    try {
      await authorizeRepositoryConnectionProposal(pending.proposal.requestId);
      if (!isReviewActive(pending)) return;
      // Cache before invoking: rejection can follow a persisted source or grant.
      pending.attempted = true;
      show(pending);
      await connectConnectedBrainSource({
        discoveryIds: [selected.discoveryId],
        consentAccepted: true,
        proposalRequestId: pending.proposal.requestId,
      });
      if (!isReviewActive(pending)) return;
      void queryClient.invalidateQueries({
        queryKey: connectedBrainInventoryQueryKey,
      });
      await verify(pending);
    } catch (cause) {
      if (!isReviewActive(pending)) return;
      pending.busy = false;
      pending.phase = "attention";
      pending.error = errorMessage(cause);
      show(pending);
    }
  }

  async function close() {
    const pending = active.current;
    if (!pending || pending.phase === "closing") return;
    // Closing permanently fences the earlier operation, even if the close ACK
    // fails and the owner must retry returning the closed outcome.
    pending.ending = true;
    pending.busy = true;
    pending.phase = "closing";
    show(pending);
    try {
      await finishRepositoryConnectionProposal(
        pending.proposal.requestId,
        "closed",
      );
      dismiss(pending);
    } catch (cause) {
      if (active.current !== pending) return;
      pending.busy = false;
      pending.phase = "attention";
      pending.error = errorMessage(cause);
      show(pending);
    }
  }

  if (!view) return null;
  if (view.phase === "review" && view.inventory) {
    return (
      <BrainConnectionDialog
        consentCopy={view.inventory.consentCopy}
        items={createBrainConnectionQueueItems(
          view.inventory.discoveries.filter(
            (item) => item.sourceKind === "repository",
          ),
        )}
        onConfirm={() => void connect()}
        onOpenChange={(open) => {
          if (!open) void close();
        }}
        onRetry={() => {}}
        onSelectAll={() => {}}
        onStop={() => {}}
        onToggle={(discoveryId, selected) => {
          const pending = active.current;
          if (!pending || pending.busy || pending.attempted) return;
          pending.selectedId = selected ? discoveryId : null;
          show(pending);
        }}
        open
        purpose={view.proposal.purpose}
        running={view.busy}
        selectedIds={new Set(view.selectedId ? [view.selectedId] : [])}
        singleSelection
        sourceLabel="repository"
        stopRequested={false}
      />
    );
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void close();
      }}
    >
      <DialogContent
        className="flex max-h-[calc(100vh-2rem)] max-w-xl flex-col gap-0 overflow-hidden p-0"
        data-testid="repository-connection-proposal"
        onEscapeKeyDown={(event) => {
          if (view.phase === "closing") event.preventDefault();
        }}
        onInteractOutside={(event) => event.preventDefault()}
        showCloseButton={false}
      >
        <DialogHeader className="shrink-0 px-6 py-4">
          <DialogTitle>
            {view.attempted
              ? "Check the repository connection"
              : "Connect a repository"}
          </DialogTitle>
          <DialogDescription>{view.proposal.purpose}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-3 overflow-y-auto px-6 pb-4">
          {view.error ? (
            <div
              className="space-y-3 text-sm outline-none"
              ref={errorRef}
              role="alert"
              tabIndex={-1}
            >
              <p className="break-words text-destructive">{view.error}</p>
              {view.ending ? (
                <p className="text-muted-foreground">
                  Retry closing to return that outcome to your agent. Connection
                  work already started may finish; inspect its existing
                  connection in Brain before starting another review.
                </p>
              ) : view.attempted ? (
                <p className="text-muted-foreground">
                  The repository may already be connected. Verify the saved
                  result to return it to your agent. To start a new review,
                  close this request and inspect its existing connection in
                  Brain first.
                </p>
              ) : null}
            </div>
          ) : (
            <p
              className="flex items-center gap-2 text-sm text-muted-foreground"
              role="status"
            >
              <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
              {view.phase === "loading"
                ? "Finding repositories for your review…"
                : view.phase === "connecting"
                  ? "Connecting your selected repository…"
                  : view.phase === "closing"
                    ? "Closing this review…"
                    : "Verifying the saved connection…"}
            </p>
          )}
          {view.attempted && !view.error ? (
            <p className="text-sm text-muted-foreground">
              You can close this review. Connection work already started may
              finish; check its existing connection in Brain before trying
              again.
            </p>
          ) : null}
        </div>
        <DialogFooter className="shrink-0 border-t border-border/60 px-6 py-4">
          <Button
            disabled={view.phase === "closing"}
            onClick={() => void close()}
            variant="ghost"
          >
            {view.ending && view.error ? "Retry closing" : "Close"}
          </Button>
          {view.phase === "attention" && !view.ending ? (
            <Button
              disabled={view.busy}
              onClick={() => {
                const pending = active.current;
                if (!pending || pending.busy) return;
                if (pending.attempted) void verify(pending);
                else void loadReview(pending);
              }}
            >
              {view.attempted ? "Verify saved connection" : "Try review again"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
