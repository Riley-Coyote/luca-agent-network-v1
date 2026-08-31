import * as React from "react";

import {
  useCreateManagedAgentMutation,
  useCreateTeamMutation,
} from "@/features/agents/hooks";
import {
  subscribeConversationalActions,
  type ConversationalAction,
} from "@/features/agents/conversationalActionStore";
import { useCreateLucaProjectMutation } from "@/features/luca-projects/hooks";
import { discoverNativeResidents } from "@/shared/api/tauri";
import { sendManagedAgentChannelMessage } from "@/shared/api/tauriManagedAgentMessages";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";

type Proposal = Exclude<ConversationalAction, { action: "propose_agent" }>;

function text(payload: Record<string, unknown>, key: string) {
  return typeof payload[key] === "string" ? String(payload[key]) : "";
}

function pubkeys(payload: Record<string, unknown>) {
  return Array.isArray(payload.memberPubkeys)
    ? payload.memberPubkeys.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
}

/** Compact confirmation for persistent non-Agent proposals from owned residents. */
export function ConversationalProposalDialogs() {
  const [queue, setQueue] = React.useState<Proposal[]>([]);
  const [name, setName] = React.useState("");
  const [instructions, setInstructions] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const createTeam = useCreateTeamMutation();
  const createProject = useCreateLucaProjectMutation();
  const createResident = useCreateManagedAgentMutation();
  const current = queue[0];

  React.useEffect(
    () =>
      subscribeConversationalActions((action) => {
        if (action.action === "propose_agent") return;
        setQueue((items) =>
          items.some((item) => item.requestId === action.requestId)
            ? items
            : [...items, action as Proposal],
        );
      }),
    [],
  );

  React.useEffect(() => {
    if (!current) return;
    setName(text(current.payload, "name"));
    setInstructions(text(current.payload, "instructions"));
    setError(null);
  }, [current]);

  const dismiss = () => setQueue((items) => items.slice(1));
  const pending =
    createTeam.isPending || createProject.isPending || createResident.isPending;

  const confirm = async () => {
    if (!current || !name.trim()) return;
    setError(null);
    try {
      let receipt: string;
      if (current.action === "propose_team") {
        const members = pubkeys(current.payload);
        if (members.length === 0) {
          throw new Error(
            "Choose at least one persistent agent for this Team.",
          );
        }
        const team = await createTeam.mutateAsync({
          name: name.trim(),
          description: instructions.trim(),
          instructions: instructions.trim() || undefined,
          memberPubkeys: members,
          personaIds: [],
        });
        receipt = `Created Team “${team.name}” with ${members.length} agent${members.length === 1 ? "" : "s"}.`;
      } else if (current.action === "propose_project") {
        const project = await createProject.mutateAsync({
          name: name.trim(),
          instructions: instructions.trim() || undefined,
        });
        receipt = `Created Project “${project.name}”. You can connect its working folder in Project settings.`;
      } else {
        const candidateId = text(current.payload, "candidateId");
        const discovery = await discoverNativeResidents();
        const candidate = discovery.runtimes
          .flatMap((runtime) => runtime.candidates)
          .find(
            (item) =>
              item.semanticId === candidateId || item.nativeId === candidateId,
          );
        if (!candidate) {
          throw new Error(
            "That native agent is not available. Finish its setup in Hermes or OpenClaw, then ask again.",
          );
        }
        const result = await createResident.mutateAsync({
          name: name.trim(),
          agentCommand: candidate.bindingPreview.executablePath,
          agentArgs: ["acp"],
          harnessOverride: true,
          parallelism: 1,
          nativeRuntimeBinding: candidate.bindingPreview,
          spawnAfterCreate: true,
          startOnAppLaunch: true,
        });
        receipt = result.reused
          ? `Reused the existing Luca identity linked to ${name.trim()}.`
          : `Linked ${name.trim()} as an owned Agent without modifying its native configuration.`;
        if (result.spawnError)
          receipt += ` It was linked but could not start: ${result.spawnError}`;
      }
      await sendManagedAgentChannelMessage({
        agentPubkey: current.residentPubkey,
        channelId: current.sourceChatId,
        content: receipt,
        marker: `luca-action:${current.requestId}:confirmed`,
        markerScope: "agent",
      });
      dismiss();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      try {
        await sendManagedAgentChannelMessage({
          agentPubkey: current.residentPubkey,
          channelId: current.sourceChatId,
          content: `I could not complete that request: ${message}`,
          marker: `luca-action:${current.requestId}:failed`,
          markerScope: "agent",
        });
      } catch {
        // The dialog remains open with the original actionable error.
      }
    }
  };

  const kind =
    current?.action === "propose_team"
      ? "Team"
      : current?.action === "propose_project"
        ? "Project"
        : "native Agent link";

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !pending) dismiss();
      }}
      open={Boolean(current)}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Confirm {kind}</DialogTitle>
          <DialogDescription>
            Luca prepared this from your conversation. Review the essentials,
            then confirm once.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <label
            className="block space-y-1.5 text-sm"
            htmlFor="conversational-proposal-name"
          >
            <span className="font-medium">Name</span>
            <Input
              disabled={pending}
              id="conversational-proposal-name"
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </label>
          {current?.action !== "propose_native_link" ? (
            <label
              className="block space-y-1.5 text-sm"
              htmlFor="conversational-proposal-instructions"
            >
              <span className="font-medium">Purpose and instructions</span>
              <Textarea
                disabled={pending}
                id="conversational-proposal-instructions"
                onChange={(event) => setInstructions(event.target.value)}
                rows={5}
                value={instructions}
              />
            </label>
          ) : null}
          {current?.action === "propose_team" ? (
            <p className="text-xs text-muted-foreground">
              {pubkeys(current.payload).length} persistent agent
              {pubkeys(current.payload).length === 1 ? "" : "s"} in this roster.
            </p>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button disabled={pending} onClick={dismiss} variant="ghost">
            Cancel
          </Button>
          <Button
            disabled={pending || !name.trim()}
            onClick={() => void confirm()}
          >
            {pending ? "Working…" : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
