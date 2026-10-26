import * as React from "react";
import { toast } from "sonner";

import {
  PlaceAskLink,
  PlaceAskRow,
  PlaceQuietButton,
} from "@/app/shell/placeRails/PlaceAskRow";
import {
  canRememberCapabilityPermission,
  PERMISSION_TENSE_WIRE_VALUE,
  runtimePermissionOffer,
  visiblePermissionTenses,
  type VisiblePermissionTense,
} from "@/features/agents/managedPermissionPolicy";
import { ManagedInputCard } from "@/features/capabilities/ui/ManagedInputCard";
import {
  type PendingManagedInput,
  resolveManagedInput,
} from "@/shared/api/managedInputs";
import { resolveManagedPermission } from "@/shared/api/managedPermissions";
import type {
  ManagedPermissionTense,
  PendingManagedPermission,
} from "@/shared/api/types";

/**
 * The two asks a mind puts to you, as one flat row each (PlaceAskRow): a
 * permission request and a question. One row in both places that ask
 * (SHELL_BUILD.md WP-09b, Decided 1): Activity's Needs you and a mind's
 * Notebook, so an ask looks and answers the same in each. Needs you's
 * proposals and paused exchanges stay in NeedsYouCard.
 */

/** What every ask row carries besides its ask: its time, its open, and the
 *  attributes its list finds it by. */
export type AskCommon = {
  "data-testid": string;
  note: string;
  onOpen: () => void;
  openTestId: string;
} & { [attribute: `data-${string}`]: string };

/** The answers a permission card offers, in its words. */
const PERMISSION_TENSE_LABEL: Record<VisiblePermissionTense, string> = {
  always: "Always",
  deny: "Deny",
  once: "Once",
};

export function failed(error: unknown, fallback: string) {
  toast.error(error instanceof Error ? error.message : fallback);
}

/** An item's controls, in order: its title (which opens it), then its
 *  answers. */
const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * An answered ask leaves while it holds focus: focus moves on to the next
 * ask's first control, or after the last to `fallback`, so the next Tab
 * carries on from here rather than from the top of the page. Each ask is
 * found by `data-ask-key`; give the list `listRef` and `onFocus`.
 */
export function useAskFocusHandoff(
  keys: readonly string[],
  fallback?: React.RefObject<HTMLElement | null>,
) {
  const listRef = React.useRef<HTMLUListElement>(null);
  const focusedKey = React.useRef<string | null>(null);
  const shownKeys = React.useRef<readonly string[]>([]);
  React.useLayoutEffect(() => {
    const before = shownKeys.current;
    shownKeys.current = keys;
    const held = focusedKey.current;
    if (!held || keys.includes(held)) return;
    focusedKey.current = null;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const next =
      keys[Math.min(Math.max(0, before.indexOf(held)), keys.length - 1)];
    if (!next) {
      fallback?.current?.focus();
      return;
    }
    listRef.current
      ?.querySelector(`[data-ask-key="${CSS.escape(next)}"]`)
      ?.querySelector<HTMLElement>(FOCUSABLE)
      ?.focus();
  }, [fallback, keys]);
  const onFocus = React.useCallback((event: React.FocusEvent) => {
    const item = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-ask-key]",
    );
    focusedKey.current = item?.dataset.askKey ?? null;
  }, []);
  return { listRef, onFocus };
}

/** A permission: Deny · Once (and Always, where the desktop offers it), its
 *  action preview behind Details. */
export function PermissionAsk({
  common,
  pending,
  summary,
}: {
  common: AskCommon;
  pending: PendingManagedPermission;
  summary: string;
}) {
  const [busy, setBusy] = React.useState(false);
  const [details, setDetails] = React.useState(false);
  const request = pending.request;
  const structured = request.protocol === "luca.managed.permission.v2";
  const offer = runtimePermissionOffer(pending);
  const title = structured
    ? request.operation
    : request.title || "An agent is waiting for your decision.";
  const answer = async (optionId?: string, tense?: ManagedPermissionTense) => {
    setBusy(true);
    try {
      await resolveManagedPermission(pending.pendingId, optionId, tense);
    } catch (error) {
      failed(error, "This permission request is no longer active.");
      setBusy(false);
    }
  };
  const answers = structured
    ? [
        { key: "deny", label: "Deny", run: () => answer() },
        { key: "once", label: "Once", run: () => answer("allow_once") },
        ...(canRememberCapabilityPermission(request)
          ? [
              {
                key: "always",
                label: "Always here",
                run: () => answer("always_allow"),
              },
            ]
          : []),
      ]
    : visiblePermissionTenses(offer).map((tense) => ({
        key: tense,
        label: PERMISSION_TENSE_LABEL[tense],
        run: () => answer(undefined, PERMISSION_TENSE_WIRE_VALUE[tense]),
      }));
  const preview = structured
    ? request.resource.displayName
    : (request.actionPreview ?? request.toolCallId);
  const whereLine = structured
    ? null
    : offer.projectLabel
      ? `In ${offer.projectLabel}`
      : "Outside your projects";
  return (
    <PlaceAskRow
      {...common}
      answers={answers.map((each) => (
        <PlaceQuietButton
          data-testid={`needs-you-permission-${each.key}`}
          disabled={busy}
          key={each.key}
          onClick={() => void each.run()}
        >
          {each.label}
        </PlaceQuietButton>
      ))}
      extra={
        preview || whereLine || offer.note ? (
          <PlaceAskLink
            aria-expanded={details}
            onClick={() => setDetails((open) => !open)}
          >
            {details ? "Hide details" : "Details"}
          </PlaceAskLink>
        ) : null
      }
      openLabel={`${title}, ${summary}. Open the conversation`}
      panel={
        details ? (
          <div className="luca-ask-details" data-testid="needs-you-details">
            {whereLine ? <p>{whereLine}</p> : null}
            {preview ? <pre>{preview}</pre> : null}
            {offer.note ? <p>{offer.note}</p> : null}
          </div>
        ) : null
      }
      summary={summary}
      title={title}
    />
  );
}

/** A question: with one choice field, its choices then Send and Skip;
 *  otherwise Answer, which opens today's form under the row. */
export function QuestionAsk({
  common,
  pending,
  summary,
}: {
  common: AskCommon;
  pending: PendingManagedInput;
  summary: string;
}) {
  const [busy, setBusy] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [choice, setChoice] = React.useState<string | null>(null);
  const fields = pending.request.fields;
  const only =
    fields.length === 1 && fields[0].kind === "single" ? fields[0] : null;
  const send = async (action: "answered" | "declined") => {
    setBusy(true);
    try {
      await resolveManagedInput(
        pending.pendingId,
        action,
        action === "answered" && only && choice ? { [only.key]: choice } : {},
      );
    } catch (error) {
      failed(error, "This question is no longer waiting.");
      setBusy(false);
    }
  };
  return (
    <PlaceAskRow
      {...common}
      answers={
        only ? (
          <>
            <fieldset aria-label={only.label} className="luca-ask-choices">
              {only.options.map((option) => (
                <PlaceQuietButton
                  disabled={busy}
                  key={option.value}
                  onClick={() => setChoice(option.value)}
                  pressed={choice === option.value}
                  title={option.description ?? undefined}
                >
                  {option.label}
                </PlaceQuietButton>
              ))}
            </fieldset>
            <PlaceQuietButton
              data-testid="needs-you-question-send"
              disabled={busy || !choice}
              onClick={() => void send("answered")}
            >
              Send
            </PlaceQuietButton>
            <PlaceQuietButton
              data-testid="needs-you-question-skip"
              disabled={busy}
              onClick={() => void send("declined")}
            >
              Skip
            </PlaceQuietButton>
          </>
        ) : (
          <PlaceQuietButton
            aria-expanded={open}
            data-testid="needs-you-question-answer"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "Close" : "Answer"}
          </PlaceQuietButton>
        )
      }
      openLabel={`${pending.request.message}, ${summary}. Open the conversation`}
      panel={
        !only && open ? <ManagedInputCard compact pending={pending} /> : null
      }
      summary={summary}
      title={pending.request.message}
    />
  );
}
