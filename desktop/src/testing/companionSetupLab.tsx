import * as React from "react";
import { CompanionSetupPanel, type CompanionSetupApi } from "@/features/luca/CompanionSetupDialog";
import { Button } from "@/shared/ui/button";
import type { CompanionAwareness, CompanionHistory, CompanionWork } from "@/shared/api/companion";
import { LAB_DM_ID, LAB_RESIDENTS } from "./labScene";

/** In-memory fixture adapter; no native calls, source reads or model work. */
function createSampleApi(): CompanionSetupApi {
  let awareness: CompanionAwareness = { availability: "ready", paused: true, revision: 0, grants: [], truncated: false };
  let work: CompanionWork = { availability: "ready", nativeChannelAvailable: true, actualModelExecutionVerified: false,
    policy: { revision: 0, enabled: false, paused: true, allow_local_creations: false, allow_outreach: false } };
  const selections: { sourceId: string; kind?: "codex_sessions" | "claude_projects"; class: string }[] = [];
  const histories = new Map<string, CompanionHistory>();
  const disclosure = "Selected activity may be sent to the connected model and remain in the harness’s history and Polyphonic conversation. Pause or removal stops future use; it cannot erase copies already received. This does not connect Brain or another companion.";
  const copy = <T,>(value: T): T => structuredClone(value);
  return {
    companionState: async () => copy({ awareness, work, selections }),
    pickCompanionSource: async (_resident, kind) => {
      const sourceId = `sample-source-${selections.length + 1}`;
      selections.push({ sourceId, class: kind === "file" ? "selected_file" : "visible_excerpts", ...(kind === "file" ? {} : { kind }) });
      awareness = { ...awareness, grants: [...awareness.grants, { source: { source_id: sourceId, state: "unknown" }, grant: { grant_revision: 1, state: "active", choices: { observe: false, promote: false, retain: false, provider_egress_binding: null } } }] };
      return copy(awareness);
    },
    companionHistory: async (_resident, source) => copy(histories.get(source) ?? { choice: null, currentBindingConfirmed: false, consumersReady: false, disclosureRevision: 1, disclosure }),
    setCompanionHistory: async (_resident, source, old, allowed) => {
      const next = { ...old, choice: { revision: (old.choice?.revision ?? 0) + 1, allowed }, currentBindingConfirmed: allowed };
      histories.set(source, next); return copy(next);
    },
    setCompanionSource: async (_resident, grant, choices) => {
      awareness = { ...awareness, grants: awareness.grants.map((current) => current.source.source_id !== grant.source.source_id ? current : {
        ...current, grant: { ...current.grant, grant_revision: current.grant.grant_revision + 1, choices: { observe: choices.observe, promote: choices.promote, retain: false, provider_egress_binding: choices.providerEgress ? "sample-binding" : null } },
      }) }; return copy(awareness);
    },
    pauseCompanionAwareness: async (_resident, _old, paused) => { awareness = { ...awareness, paused, revision: awareness.revision + 1 }; return copy(awareness); },
    setCompanionWork: async (_resident, _old, enabled, paused) => { work = { ...work, policy: { ...work.policy, revision: work.policy.revision + 1, enabled, paused, allow_local_creations: enabled } }; return copy(work); },
  };
}
export function CompanionSetupLab() {
  const [open, setOpen] = React.useState(true);
  const [api] = React.useState(createSampleApi);
  const request = React.useMemo(() => ({ residentPubkey: LAB_RESIDENTS.luca.pubkey, conversationId: LAB_DM_ID }), []);
  return <>
    {!open ? <Button variant="outline" className="fixed right-5 top-5 z-40" onClick={() => setOpen(true)}>Review companion setup sample</Button> : null}
    <CompanionSetupPanel request={open ? request : null} name="Luca" onClose={() => setOpen(false)} api={api} simulation />
  </>;
}
