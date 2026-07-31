import { useQuery } from "@tanstack/react-query";

import { listLucaResidents } from "./api";

export const lucaResidentsQueryKey = ["luca-resident-registry"] as const;

export function useLucaResidentsQuery() {
  return useQuery({
    queryKey: lucaResidentsQueryKey,
    queryFn: listLucaResidents,
  });
}
