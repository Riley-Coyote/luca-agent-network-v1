import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import * as React from "react";

import type { ArtifactKind } from "@/features/artifacts/types";
import {
  exportArtifact,
  getArtifactPreviewState,
  getArtifact,
  importArtifactFromPicker,
  listArtifactReceipts,
  listArtifacts,
  pinArtifact,
  prepareArtifactPreview,
  readArtifactPreview,
  refreshPreviewHealth,
  revokeArtifactPreview,
  restoreArtifact,
  revertArtifact,
  softDeleteArtifact,
} from "@/shared/api/tauriArtifacts";

export const artifactsQueryKey = ["artifacts"] as const;

export function useArtifactLibrary(input: {
  query: string;
  kind: "all" | ArtifactKind;
  deletedState: "active" | "deleted" | "all";
}) {
  return useInfiniteQuery({
    queryKey: [...artifactsQueryKey, input],
    queryFn: ({ pageParam }) =>
      listArtifacts({
        query: input.query || undefined,
        kinds: input.kind === "all" ? undefined : [input.kind],
        deleted: input.deletedState,
        cursor: pageParam,
        limit: 80,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
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
  enabled = true,
) {
  return useQuery({
    queryKey: [...artifactsQueryKey, "preview", artifactId, version],
    queryFn: () => readArtifactPreview(artifactId ?? "", version),
    enabled: Boolean(artifactId) && enabled,
  });
}

export function usePreparedArtifactPreview(
  artifactId: string | null,
  version: number | null,
  enabled: boolean,
) {
  const query = useQuery({
    queryKey: [...artifactsQueryKey, "prepared-preview", artifactId, version],
    queryFn: () => prepareArtifactPreview(artifactId ?? "", version),
    enabled: Boolean(artifactId) && enabled,
    gcTime: 0,
    retry: false,
  });
  const presentationId = query.data?.presentationId;
  React.useEffect(
    () => () => {
      if (presentationId) {
        void revokeArtifactPreview(presentationId).catch(() => undefined);
      }
    },
    [presentationId],
  );
  return query;
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
    queryFn: () => refreshPreviewHealth(previewSessionId ?? ""),
    enabled: Boolean(previewSessionId),
    refetchInterval: (query) =>
      query.state.data?.status === "stopped" ? false : 2_500,
    retry: false,
  });
}

export function useArtifactPreviewState(artifactId: string | null) {
  return useQuery({
    queryKey: [...artifactsQueryKey, "preview-state", artifactId],
    queryFn: () => getArtifactPreviewState(artifactId ?? ""),
    enabled: Boolean(artifactId),
    refetchInterval: 2_500,
    retry: false,
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
