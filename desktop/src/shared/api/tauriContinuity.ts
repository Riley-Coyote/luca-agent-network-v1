import { invoke } from "@tauri-apps/api/core";

export type ResidentHandoff = {
  summary: string;
  unresolvedThreads: string[];
  commitments: string[];
  explicitPreferences: string[];
  sourceEventIds: string[];
  updatedAt: string;
  recordId: string;
  lineageRootId: string;
  revision: number;
  pinnedOwnerCorrection: boolean;
};

export type ResidentHandoffJob = {
  jobId: string;
  state: "pending" | "running" | "completed" | "cancelled" | "failed";
  lastErrorCode: string | null;
  updatedAt: string;
  canRetry: boolean;
};

export type ResidentContinuityInspector = {
  enabled: boolean;
  availability: "ready" | "empty" | "locked" | "unavailable" | "invalid";
  handoff: ResidentHandoff | null;
  job: ResidentHandoffJob | null;
};

export type ResidentContinuityActivity = Pick<
  ResidentContinuityInspector,
  "enabled" | "job"
>;

export type ResidentHandoffCorrection = Pick<
  ResidentHandoff,
  "summary" | "unresolvedThreads" | "commitments" | "explicitPreferences"
>;

export function getResidentContinuity(
  residentPubkey: string,
): Promise<ResidentContinuityInspector> {
  return invoke("get_resident_continuity", { residentPubkey });
}

export function getResidentContinuityActivity(
  residentPubkey: string,
): Promise<ResidentContinuityActivity> {
  return invoke("get_resident_continuity_activity", { residentPubkey });
}

export function setResidentContinuityEnabled(
  residentPubkey: string,
  enabled: boolean,
): Promise<ResidentContinuityInspector> {
  return invoke("set_resident_continuity_enabled", {
    residentPubkey,
    enabled,
  });
}

export function correctResidentHandoff(
  residentPubkey: string,
  correction: ResidentHandoffCorrection,
): Promise<ResidentContinuityInspector> {
  return invoke("correct_resident_handoff", {
    input: { residentPubkey, ...correction },
  });
}

export function forgetResidentHandoff(
  residentPubkey: string,
): Promise<ResidentContinuityInspector> {
  return invoke("forget_resident_handoff", { residentPubkey });
}

export function retryResidentHandoff(
  residentPubkey: string,
): Promise<ResidentContinuityInspector> {
  return invoke("retry_resident_handoff", { residentPubkey });
}
