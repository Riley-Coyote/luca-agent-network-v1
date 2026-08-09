import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  cancelOwnerBrainImport,
  commitOwnerBrainImport,
  getOwnerBrainState,
  grantOwnerBrainSource,
  pickAndPreviewOwnerBrainSource,
  reconfirmOwnerBrainSource,
  revokeOwnerBrainSource,
  type OwnerBrainGrantInput,
} from "@/shared/api/tauriBrain";

export const ownerBrainStateQueryKey = ["owner-brain-state"] as const;

export function useOwnerBrainStateQuery() {
  return useQuery({
    queryKey: ownerBrainStateQueryKey,
    queryFn: getOwnerBrainState,
  });
}

export function useOwnerBrainActions() {
  const queryClient = useQueryClient();
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ownerBrainStateQueryKey });

  return {
    pickSource: useMutation({ mutationFn: pickAndPreviewOwnerBrainSource }),
    commitImport: useMutation({
      mutationFn: commitOwnerBrainImport,
      onSuccess: refresh,
    }),
    cancelImport: useMutation({ mutationFn: cancelOwnerBrainImport }),
    grant: useMutation({
      mutationFn: (input: OwnerBrainGrantInput) => grantOwnerBrainSource(input),
      onSuccess: refresh,
    }),
    revoke: useMutation({
      mutationFn: (input: OwnerBrainGrantInput) =>
        revokeOwnerBrainSource(input),
      onSuccess: refresh,
    }),
    reconfirm: useMutation({
      mutationFn: (input: OwnerBrainGrantInput) =>
        reconfirmOwnerBrainSource(input),
      onSuccess: refresh,
    }),
  };
}
