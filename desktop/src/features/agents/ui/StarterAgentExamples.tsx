import type { AgentPersona } from "@/shared/api/types";
import { copyTextToClipboard } from "@/shared/lib/clipboard";
import { Button } from "@/shared/ui/button";
import { starterSpecialist } from "../lib/starterSpecialists";

/** Copy-only starting points: they never create residents or send a task. */
export function StarterAgentExamples({ persona }: { persona: AgentPersona }) {
  const starter = starterSpecialist(persona);
  if (!starter) return null;
  return (
    <section
      className="space-y-4"
      aria-label={`Examples for ${persona.displayName}`}
    >
      <div>
        <p className="text-sm font-medium">{starter.role}</p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {starter.summary}
        </p>
      </div>
      <div className="space-y-4">
        <h4 className="text-sm font-medium">Try asking</h4>
        {starter.examples.map((example) => (
          <div className="space-y-1" key={example.title}>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">{example.title}</p>
              <Button
                aria-label={`Copy prompt: ${example.title}`}
                onClick={() =>
                  copyTextToClipboard(
                    example.prompt,
                    "Prompt copied. Send it when you’re ready.",
                  )
                }
                size="sm"
                type="button"
                variant="ghost"
              >
                Copy
              </Button>
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              {example.prompt}
            </p>
          </div>
        ))}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        Copy a prompt to use in chat. Nothing runs until you send it.
      </p>
    </section>
  );
}
