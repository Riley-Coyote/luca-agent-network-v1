import { useAgentManagement } from "@/features/agents/useAgentManagement";
import { AgentDialog } from "./AgentDialog";
import { NativeAgentProvisioningDialog } from "./NativeAgentProvisioningDialog";

/** Global review surfaces opened by owned agents through the Buzz harness. */
export function AgentManagementDialogs() {
  const management = useAgentManagement();
  const nativeRuntime =
    management.request?.action === "create" &&
    (management.request.request.requestedRuntimeFamily === "hermes" ||
      management.request.request.requestedRuntimeFamily === "openclaw")
      ? management.request.request.requestedRuntimeFamily
      : null;

  return (
    <>
      {management.request?.action === "create" && !nativeRuntime ? (
        <AgentDialog
          definitionError={
            management.error ? new Error(management.error) : null
          }
          initialValues={management.createInitialValues}
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
          onComplete={management.dismiss}
          onOpenChange={(open) => {
            if (!open) management.dismiss();
          }}
          open
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
