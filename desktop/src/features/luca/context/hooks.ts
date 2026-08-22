import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  pickConversationContextFolder,
  promoteConversationContextToProject,
  removeConversationContextOverride,
  syncConversationContext,
  updateConversationContext,
  type MutateConversationContextInput,
  type ConversationContextView,
  type SyncConversationContextInput,
  type UpdateConversationContextInput,
} from "@/shared/api/tauriConversationContext";

export function conversationContextQueryKey(conversationId: string) {
  return ["conversation-context", conversationId] as const;
}

export function useConversationContextQuery(
  input: SyncConversationContextInput | null,
) {
  return useQuery({
    enabled: input !== null,
    queryKey: input
      ? [
          ...conversationContextQueryKey(input.conversationId),
          input.projectId,
          ...input.projectSourceIds,
        ]
      : ["conversation-context", "disabled"],
    queryFn: () => {
      if (!input) throw new Error("Conversation context is unavailable");
      return syncConversationContext(input);
    },
    staleTime: 15_000,
  });
}

export function useConversationContextActions(conversationId: string) {
  const queryClient = useQueryClient();
  const commit = (view: ConversationContextView | null) => {
    if (!view) return;
    queryClient.setQueriesData(
      { queryKey: conversationContextQueryKey(conversationId) },
      view,
    );
  };

  return {
    update: useMutation({
      mutationFn: (input: UpdateConversationContextInput) =>
        updateConversationContext(input),
      onSuccess: commit,
    }),
    promote: useMutation({
      mutationFn: (input: MutateConversationContextInput) =>
        promoteConversationContextToProject(input),
      onSuccess: commit,
    }),
    clearOverride: useMutation({
      mutationFn: (input: MutateConversationContextInput) =>
        removeConversationContextOverride(input),
      onSuccess: commit,
    }),
    pickFolder: useMutation({
      mutationFn: (input: MutateConversationContextInput) =>
        pickConversationContextFolder(input),
      onSuccess: commit,
    }),
  };
}
