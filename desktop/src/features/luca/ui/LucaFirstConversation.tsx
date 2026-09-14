import { Markdown } from "@/shared/ui/markdown";

/** The quiet introduction above the real conversation composer. */
export function LucaFirstConversation({ greeting }: { greeting: string }) {
  return (
    <div
      className="luca-measure pointer-events-auto mb-7 px-0 text-center"
      data-testid="luca-first-conversation"
    >
      <Markdown
        className="mx-auto max-w-lg text-pretty text-base leading-relaxed text-foreground"
        content={greeting}
      />
    </div>
  );
}
