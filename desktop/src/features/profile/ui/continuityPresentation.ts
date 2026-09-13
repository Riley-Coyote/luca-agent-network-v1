import type { ResidentContinuityInspector } from "@/shared/api/tauriContinuity";

/** The inspector describes stored state, never what a runtime loaded for a turn. */
export function savedHandoffPresentation(
  data: ResidentContinuityInspector | null,
): {
  label: string;
  detail: string;
  empty: string;
} {
  if (!data) {
    return {
      label: "Status unavailable",
      detail: "Luca could not check this handoff. Messaging still works.",
      empty: "The saved handoff could not be checked. Messaging still works.",
    };
  }
  if (!data.enabled) {
    return {
      label: "Off",
      detail:
        "New handoffs and later handoff injection are off. Messaging still works.",
      empty: "Continuity is off for this resident. Messaging still works.",
    };
  }
  if (data.availability === "locked") {
    return {
      label: "Locked",
      detail:
        "Luca cannot read this encrypted handoff right now. Messaging still works.",
      empty: "The saved handoff is locked. Messaging still works.",
    };
  }
  if (data.availability === "unavailable") {
    return {
      label: "Unavailable",
      detail: "Luca cannot open this handoff right now. Messaging still works.",
      empty: "The saved handoff is unavailable. Messaging still works.",
    };
  }
  if (data.availability === "invalid") {
    return {
      label: "Needs attention",
      detail: "This handoff could not be authenticated. Messaging still works.",
      empty: "This handoff could not be authenticated. Messaging still works.",
    };
  }
  if (data.handoff) {
    return {
      label: "Saved",
      detail:
        "A handoff is stored. Check a specific turn's context receipt to see what Polyphonic delivered.",
      empty: "",
    };
  }
  return {
    label: "No saved handoff",
    detail: "No handoff is stored yet. Messaging still works.",
    empty:
      "No handoff yet. After a meaningful exchange, this resident may preserve a compact working-state summary.",
  };
}

export function handoffJobLabel(
  data: ResidentContinuityInspector | null,
): string {
  if (!data) return "Job status unavailable";
  const state = data?.job?.state;
  if (state === "pending" || state === "running") return "Saving handoff";
  if (state === "failed") return "Save failed";
  if (state === "completed") return "Latest save completed";
  if (state === "cancelled") return "Save cancelled";
  return "No save job";
}
