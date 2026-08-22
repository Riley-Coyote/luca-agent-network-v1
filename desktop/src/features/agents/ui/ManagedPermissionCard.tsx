import * as React from "react";
import { listen } from "@tauri-apps/api/event";
import { ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { resolveManagedPermission } from "@/shared/api/managedPermissions";
import { managedPermissionOutcomeCopy } from "@/features/messages/lib/managedOperationalStatus";
import { canRememberCapabilityPermission } from "@/features/agents/managedPermissionPolicy";
import type {
  ManagedPermissionResolvedEvent,
  PendingManagedPermission,
} from "@/shared/api/types";
import { Button } from "@/shared/ui/button";

type ManagedPermissionCardProps = {
  pending: PendingManagedPermission;
  compact?: boolean;
};

export function ManagedPermissionCard({
  pending,
  compact = false,
}: ManagedPermissionCardProps) {
  const [resolving, setResolving] = React.useState<string | null>(null);
  const request = pending.request;
  const structured = request.protocol === "luca.managed.permission.v2";
  const canRemember = structured && canRememberCapabilityPermission(request);

  React.useEffect(() => {
    let dispose: (() => void) | null = null;
    let active = true;
    void listen<ManagedPermissionResolvedEvent>(
      "managed-permission-resolved",
      ({ payload: resolution }) => {
        if (!active || resolution.pendingId !== pending.pendingId) return;
        const message = managedPermissionOutcomeCopy(resolution.outcome);
        if (resolution.outcome === "approved") toast.success(message);
        else toast(message);
      },
    ).then((unlisten) => {
      if (active) dispose = unlisten;
      else unlisten();
    });
    return () => {
      active = false;
      dispose?.();
    };
  }, [pending.pendingId]);

  async function decide(optionId?: string) {
    setResolving(optionId ?? "cancel");
    try {
      await resolveManagedPermission(pending.pendingId, optionId);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "This permission request is no longer active.",
      );
      setResolving(null);
    }
  }

  return (
    <section
      aria-label="Agent permission required"
      className="border border-border bg-card text-card-foreground shadow-sm"
      data-testid="managed-permission-card"
    >
      <div className={compact ? "p-3" : "p-4"}>
        <div className="flex items-start gap-3">
          <ShieldAlert
            aria-hidden="true"
            className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Permission required</p>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              {structured
                ? request.operation
                : request.title || "An agent is waiting for your decision."}
            </p>
            {structured ? (
              <p className="mt-2 truncate font-mono text-badge uppercase tracking-caps-wide text-ink-faint">
                {request.resource.displayName}
              </p>
            ) : request.toolCallId ? (
              <p className="mt-2 truncate font-mono text-badge uppercase tracking-caps-wide text-ink-faint">
                {request.toolCallId}
              </p>
            ) : null}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          <Button
            disabled={resolving !== null}
            onClick={() => void decide()}
            size="sm"
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
          {structured ? (
            <>
              <Button
                disabled={resolving !== null}
                onClick={() => void decide("allow_once")}
                size="sm"
                type="button"
                variant="outline"
              >
                {resolving === "allow_once" ? "Sending…" : "Allow once"}
              </Button>
              {canRemember ? (
                <Button
                  disabled={resolving !== null}
                  onClick={() => void decide("always_allow")}
                  size="sm"
                  type="button"
                >
                  {resolving === "always_allow" ? "Saving…" : "Always allow"}
                </Button>
              ) : null}
            </>
          ) : (
            request.options.map((option) => (
              <Button
                disabled={resolving !== null}
                key={option.optionId}
                onClick={() => void decide(option.optionId)}
                size="sm"
                type="button"
                variant="outline"
              >
                {resolving === option.optionId ? "Sending…" : option.name}
              </Button>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
