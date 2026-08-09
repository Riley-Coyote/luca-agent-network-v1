import {
  AlertTriangle,
  Check,
  Cloud,
  Laptop,
  LockKeyhole,
  RotateCcw,
  ShieldOff,
} from "lucide-react";
import * as React from "react";

import type { ResidentRegistryEntry } from "@/features/luca/residents/api";
import type {
  OwnerBrainGrant,
  OwnerBrainSource,
} from "@/shared/api/tauriBrain";
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
import { SubsectionLabel } from "@/shared/ui/PageHeader";

type GrantAction = "grant" | "revoke" | "reconfirm";

type BrainAccessPanelProps = {
  grants: OwnerBrainGrant[];
  isMutating: boolean;
  onAction: (
    action: GrantAction,
    resident: Pick<ResidentRegistryEntry, "displayName" | "residentPubkey">,
  ) => void;
  residents: ResidentRegistryEntry[];
  source: OwnerBrainSource;
};

export function BrainAccessPanel({
  grants,
  isMutating,
  onAction,
  residents,
  source,
}: BrainAccessPanelProps) {
  const [revokeTarget, setRevokeTarget] =
    React.useState<ResidentRegistryEntry | null>(null);
  const grantsByResident = new Map(
    grants
      .filter((grant) => grant.sourceId === source.sourceId)
      .map((grant) => [grant.residentPubkey, grant]),
  );

  return (
    <section
      aria-labelledby="brain-access-heading"
      className="overflow-hidden rounded-2xl border border-border/60 bg-card/30"
      data-testid="brain-access-panel"
    >
      <div className="border-b border-border/60 px-5 py-4">
        <SubsectionLabel>Resident access</SubsectionLabel>
        <h2
          className="mt-1 text-base font-semibold tracking-tight"
          id="brain-access-heading"
        >
          Explicit grants only
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Each resident gets independent access to this source. A runtime,
          provider, or network-egress change makes that grant stale.
        </p>
      </div>

      {residents.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <LockKeyhole className="mx-auto h-5 w-5 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">No residents yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Create a resident before granting Brain access.
          </p>
        </div>
      ) : (
        <div>
          {residents.map((resident) => {
            const grant = grantsByResident.get(resident.residentPubkey);
            return (
              <ResidentGrantRow
                grant={grant}
                isMutating={isMutating}
                key={resident.residentPubkey}
                onGrant={() => onAction("grant", resident)}
                onReconfirm={() => onAction("reconfirm", resident)}
                onRevoke={() => setRevokeTarget(resident)}
                resident={resident}
              />
            );
          })}
        </div>
      )}

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
        open={revokeTarget !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Revoke {revokeTarget?.displayName}&apos;s access?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Future retrieval from {source.displayName} will be denied for this
              resident. Other resident grants are unchanged, and you can grant
              access again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep access</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (revokeTarget) onAction("revoke", revokeTarget);
                setRevokeTarget(null);
              }}
            >
              Revoke access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function ResidentGrantRow({
  grant,
  isMutating,
  onGrant,
  onReconfirm,
  onRevoke,
  resident,
}: {
  grant?: OwnerBrainGrant;
  isMutating: boolean;
  onGrant: () => void;
  onReconfirm: () => void;
  onRevoke: () => void;
  resident: ResidentRegistryEntry;
}) {
  const state = grant?.state ?? "absent";
  return (
    <div
      className="flex flex-col gap-3 border-b border-border/40 px-5 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
      data-testid={`brain-grant-${resident.residentPubkey}`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium">{resident.displayName}</p>
          <GrantState state={state} />
        </div>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          {grant?.providerEgress === "local" ? (
            <Laptop className="h-3.5 w-3.5" />
          ) : (
            <Cloud className="h-3.5 w-3.5" />
          )}
          {grant
            ? `${grant.providerEgress === "local" ? "Local" : "Remote"} provider path`
            : "No source content can be retrieved"}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        {state === "active" ? (
          <Button
            disabled={isMutating}
            onClick={onRevoke}
            size="xs"
            type="button"
            variant="ghost"
          >
            Revoke
          </Button>
        ) : null}
        {state === "stale" ? (
          <>
            <Button
              disabled={isMutating}
              onClick={onRevoke}
              size="xs"
              type="button"
              variant="ghost"
            >
              Revoke
            </Button>
            <Button
              disabled={isMutating || !grant?.canReconfirm}
              onClick={onReconfirm}
              size="xs"
              type="button"
              variant="outline"
            >
              <RotateCcw /> Reconfirm
            </Button>
          </>
        ) : null}
        {state === "absent" || state === "revoked" ? (
          <Button
            disabled={isMutating}
            onClick={onGrant}
            size="xs"
            type="button"
            variant="outline"
          >
            Grant access
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function GrantState({ state }: { state: OwnerBrainGrant["state"] | "absent" }) {
  const values = {
    active: {
      icon: Check,
      label: "Active",
      className: "border-emerald-500/25 bg-emerald-500/8 text-emerald-300",
    },
    stale: {
      icon: AlertTriangle,
      label: "Needs review",
      className: "border-amber-500/25 bg-amber-500/8 text-amber-300",
    },
    revoked: {
      icon: ShieldOff,
      label: "Revoked",
      className: "border-border/60 bg-muted/25 text-muted-foreground",
    },
    absent: {
      icon: LockKeyhole,
      label: "No access",
      className: "border-border/60 bg-transparent text-muted-foreground",
    },
  } as const;
  const value = values[state];
  const Icon = value.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-medium ${value.className}`}
    >
      <Icon className="h-3 w-3" />
      {value.label}
    </span>
  );
}
