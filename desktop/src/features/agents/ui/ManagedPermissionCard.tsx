import * as React from "react";
import { listen } from "@tauri-apps/api/event";
import { ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import {
  PermissionAsk,
  isCompanionSetupReview,
  rememberHint,
} from "@/app/shell/placeRails/ManagedAsks";
import { resolveManagedPermission } from "@/shared/api/managedPermissions";
import { managedPermissionOutcomeCopy } from "@/features/messages/lib/managedOperationalStatus";
import {
  canRememberCapabilityPermission,
  PERMISSION_TENSE_WIRE_VALUE,
  runtimePermissionOffer,
  visiblePermissionTenses,
  type VisiblePermissionTense,
} from "@/features/agents/managedPermissionPolicy";
import type {
  ManagedPermissionResolvedEvent,
  ManagedPermissionTense,
  PendingManagedPermission,
} from "@/shared/api/types";
import { useShellFrameEnabled } from "@/shared/features/useShellFrameEnabled";
import { Button, type ButtonProps } from "@/shared/ui/button";

type ManagedPermissionCardProps = {
  pending: PendingManagedPermission;
  compact?: boolean;
  /** Who asks, in the ask's words ("Atlas asks"); drawn under the frame. */
  summary?: string;
  /** Under the frame, the row alone, for a list that holds every ask (a
   *  room's stack, SHELL_BUILD.md WP-23). */
  bare?: boolean;
};

/**
 * Label and styling for each of the three buttons an unstructured card can
 * show, in their fixed visual order (Deny · Once · Always — see
 * `visiblePermissionTenses`). Always is the one filled/primary button, so it
 * takes no `variant` at all, same as before this was table-driven.
 */
const TENSE_BUTTON_CONFIG: Record<
  VisiblePermissionTense,
  { label: string; variant?: ButtonProps["variant"] }
> = {
  deny: { label: "Deny", variant: "ghost" },
  once: { label: "Once", variant: "outline" },
  always: { label: "Always" },
};

/** "Saving…" only where the answer is written down; everything else is sent. */
function busyLabel(tense: ManagedPermissionTense): string {
  return tense === "always_here" ? "Saving…" : "Sending…";
}

export function ManagedPermissionCard({
  pending,
  compact = false,
  summary,
  bare = false,
}: ManagedPermissionCardProps) {
  const shellFrame = useShellFrameEnabled();
  const [resolving, setResolving] = React.useState<string | null>(null);
  const request = pending.request;
  const structured = request.protocol === "luca.managed.permission.v2";
  const companionSetup = isCompanionSetupReview(request);
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

  // Under the frame, the one drawing every ask has (SHELL_BUILD.md WP-16,
  // Decided 2): Needs you's row, with the same words and answers, its preview
  // behind Details. The outcome is still announced from here.
  if (shellFrame) {
    const row = (
      <PermissionAsk
        common={{
          "data-pending-id": pending.pendingId,
          "data-testid": "managed-permission-card",
        }}
        pending={pending}
        surface={bare}
        summary={summary ?? "Asks you"}
      />
    );
    return bare ? row : <ul className="luca-ask-list">{row}</ul>;
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
                {companionSetup ? "Not now" : "Deny"}
              </Button>
              {companionSetup ? (
                <Button
                  disabled={resolving !== null}
                  onClick={() => void choose("customize")}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {resolving === "customize" ? "Sending…" : "Customize"}
                </Button>
              ) : null}
              <Button
                disabled={resolving !== null}
                onClick={() => void choose("allow_once")}
                size="sm"
                type="button"
                variant="outline"
              >
                {resolving === "allow_once"
                  ? "Sending…"
                  : companionSetup
                    ? "Approve"
                    : "Once"}
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
            visiblePermissionTenses(offer).map((tense) => {
              const wireTense = PERMISSION_TENSE_WIRE_VALUE[tense];
              const config = TENSE_BUTTON_CONFIG[tense];
              return (
                <Button
                  data-testid={`managed-permission-tense-${tense}`}
                  disabled={resolving !== null}
                  key={tense}
                  onClick={() => void decide(wireTense)}
                  size="sm"
                  type="button"
                  variant={config.variant}
                >
                  {resolving === wireTense
                    ? busyLabel(wireTense)
                    : config.label}
                </Button>
              );
            })
          )}
        </div>
        {!structured ? (
          offer.alwaysHere ? (
            <p
              className="mt-2 text-right text-xs leading-5 text-ink-faint"
              data-testid="managed-permission-remember-hint"
            >
              {rememberHint(offer.remembers ?? [], projectLabel)}
            </p>
          ) : offer.note ? (
            <p
              className="mt-2 text-right text-xs leading-5 text-ink-faint"
              data-testid="managed-permission-note"
            >
              {offer.note}
            </p>
          ) : null
        ) : null}
      </div>
    </section>
  );
}
