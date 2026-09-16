import * as React from "react";
import { listen } from "@tauri-apps/api/event";
import { ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { resolveManagedPermission } from "@/shared/api/managedPermissions";
import { managedPermissionOutcomeCopy } from "@/features/messages/lib/managedOperationalStatus";
import {
  canRememberCapabilityPermission,
  runtimePermissionOffer,
} from "@/features/agents/managedPermissionPolicy";
import type {
  ManagedPermissionResolvedEvent,
  ManagedPermissionTense,
  PendingManagedPermission,
} from "@/shared/api/types";
import { Button } from "@/shared/ui/button";

type ManagedPermissionCardProps = {
  pending: PendingManagedPermission;
  compact?: boolean;
};

/** "Saving…" only where the answer is written down; everything else is sent. */
function busyLabel(tense: ManagedPermissionTense): string {
  return tense === "always_here" ? "Saving…" : "Sending…";
}

/** Read a list the way a person would: "ls and echo", "ls, echo and cat". */
function readAsList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * What "Always here" will write down. A compound command is remembered a
 * segment at a time, so the card names every one rather than letting the
 * owner discover them in Settings afterwards.
 */
function rememberHint(
  remembers: string[],
  projectLabel: string | null,
): string {
  const where = projectLabel ?? "this project";
  const tail = "Take it back any time in Settings › Agents › Capabilities.";
  return remembers.length > 1
    ? `Remembers ${readAsList(remembers)} for ${where}. ${tail}`
    : `Remembered for ${where}. ${tail}`;
}

export function ManagedPermissionCard({
  pending,
  compact = false,
}: ManagedPermissionCardProps) {
  const [resolving, setResolving] = React.useState<string | null>(null);
  const request = pending.request;
  const structured = request.protocol === "luca.managed.permission.v2";
  const canRemember = structured && canRememberCapabilityPermission(request);
  const offer = runtimePermissionOffer(pending);
  const projectLabel = offer.projectLabel;

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

  async function resolve(
    key: string,
    optionId?: string,
    tense?: ManagedPermissionTense,
  ) {
    setResolving(key);
    try {
      await resolveManagedPermission(pending.pendingId, optionId, tense);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "This permission request is no longer active.",
      );
      setResolving(null);
    }
  }

  /** V1: the owner answers in a tense, and the desktop picks the option. */
  const decide = (tense: ManagedPermissionTense) =>
    resolve(tense, undefined, tense);
  /** V2: the capability card still names the exact option it advertised. */
  const choose = (optionId: string) => resolve(optionId, optionId);

  return (
    <section
      aria-label="Agent permission required"
      className="min-w-0 max-w-full border border-border bg-card text-card-foreground shadow-sm"
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
            <p
              className="mt-1 wrap-anywhere text-sm leading-5 text-muted-foreground"
              data-testid="managed-permission-operation"
            >
              {structured
                ? request.operation
                : request.title || "An agent is waiting for your decision."}
            </p>
            {structured ? (
              <p className="mt-2 truncate font-mono text-badge uppercase tracking-caps-wide text-ink-faint">
                {request.resource.displayName}
              </p>
            ) : (
              <>
                <p
                  className="mt-1 text-xs leading-5 text-muted-foreground"
                  data-testid="managed-permission-where"
                >
                  {projectLabel
                    ? `In ${projectLabel}`
                    : "Outside your projects"}
                </p>
                {offer.note ? (
                  <p
                    className="mt-1 text-xs leading-5 text-muted-foreground"
                    data-testid="managed-permission-note"
                  >
                    {offer.note}
                  </p>
                ) : null}
                {request.actionPreview ? (
                  <div
                    className="mt-3"
                    data-testid="managed-permission-action-preview"
                  >
                    <p className="text-badge font-medium uppercase tracking-caps-wide text-ink-faint">
                      Action preview
                    </p>
                    <p className="mt-1 whitespace-pre-wrap wrap-anywhere font-mono text-xs leading-5 text-foreground">
                      {request.actionPreview}
                    </p>
                  </div>
                ) : request.toolCallId ? (
                  <p className="mt-2 truncate font-mono text-badge uppercase tracking-caps-wide text-ink-faint">
                    {request.toolCallId}
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          {structured ? (
            <>
              <Button
                disabled={resolving !== null}
                onClick={() => void resolve("cancel")}
                size="sm"
                type="button"
                variant="ghost"
              >
                Deny
              </Button>
              <Button
                disabled={resolving !== null}
                onClick={() => void choose("allow_once")}
                size="sm"
                type="button"
                variant="outline"
              >
                {resolving === "allow_once" ? "Sending…" : "Once"}
              </Button>
              {canRemember ? (
                <Button
                  disabled={resolving !== null}
                  onClick={() => void choose("always_allow")}
                  size="sm"
                  type="button"
                >
                  {resolving === "always_allow" ? "Saving…" : "Always here"}
                </Button>
              ) : null}
            </>
          ) : (
            <>
              {offer.deny ? (
                <Button
                  data-testid="managed-permission-tense-deny"
                  disabled={resolving !== null}
                  onClick={() => void decide("deny")}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {resolving === "deny" ? busyLabel("deny") : "Deny"}
                </Button>
              ) : null}
              {offer.once ? (
                <Button
                  data-testid="managed-permission-tense-once"
                  disabled={resolving !== null}
                  onClick={() => void decide("once")}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {resolving === "once" ? busyLabel("once") : "Once"}
                </Button>
              ) : null}
              {offer.task ? (
                <Button
                  data-testid="managed-permission-tense-task"
                  disabled={resolving !== null}
                  onClick={() => void decide("task")}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {resolving === "task" ? busyLabel("task") : "For this task"}
                </Button>
              ) : null}
              {offer.alwaysHere ? (
                <Button
                  data-testid="managed-permission-tense-always_here"
                  disabled={resolving !== null}
                  onClick={() => void decide("always_here")}
                  size="sm"
                  type="button"
                >
                  {resolving === "always_here"
                    ? busyLabel("always_here")
                    : "Always here"}
                </Button>
              ) : null}
            </>
          )}
        </div>
        {!structured && offer.alwaysHere ? (
          <p
            className="mt-2 text-right text-xs leading-5 text-ink-faint"
            data-testid="managed-permission-remember-hint"
          >
            {rememberHint(offer.remembers ?? [], projectLabel)}
          </p>
        ) : null}
      </div>
    </section>
  );
}
