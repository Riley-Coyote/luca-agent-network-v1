export const LUCA_OWNER_ONBOARDING_COMPLETION_STORAGE_KEY =
  "luca-owner-onboarding-complete.v1";

export const LUCA_OWNER_ONBOARDING_COMPLETED_EVENT =
  "luca:owner-onboarding-completed";

export function notifyLucaOwnerOnboardingCompleted() {
  window.dispatchEvent?.(new Event(LUCA_OWNER_ONBOARDING_COMPLETED_EVENT));
}
