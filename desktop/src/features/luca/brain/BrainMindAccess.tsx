import * as React from "react";
import { AlertCircle, ArrowRight, RotateCcw } from "lucide-react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useLucaResidentsQuery } from "@/features/luca/residents/hooks";
import { cn } from "@/shared/lib/cn";
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
import {
  readableConnectedBrainError,
  readableOwnerBrainError,
} from "./brainErrors";
import {
  accessDetail,
  accessWord,
  type MindSourceAccess,
  mindBrainAccess,
  readsEverything,
} from "./brainReads";
import {
  useConnectedBrainActions,
  useConnectedBrainInventoryQuery,
  useOwnerBrainActions,
  useOwnerBrainStateQuery,
} from "./hooks";

/**
 * What one mind can read (BETA14_RELEASE.md WP-38, Decided 3): this mind's
 * own access, source by source, with the controls for it that Brain's
 * details hold today (exclude, restore and reconfirm a connected source;
 * grant, revoke and reconfirm a file), then "Open Brain", to the place.
 * Connecting, adding folders, the scan and the consent dialogs live in
 * Brain alone.
 */
export function BrainMindAccess({
  isLuca,
  name,
  residentPubkey,
}: {
  /** Luca reads everything Brain connects while every grant is active. */
  isLuca: boolean;
  name: string;
  residentPubkey: string;
}) {
  const { goBrain } = useAppNavigation();
  const connectedQuery = useConnectedBrainInventoryQuery();
  const ownerQuery = useOwnerBrainStateQuery();
  const residentsQuery = useLucaResidentsQuery();
  const connected = useConnectedBrainActions();
  const owner = useOwnerBrainActions();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] =
    React.useState<MindSourceAccess | null>(null);

  const files =
    ownerQuery.data?.availability === "ready" ? ownerQuery.data : undefined;
  const rows = mindBrainAccess(connectedQuery.data, files, residentPubkey);
  // Brain's details offer a mind's controls only to the residents Brain
  // knows; a mind it doesn't know shows its access without them.
  const known =
    residentsQuery.data?.residents.some(
      (resident) =>
        resident.residentPubkey.toLowerCase() === residentPubkey.toLowerCase(),
    ) ?? false;

  const change = async (
    row: MindSourceAccess,
    action: "grant" | "revoke" | "reconfirm",
  ) => {
    setBusy(row.sourceId);
    setError(null);
    const input = { residentPubkey, sourceId: row.sourceId };
    try {
      if (row.record === "file") await owner[action].mutateAsync(input);
      else if (action === "revoke") await connected.revoke.mutateAsync(input);
      else await connected.reconfirm.mutateAsync(input);
    } catch (failure) {
      setError(
        row.record === "file"
          ? `${name}: ${readableOwnerBrainError(failure, "access")}`
          : readableConnectedBrainError(failure),
      );
    } finally {
      setBusy(null);
    }
  };

  const loading = !connectedQuery.data && !connectedQuery.isError;
  return (
    <div data-testid="mind-brain-access">
      {error ? (
        <div
          className="mb-3 flex items-start gap-2 text-sm text-destructive"
          role="alert"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <p>{error}</p>
        </div>
      ) : null}
      {isLuca && readsEverything(rows) ? (
        <p
          className="pb-3 text-sm text-muted-foreground"
          data-testid="mind-brain-access-everything"
        >
          {name} reads everything Brain connects.
        </p>
      ) : null}
      {loading ? null : rows.length === 0 ? (
        <p className="pb-3 text-sm text-muted-foreground">
          Brain has nothing connected yet.
        </p>
      ) : (
        <ul aria-label={`What ${name} can read`}>
          {rows.map((row) => (
            <AccessRow
              busy={busy === row.sourceId}
              key={`${row.record}:${row.sourceId}`}
              onGrant={() => void change(row, "grant")}
              onReconfirm={() => void change(row, "reconfirm")}
              onRevoke={() =>
                row.record === "file"
                  ? setRevokeTarget(row)
                  : void change(row, "revoke")
              }
              row={row}
              withControls={known}
            />
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          data-testid="mind-open-brain"
          onClick={() => void goBrain()}
          size="quiet"
          variant="quiet"
        >
          {/* An in-app move, drawn as the runtime sessions' Open Brain
              draws it: ArrowRight at 16, after the words. */}
          Open Brain <ArrowRight className="!size-4" />
        </Button>
      </div>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
        open={revokeTarget !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke {name}&apos;s access?</AlertDialogTitle>
            <AlertDialogDescription>
              Future retrieval from {revokeTarget?.name} will be denied for this
              resident. Other resident grants are unchanged, and you can grant
              access again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep access</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (revokeTarget) void change(revokeTarget, "revoke");
                setRevokeTarget(null);
              }}
            >
              Revoke access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** One source: its name, its kind and what the grant covers, this mind's
 *  state, and the control Brain's details give that state. */
function AccessRow({
  busy,
  onGrant,
  onReconfirm,
  onRevoke,
  row,
  withControls,
}: {
  busy: boolean;
  onGrant: () => void;
  onReconfirm: () => void;
  onRevoke: () => void;
  row: MindSourceAccess;
  withControls: boolean;
}) {
  const file = row.record === "file";
  return (
    <li
      className="flex flex-col gap-2 border-b border-border/40 py-3 first:pt-0 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-5"
      data-state={row.state}
      data-testid={`mind-brain-source-${row.sourceId}`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm">{row.name}</p>
          <span
            className={cn(
              "text-2xs",
              row.state === "active"
                ? "text-emerald-400"
                : row.state === "stale"
                  ? "text-amber-400"
                  : "text-muted-foreground",
            )}
          >
            {accessWord(row)}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {accessDetail(row)}
        </p>
      </div>
      {withControls ? (
        <div className="flex shrink-0 gap-2">
          {row.state === "active" || (file && row.state === "stale") ? (
            <Button
              disabled={busy}
              onClick={onRevoke}
              size="quiet"
              variant="quiet"
            >
              {file ? "Revoke" : "Exclude"}
            </Button>
          ) : null}
          {row.state === "stale" ? (
            <Button
              disabled={busy || (file && !row.canReconfirm)}
              onClick={onReconfirm}
              size="quiet"
              variant="quiet"
            >
              <RotateCcw /> {file ? "Reconfirm" : "Reconfirm resident"}
            </Button>
          ) : null}
          {row.state === "revoked" || row.state === "absent" ? (
            <Button
              disabled={busy}
              onClick={file ? onGrant : onReconfirm}
              size="quiet"
              variant="quiet"
            >
              {file ? "Grant access" : "Restore resident access"}
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
