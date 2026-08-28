import { ArrowUpRight, BookOpen, LoaderCircle, Search } from "lucide-react";
import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import {
  useCapabilitySkillDetail,
  useCapabilitySkills,
} from "@/features/capabilities/hooks";
import type { CapabilitySkillSummary } from "@/shared/api/tauriCapabilities";
import { cn } from "@/shared/lib/cn";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui/sheet";

type RuntimeFilter = "all" | string;

export function SkillLibraryPanel() {
  const skillsQuery = useCapabilitySkills();
  const { goNewMessage } = useAppNavigation();
  const [query, setQuery] = React.useState("");
  const [runtimeFilter, setRuntimeFilter] =
    React.useState<RuntimeFilter>("all");
  const [selectedSkill, setSelectedSkill] =
    React.useState<CapabilitySkillSummary | null>(null);
  const deferredQuery = React.useDeferredValue(
    query.trim().toLocaleLowerCase(),
  );
  const skills = skillsQuery.data ?? [];
  const runtimeIds = React.useMemo(
    () =>
      [...new Set(skills.flatMap((skill) => skill.runtimeIds))].sort((a, b) =>
        runtimeLabel(a).localeCompare(runtimeLabel(b)),
      ),
    [skills],
  );
  const visibleSkills = React.useMemo(
    () =>
      skills.filter((skill) => {
        if (
          runtimeFilter !== "all" &&
          !skill.runtimeIds.includes(runtimeFilter)
        ) {
          return false;
        }
        if (!deferredQuery) return true;
        const haystack = [
          skill.name,
          skill.description,
          ...skill.sourceLabels,
          ...skill.runtimeIds,
        ]
          .join(" ")
          .toLocaleLowerCase();
        return haystack.includes(deferredQuery);
      }),
    [deferredQuery, runtimeFilter, skills],
  );

  const handleUseSkill = React.useCallback(
    (skill: CapabilitySkillSummary) => {
      const runtime = preferredRuntime(skill.runtimeIds);
      setSelectedSkill(null);
      void goNewMessage({
        skill: skill.name,
        runtime,
      });
    },
    [goNewMessage],
  );

  return (
    <>
      <div className="skill-library-controls">
        <label className="artifact-library-search">
          <Search aria-hidden />
          <span className="sr-only">Search installed skills</span>
          <input
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search installed skills"
            value={query}
          />
        </label>
        <fieldset
          aria-label="Filter skills by runtime"
          className="artifact-library-filters"
        >
          <button
            aria-pressed={runtimeFilter === "all"}
            className={cn(runtimeFilter === "all" && "is-active")}
            onClick={() => setRuntimeFilter("all")}
            type="button"
          >
            All runtimes
          </button>
          {runtimeIds.map((runtimeId) => (
            <button
              aria-pressed={runtimeFilter === runtimeId}
              className={cn(runtimeFilter === runtimeId && "is-active")}
              key={runtimeId}
              onClick={() => setRuntimeFilter(runtimeId)}
              type="button"
            >
              {runtimeLabel(runtimeId)}
            </button>
          ))}
        </fieldset>
      </div>

      <div className="artifact-library-screen__body">
        {skillsQuery.isLoading ? <SkillLibraryLoading /> : null}
        {skillsQuery.isError ? (
          <SkillLibraryState
            action="Check again"
            onAction={() => void skillsQuery.refetch()}
            text="Your agents still work normally. Polyphonic could not read their installed skill catalogs."
            title="Skills are unavailable"
          />
        ) : null}
        {!skillsQuery.isLoading &&
        !skillsQuery.isError &&
        visibleSkills.length === 0 ? (
          <SkillLibraryState
            action={query || runtimeFilter !== "all" ? "Clear filters" : null}
            onAction={() => {
              setQuery("");
              setRuntimeFilter("all");
            }}
            text={
              skills.length === 0
                ? "Skills installed for your runtimes will appear here automatically."
                : "No installed skill matches this view."
            }
            title={skills.length === 0 ? "No skills found" : "Nothing found"}
          />
        ) : null}
        {visibleSkills.length > 0 ? (
          <ul className="skill-library-list">
            {visibleSkills.map((skill) => (
              <SkillRow
                key={skill.skillId}
                onOpen={() => setSelectedSkill(skill)}
                onUse={() => handleUseSkill(skill)}
                skill={skill}
              />
            ))}
          </ul>
        ) : null}
      </div>

      <footer className="artifact-library-screen__footer">
        <span>{visibleSkills.length} installed skills</span>
        <span>Owned and executed by your runtimes</span>
      </footer>

      <SkillDetailSheet
        onOpenChange={(open) => {
          if (!open) setSelectedSkill(null);
        }}
        onUse={() => {
          if (selectedSkill) handleUseSkill(selectedSkill);
        }}
        skill={selectedSkill}
      />
    </>
  );
}

function SkillRow({
  onOpen,
  onUse,
  skill,
}: {
  onOpen: () => void;
  onUse: () => void;
  skill: CapabilitySkillSummary;
}) {
  return (
    <li className="skill-library-row">
      <button
        className="skill-library-row__main"
        onClick={onOpen}
        type="button"
      >
        <span className="skill-library-row__icon">
          <BookOpen aria-hidden />
        </span>
        <span className="skill-library-row__copy">
          <strong>{skill.name}</strong>
          <span>{skill.description}</span>
        </span>
        <span className="skill-library-row__sources">
          {skill.sourceLabels.join(" · ")}
        </span>
      </button>
      <button
        aria-label={`Use ${skill.name} in a conversation`}
        className="skill-library-row__use"
        onClick={onUse}
        type="button"
      >
        Use <ArrowUpRight aria-hidden />
      </button>
    </li>
  );
}

function SkillDetailSheet({
  onOpenChange,
  onUse,
  skill,
}: {
  onOpenChange: (open: boolean) => void;
  onUse: () => void;
  skill: CapabilitySkillSummary | null;
}) {
  const detailQuery = useCapabilitySkillDetail(skill?.skillId ?? null);
  return (
    <Sheet onOpenChange={onOpenChange} open={skill !== null}>
      <SheetContent className="skill-detail-sheet sm:max-w-none" side="right">
        <SheetHeader className="skill-detail-sheet__header">
          <span className="artifact-library-screen__header-label">
            Installed skill
          </span>
          <SheetTitle>{skill?.name ?? "Skill"}</SheetTitle>
          <SheetDescription>
            {skill?.description ?? "Runtime-owned instructions"}
          </SheetDescription>
        </SheetHeader>
        <div className="skill-detail-sheet__meta">
          {(skill?.sourceLabels ?? []).map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div className="skill-detail-sheet__body">
          {detailQuery.isLoading ? (
            <div
              aria-label="Loading skill"
              className="skill-detail-sheet__loading"
              role="status"
            >
              <LoaderCircle aria-hidden className="animate-spin" />
              Reading skill…
            </div>
          ) : null}
          {detailQuery.isError ? (
            <p role="alert">This skill is no longer available.</p>
          ) : null}
          {detailQuery.data ? <pre>{detailQuery.data.content}</pre> : null}
        </div>
        <div className="skill-detail-sheet__footer">
          <p>
            Polyphonic opens a normal conversation. The runtime loads and
            executes its own skill.
          </p>
          <button disabled={!skill} onClick={onUse} type="button">
            Use in conversation <ArrowUpRight aria-hidden />
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SkillLibraryLoading() {
  return (
    <div
      aria-label="Loading installed skills"
      className="artifact-library-loading"
      role="status"
    >
      {[0, 1, 2, 3, 4].map((item) => (
        <i aria-hidden key={item} />
      ))}
    </div>
  );
}

function SkillLibraryState({
  action,
  onAction,
  text,
  title,
}: {
  action: string | null;
  onAction: () => void;
  text: string;
  title: string;
}) {
  return (
    <div className="artifact-library-state">
      <BookOpen aria-hidden />
      <h2>{title}</h2>
      <p>{text}</p>
      {action ? (
        <button onClick={onAction} type="button">
          {action}
        </button>
      ) : null}
    </div>
  );
}

function runtimeLabel(runtimeId: string): string {
  switch (runtimeId) {
    case "claude":
      return "Claude Code";
    case "codex":
      return "Codex";
    case "openclaw":
      return "OpenClaw";
    case "hermes":
      return "Hermes";
    case "goose":
      return "Goose";
    case "polyphonic":
      return "Polyphonic";
    default:
      return runtimeId;
  }
}

function preferredRuntime(runtimeIds: readonly string[]): string | undefined {
  return runtimeIds.find((runtimeId) => runtimeId !== "polyphonic");
}
