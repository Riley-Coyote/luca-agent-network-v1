import * as React from "react";
import { LoaderCircle } from "lucide-react";

import {
  useAcpRuntimesQuery,
  useManagedAgentsQuery,
  usePersonasQuery,
} from "@/features/agents/hooks";
import {
  availableRuntimesForStart,
  buildInstanceInputForDefinition,
} from "@/features/agents/lib/instanceInputForDefinition";
import { useOperatorForgeSettingsQuery } from "@/features/agents/operatorForgeQueries";
import { createLucaResident } from "@/features/luca/residents/api";
import { openDm } from "@/shared/api/tauriChannels";
import { hasManagedAgentChannelMessageMarker } from "@/shared/api/tauriManagedAgentMessageMarkers";
import { sendManagedAgentChannelMessage } from "@/shared/api/tauriManagedAgentMessages";
import {
  executeNativeAgentProvisioning,
  previewNativeAgentProvisioning,
  type NativeProvisioningRequestV1,
} from "@/shared/api/tauriOperatorForge";
import { setPersonaActive } from "@/shared/api/tauriPersonas";
import { Button } from "@/shared/ui/button";
import { PolyphonicBrandMark } from "./PolyphonicThresholdField";

const LUCA_PERSONA_ID = "builtin:fizz";
const GREETING_MARKER = "polyphonic-onboarding.luca-greeting.v1";

export function PolyphonicPreparingStep({
  displayName,
  onComplete,
}: {
  displayName: string;
  onComplete: (channelId: string) => void;
}) {
  const managed = useManagedAgentsQuery();
  const personas = usePersonasQuery();
  const runtimes = useAcpRuntimesQuery({ enabled: true });
  const runtimesRef = React.useRef(runtimes);
  runtimesRef.current = runtimes;
  const settings = useOperatorForgeSettingsQuery();
  const [attempt, setAttempt] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [working, setWorking] = React.useState(true);

  React.useEffect(() => {
    void attempt;
    let cancelled = false;
    async function prepare() {
      if (!settings.data || !personas.data) return;
      setWorking(true);
      setError(null);
      try {
        const target = settings.data.preferences.defaultRuntimeTarget;
        if (!settings.data.preferences.runtimeConfirmed || !target) {
          throw new Error("Choose a ready runtime before continuing.");
        }
        const persona = personas.data.find(
          (candidate) => candidate.id === LUCA_PERSONA_ID,
        );
        if (!persona)
          throw new Error("Luca's built-in definition is unavailable.");
        if (!persona.isActive) {
          await setPersonaActive(LUCA_PERSONA_ID, true);
        }

        let lucaPubkey = (managed.data ?? []).find(
          (resident) => resident.personaId === LUCA_PERSONA_ID,
        )?.pubkey;

        if (!lucaPubkey && target.kind === "managed") {
          const available = await availableRuntimesForStart(
            runtimesRef.current,
          );
          const runtime = available.find(
            (candidate) => candidate.id === target.runtimeId,
          );
          if (!runtime)
            throw new Error("The selected runtime is no longer ready.");
          const baseInput = await buildInstanceInputForDefinition(
            persona,
            runtime,
          );
          const created = await createLucaResident({
            ...baseInput,
            spawnAfterCreate: false,
            startOnAppLaunch: false,
          });
          if (created.profileSyncError)
            throw new Error(created.profileSyncError);
          lucaPubkey = created.resident.residentPubkey;
        }

        if (!lucaPubkey && target.kind === "native") {
          const request: NativeProvisioningRequestV1 = {
            displayName: "Luca",
            systemPrompt: persona.systemPrompt,
            runtime: target.runtime,
            mode: "fresh",
            selectedSkills: [],
            includeMemory: false,
            workspaceDocuments: [],
          };
          const preview = await previewNativeAgentProvisioning(request);
          const receipt = await executeNativeAgentProvisioning(
            preview.transactionId,
            LUCA_PERSONA_ID,
            request,
          );
          lucaPubkey = receipt.residentPubkey ?? undefined;
        }

        if (!lucaPubkey)
          throw new Error("Luca could not be created on this Mac.");
        const channel = await openDm({ pubkeys: [lucaPubkey] });
        const alreadySent = await hasManagedAgentChannelMessageMarker({
          channelId: channel.id,
          marker: GREETING_MARKER,
          markerScope: "channel",
        });
        if (!alreadySent) {
          await sendManagedAgentChannelMessage({
            agentPubkey: lucaPubkey,
            channelId: channel.id,
            content: `Hi, ${displayName.trim()} — I’m Luca. I’m ready. What would you like help with first?`,
            marker: GREETING_MARKER,
            markerScope: "channel",
          });
        }
        if (!cancelled) onComplete(channel.id);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
          setWorking(false);
        }
      }
    }
    void prepare();
    return () => {
      cancelled = true;
    };
  }, [
    attempt,
    displayName,
    managed.data,
    onComplete,
    personas.data,
    settings.data,
  ]);

  return (
    <div className="flex min-h-[18rem] flex-col justify-center" role="status">
      <PolyphonicBrandMark />
      <h1 className="mt-5 text-[1.75rem] font-medium tracking-[-0.018em] text-foreground">
        Getting Luca ready…
      </h1>
      <p className="mt-2 text-[0.9375rem] leading-6 text-foreground/60">
        Preparing your resident and opening your conversation.
      </p>
      {working ? (
        <LoaderCircle className="mt-6 h-4 w-4 animate-spin text-foreground/45" />
      ) : null}
      {error ? (
        <div
          className="mt-6 flex items-center justify-between gap-4"
          role="alert"
        >
          <p className="text-sm text-destructive">{error}</p>
          <Button
            onClick={() => setAttempt((value) => value + 1)}
            type="button"
            variant="outline"
          >
            Retry
          </Button>
        </div>
      ) : null}
    </div>
  );
}
