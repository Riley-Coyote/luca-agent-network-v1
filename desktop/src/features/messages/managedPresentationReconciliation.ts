import type { ManagedFinalReconciliation } from "@/features/messages/managedPresentationTypes";

/** Classifies an exact signed-final reconciliation without normalizing bodies. */
export function classifyManagedFinalReconciliation(
  streamedText: string,
  signedText: string,
): ManagedFinalReconciliation {
  if (streamedText === signedText) return "equal";
  if (signedText.startsWith(streamedText)) return "signed_extends_stream";
  if (streamedText.startsWith(signedText)) return "stream_extends_signed";
  return "divergent";
}
