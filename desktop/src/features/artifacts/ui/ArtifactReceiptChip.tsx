import { FileCode2, LoaderCircle } from "lucide-react";

import { useArtifactCanvas } from "@/features/artifacts/ArtifactCanvasProvider";
import type { ArtifactReceipt } from "@/features/artifacts/types";
import { useArtifactResidentLabel } from "@/features/artifacts/useArtifactProvenanceLabels";
import { cn } from "@/shared/lib/cn";

export function ArtifactReceiptChip({ receipt }: { receipt: ArtifactReceipt }) {
  const { openArtifact } = useArtifactCanvas();
  const residentLabel = useArtifactResidentLabel(receipt.residentPubkey);
  const isProvisional = receipt.state === "provisional";
  return (
    <button
      className={cn("artifact-receipt-chip", `is-${receipt.state}`)}
      data-testid={`artifact-receipt-${receipt.id}`}
      onClick={() =>
        openArtifact({
          artifactId: receipt.artifactId,
          version: receipt.version,
          previewSessionId: null,
          conversationId: receipt.conversationId,
          residentPubkey: receipt.residentPubkey,
          turnId: receipt.turnId,
          source: "conversation",
        })
      }
      type="button"
    >
      {isProvisional ? (
        <LoaderCircle aria-hidden className="animate-spin" />
      ) : (
        <FileCode2 aria-hidden />
      )}
      <span>
        <strong>{receipt.artifactTitle}</strong>
        <small>
          {residentLabel} · {receiptLabel(receipt.state)}
        </small>
      </span>
    </button>
  );
}

function receiptLabel(state: ArtifactReceipt["state"]) {
  switch (state) {
    case "provisional":
      return "Creating artifact";
    case "interrupted":
      return "Saved before interruption";
    case "orphaned":
      return "Saved without a linked final";
    default:
      return "Open in Canvas";
  }
}
