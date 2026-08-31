import * as React from "react";

import { useManagedAgentsQuery } from "@/features/agents/hooks";
import type { CreateTeamInput, UpdateTeamInput } from "@/shared/api/types";
import { AgentIdentitySpecimen } from "@/shared/ui/AgentIdentitySpecimen";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";

type TeamDialogProps = {
  open: boolean;
  title: string;
  description: string;
  submitLabel: string;
  initialValues: CreateTeamInput | UpdateTeamInput | null;
  error: Error | null;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: CreateTeamInput | UpdateTeamInput) => Promise<void>;
};

export function TeamDialog({
  open,
  title,
  description,
  submitLabel,
  initialValues,
  error,
  isPending,
  onOpenChange,
  onSubmit,
}: TeamDialogProps) {
  const agentsQuery = useManagedAgentsQuery();
  const agents = agentsQuery.data ?? [];
  const [name, setName] = React.useState("");
  const [teamDescription, setTeamDescription] = React.useState("");
  const [instructions, setInstructions] = React.useState("");
  const [selectedPubkeys, setSelectedPubkeys] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (!open || !initialValues) return;
    setName(initialValues.name);
    setTeamDescription(initialValues.description ?? "");
    setInstructions(initialValues.instructions ?? "");
    const stableMembers = initialValues.memberPubkeys ?? [];
    const migratedMembers =
      stableMembers.length > 0
        ? stableMembers
        : agents
            .filter(
              (agent) =>
                agent.personaId &&
                (initialValues.personaIds ?? []).includes(agent.personaId),
            )
            .map((agent) => agent.pubkey);
    setSelectedPubkeys(migratedMembers);
  }, [agents, initialValues, open]);

  const toggleAgent = (pubkey: string) => {
    setSelectedPubkeys((current) =>
      current.some((candidate) => candidate === pubkey)
        ? current.filter((candidate) => candidate !== pubkey)
        : [...current, pubkey],
    );
  };
  const submit = async () => {
    if (!initialValues) return;
    const base = {
      name: name.trim(),
      description: teamDescription.trim() || undefined,
      instructions: instructions.trim() || undefined,
      memberPubkeys: selectedPubkeys,
      personaIds: [],
    };
    await onSubmit(
      "id" in initialValues ? { ...base, id: initialValues.id } : base,
    );
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-2xl overflow-hidden p-0">
        <div className="flex max-h-[85vh] flex-col">
          <DialogHeader className="shrink-0 border-b border-border/60 px-6 py-5 pr-14">
            <DialogTitle>{title}</DialogTitle>
            {description ? (
              <DialogDescription>{description}</DialogDescription>
            ) : null}
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <label
              className="grid gap-1.5 text-sm font-medium"
              htmlFor="team-name"
            >
              Name
              <Input
                disabled={isPending}
                id="team-name"
                onChange={(event) => setName(event.target.value)}
                placeholder="Research team"
                value={name}
              />
            </label>
            <label
              className="grid gap-1.5 text-sm font-medium"
              htmlFor="team-description"
            >
              Description
              <Textarea
                className="min-h-20"
                disabled={isPending}
                id="team-description"
                onChange={(event) => setTeamDescription(event.target.value)}
                placeholder="Optional description"
                value={teamDescription}
              />
            </label>
            <label
              className="grid gap-1.5 text-sm font-medium"
              htmlFor="team-instructions"
            >
              Team instructions
              <Textarea
                className="min-h-20"
                disabled={isPending}
                id="team-instructions"
                onChange={(event) => setInstructions(event.target.value)}
                placeholder="Instructions applied when this team is assigned work"
                value={instructions}
              />
            </label>
            <div className="space-y-2">
              <div>
                <p className="text-sm font-medium">Agents</p>
                <p className="text-xs text-muted-foreground">
                  Teams save real agent identities, including native-linked
                  agents.
                </p>
              </div>
              {agents.length > 0 ? (
                <div
                  aria-label="Agents"
                  aria-multiselectable="true"
                  className="max-h-60 space-y-1 overflow-y-auto rounded-lg border border-border/70 p-2"
                  role="listbox"
                >
                  {agents.map((agent) => {
                    const selected = selectedPubkeys.includes(agent.pubkey);
                    return (
                      <button
                        aria-selected={selected}
                        className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-muted/50"
                        key={agent.pubkey}
                        onClick={() => toggleAgent(agent.pubkey)}
                        role="option"
                        type="button"
                      >
                        <Checkbox
                          checked={selected}
                          className="pointer-events-none"
                          tabIndex={-1}
                        />
                        <AgentIdentitySpecimen
                          accessibleName={agent.name}
                          publicKey={agent.pubkey}
                          size={24}
                          state={
                            agent.status === "running"
                              ? "present"
                              : "unavailable"
                          }
                        />
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {agent.name}
                        </span>
                        {agent.nativeRuntimeBinding ? (
                          <span className="text-xs text-muted-foreground">
                            Native
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  Create an agent before creating a team.
                </p>
              )}
            </div>
            {error ? (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error.message}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 justify-end gap-2 border-t border-border/60 px-6 py-4">
            <Button
              onClick={() => onOpenChange(false)}
              size="sm"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={
                !name.trim() || selectedPubkeys.length === 0 || isPending
              }
              onClick={() => void submit()}
              size="sm"
            >
              {isPending ? "Saving…" : submitLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
