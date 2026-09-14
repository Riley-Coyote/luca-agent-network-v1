/** The quiet introduction above the real conversation composer. */
export function LucaFirstConversation({ greeting }: { greeting: string }) {
  return (
    <div
      className="luca-measure pointer-events-auto mb-7 px-0 text-center"
      data-testid="luca-first-conversation"
    >
      <p className="mx-auto max-w-lg whitespace-pre-wrap text-pretty text-base leading-relaxed text-foreground">
        {greeting}
      </p>
    </div>
  );
}
