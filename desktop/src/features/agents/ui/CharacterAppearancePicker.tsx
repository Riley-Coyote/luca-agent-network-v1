import { useIdentityQuery } from "@/shared/api/hooks";
import { AgentCharacter } from "@/shared/ui/characters/AgentCharacter";
import {
  setChatMarkAppearance,
  useChatMarkAppearance,
} from "@/features/messages/lib/chatMarkAppearancePreference";
import { Button } from "@/shared/ui/button";

export function CharacterAppearancePicker({
  name,
  publicKey,
}: {
  avatarUrl?: string | null;
  name: string;
  publicKey: string;
}) {
  const identity = useIdentityQuery();
  const owner = identity.data?.pubkey;
  const appearance = useChatMarkAppearance(owner);
  return (
    <div
      className="flex flex-wrap items-center gap-6"
      data-testid="agent-character-picker"
    >
      <AgentCharacter accessibleName={name} publicKey={publicKey} size={112} />
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Sphere or unique glyph. Applied consistently across your agents.
        </p>
        <fieldset className="flex gap-2" aria-label="Agent appearance">
          {(["sphere", "glyph"] as const).map((style) => (
            <Button
              key={style}
              disabled={!owner}
              aria-pressed={appearance.style === style}
              variant={appearance.style === style ? "secondary" : "ghost"}
              onClick={() => setChatMarkAppearance(owner, { style })}
            >
              {style === "sphere" ? "Sphere" : "Glyph"}
            </Button>
          ))}
        </fieldset>
      </div>
    </div>
  );
}
