import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { channelsQueryKey } from "@/features/channels/hooks";
import {
  createLucaProject,
  listLucaProjects,
  updateLucaProject,
  type CreateLucaProjectInput,
  type UpdateLucaProjectInput,
} from "@/features/luca-projects/api";

export const lucaProjectsQueryKey = ["luca-projects"] as const;

export function useLucaProjectsQuery() {
  return useQuery({
    queryKey: lucaProjectsQueryKey,
    queryFn: listLucaProjects,
    staleTime: 30_000,
  });
}

export function useCreateLucaProjectMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateLucaProjectInput) => createLucaProject(input),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: lucaProjectsQueryKey }),
  });
}

export function useUpdateLucaProjectMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateLucaProjectInput) => updateLucaProject(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: lucaProjectsQueryKey }),
        queryClient.invalidateQueries({ queryKey: channelsQueryKey }),
      ]);
    },
  });
}
