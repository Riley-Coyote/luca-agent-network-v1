import * as React from "react";
import { FolderKanban, FolderX, Plus, Settings2 } from "lucide-react";

import {
  useCreateLucaProjectMutation,
  useLucaProjectsQuery,
  useUpdateLucaProjectMutation,
} from "@/features/luca-projects/hooks";
import type { LucaProject } from "@/features/luca-projects/api";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";

type ProjectDraft = {
  name: string;
  instructions: string;
  workingFolder: string;
};

const EMPTY_DRAFT: ProjectDraft = {
  name: "",
  instructions: "",
  workingFolder: "",
};

export function LucaProjectsScreen({
  onOpenProject,
}: {
  onOpenProject: (projectId: string) => void;
}) {
  const projectsQuery = useLucaProjectsQuery();
  const createProject = useCreateLucaProjectMutation();
  const updateProject = useUpdateLucaProjectMutation();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<LucaProject | null>(null);
  const [draft, setDraft] = React.useState<ProjectDraft>(EMPTY_DRAFT);

  const openCreate = () => {
    setEditing(null);
    setDraft(EMPTY_DRAFT);
    setDialogOpen(true);
  };
  const openEdit = (project: LucaProject) => {
    setEditing(project);
    setDraft({
      name: project.name,
      instructions: project.instructions ?? "",
      workingFolder: project.workingFolder ?? "",
    });
    setDialogOpen(true);
  };
  const save = async () => {
    if (!draft.name.trim()) return;
    if (editing) {
      await updateProject.mutateAsync({
        projectId: editing.id,
        name: draft.name.trim(),
        instructions: draft.instructions.trim() || null,
        workingFolder: draft.workingFolder.trim() || null,
      });
    } else {
      const project = await createProject.mutateAsync({
        name: draft.name.trim(),
        instructions: draft.instructions.trim() || undefined,
        workingFolder: draft.workingFolder.trim() || undefined,
      });
      onOpenProject(project.id);
    }
    setDialogOpen(false);
  };
  const projects = (projectsQuery.data ?? []).filter(
    (project) => !project.archived,
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-6 py-8">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Organize related chats and give agents the right instructions and
              working folder.
            </p>
          </div>
          <Button data-testid="create-project" onClick={openCreate}>
            <Plus className="size-4" />
            New project
          </Button>
        </header>

        {projectsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading projects…</p>
        ) : projects.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <article
                className="group rounded-xl border border-border/60 bg-card/65 p-4 shadow-sm transition-colors hover:border-border"
                key={project.id}
              >
                <div className="flex items-start gap-3">
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => onOpenProject(project.id)}
                    type="button"
                  >
                    <span className="mb-3 flex size-9 items-center justify-center rounded-lg bg-muted">
                      <FolderKanban className="size-4" />
                    </span>
                    <h2 className="truncate text-sm font-semibold">
                      {project.name}
                    </h2>
                    <p className="mt-1 line-clamp-2 min-h-10 text-sm text-muted-foreground">
                      {project.instructions || "No project instructions yet."}
                    </p>
                  </button>
                  <Button
                    aria-label={`Edit ${project.name}`}
                    onClick={() => openEdit(project)}
                    size="icon"
                    variant="ghost"
                  >
                    <Settings2 className="size-4" />
                  </Button>
                </div>
                <div className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
                  {project.workingFolderState === "missing" ? (
                    <>
                      <FolderX className="size-3.5 text-amber-500" />
                      <span className="text-amber-500">Reconnect folder</span>
                    </>
                  ) : project.workingFolderState === "connected" ? (
                    <>
                      <FolderKanban className="size-3.5" />
                      Folder connected
                    </>
                  ) : (
                    "No folder connected"
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border px-6 py-14 text-center">
            <FolderKanban className="mx-auto mb-3 size-8 text-muted-foreground" />
            <h2 className="text-sm font-semibold">No projects yet</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Create one when a group of chats should share context or a working
              folder.
            </p>
            <Button className="mt-5" onClick={openCreate} variant="secondary">
              Create your first project
            </Button>
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Project settings" : "New project"}
            </DialogTitle>
            <DialogDescription>
              Instructions and folder access stay on this device. Only the name
              and archived state sync through Luca.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <label
              className="grid gap-1.5 text-sm font-medium"
              htmlFor="project-name"
            >
              Name
              <Input
                autoFocus
                id="project-name"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="Website launch"
                value={draft.name}
              />
            </label>
            <label
              className="grid gap-1.5 text-sm font-medium"
              htmlFor="project-instructions"
            >
              Instructions{" "}
              <span className="font-normal text-muted-foreground">
                Optional
              </span>
              <Textarea
                id="project-instructions"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    instructions: event.target.value,
                  }))
                }
                placeholder="What agents should know whenever they work in this project"
                value={draft.instructions}
              />
            </label>
            <label
              className="grid gap-1.5 text-sm font-medium"
              htmlFor="project-working-folder"
            >
              Working folder{" "}
              <span className="font-normal text-muted-foreground">
                Optional
              </span>
              <Input
                id="project-working-folder"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    workingFolder: event.target.value,
                  }))
                }
                placeholder="/Users/you/Projects/website"
                value={draft.workingFolder}
              />
            </label>
          </div>
          <DialogFooter>
            <Button onClick={() => setDialogOpen(false)} variant="ghost">
              Cancel
            </Button>
            <Button
              disabled={
                !draft.name.trim() ||
                createProject.isPending ||
                updateProject.isPending
              }
              onClick={() => void save()}
            >
              {createProject.isPending || updateProject.isPending
                ? "Saving…"
                : editing
                  ? "Save changes"
                  : "Create project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
