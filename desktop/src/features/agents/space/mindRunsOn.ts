import {
  residentSourceLabel,
  type ResidentSummaryViewModel,
} from "@/features/agents/ui/agentLibraryViewModel";

/**
 * What kind of mind this is and who holds its configuration, in the words
 * Settings > Agents' detail used. Shared by that detail (flag off) and a
 * mind's own Settings tab (SHELL_BUILD.md WP-24, Decided 4), so the words
 * are the same in both.
 */

export function agentOriginLabel(resident: ResidentSummaryViewModel) {
  if (resident.nativeSource === "hermes") return "Hermes";
  if (resident.nativeSource === "openclaw") return "OpenClaw";
  if (resident.kind === "managed_luca" || resident.kind === "persona_only") {
    return "Polyphonic Agent";
  }
  return "External agent";
}

export function agentOriginDescription(resident: ResidentSummaryViewModel) {
  return resident.kind === "managed_native"
    ? `${agentOriginLabel(resident)} · Native-managed agent`
    : `${agentOriginLabel(resident)} · ${residentSourceLabel(resident)}`;
}

export function authorityLabel(
  resident: ResidentSummaryViewModel,
  appName: string,
) {
  return resident.kind === "managed_native"
    ? `Native-managed binding · ${appName}-managed overlays`
    : `${appName}-managed`;
}

/**
 * What runs a mind, said one way everywhere on their pages: the header, the
 * Settings row, the Harness pane and "{Harness} settings" (WP-43, round 3).
 */
export function harnessLabel(resident: ResidentSummaryViewModel): string {
  return residentSourceLabel(resident);
}
