import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { managedAgentsQueryKey } from "@/features/agents/hooks";
import {
  listResidentDocuments,
  readResidentDocument,
  type ResidentDocumentContent,
  type ResidentDocumentsInspector,
  type ResidentDocumentTarget,
  type ResidentDocumentWriteReceipt,
  writeResidentDocument,
} from "@/shared/api/tauriResidentDocuments";

/**
 * Query layer for a resident's agent folder. Reads are cached per resident;
 * a write invalidates the folder listing, the document itself, and the
 * managed-agents query — the drift hash changes on write, so the
 * needs-restart badge follows without a poll.
 */

export const residentDocumentsQueryKey = (residentPubkey: string) =>
  ["resident-documents", residentPubkey] as const;

export const residentDocumentQueryKey = (
  residentPubkey: string,
  target: ResidentDocumentTarget,
) => ["resident-document", residentPubkey, targetKey(target)] as const;

export function targetKey(target: ResidentDocumentTarget): string {
  return "kind" in target ? `kind:${target.kind}` : `path:${target.relPath}`;
}

export function useResidentDocumentsQuery(residentPubkey: string | null) {
  return useQuery<ResidentDocumentsInspector>({
    queryKey: residentDocumentsQueryKey(residentPubkey ?? ""),
    queryFn: () => listResidentDocuments(residentPubkey as string),
    enabled: Boolean(residentPubkey),
    staleTime: 5_000,
  });
}

export function useResidentDocumentQuery(
  residentPubkey: string | null,
  target: ResidentDocumentTarget | null,
) {
  return useQuery<ResidentDocumentContent>({
    queryKey: residentDocumentQueryKey(
      residentPubkey ?? "",
      target ?? { relPath: "" },
    ),
    queryFn: () =>
      readResidentDocument(
        residentPubkey as string,
        target as ResidentDocumentTarget,
      ),
    enabled: Boolean(residentPubkey && target),
    // The editor owns the draft; never refetch under someone's cursor.
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
}

export function useWriteResidentDocumentMutation(
  residentPubkey: string | null,
) {
  const queryClient = useQueryClient();
  return useMutation<
    ResidentDocumentWriteReceipt,
    Error,
    {
      target: ResidentDocumentTarget;
      content: string;
      expectedHash: string | null;
    }
  >({
    mutationFn: ({ target, content, expectedHash }) =>
      writeResidentDocument(
        residentPubkey as string,
        target,
        content,
        expectedHash,
      ),
    onSuccess: async (receipt, variables) => {
      if (!residentPubkey) return;
      queryClient.setQueryData<ResidentDocumentContent>(
        residentDocumentQueryKey(residentPubkey, variables.target),
        {
          target: variables.target,
          exists: true,
          content: variables.content,
          hash: receipt.hash,
          modifiedAt: receipt.modifiedAt,
        },
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: residentDocumentsQueryKey(residentPubkey),
        }),
        queryClient.invalidateQueries({ queryKey: managedAgentsQueryKey }),
      ]);
    },
  });
}
