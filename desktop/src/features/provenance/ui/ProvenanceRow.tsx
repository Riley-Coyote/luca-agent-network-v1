import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Copy,
  Hash,
  ShieldAlert,
  ShieldQuestion,
} from "lucide-react";
import * as React from "react";

import type { ProvenanceRecord } from "@/features/provenance/lib/provenanceRecord";
import type { VerificationStatus } from "@/features/provenance/lib/verifyProvenance";
import { copyTextToClipboard } from "@/shared/lib/clipboard";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { PubKey } from "@/shared/ui/PubKey";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

function clockLabel(createdAt: number): string {
  return new Date(createdAt * 1_000).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function exactLabel(createdAt: number): string {
  return new Date(createdAt * 1_000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  });
}

/**
 * The verification mark.
 *
 * A passing check is the expected state, so it stays quiet — a green tick on
 * every row would be noise that hides the one row that matters. A failed check
 * is the opposite and is allowed to shout.
 */
function VerificationMark({ status }: { status: VerificationStatus }) {
  const { Icon, className, label } =
    status === "verified"
      ? {
          Icon: Check,
          className: "text-muted-foreground/60",
          label: "Signature verified against this resident's key",
        }
      : status === "failed"
        ? {
            Icon: ShieldAlert,
            className: "text-destructive",
            label: "Signature does not match — this record cannot be trusted",
          }
        : {
            Icon: ShieldQuestion,
            className: "text-muted-foreground/40",
            label: "No checkable signature on this record",
          };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span aria-label={label} className="shrink-0" role="img">
          <Icon aria-hidden className={cn("h-3.5 w-3.5", className)} />
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function VerificationSentence({ status }: { status: VerificationStatus }) {
  if (status === "verified") {
    return (
      <p className="text-2xs text-muted-foreground">
        Checked just now: the contents hash to this event id, and the signature
        matches the signing key. Nothing here has been altered.
      </p>
    );
  }
  if (status === "failed") {
    return (
      <p className="text-2xs text-destructive">
        This record failed verification. Either the contents were changed after
        signing, or it was not signed by the key it claims. Do not trust it.
      </p>
    );
  }
  return (
    <p className="text-2xs text-muted-foreground">
      This record arrived without a signature that can be checked, so it proves
      nothing on its own.
    </p>
  );
}

function ReceiptField({
  label,
  mono = true,
  truncate = false,
  value,
}: {
  label: string;
  mono?: boolean;
  /** Long hex (a signature) stays one line; copying still takes all of it. */
  truncate?: boolean;
  value: string;
}) {
  const [copied, setCopied] = React.useState(false);
  const reset = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(reset.current), []);

  return (
    <div className="group/field flex min-w-0 items-center justify-between gap-3 py-1.5">
      <span className="shrink-0 text-2xs text-muted-foreground">{label}</span>
      <button
        className={cn(
          "flex min-w-0 cursor-pointer items-center gap-1.5 rounded-sm text-right text-xs text-foreground/80 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
          mono && "font-mono",
        )}
        onClick={() => {
          copyTextToClipboard(value, `${label} copied`);
          setCopied(true);
          window.clearTimeout(reset.current);
          reset.current = window.setTimeout(() => setCopied(false), 1500);
        }}
        title={`Copy ${label}`}
        type="button"
      >
        <span className={cn("min-w-0", truncate ? "truncate" : "break-all")}>
          {value}
        </span>
        {copied ? (
          <Check aria-hidden className="h-3 w-3 shrink-0" />
        ) : (
          <Copy
            aria-hidden
            className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover/field:opacity-60"
          />
        )}
      </button>
    </div>
  );
}

export function ProvenanceRow({
  channelLabel,
  onOpenInConversation,
  record,
}: {
  channelLabel: string | null;
  /** Absent when the record is not something the app can navigate to. */
  onOpenInConversation: (() => void) | null;
  record: ProvenanceRecord;
}) {
  const [open, setOpen] = React.useState(false);
  const receiptId = React.useId();
  const consequential = record.weight === "consequence";
  const suspect = record.verification === "failed";
  const sentence = [record.verb, record.object].filter(Boolean).join(" ");

  return (
    <li
      className="group border-border/40 border-b last:border-b-0"
      data-provenance-verification={record.verification}
      data-provenance-weight={record.weight}
      data-testid={`provenance-row-${record.event.id.slice(0, 12)}`}
    >
      <button
        aria-controls={receiptId}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-3 rounded-sm px-1 py-1.5 text-left transition-colors hover:bg-foreground/[0.03] focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
          suspect && "bg-destructive/[0.06]",
        )}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className="w-12 shrink-0 font-mono text-2xs text-muted-foreground tabular-nums">
          {clockLabel(record.createdAt)}
        </span>

        <VerificationMark status={record.verification} />

        <span className="min-w-0 flex-1 truncate" title={sentence}>
          <span
            className={cn(
              "text-sm",
              consequential ? "text-foreground" : "text-foreground/85",
            )}
          >
            {record.verb}
          </span>
          {record.object ? (
            <span className="ml-1.5 text-muted-foreground text-sm">
              {record.object}
            </span>
          ) : null}
          {record.outcome ? (
            <span className="ml-1.5 text-2xs text-muted-foreground">
              → {record.outcome}
            </span>
          ) : null}
        </span>

        {channelLabel ? (
          <span className="hidden shrink-0 items-center gap-0.5 text-2xs text-muted-foreground sm:inline-flex">
            <Hash aria-hidden className="h-2.5 w-2.5" />
            {channelLabel}
          </span>
        ) : null}

        <ChevronRight
          aria-hidden
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-transform",
            open && "rotate-90",
          )}
        />
      </button>

      <div hidden={!open} id={receiptId}>
        <div className="mb-2 ml-12 rounded-lg border border-border/50 bg-foreground/[0.02] px-3 py-2.5">
          {/* What was said comes first. The cryptography backs it; it is not
              the thing a person opened the row to read. */}
          {record.event.content.length > 0 ? (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-sans text-foreground/90 text-sm leading-relaxed">
              {record.event.content}
            </pre>
          ) : (
            <p className="text-muted-foreground text-sm">
              This record carries no content of its own.
            </p>
          )}

          <div className="mt-3 flex items-center justify-between gap-3 border-border/40 border-t pt-2.5">
            <VerificationSentence status={record.verification} />
            {onOpenInConversation ? (
              <Button
                className="shrink-0"
                onClick={onOpenInConversation}
                size="sm"
                type="button"
                variant="ghost"
              >
                Open in conversation
                <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>

          <div className="mt-1 divide-y divide-border/40">
            <ReceiptField label="event id" value={record.event.id} />
            <ReceiptField
              label="signature"
              truncate
              value={record.event.sig}
            />
            <ReceiptField label="kind" value={String(record.event.kind)} />
            <ReceiptField
              label="signed at"
              mono={false}
              value={exactLabel(record.createdAt)}
            />
            <div className="flex items-center justify-between gap-3 py-1.5">
              <span className="shrink-0 text-2xs text-muted-foreground">
                signed by
              </span>
              <PubKey className="text-xs" pubkey={record.event.pubkey} />
            </div>
          </div>

          <div className="mt-1 flex justify-end">
            <Button
              onClick={() =>
                copyTextToClipboard(
                  JSON.stringify(record.event, null, 2),
                  "Raw event copied",
                )
              }
              size="sm"
              type="button"
              variant="ghost"
            >
              Copy raw event
            </Button>
          </div>
        </div>
      </div>
    </li>
  );
}
