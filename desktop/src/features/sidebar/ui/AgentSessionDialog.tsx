import * as React from "react";
import { useAttachManagedAgentToChannelMutation } from "@/features/agents/hooks";
import { useCreateChannelMutation } from "@/features/channels/hooks";
import type { ManagedAgent } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

/** Separate sessions use the existing private room and resident attachment path. */
export function AgentSessionDialog({
  agent,
  onClose,
  onCreated,
}: {
  agent: ManagedAgent;
  onClose: () => void;
  onCreated: (channelId: string) => void;
}) {
  const inputId = React.useId();
  const create = useCreateChannelMutation();
  const attach = useAttachManagedAgentToChannelMutation(null);
  const [name, setName] = React.useState(`Session with ${agent.name}`);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const createdId = React.useRef<string | null>(null);
  const lock = React.useRef(false);
  const alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current || !name.trim()) return;
    lock.current = true;
    setPending(true);
    setError(null);
    try {
      // Keep the created room for a retry if attaching the resident fails.
      const id =
        createdId.current ??
        (
          await create.mutateAsync({
            name: name.trim(),
            channelType: "stream",
            visibility: "private",
          })
        ).id;
      createdId.current = id;
      if (!alive.current) return;
      await attach.mutateAsync({
        channelId: id,
        agent,
        role: "bot",
        ensureRunning: true,
      });
      if (alive.current) {
        onCreated(id);
        onClose();
      }
    } catch (cause) {
      if (alive.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not start the session.",
        );
    } finally {
      lock.current = false;
      if (alive.current) setPending(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New session with {agent.name}</DialogTitle>
          <DialogDescription>
            A separate private conversation. Existing sessions stay where they
            are.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <label htmlFor={inputId} className="block space-y-2 text-sm">
            <span>Session name</span>
            <Input
              id={inputId}
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              disabled={pending || createdId.current !== null}
            />
          </label>
          {error && (
            <div role="alert" className="text-sm text-destructive">
              {error}
              {createdId.current && (
                <p className="mt-2 text-xs text-muted-foreground">
                  The private conversation was saved. Retry to finish adding{" "}
                  {agent.name}, or find it under Projects.
                </p>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending
                ? "Starting…"
                : createdId.current
                  ? "Retry"
                  : "Start session"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
