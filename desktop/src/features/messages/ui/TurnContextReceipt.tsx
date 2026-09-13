import * as React from "react";

import { useCommunities } from "@/features/communities/useCommunities";
import { useIdentityQuery } from "@/shared/api/hooks";
import {
  getManagedTurnContextReceipt,
  type ManagedTurnContextReceipt,
  type ManagedTurnContextReceiptInput,
} from "@/shared/api/tauriTurnContext";

// Fixed delivery-protocol order; these are layer states, not file-read claims.
const CONTEXT_LAYERS = [
  "Capsule",
  "Handoff and open threads",
  "Notes and reflections",
  "Associative recall",
  "Brain sources",
];

/** On-demand, owner-local evidence for the exact turn being inspected. */
export function TurnContextReceipt({
  input,
  privateConversation,
}: {
  input: ManagedTurnContextReceiptInput;
  privateConversation: boolean;
}) {
  const identity = useIdentityQuery();
  const { activeCommunity } = useCommunities();
  if (!privateConversation || !identity.data?.pubkey) return null;
  const scope = JSON.stringify([
    identity.data.pubkey,
    activeCommunity?.relayUrl,
    input.conversationId,
    input.residentPubkey,
    input.dispatchReceiptId,
  ]);
  return <ReceiptDisclosure input={input} key={scope} />;
}

function ReceiptDisclosure({
  input,
}: {
  input: ManagedTurnContextReceiptInput;
}) {
  const [open, setOpen] = React.useState(false);
  const [receipt, setReceipt] =
    React.useState<ManagedTurnContextReceipt | null>(null);
  const [failed, setFailed] = React.useState(false);
  const { conversationId, residentPubkey, dispatchReceiptId } = input;
  React.useEffect(() => {
    if (!open) return;
    let current = true;
    setReceipt(null);
    setFailed(false);
    void getManagedTurnContextReceipt({
      conversationId,
      residentPubkey,
      dispatchReceiptId,
    })
      .then((next) => {
        if (current) setReceipt(next);
      })
      .catch(() => {
        if (current) setFailed(true);
      });
    return () => {
      current = false;
    };
  }, [open, conversationId, residentPubkey, dispatchReceiptId]);
  return (
    <details
      className="mt-3 border-t border-border/50 pt-2 text-xs text-muted-foreground"
      data-testid="turn-context-receipt"
      onToggle={(event) => {
        if (event.target === event.currentTarget)
          setOpen(event.currentTarget.open);
      }}
    >
      <summary className="w-fit cursor-pointer rounded-sm py-1 hover:text-foreground focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2">
        Context for this turn
      </summary>
      {open ? (
        <section
          className="space-y-3 pb-1 pt-2 leading-relaxed"
          aria-label="Turn context receipt"
        >
          {failed || receipt?.availability === "unavailable" ? (
            <p role="status">
              Context evidence is unavailable for this turn. Missing or legacy
              records cannot confirm what was delivered.
            </p>
          ) : !receipt ? (
            <p role="status">Loading turn context…</p>
          ) : (
            <>
              <div>
                <p className="font-medium text-ink">Attached</p>
                <p>
                  {receipt.attachment
                    ? `Source selection · revision ${receipt.attachment.revision} · ${receipt.attachment.sourceIds.length} ${receipt.attachment.sourceIds.length === 1 ? "source" : "sources"}`
                    : "No source selection retained in this receipt."}
                </p>
                {receipt.attachment ? (
                  <details className="mt-1">
                    <summary className="w-fit cursor-pointer rounded-sm hover:text-foreground">
                      Source references
                    </summary>
                    <p className="mt-1 break-all font-mono text-2xs">
                      {receipt.attachment.snapshotRef}
                    </p>
                    <ul className="mt-1 space-y-1">
                      {receipt.attachment.sourceIds.map((id) => (
                        <li className="break-all font-mono text-2xs" key={id}>
                          {id}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                {receipt.sessionContext?.attachedSessionReferenceDelivered ? (
                  <p className="mt-1">
                    An attached session reference was delivered. Reading its
                    transcript is managed by the runtime.
                  </p>
                ) : null}
              </div>
              <div>
                <p className="font-medium text-ink">
                  Delivered to the runtime bridge
                </p>
                <p>
                  {receipt.sessionContext
                    ? receipt.sessionContext.status === "ready"
                      ? "Working context delivered."
                      : "Working context delivered with limitations."
                    : "Working-context delivery was not recorded."}
                </p>
                <p>
                  {receipt.continuity
                    ? `Continuity packet delivered · ${receipt.continuity.status}.`
                    : "Continuity delivery was not recorded."}
                </p>
              </div>
              {receipt.continuity ? (
                <details>
                  <summary className="w-fit cursor-pointer rounded-sm hover:text-foreground">
                    Context layers
                  </summary>
                  <dl className="mt-2 space-y-1">
                    {CONTEXT_LAYERS.map((label, index) => (
                      <div
                        className="flex flex-wrap justify-between gap-x-4"
                        key={label}
                      >
                        <dt>{label}</dt>
                        <dd>
                          {receipt.continuity?.layerStatuses[index] ??
                            "not recorded"}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </details>
              ) : null}
              <p>
                Delivery does not confirm which files were read or which
                material the model used. Saved Notebook notes are separate from
                this turn’s receipt.
              </p>
            </>
          )}
        </section>
      ) : null}
    </details>
  );
}
