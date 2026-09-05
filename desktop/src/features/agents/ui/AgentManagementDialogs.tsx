import { useAgentManagement } from "@/features/agents/useAgentManagement";
import { useOperatorForgeSettingsQuery } from "@/features/agents/operatorForgeQueries";
import { AgentDialog } from "./AgentDialog";
import { NativeAgentProvisioningDialog } from "./NativeAgentProvisioningDialog";
import { NativeResidentImportSection } from "./NativeResidentImportSection";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

/** Global review surfaces opened by owned agents through the Buzz harness. */
export function AgentManagementDialogs() {
  const management = useAgentManagement();
  const operatorSettings = useOperatorForgeSettingsQuery();
  const requestedRuntime =
    management.request?.action === "create"
      ? management.request.request.requestedRuntimeFamily
      : undefined;
  const effectiveTarget = operatorSettings.data
    ? operatorSettings.data.preferences.runtimeConfirmed
      ? operatorSettings.data.preferences.defaultRuntimeTarget
      : operatorSettings.data.recommendation
    : null;
  const nativeRuntime =
    requestedRuntime === "hermes" || requestedRuntime === "openclaw"
      ? requestedRuntime
      : requestedRuntime === undefined && effectiveTarget?.kind === "native"
        ? effectiveTarget.runtime
        : null;
  const managedRuntime =
    requestedRuntime === "codex"
      ? "codex"
      : requestedRuntime === "claude_code"
        ? "claude"
        : requestedRuntime === undefined && effectiveTarget?.kind === "managed"
          ? effectiveTarget.runtimeId
          : undefined;
  const waitingForOwnerTarget =
    management.request?.action === "create" &&
    requestedRuntime === undefined &&
    operatorSettings.isLoading;

  if (waitingForOwnerTarget) return null;

  return (
    <>
      {management.request?.action === "import" &&
      management.residentProposalId ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) void management.closeNativeImport();
          }}
        >
          <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Bring in your Hermes profile</DialogTitle>
              <DialogDescription>
                Choose the exact existing profile. Your current conversation
                stays open; the import result returns to the resident who asked.
              </DialogDescription>
            </DialogHeader>
            <NativeResidentImportSection
              key={management.residentProposalId}
              residents={management.managedAgents}
              proposal={{
                requestId: management.residentProposalId,
                nativeProfileName: management.request.request.nativeProfileName,
                authorize: management.authorizePendingCreate,
                complete: management.completeNativeImport,
                close: () => void management.closeNativeImport(),
                closeState: management.importCloseState,
              }}
            />
          </DialogContent>
        </Dialog>
      ) : null}
      {management.request?.action === "create" && !nativeRuntime ? (
        <AgentDialog
          definitionError={
            management.error ? new Error(management.error) : null
          }
          initialValues={
            management.createInitialValues && managedRuntime
              ? { ...management.createInitialValues, runtime: managedRuntime }
              : management.createInitialValues
          }
          isDefinitionPending={management.isPending}
          mode="definition"
          onOpenChange={(open) => {
            if (!open) management.dismiss();
          }}
          onSubmitDefinition={management.submitCreate}
          runtimes={management.runtimes}
          runtimesLoading={management.runtimesLoading}
        />
      ) : null}
      {management.request?.action === "create" && nativeRuntime ? (
        <NativeAgentProvisioningDialog
          beforeOwnerAction={management.authorizePendingCreate}
          initialMode={management.request.request.provisioningIntent ?? "fresh"}
          initialName={management.request.request.displayName}
          initialPrompt={management.request.request.systemPrompt}
          initialRuntime={nativeRuntime}
          onComplete={management.completeNativeCreate}
          onOpenChange={(open) => {
            if (!open) management.dismiss();
          }}
          open
          residentProposalId={management.residentProposalId}
          targetChannel={management.createTargetChannel}
        />
      ) : null}
      {management.request?.action === "update" ? (
        <AgentDialog
          description=""
          error={management.editError ? new Error(management.editError) : null}
          initialValues={management.editInitialValues}
          isPending={management.isPending}
          mode="definition-edit"
          onOpenChange={(open) => {
            if (!open) management.dismiss();
          }}
          onSubmit={management.submitUpdate}
          open
          runtimes={management.runtimes}
          runtimesLoading={management.runtimesLoading}
          submitLabel="Save changes"
          title="Edit agent"
        />
      ) : null}
    </>
  );
}
