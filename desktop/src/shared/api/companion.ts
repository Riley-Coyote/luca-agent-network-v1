import { invokeTauri } from "./tauri";

export type CompanionGrant = {
  source: { source_id: string; state: string };
  grant: {
    grant_revision: number;
    state: string;
    choices: {
      observe: boolean;
      promote: boolean;
      retain: boolean;
      provider_egress_binding: string | null;
    };
  };
};
export type CompanionAwareness = {
  availability: string;
  paused: boolean;
  revision: number;
  grants: CompanionGrant[];
  truncated: boolean;
};
export type CompanionWork = {
  availability: string;
  nativeChannelAvailable: boolean;
  actualModelExecutionVerified: boolean;
  policy: {
    revision: number;
    enabled: boolean;
    paused: boolean;
    allow_local_creations: boolean;
    allow_outreach: boolean;
  };
};
export type CompanionHistory = {
  choice: { revision: number; allowed: boolean } | null;
  currentBindingConfirmed: boolean;
  consumersReady: boolean;
  disclosureRevision: number;
  disclosure: string;
};
export type SourceChoices = {
  observe: boolean;
  promote: boolean;
  providerEgress: boolean;
  retainRaw: false;
};
export type ProfileKind = "codex_sessions" | "claude_projects";
export type CompanionSelection = {
  sourceId: string;
  kind?: ProfileKind;
  class: string;
};
const requestId = () => crypto.randomUUID();

export async function companionState(residentPubkey: string) {
  const [awareness, work, files, profiles] = await Promise.all([
    invokeTauri<CompanionAwareness>("get_companion_awareness", {
      residentPubkey,
    }),
    invokeTauri<CompanionWork>("get_companion_initiative", { residentPubkey }),
    invokeTauri<CompanionSelection[]>("list_companion_selected_sources", {
      residentPubkey,
    }),
    invokeTauri<CompanionSelection[]>("list_companion_native_profiles", {
      residentPubkey,
    }),
  ]);
  return { awareness, work, selections: [...profiles, ...files] };
}
export function companionHistory(residentPubkey: string, sourceId: string) {
  return invokeTauri<CompanionHistory>("get_companion_native_history_choice", {
    residentPubkey,
    sourceId,
  });
}
export function setCompanionHistory(
  residentPubkey: string,
  sourceId: string,
  history: CompanionHistory,
  allowed: boolean,
) {
  return invokeTauri<CompanionHistory>("set_companion_native_history_choice", {
    residentPubkey,
    sourceId,
    input: {
      allowed,
      expectedRevision: history.choice?.revision ?? 0,
      disclosureRevision: history.disclosureRevision,
      requestId: requestId(),
    },
  });
}
export function pickCompanionSource(
  residentPubkey: string,
  kind: ProfileKind | "file",
) {
  const choices: SourceChoices = {
    observe: false,
    promote: false,
    providerEgress: false,
    retainRaw: false,
  };
  return kind === "file"
    ? invokeTauri<CompanionAwareness | null>(
        "pick_companion_awareness_source",
        {
          residentPubkey,
          class: "selected_file",
          choices,
          requestId: requestId(),
        },
      )
    : invokeTauri<CompanionAwareness | null>("pick_companion_native_profile", {
        residentPubkey,
        kind,
        class: "visible_excerpts",
        choices,
        requestId: requestId(),
      });
}
export function setCompanionSource(
  residentPubkey: string,
  grant: CompanionGrant,
  choices: SourceChoices,
) {
  return invokeTauri<CompanionAwareness>("set_companion_source_choices", {
    residentPubkey,
    sourceId: grant.source.source_id,
    expectedRevision: grant.grant.grant_revision,
    choices,
    requestId: requestId(),
  });
}
export function pauseCompanionAwareness(
  residentPubkey: string,
  state: CompanionAwareness,
  paused: boolean,
) {
  return invokeTauri<CompanionAwareness>("set_companion_awareness_paused", {
    residentPubkey,
    paused,
    expectedRevision: state.revision,
    requestId: requestId(),
  });
}
export function setCompanionWork(
  residentPubkey: string,
  work: CompanionWork,
  enabled: boolean,
  paused: boolean,
) {
  return invokeTauri<CompanionWork>("set_companion_initiative_policy", {
    residentPubkey,
    input: {
      enabled,
      paused,
      allowOutreach: false,
      allowLocalCreations: enabled,
      expectedRevision: work.policy.revision,
      requestId: requestId(),
    },
  });
}
