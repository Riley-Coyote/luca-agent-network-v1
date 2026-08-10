import * as React from "react";
import { AlertCircle, Check, LoaderCircle } from "lucide-react";

import { useCreatePersonaMutation } from "@/features/agents/hooks";
import {
  executeNativeAgentProvisioning,
  previewNativeAgentProvisioning,
  type AgentProvisioningModeV1,
  type NativeProvisioningPreviewV1,
  type NativeProvisioningRequestV1,
  type NativeRuntimeFamilyV1,
} from "@/shared/api/tauriOperatorForge";
import { discoverNativeResidents } from "@/shared/api/tauri";
import type { DiscoveredResidentCandidate } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
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
}: {
  beforeOwnerAction?: () => Promise<void> | void;
  initialMode?: AgentProvisioningModeV1;
  initialName?: string;
  initialPrompt?: string;
  initialRuntime?: NativeRuntimeFamilyV1;
  onComplete?: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  personaId?: string;
}) {
  const createPersona = useCreatePersonaMutation();
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
  }, [previewDraftFingerprint]);

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
      const resolvedPersonaId =
        personaId ??
        (
          await createPersona.mutateAsync({
            displayName: approvedRequest.displayName,
            systemPrompt: approvedRequest.systemPrompt,
          })
        ).id;
      await executeNativeAgentProvisioning(
        preview.transactionId,
        resolvedPersonaId,
        approvedRequest,
      );
      onComplete?.();
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[min(720px,calc(100vh-2rem))] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create a native agent</DialogTitle>
          <DialogDescription>
            Review every native change before Polyphonic creates or links
            anything.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label
            className="block space-y-1.5 text-sm"
            htmlFor="native-agent-name"
          >
            <span className="font-medium">Name</span>
            <Input
              disabled={busy}
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
              disabled={busy}
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
                disabled={busy}
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
                disabled={busy}
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
                disabled={busy}
                id="native-agent-source"
                onChange={(event) => setSourceSemanticId(event.target.value)}
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
                disabled={busy}
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
                  disabled={busy}
                  onChange={(event) => setIncludeMemory(event.target.checked)}
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
                  disabled={busy}
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
              className="rounded-lg border border-border/70 bg-muted/20 p-4"
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
                      <span className="font-medium">{change.subject}</span> ·{" "}
                      {change.detail}
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
          {error ? (
            <p className="flex gap-2 text-sm text-destructive" role="alert">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              disabled={busy}
              onClick={() => onOpenChange(false)}
              variant="ghost"
            >
              Cancel
            </Button>
            {preview ? (
              <Button disabled={busy} onClick={() => void execute()}>
                {busy ? <LoaderCircle className="animate-spin" /> : null}Create
                agent
              </Button>
            ) : (
              <Button
                disabled={busy || !canPreview}
                onClick={() => void review()}
              >
                {busy ? <LoaderCircle className="animate-spin" /> : null}Review
                changes
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
