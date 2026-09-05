import * as React from "react";

import { Card } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";
import { cn } from "@/shared/lib/cn";
import { channelChrome } from "@/shared/layout/chromeLayout";
import { TopChromeInsetHeader } from "@/shared/layout/TopChromeInsetHeader";

type ViewLoadingFallbackKind =
  | "agents"
  | "brain"
  | "channel"
  | "forum"
  | "projects"
  | "pulse"
  | "workflows";

type ViewLoadingFallbackProps = {
  delayMs?: number;
  includeHeader?: boolean;
  kind: ViewLoadingFallbackKind;
};

/** The one don't-flash delay: skeletons and boot spinners appear only when a
 *  wait outlives this, so fast loads never flicker a loader. */
export const LOADING_REVEAL_DELAY_MS = 250;

function LoadingHeaderSkeleton() {
  return (
    <TopChromeInsetHeader data-tauri-drag-region flush>
      <header className="min-w-0 cursor-default select-none px-5 py-2">
        <div className="flex h-9 min-w-0 items-center gap-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1 overflow-hidden">
              <Skeleton className="h-4 w-4 shrink-0 rounded-sm" />
              <Skeleton className="h-4 w-28 max-w-[50vw]" />
            </div>
          </div>
          <div className="hidden shrink-0 items-center gap-1 sm:flex">
            <Skeleton className="h-8 w-16 rounded-lg" />
            <Skeleton className="h-8 w-8 rounded-lg" />
          </div>
        </div>
      </header>
    </TopChromeInsetHeader>
  );
}

function MessageRowsSkeleton() {
  return (
    <>
      {["first", "second", "third", "fourth"].map((row, index) => (
        <article
          className="relative mx-1 flex items-start gap-2.5 rounded-2xl px-2 py-2"
          key={row}
        >
          <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
          <div className="-mt-1 min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0">
              <Skeleton className="h-[15px] w-28" />
              <Skeleton className="h-3 w-10" />
            </div>
            <div className="mt-1 space-y-1.5 pb-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton
                className={index % 2 === 0 ? "h-4 w-4/5" : "h-4 w-2/3"}
              />
            </div>
            <div className="flex items-center gap-4">
              <Skeleton className="h-4 w-8 rounded-full" />
              <Skeleton className="h-4 w-8 rounded-full" />
              <Skeleton className="h-4 w-8 rounded-full" />
            </div>
          </div>
        </article>
      ))}
    </>
  );
}

function AgentRosterRowSkeleton({ variant = 0 }: { variant?: number }) {
  return (
    <div className="flex min-h-16 items-center gap-3 rounded-lg px-3 py-2">
      <Skeleton className="size-8 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1">
        <Skeleton className={cn("h-4", variant % 2 === 0 ? "w-28" : "w-20")} />
        <Skeleton
          className={cn("mt-2 h-3", variant % 3 === 0 ? "w-36" : "w-28")}
        />
      </div>
    </div>
  );
}

function AgentRosterLoadingSkeleton() {
  return (
    <aside className="flex min-h-0 w-full shrink-0 flex-col border-border/60 bg-card/45 md:w-[292px] md:border-r">
      <header className="space-y-4 border-b border-border/55 px-4 pb-4 pt-11 md:pt-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Skeleton className="h-5 w-16" />
            <Skeleton className="mt-2 h-3 w-20" />
          </div>
          <Skeleton className="size-9 rounded-md" />
        </div>
        <Skeleton className="h-9 w-full rounded-md" />
        <div className="flex gap-1">
          <Skeleton className="h-7 w-10 rounded-md" />
          <Skeleton className="h-7 w-16 rounded-md" />
          <Skeleton className="h-7 w-20 rounded-md" />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden px-2 py-2">
        {["one", "two", "three", "four", "five"].map((key, index) => (
          <AgentRosterRowSkeleton key={key} variant={index} />
        ))}
      </div>

      <footer className="grid grid-cols-2 gap-1 border-t border-border/55 p-2">
        <Skeleton className="h-9 rounded-md" />
        <Skeleton className="h-9 rounded-md" />
      </footer>
    </aside>
  );
}

function AgentWorkspaceLoadingSkeleton() {
  return (
    <main className="hidden min-h-0 min-w-0 flex-1 flex-col bg-card/60 md:flex">
      <header className="border-b border-border/60 px-5 py-5 sm:px-7">
        <div className="flex min-w-0 flex-wrap items-start gap-x-4 gap-y-3">
          <Skeleton className="size-[52px] shrink-0 rounded-full" />
          <div className="min-w-[10rem] flex-1 pt-0.5">
            <div className="flex items-center gap-3">
              <Skeleton className="h-6 w-36" />
              <Skeleton className="h-3 w-16" />
            </div>
            <Skeleton className="mt-3 h-4 w-64 max-w-full" />
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Skeleton className="h-9 w-24 rounded-md" />
            <Skeleton className="size-9 rounded-md" />
            <Skeleton className="size-9 rounded-md" />
          </div>
        </div>
        <div className="mt-5 flex gap-6">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-16" />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden px-5 py-6 sm:px-7">
        <div className="mx-auto w-full max-w-4xl">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="mt-4 h-4 w-full max-w-2xl" />
          <Skeleton className="mt-2 h-4 w-5/6 max-w-xl" />
          <div className="mt-7 divide-y divide-border/45 border-y border-border/55">
            {["one", "two", "three", "four"].map((key, index) => (
              <div
                className="grid gap-3 py-4 sm:grid-cols-[140px_minmax(0,1fr)]"
                key={key}
              >
                <Skeleton className="h-3 w-20" />
                <Skeleton
                  className={cn("h-4", index % 2 === 0 ? "w-52" : "w-40")}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}

function AgentsLoadingBody() {
  return (
    <div
      className="relative z-10 flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background"
      data-testid="agents-loading-layout"
    >
      <AgentRosterLoadingSkeleton />
      <AgentWorkspaceLoadingSkeleton />
    </div>
  );
}

function CardListLoadingBody() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-4 pb-4 pt-4 sm:px-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-8 w-8 rounded-lg" />
        </div>
        <Skeleton className="h-9 w-36 rounded-lg" />
      </div>

      <div className="space-y-2">
        {["first", "second", "third", "fourth"].map((card) => (
          <Card className="p-4" key={card}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-3">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-5 w-44" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
                <Skeleton className="h-4 w-full max-w-2xl" />
                <div className="flex flex-wrap gap-2">
                  <Skeleton className="h-5 w-20 rounded-full" />
                  <Skeleton className="h-5 w-24 rounded-full" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
              </div>
              <div className="hidden shrink-0 gap-2 sm:flex">
                <Skeleton className="h-8 w-8 rounded-lg" />
                <Skeleton className="h-8 w-8 rounded-lg" />
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ChannelLoadingBody({ hasHeader = false }: { hasHeader?: boolean }) {
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-2 pb-32 pt-1">
        <div
          className={cn(
            "flex w-full flex-col gap-4",
            // The real channel header overlays content, so reserve its
            // measured height — unless an in-flow header skeleton is above.
            hasHeader ? "pt-3" : channelChrome.contentPadding,
          )}
        >
          <MessageRowsSkeleton />
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
        <div className="pointer-events-auto">
          <div className="relative z-10 shrink-0 bg-transparent px-5 pb-2 pt-0">
            <div
              aria-hidden="true"
              className="absolute inset-x-0 bottom-0 h-5 bg-background"
            />
            <div className="relative isolate rounded-2xl border border-border/50 bg-background/80 px-3 pb-2 pt-3 shadow-none backdrop-blur-md supports-[backdrop-filter]:bg-background/70 dark:bg-background/70 dark:backdrop-blur-xl dark:supports-[backdrop-filter]:bg-background/55 sm:px-4">
              <Skeleton className="h-5 w-56 max-w-full" />
              <div className="mt-4 flex items-center gap-2">
                <Skeleton className="h-8 w-8 rounded-lg" />
                <Skeleton className="h-8 w-8 rounded-lg" />
                <Skeleton className="h-8 w-8 rounded-lg" />
                <Skeleton className="ml-auto h-8 w-8 rounded-full" />
              </div>
            </div>
          </div>
          <div className="h-7 bg-background px-5 pb-1 pt-0">
            <div className="flex h-full w-full items-center gap-2" />
          </div>
        </div>
      </div>
    </div>
  );
}

function ForumLoadingBody({ hasHeader = false }: { hasHeader?: boolean }) {
  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
        !hasHeader && channelChrome.contentPadding,
      )}
    >
      <div className="border-b border-border/60 p-4">
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-3">
          {["first", "second", "third"].map((card) => (
            <Card className="p-4" key={card}>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <div className="flex items-center gap-3">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-14" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The Brain view's card grid, quietly. */
function BrainLoadingBody() {
  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <div className="mx-auto w-full max-w-5xl px-5 pb-12 pt-14 sm:px-7 sm:pt-7 lg:px-9">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="mt-3 h-4 w-80 max-w-full" />
        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          {["one", "two", "three", "four"].map((key) => (
            <Card className="p-5" key={key}>
              <div className="flex items-start justify-between">
                <Skeleton className="h-10 w-10 rounded-xl" />
                <Skeleton className="h-4 w-16 rounded-full" />
              </div>
              <Skeleton className="mt-5 h-5 w-32" />
              <Skeleton className="mt-3 h-4 w-full" />
              <Skeleton className="mt-1.5 h-4 w-4/5" />
              <Skeleton className="mt-4 h-3 w-40" />
              <Skeleton className="mt-4 h-9 w-32 rounded-full" />
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ViewLoadingFallback({
  delayMs = LOADING_REVEAL_DELAY_MS,
  includeHeader = false,
  kind,
}: ViewLoadingFallbackProps) {
  const [isVisible, setIsVisible] = React.useState(delayMs <= 0);

  React.useEffect(() => {
    if (delayMs <= 0) {
      setIsVisible(true);
      return;
    }

    const timer = window.setTimeout(() => setIsVisible(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs]);

  const shouldShowChannelHeader =
    includeHeader && (kind === "channel" || kind === "forum");

  return (
    <div
      aria-hidden={!isVisible}
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden transition-opacity duration-100 motion-reduce:transition-none",
        isVisible ? "opacity-100" : "pointer-events-none opacity-0",
      )}
      data-testid="view-loading-fallback"
      data-visible={isVisible ? "true" : "false"}
    >
      {shouldShowChannelHeader ? <LoadingHeaderSkeleton /> : null}
      {kind === "agents" ? <AgentsLoadingBody /> : null}
      {kind === "brain" ? <BrainLoadingBody /> : null}
      {kind === "workflows" ? <CardListLoadingBody /> : null}
      {kind === "projects" ? <CardListLoadingBody /> : null}
      {kind === "channel" ? (
        <ChannelLoadingBody hasHeader={shouldShowChannelHeader} />
      ) : null}
      {kind === "forum" ? (
        <ForumLoadingBody hasHeader={shouldShowChannelHeader} />
      ) : null}
      {kind === "pulse" ? (
        <ChannelLoadingBody hasHeader={shouldShowChannelHeader} />
      ) : null}
    </div>
  );
}
