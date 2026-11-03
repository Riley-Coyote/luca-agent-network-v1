import * as React from "react";
import {
  agentChatPictureKey,
  saveAgentChatPicture,
  useAgentChatPicture,
} from "@/features/agents/lib/agentChatPicture";
import { useIdentityQuery } from "@/shared/api/hooks";
import { Button } from "@/shared/ui/button";
import { AgentDendrite } from "@/shared/ui/dendrite/AgentDendrite";

/** Owner-chosen picture for the mark at the top of this agent's chats. */
export function AgentChatPicture({
  pubkey,
  name,
}: {
  pubkey: string;
  name: string;
}) {
  const owner = useIdentityQuery().data?.pubkey;
  const picture = useAgentChatPicture(owner, pubkey);
  const key = agentChatPictureKey(owner, pubkey);
  const currentKey = React.useRef(key);
  currentKey.current = key;
  const input = React.useRef<HTMLInputElement>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const choose = async (file: File) => {
    if (!key) return;
    setError(null);
    if (
      !/^(image\/png|image\/jpeg|image\/webp)$/.test(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      setError("Choose a PNG, JPG, or WebP picture under 10 MB.");
      return;
    }
    setPending(true);
    try {
      const image = await createImageBitmap(file);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 256;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Could not prepare the picture.");
        const side = Math.min(image.width, image.height);
        context.drawImage(
          image,
          (image.width - side) / 2,
          (image.height - side) / 2,
          side,
          side,
          0,
          0,
          256,
          256,
        );
        if (alive.current && currentKey.current === key)
          saveAgentChatPicture(key, canvas.toDataURL("image/webp", 0.9));
      } finally {
        image.close();
      }
    } catch {
      if (alive.current)
        setError(
          "Could not save that picture. Try another image or free some storage.",
        );
    } finally {
      if (alive.current) setPending(false);
    }
  };

  return (
    <div
      className="flex flex-wrap items-center gap-4 py-4"
      data-testid="agent-chat-picture"
    >
      {picture ? (
        <img
          src={picture}
          alt={name}
          width={56}
          height={56}
          className="size-14 rounded-full object-cover"
        />
      ) : (
        <AgentDendrite residentKey={pubkey} size={56} />
      )}
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm">Chat picture</p>
        <p className="text-sm text-muted-foreground">
          At the top of {name}'s chats. Kept on this Mac; not sent to the agent.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={!key || pending}
            onClick={() => input.current?.click()}
          >
            {pending
              ? "Saving…"
              : picture
                ? "Change picture"
                : "Choose picture"}
          </Button>
          {picture ? (
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => {
                try {
                  if (key) saveAgentChatPicture(key, null);
                  setError(null);
                } catch {
                  setError("Could not remove the picture.");
                }
              }}
            >
              Use agent mark
            </Button>
          ) : null}
        </div>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        aria-label="Choose chat picture"
        data-testid="agent-chat-picture-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void choose(file);
        }}
      />
    </div>
  );
}
