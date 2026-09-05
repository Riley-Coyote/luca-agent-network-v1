import * as React from "react";
import { AlertCircle, Check, LoaderCircle } from "lucide-react";

import {
  managedAgentsQueryKey,
  useCreatePersonaMutation,
  useManagedAgentsQuery,
} from "@/features/agents/hooks";
import { attachManagedAgentToChannel } from "@/features/agents/channelAgents";
import type { NativeAgentCompletion } from "@/features/agents/lib/agentManagementCompletion";
import {
  executeNativeAgentProvisioning,
  previewNativeAgentProvisioning,
  reconcileNativeAgentProvisioning,
  rollbackNativeAgentProvisioning,
  type AgentProvisioningModeV1,
  type NativeProvisioningPreviewV1,
  type NativeProvisioningReceiptV1,
  type NativeProvisioningRequestV1,
  type NativeRuntimeFamilyV1,
} from "@/shared/api/tauriOperatorForge";
import { discoverNativeResidents } from "@/shared/api/tauri";
import { startManagedAgent } from "@/shared/api/tauriManagedAgents";
import type { DiscoveredResidentCandidate } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";

function splitSelections(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function NativeAgentProvisioningDialog({
  beforeOwnerAction,
  initialMode = "fresh",
  initialName = "",
  initialPrompt = "",
  initialRuntime = "hermes",
  onComplete,
  onOpenChange,
  open,
  personaId,
  residentProposalId,
  targetChannel,
}: {
  beforeOwnerAction?: () => Promise<void> | void;
  initialMode?: AgentProvisioningModeV1;
  initialName?: string;
  initialPrompt?: string;
  initialRuntime?: NativeRuntimeFamilyV1;
  onComplete?: (completion: NativeAgentCompletion) => Promise<void> | void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  personaId?: string;
  residentProposalId?: string;
  targetChannel?: { id: string; name: string } | null;
}) {
  const queryClient = useQueryClient();
  const createPersona = useCreatePersonaMutation();
  const managedAgents = useManagedAgentsQuery();
  const [name, setName] = React.useState(initialName);
  const [prompt, setPrompt] = React.useState(initialPrompt);
  const [runtime, setRuntime] =
    React.useState<NativeRuntimeFamilyV1>(initialRuntime);
  const [mode, setMode] = React.useState<AgentProvisioningModeV1>(initialMode);
  const [candidates, setCandidates] = React.useState<
    DiscoveredResidentCandidate[]
  >([]);
  const [sourceSemanticId, setSourceSemanticId] = React.useState("");
  const [skills, setSkills] = React.useState("");
  const [documents, setDocuments] = React.useState("");
  const [includeMemory, setIncludeMemory] = React.useState(false);
  const [preview, setPreview] =
    React.useState<NativeProvisioningPreviewV1 | null>(null);
  const [approvedRequest, setApprovedRequest] =
    React.useState<NativeProvisioningRequestV1 | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [createdPersonaId, setCreatedPersonaId] = React.useState<string | null>(
    personaId ?? null,
  );
  const [recoveryTransactionId, setRecoveryTransactionId] = React.useState<
    string | null
  >(null);
  const [completion, setCompletion] =
    React.useState<NativeProvisioningReceiptV1 | null>(null);
  const [attachmentError, setAttachmentError] = React.useState<string | null>(
    null,
  );
  const [completedResult, setCompletedResult] =
    React.useState<NativeAgentCompletion | null>(null);
  const [deliveryError, setDeliveryError] = React.useState<string | null>(null);
  const resolvedTarget = React.useRef<{ id: string; name: string } | null>(
    null,
  );
  const attentionRef = React.useRef<HTMLElement>(null);
  const reviewRef = React.useRef<HTMLElement>(null);

  React.useEffect(() => {
    // Only the owner's successful review action sets a new preview. Keep
    // background refreshes from moving focus after the owner starts reading.
    if (preview) reviewRef.current?.focus();
  }, [preview]);

  React.useEffect(() => {
    if (open && !busy && (attachmentError || deliveryError)) {
      attentionRef.current?.focus();
    }
  }, [open, busy, attachmentError, deliveryError]);

  React.useEffect(() => {
    if (!open) return;
    setError(null);
    void discoverNativeResidents()
      .then((outcome) =>
        setCandidates(outcome.runtimes.flatMap((entry) => entry.candidates)),
      )
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      );
  }, [open]);

  const previewDraftFingerprint = JSON.stringify([
    documents,
    includeMemory,
    mode,
    name,
    prompt,
    runtime,
    skills,
    sourceSemanticId,
  ]);
  React.useEffect(() => {
    if (!previewDraftFingerprint) return;
    setPreview(null);
    setApprovedRequest(null);
    setCreatedPersonaId(personaId ?? null);
    setRecoveryTransactionId(null);
    setCompletion(null);
    setAttachmentError(null);
    setCompletedResult(null);
    setDeliveryError(null);
    resolvedTarget.current = null;
  }, [previewDraftFingerprint, personaId]);

  const matchingSources = candidates.filter(
    (candidate) => candidate.nativeType === runtime,
  );
  const request = React.useMemo<NativeProvisioningRequestV1>(
    () => ({
      displayName: name.trim(),
      systemPrompt: prompt.trim(),
      runtime,
      mode,
      ...(mode === "fresh" ? {} : { sourceSemanticId }),
      selectedSkills: mode === "fresh" ? [] : splitSelections(skills),
      includeMemory: mode === "advanced" && includeMemory,
      workspaceDocuments: mode === "advanced" ? splitSelections(documents) : [],
    }),
    [
      documents,
      includeMemory,
      mode,
      name,
      prompt,
      runtime,
      skills,
      sourceSemanticId,
    ],
  );
  const canPreview =
    request.displayName.length > 0 &&
    request.systemPrompt.length > 0 &&
    (mode === "fresh" || sourceSemanticId.length > 0);
  const creationLocked =
    busy || recoveryTransactionId !== null || completion !== null;

  function closeCompleted() {
    onOpenChange(false);
  }

  async function attachCompletedResident(
    receipt: NativeProvisioningReceiptV1,
  ): Promise<NativeAgentCompletion> {
    if (!targetChannel) {
      return { receipt, originChannelId: null, attachment: null };
    }
    if (!receipt.residentPubkey) {
      throw new Error("The completed resident identity is unavailable.");
    }
    const refreshed = await managedAgents.refetch({ throwOnError: true });
    const resident = refreshed.data?.find(
      (candidate) =>
        normalizePubkey(candidate.pubkey) ===
        normalizePubkey(receipt.residentPubkey ?? ""),
    );
    if (!resident) {
      throw new Error(
        "The resident was created, but its Library record is not available yet.",
      );
    }
    await beforeOwnerAction?.();
    const attached = await attachManagedAgentToChannel(
      resolvedTarget.current?.id ?? targetChannel.id,
      { agent: resident, ensureRunning: false, role: "bot" },
    );
    // Save the canonical destination before startup, which can fail after a
    // successful DM expansion. Retry the exact target with the same resident.
    resolvedTarget.current = {
      id: attached.channelId,
      name: attached.channelName,
    };
    if (resident.status !== "running" && resident.status !== "deployed") {
      await beforeOwnerAction?.();
      attached.agent = await startManagedAgent(resident.pubkey);
      attached.started = true;
    }
    await queryClient.invalidateQueries({ queryKey: managedAgentsQueryKey });
    return {
      receipt,
      originChannelId: targetChannel.id,
      attachment: attached,
    };
  }

  async function deliverCompletion(result: NativeAgentCompletion) {
    setDeliveryError(null);
    try {
      await onComplete?.(result);
      closeCompleted();
    } catch (cause) {
      setDeliveryError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function completeProvisioning(receipt: NativeProvisioningReceiptV1) {
    setCompletion(receipt);
    setRecoveryTransactionId(null);
    setAttachmentError(null);
    if (receipt.status !== "complete") return;
    let result: NativeAgentCompletion;
    try {
      await beforeOwnerAction?.();
      result = await attachCompletedResident(receipt);
      setCompletedResult(result);
    } catch (cause) {
      setAttachmentError(
        cause instanceof Error
          ? cause.message
          : "The agent could not be added to the conversation.",
      );
      return;
    }
    await deliverCompletion(result);
  }

  async function review() {
    setBusy(true);
    setError(null);
    try {
      await beforeOwnerAction?.();
      const next = await previewNativeAgentProvisioning(request);
      setApprovedRequest(request);
      setPreview(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function execute() {
    if (!preview || !approvedRequest) return;
    setBusy(true);
    setError(null);
    try {
      await beforeOwnerAction?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
      return;
    }

    let resolvedPersonaId = createdPersonaId;
    if (!resolvedPersonaId) {
      try {
        resolvedPersonaId = (
          await createPersona.mutateAsync({
            displayName: approvedRequest.displayName,
            systemPrompt: approvedRequest.systemPrompt,
          })
        ).id;
        setCreatedPersonaId(resolvedPersonaId);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setBusy(false);
        return;
      }
    }

    try {
      const receipt = await executeNativeAgentProvisioning(
        preview.transactionId,
        resolvedPersonaId,
        approvedRequest,
        residentProposalId,
      );
      await completeProvisioning(receipt);
    } catch (cause) {
      setRecoveryTransactionId(preview.transactionId);
      setError(
        `${cause instanceof Error ? cause.message : String(cause)} Reconcile or roll back this exact transaction before trying a new creation.`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function reconcile() {
    if (!recoveryTransactionId) return;
    setBusy(true);
    setError(null);
    try {
      await beforeOwnerAction?.();
      const receipt = await reconcileNativeAgentProvisioning(
        recoveryTransactionId,
      );
      await completeProvisioning(receipt);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function rollback() {
    if (!recoveryTransactionId) return;
    setBusy(true);
    setError(null);
    try {
      await beforeOwnerAction?.();
      const receipt = await rollbackNativeAgentProvisioning(
        recoveryTransactionId,
      );
      setRecoveryTransactionId(null);
      setCompletion(receipt);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function retryAttachment() {
    if (completion?.status !== "complete" || !targetChannel) return;
    setBusy(true);
    setAttachmentError(null);
    try {
      await beforeOwnerAction?.();
      const result = await attachCompletedResident(completion);
      setCompletedResult(result);
      await deliverCompletion(result);
    } catch (cause) {
      setAttachmentError(
        cause instanceof Error ? cause.message : String(cause),
      );
    } finally {
      setBusy(false);
    }
  }

  async function retryDelivery() {
    if (!completedResult) return;
    setBusy(true);
    try {
      await deliverCompletion(completedResult);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!busy) onOpenChange(nextOpen);
      }}
      open={open}
    >
      <DialogContent className="flex max-h-[min(720px,calc(100vh-2rem))] max-w-xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 px-6 pb-4 pt-6 pr-12">
          <DialogTitle>Create a native agent</DialogTitle>
          <DialogDescription>
            {completion?.status === "complete"
              ? "Your agent is saved. Finish the remaining step below."
              : "Review every native change before Luca creates or links anything."}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto px-6">
          <div className="space-y-4 py-1">
            {completion?.status !== "complete" ? (
              <div className="space-y-4">
                <label
                  className="block space-y-1.5 text-sm"
                  htmlFor="native-agent-name"
                >
                  <span className="font-medium">Name</span>
                  <Input
                    disabled={creationLocked}
                    id="native-agent-name"
                    onChange={(event) => setName(event.target.value)}
                    value={name}
                  />
                </label>
                <label
                  className="block space-y-1.5 text-sm"
                  htmlFor="native-agent-purpose"
                >
                  <span className="font-medium">Purpose and instructions</span>
                  <Textarea
                    disabled={creationLocked}
                    id="native-agent-purpose"
                    onChange={(event) => setPrompt(event.target.value)}
                    rows={5}
                    value={prompt}
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-1.5 text-sm">
                    <span className="font-medium">Runtime</span>
                    <select
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      disabled={creationLocked}
                      onChange={(event) =>
                        setRuntime(event.target.value as NativeRuntimeFamilyV1)
                      }
                      value={runtime}
                    >
                      <option value="hermes">Hermes</option>
                      <option value="openclaw">OpenClaw</option>
                    </select>
                  </label>
                  <label className="space-y-1.5 text-sm">
                    <span className="font-medium">Starting point</span>
                    <select
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      disabled={creationLocked}
                      onChange={(event) =>
                        setMode(event.target.value as AgentProvisioningModeV1)
                      }
                      value={mode}
                    >
                      <option value="fresh">Fresh</option>
                      <option value="template">Safe template</option>
                      <option value="advanced">Advanced clone</option>
                    </select>
                  </label>
                </div>
                {mode !== "fresh" ? (
                  <label
                    className="block space-y-1.5 text-sm"
                    htmlFor="native-agent-source"
                  >
                    <span className="font-medium">Native source</span>
                    <select
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      disabled={creationLocked}
                      id="native-agent-source"
                      onChange={(event) =>
                        setSourceSemanticId(event.target.value)
                      }
                      value={sourceSemanticId}
                    >
                      <option value="">Choose locally…</option>
                      {matchingSources.map((candidate) => (
                        <option
                          key={candidate.semanticId}
                          value={candidate.semanticId}
                        >
                          {candidate.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {mode !== "fresh" ? (
                  <label
                    className="block space-y-1.5 text-sm"
                    htmlFor="native-agent-skills"
                  >
                    <span className="font-medium">Skills to copy</span>
                    <Input
                      disabled={creationLocked}
                      id="native-agent-skills"
                      onChange={(event) => setSkills(event.target.value)}
                      placeholder="research, coding"
                      value={skills}
                    />
                    <span className="block text-xs text-muted-foreground">
                      Comma-separated safe relative names.
                    </span>
                  </label>
                ) : null}
                {mode === "advanced" ? (
                  <div className="space-y-3 rounded-lg border border-border/60 p-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        checked={includeMemory}
                        disabled={creationLocked}
                        onChange={(event) =>
                          setIncludeMemory(event.target.checked)
                        }
                        type="checkbox"
                      />{" "}
                      Include selected source memory
                    </label>
                    <label
                      className="block space-y-1.5 text-sm"
                      htmlFor="native-agent-documents"
                    >
                      <span className="font-medium">Workspace documents</span>
                      <Input
                        disabled={creationLocked}
                        id="native-agent-documents"
                        onChange={(event) => setDocuments(event.target.value)}
                        placeholder="README.md, docs/guide.md"
                        value={documents}
                      />
                    </label>
                  </div>
                ) : null}
                {preview ? (
                  <section
                    aria-label="Provisioning review"
                    className="rounded-lg border border-border/70 bg-muted/20 p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    ref={reviewRef}
                    tabIndex={-1}
                  >
                    <p className="text-sm font-medium">Review these changes</p>
                    <ul className="mt-3 space-y-2">
                      {preview.changes.map((change) => (
                        <li
                          className="flex gap-2 text-sm"
                          key={`${change.subject}-${change.action}`}
                        >
                          <Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                          <span>
                            <span className="font-medium">
                              {change.subject}
                            </span>{" "}
                            · {change.detail}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 text-xs text-muted-foreground">
                      {preview.permissionDefaults}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Recovery: {preview.recoveryAction}
                    </p>
                  </section>
                ) : null}
              </div>
            ) : null}
            {error ? (
              <p className="flex gap-2 text-sm text-destructive" role="alert">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                {error}
              </p>
            ) : null}
            {completion?.status === "rolled_back" ? (
              <section
                aria-label="Provisioning rolled back"
                className="rounded-lg border border-border/70 bg-muted/20 p-4"
              >
                <p className="text-sm font-medium">Creation rolled back</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  No completed resident was linked. Start a new reviewed
                  creation when you are ready.
                </p>
              </section>
            ) : null}
            {attachmentError && completion?.status === "complete" ? (
              <section
                aria-label="Conversation attachment needs attention"
                className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                ref={attentionRef}
                tabIndex={-1}
              >
                <p className="text-sm font-medium">Finish setting up {name}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {attachmentError} Try again to finish setup in{" "}
                  {resolvedTarget.current?.name ?? targetChannel?.name} with the
                  same agent.
                </p>
              </section>
            ) : null}
            {deliveryError ? (
              <section
                aria-label="Conversation update needs attention"
                className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                ref={attentionRef}
                tabIndex={-1}
              >
                <p className="text-sm font-medium">Send the setup update</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {deliveryError} Retry the update to the original conversation.{" "}
                  {name} and its conversation are already saved.
                </p>
              </section>
            ) : null}
            {completion?.status === "complete" &&
            !attachmentError &&
            !deliveryError ? (
              <p className="text-sm text-muted-foreground" role="status">
                Finishing setup for {name}…
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border/60 px-6 py-4">
          <Button disabled={busy} onClick={closeCompleted} variant="ghost">
            {recoveryTransactionId || completion ? "Close" : "Cancel"}
          </Button>
          {deliveryError ? (
            <Button disabled={busy} onClick={() => void retryDelivery()}>
              {busy ? (
                <LoaderCircle className="animate-spin motion-reduce:animate-none" />
              ) : null}
              Retry conversation update
            </Button>
          ) : attachmentError && completion?.status === "complete" ? (
            <Button disabled={busy} onClick={() => void retryAttachment()}>
              {busy ? (
                <LoaderCircle className="animate-spin motion-reduce:animate-none" />
              ) : null}
              Try conversation again
            </Button>
          ) : recoveryTransactionId ? (
            <>
              <Button
                disabled={busy}
                onClick={() => void rollback()}
                variant="outline"
              >
                Roll back
              </Button>
              <Button disabled={busy} onClick={() => void reconcile()}>
                {busy ? (
                  <LoaderCircle className="animate-spin motion-reduce:animate-none" />
                ) : null}
                Reconcile
              </Button>
            </>
          ) : completion?.status === "rolled_back" ? (
            <Button disabled={busy} onClick={closeCompleted}>
              Done
            </Button>
          ) : preview ? (
            <Button disabled={busy} onClick={() => void execute()}>
              {busy ? (
                <LoaderCircle className="animate-spin motion-reduce:animate-none" />
              ) : null}
              Create agent
            </Button>
          ) : (
            <Button
              disabled={busy || !canPreview}
              onClick={() => void review()}
            >
              {busy ? (
                <LoaderCircle className="animate-spin motion-reduce:animate-none" />
              ) : null}
              Review changes
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
