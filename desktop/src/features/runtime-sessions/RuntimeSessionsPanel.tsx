import * as React from "react";
import {
  AlertTriangle,
  ArrowRight,
  LoaderCircle,
  RefreshCw,
  Search,
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
import {
  getRuntimeSessionContextGeneration,
  type RuntimeSessionStartAuthority,
} from "./runtimeSessionHandoff";
import {
  indexedRuntimeId,
  isRuntimeSessionStartCurrent,
  runtimeConnectionKey,
  runtimeSessionActionLabel,
  type RuntimeSessionStartSnapshot,
} from "./runtimeSessionModel";

export function RuntimeSessionsPanel({
  contextScopeKey,
  isMobile,
  onClose,
  onOpenBrain,
  onStartContext,
  runtime,
}: {
  contextScopeKey: string | null;
  isMobile: boolean;
  onClose: () => void;
  onOpenBrain: () => void;
  onStartContext: (
    context: ConnectedRuntimeSessionContext,
    authority: RuntimeSessionStartAuthority,
  ) => boolean;
  runtime: RuntimeConnectionStatusV1 | null;
}) {
  if (!runtime) return null;

  const content = (
    <RuntimeSessionsPanelContent
      contextScopeKey={contextScopeKey}
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
  contextScopeKey,
  onClose,
  onOpenBrain,
  onStartContext,
  runtime,
}: {
  contextScopeKey: string | null;
  onClose: () => void;
  onOpenBrain: () => void;
  onStartContext: (
    context: ConnectedRuntimeSessionContext,
    authority: RuntimeSessionStartAuthority,
  ) => boolean;
  runtime: RuntimeConnectionStatusV1;
}) {
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const indexedId = indexedRuntimeId(runtime.runtimeId);
  const runtimeKey = runtimeConnectionKey(runtime);
  const sessionsQuery = useRuntimeSessionsQuery(indexedId);
  const contextMutation = useRuntimeSessionContextMutation();
  const mountedRef = React.useRef(false);
  const pendingRef = React.useRef(false);
  const requestIdRef = React.useRef(0);
  const runtimeKeyRef = React.useRef(runtimeKey);
  const scopeKeyRef = React.useRef(contextScopeKey ?? "");
  runtimeKeyRef.current = runtimeKey;
  scopeKeyRef.current = contextScopeKey ?? "";
  const [selectedSessionId, setSelectedSessionId] = React.useState<
    string | null
  >(null);
  const [operationError, setOperationError] = React.useState<string | null>(
    null,
  );
  const [search, setSearch] = React.useState("");

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pendingRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  React.useEffect(() => {
    runtimeKeyRef.current = runtimeKey;
    scopeKeyRef.current = contextScopeKey ?? "";
    pendingRef.current = false;
    requestIdRef.current += 1;
    setSelectedSessionId(null);
    setOperationError(null);
    setSearch("");
    headingRef.current?.focus({ preventScroll: true });
  }, [contextScopeKey, runtimeKey]);

  function currentStartSnapshot(): RuntimeSessionStartSnapshot {
    return {
      mounted: mountedRef.current,
      requestId: requestIdRef.current,
      runtimeKey: runtimeKeyRef.current,
      scopeKey: scopeKeyRef.current,
    };
  }

  async function startWithContext(session: ConnectedRuntimeSession) {
    if (
      !indexedId ||
      !session.available ||
      !contextScopeKey ||
      pendingRef.current
    ) {
      return;
    }
    pendingRef.current = true;
    const expected: RuntimeSessionStartSnapshot = {
      mounted: true,
      requestId: requestIdRef.current + 1,
      runtimeKey,
      scopeKey: contextScopeKey,
    };
    requestIdRef.current = expected.requestId;
    const authority: RuntimeSessionStartAuthority = {
      handoffGeneration: getRuntimeSessionContextGeneration(),
      runtimeKey,
      scopeKey: contextScopeKey,
    };
    setSelectedSessionId(session.sessionId);
    setOperationError(null);
    try {
      const context = await contextMutation.mutateAsync({
        runtimeId: indexedId,
        sessionId: session.sessionId,
      });
      if (!isRuntimeSessionStartCurrent(expected, currentStartSnapshot())) {
        return;
      }
      if (!onStartContext(context, authority)) {
        setOperationError(
          "The active community changed before context could be attached. Choose the session again.",
        );
      }
    } catch {
      if (isRuntimeSessionStartCurrent(expected, currentStartSnapshot())) {
        setOperationError(
          "That indexed session changed or is unavailable. Refresh it in Brain, then try again.",
        );
      }
    } finally {
      if (isRuntimeSessionStartCurrent(expected, currentStartSnapshot())) {
        pendingRef.current = false;
        setSelectedSessionId(null);
      }
    }
  }

  const list = sessionsQuery.data;
  const sourceStatus = list?.sourceStatus;
  const needsSource = sourceStatus === "not_connected";
  const sourceNeedsAttention =
    sourceStatus === "needs_attention" || sourceStatus === "unavailable";
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleSessions =
    list?.sessions.filter((session) => {
      if (!normalizedSearch) return true;
      return `${session.title} ${session.preview}`
        .toLocaleLowerCase()
        .includes(normalizedSearch);
    }) ?? [];

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
              Browse local history or bring one session into a new Polyphonic
              conversation as context.
            </p>
          </div>
        </div>
        <Button
          aria-label={`Close ${runtime.label} sessions`}
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
        ) : sourceNeedsAttention && (list?.sessions.length ?? 0) === 0 ? (
          <EmptyState
            detail="One or more connected session indexes are stale or invalid. Refresh them in Brain before using their context."
            title="Session index needs attention"
          />
        ) : list?.truncated && list.sessions.length === 0 ? (
          <EmptyState
            detail={`${list.totalSessionCount} local sessions exist, but none fit within this panel's bounded read limit.`}
            title="Sessions exceed the read limit"
          />
        ) : (list?.sessions.length ?? 0) === 0 ? (
          <EmptyState
            detail="The connected source contains no visible conversations yet."
            title="No sessions found"
          />
        ) : (
          <div className="space-y-2" data-testid="runtime-session-list">
            {sourceNeedsAttention ? (
              <div className="mb-3 flex gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
                Brain reports this source needs attention. Readable sessions
                remain available while you repair the connection.
              </div>
            ) : null}
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <span className="sr-only">Search {runtime.label} sessions</span>
              <input
                className="h-9 w-full rounded-lg border border-border/50 bg-card/20 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-border focus:bg-card/30"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search sessions"
                type="search"
                value={search}
              />
            </label>
            {visibleSessions.map((session, index) => (
              <SessionCard
                isDisabled={
                  selectedSessionId !== null || contextScopeKey === null
                }
                isPending={selectedSessionId === session.sessionId}
                key={session.sessionId}
                onStart={() => void startWithContext(session)}
                position={index + 1}
                session={session}
              />
            ))}
            {visibleSessions.length === 0 ? (
              <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                No sessions match this search.
              </p>
            ) : null}
            {list?.truncated ? (
              <p className="px-2 py-2 text-2xs leading-relaxed text-muted-foreground">
                Showing the {list.sessions.length} most recent of{" "}
                {list.totalSessionCount} local sessions.
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
  isDisabled,
  isPending,
  onStart,
  position,
  session,
}: {
  isDisabled: boolean;
  isPending: boolean;
  onStart: () => void;
  position: number;
  session: ConnectedRuntimeSession;
}) {
  const titleId = `runtime-session-title-${session.sessionId}`;
  const descriptionId = `runtime-session-description-${session.sessionId}`;
  return (
    <article
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      className={cn(
        "rounded-xl border border-border/50 bg-card/15 p-3 transition-colors",
        session.available && "hover:border-border/80 hover:bg-card/25",
      )}
      data-testid={`runtime-session-${session.sessionId}`}
    >
      <h3
        className="line-clamp-2 text-sm font-medium leading-snug"
        id={titleId}
      >
        {session.title}
      </h3>
      <p
        className="mt-1 line-clamp-1 text-xs text-muted-foreground"
        id={descriptionId}
      >
        {session.preview}
      </p>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-2xs text-ink-faint">
          {formatSessionMeta(session)}
        </span>
        <Button
          aria-describedby={descriptionId}
          aria-label={runtimeSessionActionLabel(session.title, position)}
          disabled={!session.available || isDisabled}
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
  if (!session.updatedAt) return "Local session";
  const timestamp = new Date(session.updatedAt);
  if (Number.isNaN(timestamp.getTime())) return "Local session";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
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
