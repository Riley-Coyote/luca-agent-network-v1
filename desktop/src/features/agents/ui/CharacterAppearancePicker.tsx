import { AgentIdentitySpecimen } from "@/shared/ui/AgentIdentitySpecimen";
import { Button } from "@/shared/ui/button";
import { AgentCharacter } from "@/shared/ui/characters/AgentCharacter";
import {
  CHARACTER_IDS,
  defaultCharacterId,
  isCustomAgentPhotoUrl,
  setAgentPhotoPreferred,
  setCharacterId,
  setCharacterMotionEnabled,
  useCharacterId,
  useCharacterMotionEnabled,
  useAgentPhotoPreferred,
} from "@/shared/ui/characters/characterAppearance";
import { Switch } from "@/shared/ui/switch";
import { cn } from "@/shared/lib/cn";

export function CharacterAppearancePicker({
  avatarUrl,
  name,
  publicKey,
}: {
  avatarUrl?: string | null;
  name: string;
  publicKey: string;
}) {
  const selected = useCharacterId(publicKey);
  const motionEnabled = useCharacterMotionEnabled();
  const hasCustomPhoto = isCustomAgentPhotoUrl(avatarUrl);
  const photoPreferred = useAgentPhotoPreferred(publicKey, avatarUrl);

  return (
    <div className="space-y-4" data-testid="agent-character-picker">
      <div className="flex flex-wrap items-start gap-6">
        <div className="flex size-56 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-background/60">
          <AgentIdentitySpecimen
            accessibleName={name}
            avatarUrl={avatarUrl}
            motion="ambient"
            publicKey={publicKey}
            size={224}
          />
        </div>
        <div className="min-w-[12rem] flex-1">
          <p className="mb-3 text-sm leading-5 text-muted-foreground">
            Choose a character for {name}. Saved on this device, the choice
            stays with this agent when their model or runtime changes.
          </p>
          <fieldset className="grid grid-cols-4 gap-2 border-0 p-0">
            <legend className="sr-only">Characters</legend>
            {CHARACTER_IDS.map((id) => (
              <button
                aria-label={`Choose ${id}`}
                aria-pressed={!photoPreferred && selected === id}
                className={cn(
                  "flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg border px-1 py-2 text-2xs capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  !photoPreferred && selected === id
                    ? "border-foreground/70 bg-muted text-foreground"
                    : "border-border/55 bg-background/30 text-muted-foreground hover:border-border hover:bg-muted/40",
                )}
                data-testid={`choose-character-${id}`}
                key={id}
                onClick={() => setCharacterId(publicKey, id)}
                type="button"
              >
                <AgentCharacter
                  accessibleName={id}
                  id={id}
                  publicKey={publicKey}
                  size={32}
                />
                <span>{id}</span>
              </button>
            ))}
          </fieldset>
          <Button
            className="mt-3"
            onClick={() => setCharacterId(publicKey, null)}
            size="sm"
            variant="ghost"
          >
            Use assigned default ({defaultCharacterId(publicKey)})
          </Button>
        </div>
      </div>
      {hasCustomPhoto ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            aria-pressed={photoPreferred}
            onClick={() => setAgentPhotoPreferred(publicKey)}
            size="sm"
            variant={photoPreferred ? "secondary" : "ghost"}
          >
            Use saved photo
          </Button>
          <p className="text-xs text-muted-foreground">
            {photoPreferred
              ? "Choose a character to show it without deleting your photo."
              : "Your saved photo remains available on this agent."}
          </p>
        </div>
      ) : null}
      <label
        className="flex items-center gap-3 text-sm"
        htmlFor="character-motion-enabled"
      >
        <Switch
          checked={motionEnabled}
          id="character-motion-enabled"
          onCheckedChange={setCharacterMotionEnabled}
        />
        <span>Subtle character motion</span>
      </label>
    </div>
  );
}
