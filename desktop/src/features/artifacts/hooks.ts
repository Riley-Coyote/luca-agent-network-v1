import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ArtifactKind } from "@/features/artifacts/types";
import {
  exportArtifact,
  getArtifact,
  getPreviewSession,
  importArtifactFromPicker,
  listArtifactReceipts,
  listArtifacts,
  pinArtifact,
  readArtifactPreview,
  refreshPreviewHealth,
  restoreArtifact,
  revertArtifact,
  softDeleteArtifact,
} from "@/shared/api/tauriArtifacts";

export const artifactsQueryKey = ["artifacts"] as const;

export function useArtifactLibrary(input: {
  query: string;
  kind: "all" | ArtifactKind;
  includeDeleted: boolean;
}) {
  return useQuery({
    queryKey: [...artifactsQueryKey, input],
    queryFn: () =>
      listArtifacts({
        query: input.query || undefined,
        kind: input.kind === "all" ? undefined : input.kind,
        includeDeleted: input.includeDeleted,
        limit: 100,
      }),
  });
}

export function useArtifactDetail(artifactId: string | null) {
  return useQuery({
    queryKey: [...artifactsQueryKey, "detail", artifactId],
    queryFn: () => getArtifact(artifactId ?? ""),
    enabled: Boolean(artifactId),
  });
}

export function useArtifactPreview(
  artifactId: string | null,
  version: number | null,
) {
  return useQuery({
    queryKey: [...artifactsQueryKey, "preview", artifactId, version],
    queryFn: () => readArtifactPreview(artifactId ?? "", version),
    enabled: Boolean(artifactId),
  });
}

export function useArtifactReceipts(conversationId: string | null) {
  return useQuery({
    queryKey: [...artifactsQueryKey, "receipts", conversationId],
    queryFn: () => listArtifactReceipts(conversationId ?? ""),
    enabled: Boolean(conversationId),
    retry: false,
  });
}

export function usePreviewSession(previewSessionId: string | null) {
  return useQuery({
    queryKey: [...artifactsQueryKey, "preview-session", previewSessionId],
    queryFn: () => getPreviewSession(previewSessionId ?? ""),
    enabled: Boolean(previewSessionId),
    refetchInterval: (query) =>
      query.state.data?.status === "starting" ? 1_500 : false,
  });
}

export function useArtifactMutations() {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: artifactsQueryKey });
  return {
    importArtifact: useMutation({
      mutationFn: importArtifactFromPicker,
      onSuccess: invalidate,
    }),
    pinArtifact: useMutation({
      mutationFn: ({
        artifactId,
        pinned,
      }: {
        artifactId: string;
        pinned: boolean;
      }) => pinArtifact(artifactId, pinned),
      onSuccess: invalidate,
    }),
    deleteArtifact: useMutation({
      mutationFn: softDeleteArtifact,
      onSuccess: invalidate,
    }),
    restoreArtifact: useMutation({
      mutationFn: restoreArtifact,
      onSuccess: invalidate,
    }),
    revertArtifact: useMutation({
      mutationFn: (input: {
        artifactId: string;
        version: number;
        expectedCurrentVersion: number;
      }) =>
        revertArtifact(
          input.artifactId,
          input.version,
          input.expectedCurrentVersion,
        ),
      onSuccess: invalidate,
    }),
    exportArtifact: useMutation({
      mutationFn: ({
        artifactId,
        version,
      }: {
        artifactId: string;
        version?: number;
      }) => exportArtifact(artifactId, version),
    }),
    refreshPreview: useMutation({
      mutationFn: refreshPreviewHealth,
      onSuccess: (session) =>
        queryClient.setQueryData(
          [...artifactsQueryKey, "preview-session", session.id],
          session,
        ),
    }),
  };
}
