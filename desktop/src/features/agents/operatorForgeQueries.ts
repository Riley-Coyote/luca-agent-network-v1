import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getOperatorForgeSettings,
  listNativeProvisioningTransactions,
  saveOperatorForgePreferences,
  type SaveOperatorPreferencesInputV1,
} from "@/shared/api/tauriOperatorForge";

export const operatorForgeSettingsQueryKey = [
  "operator-forge-settings",
] as const;
export const nativeProvisioningActivityQueryKey = [
  "native-provisioning-activity",
] as const;

export function useOperatorForgeSettingsQuery() {
  return useQuery({
    queryKey: operatorForgeSettingsQueryKey,
    queryFn: getOperatorForgeSettings,
  });
}

export function useSaveOperatorForgePreferencesMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveOperatorPreferencesInputV1) =>
      saveOperatorForgePreferences(input),
    onSuccess: (settings) => {
      queryClient.setQueryData(operatorForgeSettingsQueryKey, settings);
    },
  });
}

export function useNativeProvisioningActivityQuery() {
  return useQuery({
    queryKey: nativeProvisioningActivityQueryKey,
    queryFn: listNativeProvisioningTransactions,
  });
}
