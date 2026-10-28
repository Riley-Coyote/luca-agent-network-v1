import type * as React from "react";
import { useMemo } from "react";

import { useLucaResidentsQuery } from "@/features/luca/residents/hooks";
import { FingerprintResidentsProvider } from "@/shared/ui/fingerprint/AgentFingerprint";

/**
 * Gives every fingerprint below it the owner's agents in the order they
 * arrived, so the first five kinds step past one another (WP-41).
 */
export function ResidentFingerprintKinds({
  children,
}: {
  children: React.ReactNode;
}) {
  const residents = useLucaResidentsQuery();
  const list = useMemo(
    () =>
      (residents.data?.residents ?? []).map((resident) => ({
        publicKey: resident.residentPubkey,
        arrivedAt: resident.createdAt,
      })),
    [residents.data],
  );
  return (
    <FingerprintResidentsProvider residents={list}>
      {children}
    </FingerprintResidentsProvider>
  );
}
