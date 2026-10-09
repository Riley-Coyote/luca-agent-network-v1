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
  collectionRunning: boolean;
  revision: number;
  grants: CompanionGrant[];
  truncated: boolean;
};
export type CompanionWork = {
  availability: string;
  executionPaused: boolean;
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
export type BrowserKind =
  | "google_chrome"
  | "chromium"
  | "chrome_for_testing146_plus";
export type BrowserSelection = {
  selectionId: string;
  browser: BrowserKind;
  profileName: string;
  existingManifestRef: string | null;
};
export type BrowserApproval = { code: string; expiresInSeconds: number };
export type BrowserProfile = {
  profile_instance_id: string;
  enabled: boolean;
  bridge_ready: boolean;
  source_keys: { source: { source_id: string } }[];
};
export type MachineClass =
  | "app_metadata"
  | "accessibility_text"
  | "screen_text";
const requestId = () => crypto.randomUUID();

export async function companionState(residentPubkey: string) {
  const [awareness, work, files, profiles, machines, browsers] =
    await Promise.all([
      invokeTauri<CompanionAwareness>("get_companion_awareness", {
        residentPubkey,
      }),
      invokeTauri<CompanionWork>("get_companion_initiative", {
        residentPubkey,
      }),
      invokeTauri<CompanionSelection[]>("list_companion_selected_sources", {
        residentPubkey,
      }),
      invokeTauri<CompanionSelection[]>("list_companion_native_profiles", {
        residentPubkey,
      }),
      invokeTauri<CompanionSelection[]>("list_companion_machine_sources", {
        residentPubkey,
      }),
      invokeTauri<BrowserProfile[]>("list_companion_browser_profiles", {
        residentPubkey,
      }),
    ]);
  const browserSources: CompanionSelection[] = browsers
    .filter((profile) => profile.enabled)
    .flatMap((profile) =>
      profile.source_keys.map((key, index) => ({
        sourceId: key.source.source_id,
        class:
          ["browser_visit", "browser_bookmark", "browser_excerpt"][index] ??
          "browser",
      })),
    );
  return {
    awareness,
    work,
    browsers,
    selections: [...profiles, ...files, ...machines, ...browserSources],
  };
}
export function selectCompanionMachineSource(
  residentPubkey: string,
  className: MachineClass,
  allowedBundleIds: string[],
) {
  return invokeTauri<CompanionAwareness>("select_companion_machine_source", {
    residentPubkey,
    policy: {
      class: className,
      allowedBundleIds,
      excludedBundleIds: [],
      excludedTitleTerms: ["password", "private", "incognito"],
      maxTextBytes: 4096,
    },
    choices: {
      observe: false,
      promote: false,
      providerEgress: false,
      retainRaw: false,
    },
    requestId: requestId(),
  });
}
export function pickCompanionBrowserProfile(
  residentPubkey: string,
  browser: BrowserKind,
) {
  return invokeTauri<BrowserSelection | null>(
    "pick_companion_browser_native_host",
    { residentPubkey, browser },
  );
}
export async function connectCompanionBrowser(
  residentPubkey: string,
  selection: BrowserSelection,
  allowedOrigins: string[],
  excludedOrigins: string[],
) {
  const approval = await invokeTauri<BrowserApproval>(
    "approve_companion_browser_pairing",
    { residentPubkey, allowedOrigins, excludedOrigins },
  );
  const installed = await invokeTauri<object | null>(
    "install_companion_browser_native_host",
    {
      residentPubkey,
      selectionId: selection.selectionId,
      confirmedExistingRef: selection.existingManifestRef,
    },
  );
  if (!installed)
    throw new Error(
      "Browser registration was not changed. You can try again later.",
    );
  return approval;
}
export function revealCompanionBrowserExtension() {
  return invokeTauri<void>("reveal_companion_browser_extension");
}
export function disconnectCompanionBrowser(
  residentPubkey: string,
  profileInstanceId: string,
) {
  return invokeTauri<CompanionAwareness>(
    "disconnect_companion_browser_profile",
    { residentPubkey, profileInstanceId },
  );
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
