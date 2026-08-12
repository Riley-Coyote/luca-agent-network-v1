import * as React from "react";

import {
  consumePendingOpenCreateAgent,
  subscribeOpenCreateAgent,
  type OpenCreateAgentOptions,
} from "@/features/agents/openCreateAgentEvent";
import { useOperatorForgeSettingsQuery } from "@/features/agents/operatorForgeQueries";
import { AgentDialog } from "./AgentDialog";
import { NativeAgentProvisioningDialog } from "./NativeAgentProvisioningDialog";
import { usePersonaActions } from "./usePersonaActions";
import { createPersonaDialogState } from "./personaDialogState";

/** App-level create flow so contextual entry points do not navigate away. */
export function RequestedAgentCreateDialogs() {
  const personas = usePersonaActions();
  const operatorSettings = useOperatorForgeSettingsQuery();
  const [targetChannel, setTargetChannel] = React.useState<{
    id: string;
    name: string;
  } | null>(null);
  const [isOpen, setIsOpen] = React.useState(false);

  const openCreate = React.useEffectEvent((options: OpenCreateAgentOptions) => {
    personas.prepareCreate();
    setTargetChannel(
      options.channelId && options.channelName
        ? { id: options.channelId, name: options.channelName }
        : null,
    );
    setIsOpen(true);
  });

  React.useEffect(() => {
    const pending = consumePendingOpenCreateAgent();
    if (pending) openCreate(pending);
    return subscribeOpenCreateAgent(openCreate);
  }, []);

  const effectiveTarget = operatorSettings.data
    ? operatorSettings.data.preferences.runtimeConfirmed
      ? operatorSettings.data.preferences.defaultRuntimeTarget
      : operatorSettings.data.recommendation
    : null;

  if (isOpen && operatorSettings.isLoading) return null;

  if (isOpen && effectiveTarget?.kind === "native") {
    return (
      <NativeAgentProvisioningDialog
        initialRuntime={effectiveTarget.runtime}
        onOpenChange={(open) => {
          if (!open) {
            setIsOpen(false);
            setTargetChannel(null);
          }
        }}
        open
        targetChannel={targetChannel}
      />
    );
  }

  return isOpen ? (
    <AgentDialog
      definitionError={
        personas.createPersonaMutation.error instanceof Error
          ? personas.createPersonaMutation.error
          : null
      }
      isDefinitionPending={personas.isPending}
      initialValues={
        effectiveTarget?.kind === "managed"
          ? {
              ...createPersonaDialogState().initialValues,
              runtime: effectiveTarget.runtimeId,
            }
          : undefined
      }
      mode="definition"
      onOpenChange={(open) => {
        if (!open) {
          setIsOpen(false);
          setTargetChannel(null);
        }
      }}
      onSubmitDefinition={(input, intent, backendIntent) =>
        personas.handleSubmit(input, intent, backendIntent, targetChannel)
      }
      runtimes={personas.acpRuntimesQuery.data ?? []}
      runtimesLoading={personas.acpRuntimesQuery.isLoading}
    />
  ) : null;
}
