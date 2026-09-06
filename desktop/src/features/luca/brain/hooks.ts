import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  cancelOwnerBrainImport,
  commitOwnerBrainImport,
  connectConnectedBrainSource,
  disconnectConnectedBrainSource,
  discoverConnectedBrainSources,
  getOwnerBrainState,
  grantOwnerBrainSource,
  pickAndPreviewOwnerBrainSource,
  reconfirmConnectedBrainSource,
  reconfirmOwnerBrainSource,
  refreshConnectedBrainSource,
  revokeConnectedBrainResident,
  revokeOwnerBrainSource,
  addConnectedBrainRoot,
  type ConnectConnectedBrainSourceInput,
  type ConnectedBrainResidentInput,
  type ConnectedBrainSourceInput,
  type OwnerBrainGrantInput,
} from "@/shared/api/tauriBrain";

export const ownerBrainStateQueryKey = ["owner-brain-state"] as const;
export const connectedBrainInventoryQueryKey = [
  "connected-brain-inventory",
] as const;

export function useOwnerBrainStateQuery({
  enabled = true,
}: {
  enabled?: boolean;
} = {}) {
  return useQuery({
    queryKey: ownerBrainStateQueryKey,
    queryFn: getOwnerBrainState,
    enabled,
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

export function useConnectedBrainInventoryQuery({
  enabled = true,
}: {
  enabled?: boolean;
} = {}) {
  return useQuery({
    queryKey: connectedBrainInventoryQueryKey,
    queryFn: discoverConnectedBrainSources,
    enabled,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
}

export function useConnectedBrainActions() {
  const queryClient = useQueryClient();
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: connectedBrainInventoryQueryKey,
      }),
      queryClient.invalidateQueries({
        queryKey: ["connected-runtime-sessions"],
      }),
    ]);
  };
  return {
    addRoot: useMutation({
      mutationFn: addConnectedBrainRoot,
      onSuccess: (inventory) => {
        if (inventory) {
          queryClient.setQueryData(connectedBrainInventoryQueryKey, inventory);
        }
      },
    }),
    connect: useMutation({
      mutationFn: (input: ConnectConnectedBrainSourceInput) =>
        connectConnectedBrainSource(input),
      onSuccess: refresh,
    }),
    refresh: useMutation({
      mutationFn: (input: ConnectedBrainSourceInput) =>
        refreshConnectedBrainSource(input),
      onSuccess: refresh,
    }),
    disconnect: useMutation({
      mutationFn: (input: ConnectedBrainSourceInput) =>
        disconnectConnectedBrainSource(input),
      onSuccess: refresh,
    }),
    reconfirm: useMutation({
      mutationFn: (input: ConnectedBrainResidentInput) =>
        reconfirmConnectedBrainSource(input),
      onSuccess: refresh,
    }),
    revoke: useMutation({
      mutationFn: (input: ConnectedBrainResidentInput) =>
        revokeConnectedBrainResident(input),
      onSuccess: refresh,
    }),
  };
}
