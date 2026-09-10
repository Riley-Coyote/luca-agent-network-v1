/** The quiet introduction above the real conversation composer. */
export function LucaFirstConversation({ greeting }: { greeting: string }) {
  return (
    <div
      className="luca-measure pointer-events-auto mb-7 px-0 text-center"
      data-testid="luca-first-conversation"
    >
      <h1 className="text-balance text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
        What would you like to do?
      </h1>
      <p className="mx-auto mt-4 max-w-lg text-pretty text-base leading-relaxed text-ink-muted">
        {greeting}
      </p>
    </div>
  );
}
