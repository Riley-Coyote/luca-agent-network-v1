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
import { resolveManagedPermission } from "@/shared/api/managedPermissions";
import type {
  ManagedPermissionTense,
  PendingManagedPermission,
} from "@/shared/api/types";

/**
 * The asks a mind puts to you, as one flat row each (PlaceAskRow): a
 * permission request here; a question (`QuestionAsk`, ManagedInputCard.tsx)
 * and a proposal (`ProposalAsk`, RuntimeTaskProposalConfirmation.tsx) beside
 * their long forms. One row everywhere an ask is put (SHELL_BUILD.md WP-09b,
 * Decided 1; WP-16, Decided 2): Activity's Needs you, a mind's Notebook and
 * the conversation's own pending stack, so an ask looks, reads and answers the
 * same in each. Needs you's paused exchanges stay in NeedsYouCard.
 */

export { QuestionAsk } from "@/features/capabilities/ui/ManagedInputCard";

/** What every ask row carries besides its ask: the attributes its list finds
 *  it by, and in a list its time and its open (none in the conversation the
 *  ask is in). */
export type AskCommon = {
  "data-testid": string;
  note?: string;
  onOpen?: () => void;
  openTestId?: string;
} & { [attribute: `data-${string}`]: string };

/** The answers a permission card offers, in its words. */
const PERMISSION_TENSE_LABEL: Record<VisiblePermissionTense, string> = {
  always: "Always",
  deny: "Deny",
  once: "Once",
};

/** "Saving…" only where the answer is written down; everything else is sent. */
function busyLabel(key: string): string {
  return key === "always" ? "Saving…" : "Sending…";
}

/** Read a list the way a person would: "ls and echo", "ls, echo and cat". */
function readAsList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * What "Always" will write down. A compound command is remembered a segment
 * at a time, so the ask names every one rather than letting the owner
 * discover them in Settings afterwards.
 */
export function rememberHint(
  remembers: string[],
  projectLabel: string | null,
): string {
  const where = projectLabel ?? "this project";
  const tail = "Take it back any time in Settings › Agents › Capabilities.";
  return remembers.length > 0
    ? `Remembers ${readAsList(remembers)} for ${where}. ${tail}`
    : `Remembered for ${where}. ${tail}`;
}

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
 *  action preview, where it runs and what Always remembers behind Details. */
export function PermissionAsk({
  common,
  pending,
  summary,
}: {
  common: AskCommon;
  pending: PendingManagedPermission;
  summary: string;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [details, setDetails] = React.useState(false);
  const request = pending.request;
  const structured = request.protocol === "luca.managed.permission.v2";
  const offer = runtimePermissionOffer(pending);
  const title = structured
    ? request.operation
    : request.title || "An agent is waiting for your decision.";
  const answer = async (
    key: string,
    optionId?: string,
    tense?: ManagedPermissionTense,
  ) => {
    setBusy(key);
    try {
      await resolveManagedPermission(pending.pendingId, optionId, tense);
    } catch (error) {
      failed(error, "This permission request is no longer active.");
      setBusy(null);
    }
  };
  const answers = structured
    ? [
        { key: "deny", label: "Deny", run: () => answer("deny") },
        {
          key: "once",
          label: "Once",
          run: () => answer("once", "allow_once"),
        },
        ...(canRememberCapabilityPermission(request)
          ? [
              {
                key: "always",
                label: "Always here",
                run: () => answer("always", "always_allow"),
              },
            ]
          : []),
      ]
    : visiblePermissionTenses(offer).map((tense) => ({
        key: tense,
        label: PERMISSION_TENSE_LABEL[tense],
        run: () => answer(tense, undefined, PERMISSION_TENSE_WIRE_VALUE[tense]),
      }));
  const remembered =
    !structured && offer.alwaysHere
      ? rememberHint(offer.remembers ?? [], offer.projectLabel)
      : null;
  const footnote = remembered ?? offer.note;
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
          disabled={busy !== null}
          key={each.key}
          onClick={() => void each.run()}
        >
          {busy === each.key && each.key !== "deny"
            ? busyLabel(each.key)
            : each.label}
        </PlaceQuietButton>
      ))}
      extra={
        preview || whereLine || footnote ? (
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
            {preview ? (
              <div className="luca-ask-preview">
                {!structured && request.actionPreview ? (
                  <p className="type-eyebrow text-ink-faint">Action preview</p>
                ) : null}
                <pre>{preview}</pre>
              </div>
            ) : null}
            {footnote ? <p>{footnote}</p> : null}
          </div>
        ) : null
      }
      summary={summary}
      title={title}
    />
  );
}
