import * as React from "react";
import {
  AlertTriangle,
  ArrowRight,
  LoaderCircle,
  RefreshCw,
  X,
} from "lucide-react";

import type { RuntimeConnectionStatusV1 } from "@/shared/api/tauriMcp";
import type {
  ConnectedRuntimeSession,
  ConnectedRuntimeSessionContext,
} from "@/shared/api/tauriRuntimeSessions";
import { HarnessLogo, harnessIdFromRuntimeId } from "@/shared/ui/HarnessLogo";
import { Button } from "@/shared/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui/sheet";
import { cn } from "@/shared/lib/cn";

import {
  useRuntimeSessionContextMutation,
  useRuntimeSessionsQuery,
} from "./hooks";
import { indexedRuntimeId } from "./runtimeSessionModel";

export function RuntimeSessionsPanel({
  isMobile,
  onClose,
  onOpenBrain,
  onStartContext,
  runtime,
}: {
  isMobile: boolean;
  onClose: () => void;
  onOpenBrain: () => void;
  onStartContext: (context: ConnectedRuntimeSessionContext) => void;
  runtime: RuntimeConnectionStatusV1 | null;
}) {
  if (!runtime) return null;

  const content = (
    <RuntimeSessionsPanelContent
      onClose={onClose}
      onOpenBrain={onOpenBrain}
      onStartContext={onStartContext}
      runtime={runtime}
    />
  );

  if (isMobile) {
    return (
      <Sheet
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        open
      >
        <SheetContent
          className="flex w-[min(92vw,24rem)] flex-col gap-0 overflow-hidden bg-sidebar p-0 text-sidebar-foreground [&>button]:hidden"
          data-testid="runtime-sessions-panel-mobile"
          id="runtime-sessions-panel"
          side="left"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>{runtime.label} sessions</SheetTitle>
            <SheetDescription>
              Choose indexed visible context for a new Polyphonic conversation.
            </SheetDescription>
          </SheetHeader>
          {content}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <aside
      aria-label={`${runtime.label} local sessions`}
      className="relative z-10 hidden h-full w-[22rem] shrink-0 flex-col border-r border-border/45 bg-sidebar text-sidebar-foreground md:flex"
      data-testid="runtime-sessions-panel"
      id="runtime-sessions-panel"
    >
      {content}
    </aside>
  );
}

function RuntimeSessionsPanelContent({
  onClose,
  onOpenBrain,
  onStartContext,
  runtime,
}: {
  onClose: () => void;
  onOpenBrain: () => void;
  onStartContext: (context: ConnectedRuntimeSessionContext) => void;
  runtime: RuntimeConnectionStatusV1;
}) {
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const indexedId = indexedRuntimeId(runtime.runtimeId);
  const sessionsQuery = useRuntimeSessionsQuery(indexedId);
  const contextMutation = useRuntimeSessionContextMutation();
  const [selectedSessionId, setSelectedSessionId] = React.useState<
    string | null
  >(null);
  const [operationError, setOperationError] = React.useState<string | null>(
    null,
  );

  React.useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [runtime.runtimeId, runtime.statusId]);

  async function startWithContext(session: ConnectedRuntimeSession) {
    if (!indexedId || !session.available) return;
    setSelectedSessionId(session.sessionId);
    setOperationError(null);
    try {
      const context = await contextMutation.mutateAsync({
        runtimeId: indexedId,
        sessionId: session.sessionId,
      });
      onStartContext(context);
    } catch {
      setOperationError(
        "That indexed session changed or is unavailable. Refresh it in Brain, then try again.",
      );
    } finally {
      setSelectedSessionId(null);
    }
  }

  const list = sessionsQuery.data;
  const sourceStatus = list?.sourceStatus;
  const needsSource = sourceStatus === "not_connected";
  const sourceNeedsAttention =
    sourceStatus === "needs_attention" || sourceStatus === "unavailable";

  return (
    <>
      <header className="shrink-0 border-b border-border/45 px-4 pb-3 pt-4">
        <div className="flex items-start gap-3 pr-7">
          <HarnessLogo
            className="mt-0.5 text-foreground"
            decorative
            harness={harnessIdFromRuntimeId(runtime.runtimeId)}
            size={20}
          />
          <div className="min-w-0 flex-1">
            <h2
              className="truncate text-sm font-semibold tracking-tight outline-none"
              ref={headingRef}
              tabIndex={-1}
            >
              {runtime.label} sessions
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Bring visible, indexed excerpts into a new Polyphonic
              conversation. This never resumes or synchronizes the external
              session.
            </p>
          </div>
        </div>
        <Button
          aria-label="Close runtime sessions"
          className="absolute right-2.5 top-2.5"
          onClick={onClose}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <X />
        </Button>
      </header>

      <div className="buzz-sidebar-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {!indexedId ? (
          <EmptyState
            detail={`${runtime.label} is installed, but Polyphonic does not currently discover or index its local session history.`}
            title="No indexed session source"
          />
        ) : sessionsQuery.isLoading ? (
          <div
            aria-live="polite"
            className="flex items-center gap-2 px-2 py-8 text-sm text-muted-foreground"
          >
            <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
            Loading indexed sessions…
          </div>
        ) : sessionsQuery.isError ? (
          <div className="space-y-3 rounded-xl border border-border/55 bg-card/20 p-4">
            <p className="text-sm font-medium">Sessions are unavailable</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Polyphonic could not read the existing Brain session index.
            </p>
            <Button
              onClick={() => void sessionsQuery.refetch()}
              size="xs"
              type="button"
              variant="outline"
            >
              <RefreshCw /> Retry
            </Button>
          </div>
        ) : needsSource ? (
          <div className="space-y-3 rounded-xl border border-border/55 bg-card/20 p-4">
            <p className="text-sm font-medium">Connect session history first</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Brain already knows how to discover {runtime.label} history. A
              connected local index is required before sessions appear here.
            </p>
            <Button
              onClick={onOpenBrain}
              size="xs"
              type="button"
              variant="outline"
            >
              Open Brain <ArrowRight />
            </Button>
          </div>
        ) : (list?.sessions.length ?? 0) === 0 ? (
          <EmptyState
            detail="The connected source contains no indexed visible conversations yet."
            title="No sessions found"
          />
        ) : (
          <div className="space-y-2" data-testid="runtime-session-list">
            {sourceNeedsAttention ? (
              <div className="mb-3 flex gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
                Brain reports this source needs attention. Only unchanged,
                verified excerpts can be used.
              </div>
            ) : null}
            {list?.sessions.map((session) => (
              <SessionCard
                isPending={selectedSessionId === session.sessionId}
                key={session.sessionId}
                onStart={() => void startWithContext(session)}
                session={session}
              />
            ))}
            {list?.truncated ? (
              <p className="px-2 py-2 text-2xs leading-relaxed text-muted-foreground">
                Showing the latest {list.sessions.length} of{" "}
                {list.totalSessionCount} indexed sessions.
              </p>
            ) : null}
          </div>
        )}
        {operationError ? (
          <p
            className="mt-3 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs leading-relaxed text-destructive"
            role="alert"
          >
            {operationError}
          </p>
        ) : null}
      </div>
    </>
  );
}

function SessionCard({
  isPending,
  onStart,
  session,
}: {
  isPending: boolean;
  onStart: () => void;
  session: ConnectedRuntimeSession;
}) {
  return (
    <article
      className={cn(
        "rounded-xl border border-border/50 bg-card/15 p-3 transition-colors",
        session.available && "hover:border-border/80 hover:bg-card/25",
      )}
      data-testid={`runtime-session-${session.sessionId}`}
    >
      <h3 className="line-clamp-2 text-sm font-medium leading-snug">
        {session.title}
      </h3>
      <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
        {session.preview}
      </p>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-2xs text-ink-faint">
          {formatSessionMeta(session)}
        </span>
        <Button
          disabled={!session.available || isPending}
          onClick={onStart}
          size="xs"
          type="button"
          variant="ghost"
        >
          {isPending ? (
            <LoaderCircle className="animate-spin motion-reduce:animate-none" />
          ) : null}
          Start with this context
        </Button>
      </div>
    </article>
  );
}

function formatSessionMeta(session: ConnectedRuntimeSession) {
  const count = `${session.visibleMessageCount} visible message${session.visibleMessageCount === 1 ? "" : "s"}`;
  if (!session.updatedAt) return count;
  const timestamp = new Date(session.updatedAt);
  if (Number.isNaN(timestamp.getTime())) return count;
  return `${count} · ${new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(timestamp)}`;
}

function EmptyState({ detail, title }: { detail: string; title: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border/55 px-4 py-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        {detail}
      </p>
    </div>
  );
}
