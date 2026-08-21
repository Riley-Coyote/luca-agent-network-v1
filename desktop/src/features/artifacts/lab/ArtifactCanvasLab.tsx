import {
  Activity,
  Brain,
  ChevronLeft,
  ChevronRight,
  Library,
  MessageCirclePlus,
  Search,
  Settings,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";

import { ARTIFACT_LAB_FIXTURES } from "@/features/artifacts/lab/fixtures";
import { ArtifactWorkspace } from "@/features/artifacts/ui/ArtifactWorkspace";

const NAV_ITEMS: readonly {
  icon: LucideIcon;
  label: string;
  active?: boolean;
}[] = [
  { icon: Search, label: "Search" },
  { icon: MessageCirclePlus, label: "New conversation" },
  { icon: Users, label: "Residents" },
  { icon: Activity, label: "Activity" },
  { icon: Brain, label: "Brain" },
  { icon: Library, label: "Library", active: true },
  { icon: Settings, label: "Settings" },
];

function LabRail() {
  return (
    <aside
      className="hidden w-[15.6rem] shrink-0 flex-col px-2.5 pb-3 pt-2.5 md:flex"
      data-testid="artifact-lab-rail"
    >
      <div className="flex h-9 items-center gap-2 px-1 text-muted-foreground/60">
        <Sparkles aria-hidden className="h-3.5 w-3.5" />
        <ChevronLeft aria-hidden className="h-3.5 w-3.5" />
        <ChevronRight aria-hidden className="h-3.5 w-3.5" />
      </div>
      <nav aria-label="Primary" className="mt-2 space-y-0.5">
        {NAV_ITEMS.map(({ active, icon: Icon, label }) => (
          <button
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "flex h-8 w-full items-center gap-2.5 rounded-md border border-white/10 bg-white/[0.055] px-2.5 text-left text-xs text-foreground"
                : "flex h-8 w-full items-center gap-2.5 rounded-md border border-transparent px-2.5 text-left text-xs text-muted-foreground transition-colors hover:bg-white/[0.035] hover:text-foreground"
            }
            key={label}
            type="button"
          >
            <Icon aria-hidden className="h-3.5 w-3.5" strokeWidth={1.7} />
            {label}
          </button>
        ))}
      </nav>
      <div className="mt-6 px-2 font-mono text-3xs uppercase tracking-[0.16em] text-muted-foreground/50">
        Projects
      </div>
      <div className="mt-1.5 space-y-0.5">
        <button
          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-muted-foreground hover:text-foreground"
          type="button"
        >
          <span className="text-muted-foreground/45">⌁</span> Polyphonic
        </button>
        <button
          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-muted-foreground hover:text-foreground"
          type="button"
        >
          <span className="text-muted-foreground/45">⌁</span> Runtime atlas
        </button>
      </div>
      <div className="mt-5 px-2 font-mono text-3xs uppercase tracking-[0.16em] text-muted-foreground/50">
        DMs
      </div>
      <div className="mt-1.5 space-y-0.5">
        <button
          className="flex h-8 w-full items-center justify-between rounded-md px-2 text-left text-xs text-muted-foreground hover:text-foreground"
          type="button"
        >
          <span>Luca</span>
          <span className="size-1 rounded-full bg-foreground/55" />
        </button>
        <button
          className="flex h-8 w-full items-center rounded-md px-2 text-left text-xs text-muted-foreground hover:text-foreground"
          type="button"
        >
          Vektor
        </button>
      </div>
      <div className="mt-auto flex items-center gap-2.5 px-2 py-2">
        <span className="flex size-7 items-center justify-center rounded-full bg-white/10 text-2xs text-foreground">
          C
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium">Coyote</p>
          <p className="text-3xs text-muted-foreground">Personal network</p>
        </div>
      </div>
    </aside>
  );
}

export function ArtifactCanvasLab() {
  React.useLayoutEffect(() => {
    const root = document.documentElement;
    const hadShell = root.hasAttribute("data-luca-shell");
    const hadDark = root.classList.contains("dark");
    root.setAttribute("data-luca-shell", "");
    root.classList.add("dark");
    return () => {
      if (!hadShell) root.removeAttribute("data-luca-shell");
      if (!hadDark) root.classList.remove("dark");
    };
  }, []);

  return (
    <main
      className="flex h-dvh min-h-0 overflow-hidden bg-black font-sans text-foreground"
      data-testid="artifact-canvas-lab"
    >
      <LabRail />
      <div className="flex min-w-0 flex-1 p-2 pl-px">
        <div
          className="flex min-w-0 flex-1 overflow-hidden rounded-[var(--radius)] border border-border bg-background"
          data-luca-conversation-surface
        >
          <ArtifactWorkspace
            artifacts={ARTIFACT_LAB_FIXTURES}
            initialArtifactId="threshold-study"
          />
        </div>
      </div>
    </main>
  );
}
