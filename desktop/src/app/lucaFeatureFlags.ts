/**
 * Luca V1 feature boundary for Buzz-derived desktop surfaces.
 *
 * Buzz's conversation plane remains available. The product-scope lock defers
 * the full Brain dashboard, Atlas, Inbox, browser observation, and whiteboard
 * until a later release. Keep those surfaces opt-in here rather than allowing
 * an incidental route or navigation change to expose them by default.
 */
export type LucaFeatureStatus = "retained" | "deferred";

export type LucaFeatureDefinition = Readonly<{
  defaultEnabled: boolean;
  status: LucaFeatureStatus;
}>;

export const LUCA_FEATURE_FLAGS = {
  coreChat: { defaultEnabled: true, status: "retained" },
  rooms: { defaultEnabled: true, status: "retained" },
  threads: { defaultEnabled: true, status: "retained" },
  attachments: { defaultEnabled: true, status: "retained" },
  search: { defaultEnabled: true, status: "retained" },
  agents: { defaultEnabled: true, status: "retained" },
  brainDashboard: { defaultEnabled: false, status: "deferred" },
  atlas: { defaultEnabled: false, status: "deferred" },
  inbox: { defaultEnabled: false, status: "deferred" },
  browserObservation: { defaultEnabled: false, status: "deferred" },
  workflows: { defaultEnabled: false, status: "deferred" },
  schedules: { defaultEnabled: false, status: "deferred" },
  forgeGit: { defaultEnabled: false, status: "deferred" },
  huddlesVoice: { defaultEnabled: false, status: "deferred" },
  sharedCanvas: { defaultEnabled: false, status: "deferred" },
  whiteboard: { defaultEnabled: false, status: "deferred" },
  invitedHumans: { defaultEnabled: false, status: "deferred" },
  organizations: { defaultEnabled: false, status: "deferred" },
} as const satisfies Record<string, LucaFeatureDefinition>;

export type LucaFeature = keyof typeof LUCA_FEATURE_FLAGS;

/**
 * Read the shipped default. F03 intentionally has no runtime override path:
 * later surface owners must make an explicit, reviewed change before exposing
 * a deferred product area.
 */
export function isLucaFeatureEnabled(feature: LucaFeature): boolean {
  return LUCA_FEATURE_FLAGS[feature].defaultEnabled;
}
